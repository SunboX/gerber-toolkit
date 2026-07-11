import assert from 'node:assert/strict'
import test from 'node:test'

import { GerberParser } from '../src/legacy-parser.mjs'
import {
    GerberPcbSvgRenderer,
    PcbInteractionIndex
} from '../src/legacy-renderers.mjs'

/**
 * Encodes a text fixture as an ArrayBuffer.
 * @param {string} text Fixture text.
 * @returns {ArrayBuffer}
 */
function bytes(text) {
    return new TextEncoder().encode(text).buffer
}

test('GerberParser expands macro apertures with parameters and expressions', () => {
    const source = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%AMPLUS*',
        '$3=$1+$2*',
        '1,1,$1,0,0*',
        '20,1,$2,0,-$1,0,$1,0*',
        '1,0,$3,0,0*%',
        '%ADD10PLUS,0.600X0.200*%',
        'D10*',
        'X010000Y020000D03*',
        'M02*'
    ].join('\n')

    const document = GerberParser.parseArrayBuffer(
        'synthetic-F_Cu.gtl',
        bytes(source)
    )
    const flash = document.pcb.fabrication.layers[0].primitives[0]

    assert.equal(flash.shape, 'macro')
    assert.equal(flash.name, 'PLUS')
    assert.equal(flash.x, 1)
    assert.equal(flash.y, 2)
    assert.equal(Array.isArray(flash.primitives), true)
    assert.deepEqual(
        flash.primitives.map((primitive) => ({
            type: primitive.type,
            exposure: primitive.exposure,
            diameter: primitive.diameter,
            width: primitive.width
        })),
        [
            {
                type: 'circle',
                exposure: 'dark',
                diameter: 0.6,
                width: undefined
            },
            {
                type: 'line',
                exposure: 'dark',
                diameter: undefined,
                width: 0.2
            },
            {
                type: 'circle',
                exposure: 'clear',
                diameter: 0.8,
                width: undefined
            }
        ]
    )
})

test('GerberParser preserves mixed-case macro aperture names for pad flashes', () => {
    const source = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%AMSoftPad*',
        '21,1,1.200,0.600,0,0,0*%',
        '%TA.AperFunction,SMDPad*%',
        '%ADD10SoftPad,0*%',
        'D10*',
        'X010000Y020000D03*',
        'M02*'
    ].join('\n')

    const document = GerberParser.parseArrayBuffer(
        'synthetic-B_Cu.gbl',
        bytes(source)
    )
    const flash = document.pcb.fabrication.layers[0].primitives[0]

    assert.equal(flash.shape, 'macro')
    assert.equal(flash.name, 'SoftPad')
    assert.equal(flash.primitives.length, 1)
    assert.deepEqual(flash.primitives[0], {
        type: 'rect',
        exposure: 'dark',
        width: 1.2,
        height: 0.6,
        x: 0,
        y: 0,
        rotation: 0
    })
})

test('GerberParser stores aperture blocks and flashes them as reusable groups', () => {
    const source = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%ABD10*%',
        '%ADD11C,0.500*%',
        'D11*',
        'X000000Y000000D03*',
        'X020000Y000000D03*',
        '%AB*%',
        'D10*',
        'X050000Y050000D03*',
        'M02*'
    ].join('\n')

    const document = GerberParser.parseArrayBuffer(
        'synthetic-F_Cu.gtl',
        bytes(source)
    )
    const flash = document.pcb.fabrication.layers[0].primitives[0]

    assert.equal(flash.shape, 'block')
    assert.equal(flash.primitives.length, 2)
    assert.deepEqual(
        flash.primitives.map((primitive) => [primitive.x, primitive.y]),
        [
            [5, 5],
            [7, 5]
        ]
    )
})

test('GerberParser applies step-repeat, layer polarity, attributes, and aperture transforms', () => {
    const source = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%TF.FileFunction,Copper,L1,Top*%',
        '%ADD10R,0.400X0.800*%',
        '%TA.AperFunction,SMDPad*%',
        '%TO.N,SIG_A*%',
        '%LMX*%',
        '%LR90*%',
        '%LS2*%',
        'D10*',
        '%SRX2Y2I1.000J2.000*%',
        '%LPC*%',
        'X000000Y000000D03*',
        '%SR*%',
        'M02*'
    ].join('\n')

    const document = GerberParser.parseArrayBuffer(
        'synthetic-F_Cu.gtl',
        bytes(source)
    )
    const layer = document.pcb.fabrication.layers[0]

    assert.deepEqual(layer.attributes.file.FileFunction, [
        'Copper',
        'L1',
        'Top'
    ])
    assert.equal(layer.primitives.length, 4)
    assert.deepEqual(
        layer.primitives.map((primitive) => [primitive.x, primitive.y]),
        [
            [0, 0],
            [1, 0],
            [0, 2],
            [1, 2]
        ]
    )
    assert.deepEqual(layer.primitives[0].attributes.object.N, ['SIG_A'])
    assert.deepEqual(layer.primitives[0].attributes.aperture.AperFunction, [
        'SMDPad'
    ])
    assert.equal(layer.primitives[0].polarity, 'clear')
    assert.equal(layer.primitives[0].width, 0.8)
    assert.equal(layer.primitives[0].height, 1.6)
    assert.deepEqual(layer.primitives[0].transform, {
        mirror: 'x',
        rotation: 90,
        scale: 2
    })
})

test('GerberParser parses Excellon slots as drill routes', () => {
    const source = [
        'M48',
        'METRIC,TZ',
        'T01C0.600',
        '%',
        'T01',
        'X010000Y010000',
        'G85X030000Y010000',
        'M30'
    ].join('\n')

    const document = GerberParser.parseArrayBuffer(
        'synthetic-PTH.drl',
        bytes(source)
    )
    const layer = document.pcb.fabrication.layers[0]

    assert.equal(layer.drills.length, 2)
    assert.deepEqual(layer.drills[1], {
        type: 'slot',
        x1: 1,
        y1: 1,
        x2: 3,
        y2: 1,
        diameter: 0.6,
        plated: true,
        tool: 'T01'
    })
})

test('GerberPcbSvgRenderer renders macro groups, transformed flashes, clear primitives, and slots', () => {
    const document = {
        sourceFormat: 'gerber',
        kind: 'pcb',
        fileName: 'synthetic-fabrication',
        pcb: {
            bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
            fabrication: {
                layers: [
                    {
                        id: 'layer-1',
                        fileName: 'synthetic-F_Cu.gtl',
                        role: 'top-copper',
                        side: 'top',
                        primitives: [
                            {
                                type: 'flash',
                                shape: 'circle',
                                x: 2,
                                y: 3,
                                diameter: 2,
                                polarity: 'dark'
                            },
                            {
                                type: 'flash',
                                shape: 'macro',
                                name: 'PLUS',
                                x: 2,
                                y: 3,
                                polarity: 'clear',
                                transform: {
                                    mirror: 'x',
                                    rotation: 90,
                                    scale: 2
                                },
                                primitives: [
                                    {
                                        type: 'circle',
                                        exposure: 'dark',
                                        x: 0,
                                        y: 0,
                                        diameter: 0.5
                                    }
                                ]
                            }
                        ],
                        drills: [
                            {
                                type: 'slot',
                                x1: 4,
                                y1: 5,
                                x2: 6,
                                y2: 5,
                                diameter: 0.6,
                                plated: true,
                                tool: 'T01'
                            }
                        ]
                    }
                ]
            }
        }
    }

    const markup = GerberPcbSvgRenderer.render(document)

    assert.match(markup, /gerber-flash-macro/)
    assert.match(markup, /data-polarity="clear"/)
    assert.match(
        markup,
        /transform="translate\(2 3\) rotate\(90\) scale\(-2 2\)"/
    )
    assert.match(markup, /gerber-macro-circle/)
    assert.match(markup, /gerber-slot/)
})

test('GerberPcbSvgRenderer applies macro primitive rotations', () => {
    const document = {
        sourceFormat: 'gerber',
        kind: 'pcb',
        fileName: 'synthetic-fabrication',
        pcb: {
            bounds: { minX: 0, minY: 0, maxX: 4, maxY: 4 },
            fabrication: {
                layers: [
                    {
                        id: 'layer-1',
                        fileName: 'synthetic-F_Cu.gtl',
                        role: 'top-copper',
                        side: 'top',
                        primitives: [
                            {
                                type: 'flash',
                                shape: 'macro',
                                name: 'RotatedPad',
                                x: 2,
                                y: 2,
                                primitives: [
                                    {
                                        type: 'rect',
                                        exposure: 'dark',
                                        width: 1.2,
                                        height: 0.6,
                                        x: 0,
                                        y: 0,
                                        rotation: 45
                                    }
                                ]
                            }
                        ],
                        drills: []
                    }
                ]
            }
        }
    }

    const markup = GerberPcbSvgRenderer.render(document)

    assert.match(markup, /<rect[^>]+transform="rotate\(45 0 0\)"/)
})

test('PcbInteractionIndex builds bounds for Excellon slot routes', () => {
    const document = {
        sourceFormat: 'gerber',
        kind: 'pcb',
        fileName: 'synthetic-fabrication',
        pcb: {
            fabrication: {
                layers: [
                    {
                        id: 'layer-1',
                        role: 'plated-drill',
                        primitives: [],
                        drills: [
                            {
                                type: 'slot',
                                x1: 4,
                                y1: 5,
                                x2: 6,
                                y2: 5,
                                diameter: 0.6,
                                plated: true,
                                tool: 'T01'
                            }
                        ]
                    }
                ]
            }
        }
    }

    const items = PcbInteractionIndex.build(document)

    assert.deepEqual(items[0].bounds, {
        minX: 3.7,
        minY: 4.7,
        maxX: 6.3,
        maxY: 5.3
    })
})
