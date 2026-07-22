import assert from 'node:assert/strict'
import test from 'node:test'

import {
    PcbScene3dBuilder,
    PcbScene3dModelRegistry,
    PcbScene3dScenePreparator
} from '../src/legacy-scene3d.mjs'

/**
 * Asserts that two scene-unit values match within rounding tolerance.
 * @param {number} actual Actual scene value.
 * @param {number} expected Expected scene value.
 * @returns {void}
 */
function assertSceneValue(actual, expected) {
    assert.ok(Math.abs(actual - expected) <= 0.000001)
}

/**
 * Resolves bounds for a scene point list.
 * @param {{ x: number, y: number }[]} points Scene points.
 * @returns {{ minX: number, minY: number, maxX: number, maxY: number }}
 */
function pointBounds(points) {
    return points.reduce(
        (bounds, point) => ({
            minX: Math.min(bounds.minX, point.x),
            minY: Math.min(bounds.minY, point.y),
            maxX: Math.max(bounds.maxX, point.x),
            maxY: Math.max(bounds.maxY, point.y)
        }),
        {
            minX: Infinity,
            minY: Infinity,
            maxX: -Infinity,
            maxY: -Infinity
        }
    )
}

test('PcbScene3dModelRegistry preserves the fabrication-only compatibility API', () => {
    const registry = PcbScene3dModelRegistry.create([])

    assert.deepEqual(registry.assets, [])
    assert.equal(registry.resolveForComponent(), null)
    assert.equal(registry.resolveComponentModel(), null)
    assert.equal(registry.resolveComponentBodyModel(), null)
})

/**
 * Clones the synthetic document and places a drilled pad directly on a trace.
 * @returns {object}
 */
function createDrilledTrackDocument() {
    const documentModel = structuredClone(createDocument())
    const layers = documentModel.pcb.fabrication.layers
    const topCopper = layers.find((layer) => layer.id === 'top-copper')
    const drillLayer = layers.find((layer) => layer.id === 'plated-drill')

    topCopper.primitives.push({
        type: 'flash',
        shape: 'circle',
        x: 2,
        y: 1,
        diameter: 1.2
    })
    drillLayer.drills.push({
        x: 2,
        y: 1,
        diameter: 0.6,
        plated: true,
        tool: 'T02'
    })

    return documentModel
}

/**
 * Clones the synthetic document and places an unmatched drill aperture directly
 * on a trace.
 * @returns {object}
 */
function createBareDrilledTrackDocument() {
    const documentModel = structuredClone(createDocument())
    const layers = documentModel.pcb.fabrication.layers
    const topCopper = layers.find((layer) => layer.id === 'top-copper')
    const drillLayer = layers.find((layer) => layer.id === 'plated-drill')

    topCopper.primitives.push({
        type: 'line',
        x1: 1,
        y1: 5,
        x2: 4,
        y2: 5,
        width: 0.3
    })
    drillLayer.drills.push({
        x: 2,
        y: 5,
        diameter: 0.6,
        plated: true,
        tool: 'T04'
    })

    return documentModel
}

/**
 * Clones the synthetic document and adds a rotated copper pad with a matching
 * slotted drill.
 * @returns {object}
 */
function createMatchedSlottedPadDocument() {
    const documentModel = structuredClone(createDocument())
    const layers = documentModel.pcb.fabrication.layers
    const topCopper = layers.find((layer) => layer.id === 'top-copper')
    const drillLayer = layers.find((layer) => layer.id === 'plated-drill')

    topCopper.primitives = [
        {
            type: 'flash',
            shape: 'obround',
            x: 6,
            y: 3,
            width: 1,
            height: 2,
            rotation: 90
        }
    ]
    drillLayer.drills = [
        {
            type: 'slot',
            x1: 6,
            y1: 2.4,
            x2: 6,
            y2: 3.6,
            diameter: 0.35,
            plated: true,
            tool: 'T05'
        }
    ]

    return documentModel
}

/**
 * Clones the synthetic document and adds an unmatched slotted drill.
 * @returns {object}
 */
function createBareSlottedDrillDocument() {
    const documentModel = structuredClone(createDocument())
    const layers = documentModel.pcb.fabrication.layers
    const topCopper = layers.find((layer) => layer.id === 'top-copper')
    const drillLayer = layers.find((layer) => layer.id === 'plated-drill')

    topCopper.primitives = []
    drillLayer.drills = [
        {
            type: 'slot',
            x1: 5,
            y1: 2.2,
            x2: 5,
            y2: 3.8,
            diameter: 0.4,
            plated: false,
            tool: 'T06'
        }
    ]

    return documentModel
}

/**
 * Clones the synthetic document and places a trace endpoint inside a drilled
 * pad opening.
 * @returns {object}
 */
function createDrilledTrackEndpointDocument() {
    const documentModel = structuredClone(createDocument())
    const layers = documentModel.pcb.fabrication.layers
    const topCopper = layers.find((layer) => layer.id === 'top-copper')
    const drillLayer = layers.find((layer) => layer.id === 'plated-drill')

    topCopper.primitives.push({
        type: 'line',
        x1: 0,
        y1: 4,
        x2: 10.5,
        y2: 4,
        width: 1
    })
    topCopper.primitives.push({
        type: 'flash',
        shape: 'circle',
        x: 12,
        y: 4,
        diameter: 6
    })
    drillLayer.drills.push({
        x: 12,
        y: 4,
        diameter: 3,
        plated: true,
        tool: 'T03'
    })

    return documentModel
}

/**
 * Clones the synthetic document and adds paired copper and mask strokes.
 * @returns {object}
 */
function createMaskOpenedStrokeDocument() {
    const documentModel = structuredClone(createDocument())
    const layers = documentModel.pcb.fabrication.layers
    const topCopper = layers.find((layer) => layer.id === 'top-copper')

    topCopper.primitives.push(
        { type: 'line', x1: 5, y1: 2, x2: 7, y2: 2, width: 0.25 },
        { type: 'line', x1: 5, y1: 2.8, x2: 7, y2: 2.8, width: 0.25 }
    )
    layers.push({
        id: 'top-mask',
        fileName: 'sample-F_Mask.gts',
        role: 'top-soldermask',
        side: 'top',
        primitives: [
            { type: 'line', x1: 4.95, y1: 2, x2: 7.05, y2: 2, width: 0.4 }
        ],
        drills: []
    })

    return documentModel
}

/**
 * Builds a compact document with one pad opened by solder mask and one covered.
 * @returns {object}
 */
function createMaskOpenedPadDocument() {
    const documentModel = structuredClone(createDocument())
    const layers = documentModel.pcb.fabrication.layers
    const topCopper = layers.find((layer) => layer.id === 'top-copper')

    topCopper.primitives = [
        { type: 'flash', shape: 'circle', x: 2, y: 2, diameter: 0.8 },
        { type: 'flash', shape: 'circle', x: 4, y: 2, diameter: 0.8 }
    ]
    layers.push({
        id: 'top-mask',
        fileName: 'sample-F_Mask.gts',
        role: 'top-soldermask',
        side: 'top',
        primitives: [
            { type: 'flash', shape: 'circle', x: 2, y: 2, diameter: 1 }
        ],
        drills: []
    })

    return documentModel
}

/**
 * Builds paired plated drills where only one side intersects a larger pad.
 * @returns {object}
 */
function createMaskClassifiedViaDocument() {
    const documentModel = structuredClone(createDocument())
    const layers = documentModel.pcb.fabrication.layers
    const topCopper = layers.find((layer) => layer.id === 'top-copper')
    const bottomCopper = layers.find((layer) => layer.id === 'bottom-copper')
    const drillLayer = layers.find((layer) => layer.id === 'plated-drill')
    const padFlashes = [
        { type: 'flash', shape: 'circle', x: 2, y: 2, diameter: 0.8 },
        { type: 'flash', shape: 'circle', x: 4, y: 2, diameter: 0.8 }
    ]
    const viaOpenings = [
        { type: 'flash', shape: 'circle', x: 2, y: 2, diameter: 1 },
        { type: 'flash', shape: 'circle', x: 4, y: 2, diameter: 1 }
    ]
    const hostPad = {
        type: 'flash',
        shape: 'rect',
        x: 2.35,
        y: 2.35,
        width: 1.4,
        height: 0.6,
        rotation: 45
    }
    const hostOpening = {
        ...hostPad,
        width: 1.6,
        height: 0.8
    }

    topCopper.primitives = structuredClone(padFlashes)
    bottomCopper.primitives = [
        ...structuredClone(padFlashes),
        structuredClone(hostPad)
    ]
    drillLayer.drills = [
        { x: 2, y: 2, diameter: 0.3, plated: true, tool: 'T02' },
        { x: 4, y: 2, diameter: 0.3, plated: true, tool: 'T02' }
    ]
    layers.push(
        {
            id: 'top-mask',
            fileName: 'sample-F_Mask.gts',
            role: 'top-soldermask',
            side: 'top',
            primitives: structuredClone(viaOpenings),
            drills: []
        },
        {
            id: 'bottom-mask',
            fileName: 'sample-B_Mask.gbs',
            role: 'bottom-soldermask',
            side: 'bottom',
            primitives: [...structuredClone(viaOpenings), hostOpening],
            drills: []
        }
    )

    return documentModel
}

/**
 * Builds a compact document with a copper pour and one clear-polarity void.
 * @returns {object}
 */
function createCopperPourClearanceDocument() {
    const documentModel = structuredClone(createDocument())
    const layers = documentModel.pcb.fabrication.layers
    const topCopper = layers.find((layer) => layer.id === 'top-copper')

    topCopper.primitives = [
        {
            type: 'region',
            polarity: 'dark',
            points: [
                { x: 1, y: 1 },
                { x: 9, y: 1 },
                { x: 9, y: 5 },
                { x: 1, y: 5 },
                { x: 1, y: 1 }
            ]
        },
        {
            type: 'region',
            polarity: 'clear',
            points: [
                { x: 4, y: 2 },
                { x: 6, y: 2 },
                { x: 6, y: 4 },
                { x: 4, y: 4 },
                { x: 4, y: 2 }
            ]
        }
    ]

    return documentModel
}

/**
 * Builds a compact document whose later dark copper region redraws over a
 * previous clear-polarity area.
 * @returns {object}
 */
function createOrderedCopperRegionDocument() {
    const documentModel = structuredClone(createDocument())
    const layers = documentModel.pcb.fabrication.layers
    const topCopper = layers.find((layer) => layer.id === 'top-copper')

    topCopper.primitives = [
        {
            type: 'region',
            polarity: 'dark',
            points: [
                { x: 1, y: 1 },
                { x: 4, y: 1 },
                { x: 4, y: 4 },
                { x: 1, y: 4 },
                { x: 1, y: 1 }
            ]
        },
        {
            type: 'region',
            polarity: 'clear',
            points: [
                { x: 2, y: 2 },
                { x: 3, y: 2 },
                { x: 3, y: 3 },
                { x: 2, y: 3 },
                { x: 2, y: 2 }
            ]
        },
        {
            type: 'region',
            polarity: 'dark',
            points: [
                { x: 1.5, y: 1.5 },
                { x: 3.5, y: 1.5 },
                { x: 3.5, y: 3.5 },
                { x: 1.5, y: 3.5 },
                { x: 1.5, y: 1.5 }
            ]
        }
    ]

    return documentModel
}

/**
 * Clones the synthetic document and replaces silkscreen detail with one long
 * bottom-side arc.
 * @returns {object}
 */
function createLongArcDocument() {
    const documentModel = structuredClone(createDocument())
    documentModel.pcb.bounds = { minX: 0, minY: -30, maxX: 30, maxY: 10 }
    documentModel.pcb.fabrication.layers = [
        {
            id: 'bottom-silkscreen',
            fileName: 'sample-B_Silkscreen.gbo',
            role: 'bottom-silkscreen',
            side: 'bottom',
            primitives: [
                {
                    type: 'arc',
                    x1: 18,
                    y1: -10,
                    x2: 10,
                    y2: -10,
                    i: -4,
                    j: -10,
                    clockwise: true,
                    width: 0.2
                }
            ],
            drills: []
        }
    ]
    return documentModel
}

/**
 * Builds a synthetic fabrication document with outline, copper, and drill data.
 * @returns {object}
 */
function createDocument() {
    return {
        sourceFormat: 'gerber',
        kind: 'pcb',
        fileName: 'synthetic-fabrication',
        pcb: {
            bounds: { minX: 0, minY: 0, maxX: 10, maxY: 6 },
            fabrication: {
                layers: [
                    {
                        id: 'outline',
                        fileName: 'sample-Edge_Cuts.gm1',
                        role: 'board-outline',
                        side: 'both',
                        primitives: [
                            {
                                type: 'line',
                                x1: 0,
                                y1: 0,
                                x2: 10,
                                y2: 0,
                                width: 0.1
                            },
                            {
                                type: 'line',
                                x1: 10,
                                y1: 0,
                                x2: 10,
                                y2: 6,
                                width: 0.1
                            },
                            {
                                type: 'line',
                                x1: 10,
                                y1: 6,
                                x2: 0,
                                y2: 6,
                                width: 0.1
                            },
                            {
                                type: 'line',
                                x1: 0,
                                y1: 6,
                                x2: 0,
                                y2: 0,
                                width: 0.1
                            }
                        ],
                        drills: []
                    },
                    {
                        id: 'top-copper',
                        fileName: 'sample-F_Cu.gtl',
                        role: 'top-copper',
                        side: 'top',
                        primitives: [
                            {
                                type: 'line',
                                x1: 1,
                                y1: 1,
                                x2: 4,
                                y2: 1,
                                width: 0.3
                            },
                            {
                                type: 'flash',
                                shape: 'circle',
                                x: 2,
                                y: 3,
                                diameter: 1.2
                            }
                        ],
                        drills: []
                    },
                    {
                        id: 'bottom-copper',
                        fileName: 'sample-B_Cu.gbl',
                        role: 'bottom-copper',
                        side: 'bottom',
                        primitives: [
                            {
                                type: 'line',
                                x1: 4,
                                y1: 4,
                                x2: 8,
                                y2: 4,
                                width: 0.25
                            }
                        ],
                        drills: []
                    },
                    {
                        id: 'top-silkscreen',
                        fileName: 'sample-F_Silkscreen.gto',
                        role: 'top-silkscreen',
                        side: 'top',
                        primitives: [
                            {
                                type: 'line',
                                x1: 0,
                                y1: 3,
                                x2: 4,
                                y2: 3,
                                width: 1
                            }
                        ],
                        drills: []
                    },
                    {
                        id: 'plated-drill',
                        fileName: 'sample-PTH.drl',
                        role: 'plated-drill',
                        side: 'both',
                        primitives: [],
                        drills: [
                            {
                                x: 2,
                                y: 3,
                                diameter: 0.6,
                                plated: true,
                                tool: 'T01'
                            }
                        ]
                    }
                ]
            }
        },
        bom: []
    }
}

test('PcbScene3dBuilder builds a bare-board Gerber 3D scene', () => {
    const scene = PcbScene3dBuilder.build(createDocument())
    const customThickness = PcbScene3dBuilder.build(createDocument(), {
        boardThicknessMil: 80
    })

    assert.equal(scene.sourceFormat, 'gerber')
    assert.equal(scene.coordinateSystem, 'gerber-3d-y-up')
    assert.equal(scene.board.widthMil, 393.700787)
    assert.equal(scene.board.heightMil, 236.220472)
    assert.equal(scene.board.thicknessMil, 63)
    assertSceneValue(scene.board.centerX, 196.850394)
    assertSceneValue(scene.board.centerY, 118.110236)
    assert.equal(customThickness.board.thicknessMil, 80)
    assert.equal(scene.board.segments.length, 4)
    assert.equal(
        Object.prototype.hasOwnProperty.call(scene.board, 'surfaceColor'),
        false
    )
    assert.equal(
        Object.prototype.hasOwnProperty.call(scene.board, 'edgeColor'),
        false
    )
    assert.equal(scene.components.length, 0)
    assert.equal(scene.layers.length > 0, true)
    assert.equal(Array.isArray(scene.pads), true)
    assert.equal(Array.isArray(scene.tracks), true)
    assert.equal(Array.isArray(scene.vias), true)
    assert.equal(Array.isArray(scene.zones), true)
    assert.deepEqual(scene.texts, [])
    assert.deepEqual(scene.externalPlacements, [])
    assert.equal(scene.boardAssemblyModel, null)
    assert.deepEqual(scene.externalModels, [])
    assert.equal(scene.detail.tracks.length, 2)
    assert.equal(scene.detail.pads.length, 1)
    assert.deepEqual(scene.detail.copperTexts, [])
    assert.equal(Number.isFinite(scene.detail.silkscreen.top.fillColor), true)
    assert.equal(Number.isFinite(scene.detail.silkscreen.top.strokeColor), true)
    assert.equal(
        Number.isFinite(scene.detail.silkscreen.bottom.fillColor),
        true
    )
    assert.equal(
        Number.isFinite(scene.detail.silkscreen.bottom.strokeColor),
        true
    )
    assert.equal(scene.detail.pads[0].holeDiameter, 23.622047)
    assert.equal(scene.detail.tracks[0].layerId, 1)
    assert.equal(scene.detail.tracks[1].layerId, 32)
})

test('PcbScene3dBuilder ignores empty outline layers when resolving board bounds', () => {
    const document = createDocument()
    const outline = document.pcb.fabrication.layers.find(
        (layer) => layer.id === 'outline'
    )
    document.pcb.bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 }
    document.pcb.fabrication.layers.unshift({
        id: 'empty-outline',
        fileName: 'empty-profile.gko',
        role: 'board-outline',
        side: 'both',
        bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
        primitives: [],
        drills: []
    })
    outline.bounds = { minX: 50, minY: 20, maxX: 60, maxY: 26 }
    for (const primitive of outline.primitives) {
        primitive.x1 += 50
        primitive.x2 += 50
        primitive.y1 += 20
        primitive.y2 += 20
    }

    const scene = PcbScene3dBuilder.build(document)

    assert.equal(scene.board.widthMil, 393.700787)
    assert.equal(scene.board.heightMil, 236.220472)
    assert.equal(scene.board.minX, 1968.503937)
    assert.equal(scene.board.minY, 787.401575)
})

test('PcbScene3dBuilder derives the board from the outer outline contour', () => {
    const document = createDocument()
    const outline = document.pcb.fabrication.layers.find(
        (layer) => layer.id === 'outline'
    )
    document.pcb.bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 }
    outline.bounds = { minX: 0, minY: 0, maxX: 60, maxY: 26 }
    for (const primitive of outline.primitives) {
        primitive.x1 += 50
        primitive.x2 += 50
        primitive.y1 += 20
        primitive.y2 += 20
    }
    outline.primitives.push(
        { type: 'line', x1: 0, y1: 0, x2: 5, y2: 5, width: 0.1 },
        { type: 'line', x1: 1, y1: 9, x2: 6, y2: 9, width: 0.1 }
    )

    const scene = PcbScene3dBuilder.build(document)

    assert.equal(scene.board.widthMil, 393.700787)
    assert.equal(scene.board.heightMil, 236.220472)
    assert.equal(scene.board.minX, 1968.503937)
    assert.equal(scene.board.minY, 787.401575)
    assert.equal(scene.board.segments.length, 4)
})

test('PcbScene3dBuilder synthesizes a perimeter from fragmented corner profiles', () => {
    const document = createDocument()
    const outline = document.pcb.fabrication.layers.find(
        (layer) => layer.id === 'outline'
    )
    outline.bounds = { minX: 0, minY: 0, maxX: 60, maxY: 30 }
    outline.primitives = [
        { type: 'line', x1: 0, y1: 6, x2: 0, y2: 0, width: 0.1 },
        { type: 'line', x1: 0, y1: 0, x2: 6, y2: 0, width: 0.1 },
        { type: 'line', x1: 54, y1: 0, x2: 60, y2: 0, width: 0.1 },
        { type: 'line', x1: 60, y1: 0, x2: 60, y2: 6, width: 0.1 },
        { type: 'line', x1: 60, y1: 24, x2: 60, y2: 30, width: 0.1 },
        { type: 'line', x1: 60, y1: 30, x2: 54, y2: 30, width: 0.1 },
        { type: 'line', x1: 6, y1: 30, x2: 0, y2: 30, width: 0.1 },
        { type: 'line', x1: 0, y1: 30, x2: 0, y2: 24, width: 0.1 },
        { type: 'line', x1: 2, y1: 2, x2: 4, y2: 2, width: 0.1 },
        { type: 'line', x1: 4, y1: 2, x2: 4, y2: 4, width: 0.1 },
        { type: 'line', x1: 4, y1: 4, x2: 2, y2: 4, width: 0.1 },
        { type: 'line', x1: 2, y1: 4, x2: 2, y2: 2, width: 0.1 }
    ]

    const scene = PcbScene3dBuilder.build(document)

    assert.equal(scene.board.widthMil, 2362.204724)
    assert.equal(scene.board.heightMil, 1181.102362)
    assert.equal(scene.board.segments.length, 12)
    assert.equal(scene.board.cutouts.length, 1)
    assert.equal(scene.board.cutouts[0].points.length, 5)
})

test('PcbScene3dBuilder mirrors Gerber coordinates into normal 3D board orientation', () => {
    const scene = PcbScene3dBuilder.build(createDocument())

    assertSceneValue(scene.board.segments[0].y1, 236.220472)
    assertSceneValue(scene.board.segments[0].y2, 236.220472)
    assertSceneValue(scene.detail.tracks[0].y1, 196.850394)
    assertSceneValue(scene.detail.tracks[0].y2, 196.850394)
    assertSceneValue(scene.detail.tracks[1].y1, 78.740157)
    assertSceneValue(scene.detail.tracks[1].y2, 78.740157)
    assertSceneValue(scene.detail.pads[0].y, 118.110236)
})

test('PcbScene3dBuilder clears Gerber silkscreen around rendered pads and drills', () => {
    const scene = PcbScene3dBuilder.build(createDocument())
    const cutouts = scene.detail.silkscreen.top.drillCutouts

    assert.equal(scene.detail.silkscreen.top.tracks.length, 1)
    assert.ok(cutouts.length >= 1)

    const widestCutout = cutouts
        .map(pointBounds)
        .sort((a, b) => b.maxX - b.minX - (a.maxX - a.minX))[0]

    assert.ok(widestCutout.maxX - widestCutout.minX > 23.622047)
    assertSceneValue(
        (widestCutout.minX + widestCutout.maxX) / 2,
        scene.detail.pads[0].x
    )
    assertSceneValue(
        (widestCutout.minY + widestCutout.maxY) / 2,
        scene.detail.pads[0].y
    )
})

test('PcbScene3dBuilder maps clear Gerber silkscreen regions to cutouts', () => {
    const document = createDocument()
    document.pcb.fabrication.layers = [
        document.pcb.fabrication.layers.find((layer) => layer.id === 'outline'),
        {
            id: 'top-silkscreen',
            fileName: 'sample-F_Silkscreen.gto',
            role: 'top-silkscreen',
            side: 'top',
            primitives: [
                {
                    type: 'region',
                    polarity: 'dark',
                    points: [
                        { x: 1, y: 1 },
                        { x: 5, y: 1 },
                        { x: 5, y: 4 },
                        { x: 1, y: 4 },
                        { x: 1, y: 1 }
                    ]
                },
                {
                    type: 'region',
                    polarity: 'clear',
                    points: [
                        { x: 2, y: 2 },
                        { x: 3, y: 2 },
                        { x: 3, y: 3 },
                        { x: 2, y: 3 },
                        { x: 2, y: 2 }
                    ]
                }
            ],
            drills: []
        }
    ].filter(Boolean)

    const scene = PcbScene3dBuilder.build(document)

    assert.equal(scene.detail.silkscreen.top.fills.length, 1)
    assert.equal(scene.detail.silkscreen.top.drillCutouts.length, 1)

    const cutoutBounds = pointBounds(
        scene.detail.silkscreen.top.drillCutouts[0]
    )

    assertSceneValue(cutoutBounds.maxX - cutoutBounds.minX, 39.370079)
})

test('PcbScene3dBuilder cuts copper tracks at Gerber drill holes', () => {
    const scene = PcbScene3dBuilder.build(createDrilledTrackDocument())
    const trackY = 196.850393
    const splitTracks = scene.detail.tracks.filter(
        (track) =>
            track.layerId === 1 &&
            Math.abs(track.y1 - trackY) <= 0.000001 &&
            Math.abs(track.y2 - trackY) <= 0.000001
    )
    const drilledPad = scene.detail.pads.find(
        (pad) =>
            Math.abs(pad.x - 78.740157) <= 0.000001 &&
            Math.abs(pad.y - trackY) <= 0.000001
    )
    const drillRadius = Number(drilledPad.holeDiameter) / 2

    assert.equal(splitTracks.length, 2)
    assert.ok(splitTracks.every((track) => track.x1 < track.x2))
    assertSceneValue(splitTracks[0].x2, drilledPad.x - drillRadius)
    assertSceneValue(splitTracks[1].x1, drilledPad.x + drillRadius)
    assert.notEqual(splitTracks[0].capStartRound, false)
    assert.equal(splitTracks[0].capEndRound, false)
    assert.equal(splitTracks[1].capStartRound, false)
    assert.notEqual(splitTracks[1].capEndRound, false)
    assert.notEqual(splitTracks[0].capStartSideWall, false)
    assert.equal(splitTracks[0].capEndSideWall, false)
    assert.equal(splitTracks[1].capStartSideWall, false)
    assert.notEqual(splitTracks[1].capEndSideWall, false)
})

test('PcbScene3dBuilder keeps clearance at Gerber drill-only holes', () => {
    const scene = PcbScene3dBuilder.build(createBareDrilledTrackDocument())
    const trackY = 39.370079
    const splitTracks = scene.detail.tracks.filter(
        (track) =>
            track.layerId === 1 &&
            Math.abs(track.y1 - trackY) <= 0.000001 &&
            Math.abs(track.y2 - trackY) <= 0.000001
    )
    const drillOnlyPad = scene.detail.pads.find(
        (pad) =>
            Math.abs(pad.x - 78.740157) <= 0.000001 &&
            Math.abs(pad.y - trackY) <= 0.000001
    )
    const clearance =
        Number(drillOnlyPad.holeDiameter) / 2 + Number(splitTracks[0].width) / 2

    assert.equal(splitTracks.length, 2)
    assertSceneValue(splitTracks[0].x2, drillOnlyPad.x - clearance)
    assertSceneValue(splitTracks[1].x1, drillOnlyPad.x + clearance)
})

test('PcbScene3dBuilder maps matched Gerber slot holes in pad-local rotation', () => {
    const scene = PcbScene3dBuilder.build(createMatchedSlottedPadDocument())
    const pad = scene.detail.pads.find((candidate) => candidate.holeShape === 2)

    assert.ok(pad)
    assert.equal(pad.rotation, 270)
    assert.equal(pad.holeRotation, 0)
    assert.equal(pad.holeSlotLength, 61.023622)
})

test('PcbScene3dBuilder avoids double-rotating bare Gerber slot holes', () => {
    const scene = PcbScene3dBuilder.build(createBareSlottedDrillDocument())
    const pad = scene.detail.pads.find((candidate) => candidate.holeShape === 2)

    assert.ok(pad)
    assert.equal(pad.rotation, 270)
    assert.equal(pad.holeRotation, 0)
    assert.equal(pad.holeSlotLength, 78.740157)
})

test('PcbScene3dBuilder cuts trace endpoints at Gerber drill holes', () => {
    const scene = PcbScene3dBuilder.build(createDrilledTrackEndpointDocument())
    const endpointTrack = scene.detail.tracks.find(
        (track) =>
            track.layerId === 1 && Math.abs(track.width - 39.370079) <= 0.000001
    )
    const drilledPad = scene.detail.pads.find(
        (pad) =>
            Math.abs(pad.x - 472.440945) <= 0.000001 &&
            Math.abs(pad.y - 78.740157) <= 0.000001
    )
    const drillRadius = Number(drilledPad.holeDiameter) / 2

    assertSceneValue(endpointTrack.x2, drilledPad.x - drillRadius)
})

test('PcbScene3dBuilder exposes plated drill barrels without filling non-plated drills', () => {
    const scene = PcbScene3dBuilder.build(createDrilledTrackDocument())
    const platedVias = scene.detail.vias.filter(
        (via) => via.barrelOnly === true && via.isPlated === true
    )
    const drilledTraceVia = platedVias.find(
        (via) =>
            Math.abs(via.x - 78.740157) <= 0.000001 &&
            Math.abs(via.y - 196.850393) <= 0.000001
    )

    assert.ok(platedVias.length >= 2)
    assert.equal(drilledTraceVia.holeDiameter, 23.622047)
    assert.ok(drilledTraceVia.diameter > drilledTraceVia.holeDiameter)
})

test('PcbScene3dBuilder exposes copper strokes opened by solder mask', () => {
    const scene = PcbScene3dBuilder.build(createMaskOpenedStrokeDocument())
    const candidateTracks = scene.detail.tracks.filter(
        (track) =>
            track.layerId === 1 && Math.abs(track.width - 9.84252) <= 0.000001
    )

    assert.equal(candidateTracks.length, 2)
    assert.equal(candidateTracks[0].solderMaskOpening, true)
    assert.notEqual(candidateTracks[1].solderMaskOpening, true)
})

test('PcbScene3dBuilder exposes pads opened by Gerber solder mask apertures', () => {
    const scene = PcbScene3dBuilder.build(createMaskOpenedPadDocument())
    const openedPad = scene.detail.pads.find(
        (pad) => Math.abs(pad.x - 78.740157) <= 0.000001
    )
    const coveredPad = scene.detail.pads.find(
        (pad) => Math.abs(pad.x - 157.480315) <= 0.000001
    )

    assert.equal(openedPad.hasTopSolderMaskOpening, true)
    assert.equal(coveredPad.hasTopSolderMaskOpening, false)
})

test('PcbScene3dBuilder tents vias except on sides inside opened pads', () => {
    const scene = PcbScene3dBuilder.build(createMaskClassifiedViaDocument())
    const openedVia = scene.detail.vias.find(
        (via) => Math.abs(via.x - 78.740157) <= 0.000001
    )
    const tentedVia = scene.detail.vias.find(
        (via) => Math.abs(via.x - 157.480315) <= 0.000001
    )
    const openedViaTopFlash = scene.detail.pads.find(
        (pad) =>
            Math.abs(pad.x - openedVia.x) <= 0.000001 &&
            Math.abs(Number(pad.sizeTopX) - openedVia.diameter) <= 0.000001
    )
    const openedViaBottomFlash = scene.detail.pads.find(
        (pad) =>
            Math.abs(pad.x - openedVia.x) <= 0.000001 &&
            Math.abs(Number(pad.sizeBottomX) - openedVia.diameter) <= 0.000001
    )
    const openedHostPad = scene.detail.pads.find(
        (pad) =>
            pad.hasBottomSolderMaskOpening === true &&
            Number(pad.sizeBottomX) > openedVia.diameter
    )

    assert.equal(openedVia.diameter, 31.496063)
    assert.equal(openedVia.isTentingTop, true)
    assert.equal(openedVia.isTentingBottom, false)
    assert.equal(tentedVia.isTentingTop, true)
    assert.equal(tentedVia.isTentingBottom, true)
    assert.equal(openedViaTopFlash.hasTopSolderMaskOpening, false)
    assert.equal(openedViaBottomFlash.hasBottomSolderMaskOpening, false)
    assert.equal(openedHostPad.hasBottomSolderMaskOpening, true)
})

test('PcbScene3dBuilder maps clear Gerber copper regions to pour holes', () => {
    const scene = PcbScene3dBuilder.build(createCopperPourClearanceDocument())
    const pour = scene.detail.polygons.find((polygon) => polygon.layerId === 1)

    assert.equal(scene.detail.polygons.length, 1)
    assert.equal(pour.hasSolderMask, true)
    assert.equal(scene.zones[0].hasSolderMask, true)
    assert.equal(pour.holes.length, 1)
    assert.equal(pour.holes[0].length, 5)
    assert.deepEqual(Object.keys(pour.holes[0][0]).sort(), ['x', 'y'])
    assertSceneValue(pour.holes[0][0].x, 157.480315)
    assertSceneValue(pour.holes[0][0].y, 157.480315)
})

test('PcbScene3dBuilder keeps Gerber clear regions ordered for later dark fills', () => {
    const scene = PcbScene3dBuilder.build(createOrderedCopperRegionDocument())
    const pours = scene.detail.polygons.filter(
        (polygon) => polygon.layerId === 1
    )

    assert.equal(pours.length, 2)
    assert.equal(pours[0].holes.length, 1)
    assert.equal(pours[1].holes?.length || 0, 0)
})

test('PcbScene3dBuilder preserves Gerber long arc sweeps for 3D silkscreen', () => {
    const scene = PcbScene3dBuilder.build(createLongArcDocument())
    const arc = scene.detail.silkscreen.bottom.arcs[0]

    assert.ok(Math.abs(Math.abs(arc.sweepAngle) - 316.397181) <= 0.000001)
})

test('PcbScene3dScenePreparator matches the synchronous Gerber scene builder', async () => {
    const builtScene = PcbScene3dBuilder.build(createDocument())
    const preparedScene =
        await PcbScene3dScenePreparator.prepare(createDocument())

    assert.deepEqual(preparedScene, builtScene)
    assert.equal(preparedScene.board.widthMil, builtScene.board.widthMil)
    assert.equal(preparedScene.board.heightMil, builtScene.board.heightMil)
    assert.equal(
        preparedScene.board.thicknessMil,
        builtScene.board.thicknessMil
    )
    assertSceneValue(preparedScene.board.centerX, builtScene.board.centerX)
    assertSceneValue(preparedScene.board.centerY, builtScene.board.centerY)
    assert.deepEqual(preparedScene.detail.copperTexts, [])
    assert.equal(
        Number.isFinite(preparedScene.detail.silkscreen.top.fillColor),
        true
    )
    assert.equal(
        Number.isFinite(preparedScene.detail.silkscreen.top.strokeColor),
        true
    )
})
