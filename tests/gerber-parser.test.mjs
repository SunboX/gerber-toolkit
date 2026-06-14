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
