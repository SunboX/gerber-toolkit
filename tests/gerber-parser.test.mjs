import assert from 'node:assert/strict'
import test from 'node:test'

import { GerberParser } from '../src/parser.mjs'

/**
 * Encodes a text fixture as an ArrayBuffer.
 * @param {string} text Fixture text.
 * @returns {ArrayBuffer}
 */
function bytes(text) {
    return new TextEncoder().encode(text).buffer
}

test('GerberParser parses units, format, apertures, draws, flashes, and bounds', () => {
    const source = [
        'G04 generated synthetic layer*',
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%ADD10C,0.200*%',
        'D10*',
        'X000000Y000000D02*',
        'X100000Y000000D01*',
        'X100000Y050000D01*',
        'X025000Y025000D03*',
        'M02*'
    ].join('\n')

    const document = GerberParser.parseArrayBuffer(
        'board-F_Cu.gtl',
        bytes(source)
    )

    assert.equal(document.sourceFormat, 'gerber')
    assert.equal(document.kind, 'pcb')
    assert.equal(document.pcb.fabrication.layers.length, 1)
    assert.equal(document.pcb.fabrication.layers[0].role, 'top-copper')
    assert.equal(document.pcb.fabrication.layers[0].primitives.length, 3)
    assert.deepEqual(document.pcb.bounds, {
        minX: -0.1,
        minY: -0.1,
        maxX: 10.1,
        maxY: 5.1
    })
    assert.deepEqual(document.pcb.components, [])
    assert.equal(document.pcb.boardOutline.widthMil, 401.574803)
    assert.equal(document.pcb.boardOutline.heightMil, 204.724409)
    assert.equal(document.pcb.boardOutline.segments.length, 4)
})

test('GerberParser converts inch aperture dimensions to millimeters', () => {
    const source = [
        '%FSLAX24Y24*%',
        '%MOIN*%',
        '%ADD10C,0.0100*%',
        '%ADD11R,0.0200X0.0100*%',
        'D10*',
        'X010000Y010000D02*',
        'X020000Y010000D01*',
        'X030000Y010000D03*',
        'D11*',
        'X040000Y010000D03*',
        'M02*'
    ].join('\n')

    const document = GerberParser.parseArrayBuffer(
        'sample-F_Cu.gtl',
        bytes(source)
    )
    const [line, circle, rect] = document.pcb.fabrication.layers[0].primitives

    assert.equal(line.width, 0.254)
    assert.equal(circle.diameter, 0.254)
    assert.equal(rect.width, 0.508)
    assert.equal(rect.height, 0.254)
})

test('GerberParser flashes current aperture for standalone D03 operations', () => {
    const source = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%ADD10R,1.000X0.500*%',
        'D10*',
        'X010000Y020000D02*',
        'D03*',
        'X030000Y020000D02*',
        'D03*',
        'M02*'
    ].join('\n')

    const document = GerberParser.parseArrayBuffer(
        'sample-F_Mask.gts',
        bytes(source)
    )
    const flashes = document.pcb.fabrication.layers[0].primitives.filter(
        (primitive) => primitive.type === 'flash'
    )

    assert.deepEqual(
        flashes.map(({ type, shape, width, height, x, y, polarity }) => ({
            type,
            shape,
            width,
            height,
            x,
            y,
            polarity
        })),
        [
            {
                type: 'flash',
                shape: 'rect',
                width: 1,
                height: 0.5,
                x: 1,
                y: 2,
                polarity: 'dark'
            },
            {
                type: 'flash',
                shape: 'rect',
                width: 1,
                height: 0.5,
                x: 3,
                y: 2,
                polarity: 'dark'
            }
        ]
    )
})

test('GerberParser parses Excellon drill tools and hits', () => {
    const source = [
        'M48',
        'METRIC,TZ',
        'T01C0.600',
        '%',
        'T01',
        'X050000Y060000',
        'M30'
    ].join('\n')

    const document = GerberParser.parseArrayBuffer(
        'board-PTH.drl',
        bytes(source)
    )

    assert.equal(document.sourceFormat, 'gerber')
    assert.equal(document.pcb.fabrication.layers[0].role, 'plated-drill')
    assert.equal(document.pcb.fabrication.layers[0].drills.length, 1)
    assert.deepEqual(document.pcb.fabrication.layers[0].drills[0], {
        x: 5,
        y: 6,
        diameter: 0.6,
        plated: true,
        tool: 'T01'
    })
})

test('GerberParser ignores legacy unit controls without drawing geometry', () => {
    const source = [
        'G04 generated synthetic mechanical layer*',
        '%FSLAX24Y24*%',
        'G70*',
        'G01*',
        'G75*',
        'M02*'
    ].join('\n')

    const document = GerberParser.parseArrayBuffer(
        'sample-profile.gm1',
        bytes(source)
    )
    const layer = document.pcb.fabrication.layers[0]

    assert.equal(layer.unit, 'inch')
    assert.equal(layer.primitives.length, 0)
    assert.deepEqual(layer.bounds, { minX: 0, minY: 0, maxX: 1, maxY: 1 })
})

test('GerberParser detects Excellon text files with mixed drill tools', () => {
    const source = [
        'M48',
        ';FILE_FORMAT=2:4',
        'INCH,LZ',
        ';TYPE=PLATED',
        'T1F00S00C0.0140',
        ';TYPE=NON_PLATED',
        'T2F00S00C0.0236',
        '%',
        'T01',
        'X010000Y020000',
        'X011000',
        'Y021000',
        'T02',
        'X012000Y022000',
        'M30'
    ].join('\n')

    const document = GerberParser.parseArrayBuffer(
        'sample-round-holes.TXT',
        bytes(source)
    )
    const layer = document.pcb.fabrication.layers[0]

    assert.equal(layer.role, 'plated-drill')
    assert.equal(layer.drills.length, 4)
    assert.deepEqual(layer.drills[0], {
        x: 25.4,
        y: 50.8,
        diameter: 0.3556,
        plated: true,
        tool: 'T01'
    })
    assert.deepEqual(layer.drills[1], {
        x: 27.94,
        y: 50.8,
        diameter: 0.3556,
        plated: true,
        tool: 'T01'
    })
    assert.deepEqual(layer.drills[2], {
        x: 27.94,
        y: 53.34,
        diameter: 0.3556,
        plated: true,
        tool: 'T01'
    })
    assert.deepEqual(layer.drills[3], {
        x: 30.48,
        y: 55.88,
        diameter: 0.59944,
        plated: false,
        tool: 'T02'
    })
})

test('GerberParser honors Excellon retained-leading-zero coordinates', () => {
    const source = [
        'M48',
        ';FILE_FORMAT=2:4',
        'INCH,LZ',
        ';TYPE=PLATED',
        'T1F00S00C0.0140',
        '%',
        'T01',
        'X04Y03765',
        'X044',
        'Y0394',
        'M30'
    ].join('\n')

    const document = GerberParser.parseArrayBuffer(
        'sample-short-coordinates.TXT',
        bytes(source)
    )
    const layer = document.pcb.fabrication.layers[0]

    assert.deepEqual(layer.drills, [
        {
            x: 101.6,
            y: 95.631,
            diameter: 0.3556,
            plated: true,
            tool: 'T01'
        },
        {
            x: 111.76,
            y: 95.631,
            diameter: 0.3556,
            plated: true,
            tool: 'T01'
        },
        {
            x: 111.76,
            y: 100.076,
            diameter: 0.3556,
            plated: true,
            tool: 'T01'
        }
    ])
})

test('GerberParser parses routed Excellon slots from text files', () => {
    const source = [
        'M48',
        ';FILE_FORMAT=2:4',
        'INCH,LZ',
        ';TYPE=PLATED',
        'T2F00S00C0.0236',
        '%',
        'G90',
        'G05',
        'T02',
        'G00X010000Y020000',
        'M15',
        'G01Y021000',
        'M16',
        'M30'
    ].join('\n')

    const document = GerberParser.parseArrayBuffer(
        'sample-slots.TXT',
        bytes(source)
    )
    const layer = document.pcb.fabrication.layers[0]

    assert.equal(layer.role, 'plated-drill')
    assert.deepEqual(layer.drills, [
        {
            type: 'slot',
            x1: 25.4,
            y1: 50.8,
            x2: 25.4,
            y2: 53.34,
            diameter: 0.59944,
            plated: true,
            tool: 'T02'
        }
    ])
})
