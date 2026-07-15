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
        '%TA.AperFunction,SMDPad*%',
        '%ADD10R,0.400X0.800*%',
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

test('GerberParser preserves draw-run and repeat-instance provenance', () => {
    const source = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%ADD10C,0.100*%',
        'D10*',
        '%SRX2Y1I10.000J0.000*%',
        'X000000Y000000D02*',
        'X020000Y000000D01*',
        'X020000Y020000D01*',
        'X050000Y050000D02*',
        'X070000Y050000D01*',
        '%SR*%',
        'M02*'
    ].join('\n')
    const lines = GerberParser.parseArrayBuffer(
        'source-runs.gm1',
        bytes(source)
    ).pcb.fabrication.layers[0].primitives

    assert.equal(lines.length, 6)
    assert.equal(lines[0].sourcePathId, lines[2].sourcePathId)
    assert.equal(lines[1].sourcePathId, lines[3].sourcePathId)
    assert.notEqual(lines[0].sourcePathId, lines[1].sourcePathId)
    assert.notEqual(lines[2].sourcePathId, lines[4].sourcePathId)
    assert.notEqual(lines[3].sourcePathId, lines[5].sourcePathId)
})

test('GerberParser binds TA attributes to aperture definitions', () => {
    const source = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%TA.AperFunction,SMDPad*%',
        '%ADD10C,1.000*%',
        '%TD.AperFunction*%',
        '%TA.AperFunction,Conductor*%',
        '%ADD11C,0.500*%',
        '%TD.AperFunction*%',
        'D10*',
        'X010000Y010000D03*',
        'D11*',
        'X020000Y010000D03*',
        'M02*'
    ].join('\n')
    const primitives = GerberParser.parseArrayBuffer(
        'attributes.gtl',
        bytes(source)
    ).pcb.fabrication.layers[0].primitives

    assert.deepEqual(primitives[0].attributes.aperture.AperFunction, ['SMDPad'])
    assert.deepEqual(primitives[1].attributes.aperture.AperFunction, [
        'Conductor'
    ])
})

test('GerberParser keeps immutable TF attributes across TD commands', () => {
    const source = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%TF.FileFunction,Copper,L1,Top*%',
        '%TF.FilePolarity,Negative*%',
        '%TD.FileFunction*%',
        '%TD.FilePolarity*%',
        '%ADD10C,1.000*%',
        'D10*',
        'X010000Y010000D03*',
        'M02*'
    ].join('\n')
    const attributes = GerberParser.parseArrayBuffer(
        'immutable.gtl',
        bytes(source)
    ).pcb.fabrication.layers[0].attributes.file

    assert.deepEqual(attributes.FileFunction, ['Copper', 'L1', 'Top'])
    assert.deepEqual(attributes.FilePolarity, ['Negative'])
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

test('GerberParser applies Excellon M71 and M72 unit commands', () => {
    const inch = [
        'M48',
        'M72',
        'T01C0.100',
        '%',
        'T01',
        'X1.000Y0.500',
        'M30'
    ].join('\n')
    const metric = [
        'M48',
        'M71',
        'T01C1.000',
        '%',
        'T01',
        'X1.000Y0.500',
        'M30'
    ].join('\n')
    const inchDrill = GerberParser.parseArrayBuffer('inch.drl', bytes(inch)).pcb
        .fabrication.layers[0].drills[0]
    const metricDrill = GerberParser.parseArrayBuffer(
        'metric.drl',
        bytes(metric)
    ).pcb.fabrication.layers[0].drills[0]

    assert.deepEqual(
        { x: inchDrill.x, y: inchDrill.y, diameter: inchDrill.diameter },
        { x: 25.4, y: 12.7, diameter: 2.54 }
    )
    assert.deepEqual(
        { x: metricDrill.x, y: metricDrill.y, diameter: metricDrill.diameter },
        { x: 1, y: 0.5, diameter: 1 }
    )
})

test('GerberParser parses inline-start and prior-point G85 slots', () => {
    const source = [
        'M48',
        'METRIC,TZ',
        'T01C0.600',
        '%',
        'T01',
        'X000000Y000000G85X020000Y020000',
        'X030000Y030000',
        'G85X050000Y030000',
        'M30'
    ].join('\n')
    const layer = GerberParser.parseArrayBuffer('inline-PTH.drl', bytes(source))
        .pcb.fabrication.layers[0]
    const slots = layer.drills.filter((drill) => drill.type === 'slot')

    assert.deepEqual(
        slots.map(({ x1, y1, x2, y2 }) => ({ x1, y1, x2, y2 })),
        [
            { x1: 0, y1: 0, x2: 2, y2: 2 },
            { x1: 3, y1: 3, x2: 5, y2: 3 }
        ]
    )
})

test('GerberParser preserves curved and multi-contour regions', () => {
    const source = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%TF.FileFunction,Copper,L1,Top*%',
        'G36*',
        'X000000Y000000D02*',
        'G03*',
        'X020000Y000000I010000J000000D01*',
        'G01*',
        'X000000Y000000D01*',
        'X040000Y040000D02*',
        'X060000Y040000D01*',
        'X060000Y060000D01*',
        'X040000Y040000D01*',
        'G37*',
        'M02*'
    ].join('\n')
    const layer = GerberParser.parseArrayBuffer('regions.gtl', bytes(source))
        .pcb.fabrication.layers[0]
    const regions = layer.primitives.filter(
        (primitive) => primitive.type === 'region'
    )

    assert.equal(regions.length, 2)
    assert.equal(regions[0].points.length > 4, true)
    assert.equal(
        regions[0].points.some((point) => Math.abs(point.y) > 0.1),
        true
    )
    assert.deepEqual(regions[1].points[0], { x: 4, y: 4 })
})

test('GerberParser resolves G74 center signs for arcs and region arcs', () => {
    const source = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%ADD10C,0.100*%',
        'D10*',
        'G74*',
        'X010000Y000000D02*',
        'G03*',
        'X000000Y010000I010000J000000D01*',
        'G36*',
        'X030000Y000000D02*',
        'X020000Y010000I010000J000000D01*',
        'G01*',
        'X020000Y000000D01*',
        'X030000Y000000D01*',
        'G37*',
        'M02*'
    ].join('\n')
    const primitives = GerberParser.parseArrayBuffer(
        'single-quadrant.gtl',
        bytes(source)
    ).pcb.fabrication.layers[0].primitives
    const arc = primitives.find((primitive) => primitive.type === 'arc')
    const region = primitives.find((primitive) => primitive.type === 'region')

    assert.equal(arc.i, -1)
    assert.equal(arc.j, 0)
    assert.equal(region.points.length > 4, true)
    assert.equal(
        region.points.some(
            (point) => point.x < 3 && point.x > 2 && point.y > 0
        ),
        true
    )
})

test('GerberParser preserves modal D operations on coordinate-only commands', () => {
    const source = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%ADD10C,1.000*%',
        'D10*',
        'X010000Y010000D03*',
        'X020000Y020000*',
        'X030000Y030000D02*',
        'X040000Y040000*',
        'X050000Y050000D01*',
        'X060000Y060000*',
        'M02*'
    ].join('\n')
    const primitives = GerberParser.parseArrayBuffer('modal.gtl', bytes(source))
        .pcb.fabrication.layers[0].primitives

    assert.deepEqual(
        primitives.map((primitive) => primitive.type),
        ['flash', 'flash', 'line', 'line']
    )
    assert.deepEqual(
        primitives.slice(0, 2).map(({ x, y }) => ({ x, y })),
        [
            { x: 1, y: 1 },
            { x: 2, y: 2 }
        ]
    )
    assert.deepEqual(
        primitives.slice(2).map(({ x1, y1, x2, y2 }) => ({
            x1,
            y1,
            x2,
            y2
        })),
        [
            { x1: 4, y1: 4, x2: 5, y2: 5 },
            { x1: 5, y1: 5, x2: 6, y2: 6 }
        ]
    )
})

test('GerberParser applies interpolation codes combined with coordinates', () => {
    const source = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%ADD10C,0.100*%',
        'D10*',
        'X010000Y000000D02*',
        'G74G03X000000Y010000I010000J000000D01*',
        'G75G02X010000Y000000I010000J000000D01*',
        'M02*'
    ].join('\n')
    const primitives = GerberParser.parseArrayBuffer(
        'combined.gtl',
        bytes(source)
    ).pcb.fabrication.layers[0].primitives

    assert.deepEqual(
        primitives.map((primitive) => [
            primitive.type,
            primitive.clockwise,
            primitive.i,
            primitive.j
        ]),
        [
            ['arc', false, -1, 0],
            ['arc', true, 1, 0]
        ]
    )
})

test('GerberParser includes directed arc extrema in fabrication bounds', () => {
    const source = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%ADD10C,0.100*%',
        'D10*',
        'G75*',
        'X010000Y000000D02*',
        'G03X-010000Y000000I-010000J000000D01*',
        'M02*'
    ].join('\n')
    const bounds = GerberParser.parseArrayBuffer(
        'arc-bounds.gtl',
        bytes(source)
    ).pcb.fabrication.layers[0].bounds

    assert.deepEqual(bounds, {
        minX: -1.05,
        minY: -0.05,
        maxX: 1.05,
        maxY: 1.05
    })

    const oblique = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%ADD10C,0.100*%',
        'D10*',
        'G75*',
        'X9.84807753Y1.73648178D02*',
        'G03X-1.21869343Y9.92546152I-9.84807753J-1.73648178D01*',
        'M02*'
    ].join('\n')
    const obliqueBounds = GerberParser.parseArrayBuffer(
        'oblique-arc.gtl',
        bytes(oblique)
    ).pcb.fabrication.layers[0].bounds

    assert.equal(obliqueBounds.maxY, 10.05)
})

test('GerberParser applies outer transforms to macro and aperture-block bounds', () => {
    const common = ['%FSLAX24Y24*%', '%MOMM*%']
    const macro = [
        ...common,
        '%AMOFF*',
        '1,1,1.000,2.000,0,0*%',
        '%ADD10OFF,0*%',
        '%LR90*%',
        '%LS2*%',
        'D10*',
        'X100000Y100000D03*',
        'M02*'
    ].join('\n')
    const block = [
        ...common,
        '%ADD11C,1.000*%',
        '%ABD10*%',
        'D11*',
        'X020000Y000000D03*',
        '%AB*%',
        '%LR90*%',
        '%LS2*%',
        'D10*',
        'X100000Y100000D03*',
        'M02*'
    ].join('\n')
    const parseBounds = (name, source) =>
        GerberParser.parseArrayBuffer(name, bytes(source)).pcb.fabrication
            .layers[0].bounds

    assert.deepEqual(parseBounds('macro.gtl', macro), {
        minX: 9,
        minY: 13,
        maxX: 11,
        maxY: 15
    })
    assert.deepEqual(parseBounds('block.gtl', block), {
        minX: 9,
        minY: 13,
        maxX: 11,
        maxY: 15
    })
})

test('GerberParser composes macro-child rotation and nested block placement in bounds', () => {
    const rotated = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%AMROT*',
        '20,1,1.000,2.000,0,4.000,0,90*%',
        '%ADD10ROT,0*%',
        'D10*',
        'X000000Y000000D03*',
        'M02*'
    ].join('\n')
    const nested = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%AMOFF*',
        '1,1,1.000,2.000,0,0*%',
        '%ADD12OFF,0*%',
        '%ABD10*%',
        'D12*',
        'X030000Y000000D03*',
        '%AB*%',
        'D10*',
        'X100000Y100000D03*',
        'M02*'
    ].join('\n')
    const parseBounds = (name, source) =>
        GerberParser.parseArrayBuffer(name, bytes(source)).pcb.fabrication
            .layers[0].bounds

    assert.deepEqual(parseBounds('rotated-macro.gtl', rotated), {
        minX: -0.5,
        minY: 1.5,
        maxX: 0.5,
        maxY: 4.5
    })
    assert.deepEqual(parseBounds('nested-macro.gtl', nested), {
        minX: 14.5,
        minY: 9.5,
        maxX: 15.5,
        maxY: 10.5
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
