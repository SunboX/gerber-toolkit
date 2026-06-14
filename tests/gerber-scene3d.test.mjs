import assert from 'node:assert/strict'
import test from 'node:test'

import {
    PcbScene3dBuilder,
    PcbScene3dScenePreparator
} from '../src/scene3d.mjs'

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

    assert.equal(scene.sourceFormat, 'gerber')
    assert.equal(scene.coordinateSystem, 'gerber-3d-y-up')
    assert.equal(scene.board.widthMil, 393.700787)
    assert.equal(scene.board.heightMil, 236.220472)
    assert.equal(scene.board.thicknessMil, 63)
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
    assert.equal(scene.detail.tracks.length, 2)
    assert.equal(scene.detail.pads.length, 1)
    assert.equal(scene.detail.pads[0].holeDiameter, 23.622047)
    assert.equal(scene.detail.tracks[0].layerId, 1)
    assert.equal(scene.detail.tracks[1].layerId, 32)
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

test('PcbScene3dBuilder cuts copper tracks at Gerber drill holes', () => {
    const scene = PcbScene3dBuilder.build(createDrilledTrackDocument())
    const trackY = 196.850393
    const splitTracks = scene.detail.tracks.filter(
        (track) =>
            track.layerId === 1 &&
            Math.abs(track.y1 - trackY) <= 0.000001 &&
            Math.abs(track.y2 - trackY) <= 0.000001
    )

    assert.equal(splitTracks.length, 2)
    assert.ok(splitTracks.every((track) => track.x1 < track.x2))
    assert.ok(splitTracks[0].x2 < 78.740157)
    assert.ok(splitTracks[1].x1 > 78.740157)
    assert.ok(splitTracks[0].x2 <= 66.929133)
    assert.ok(splitTracks[1].x1 >= 90.551181)
    assert.notEqual(splitTracks[0].capStartRound, false)
    assert.equal(splitTracks[0].capEndRound, false)
    assert.equal(splitTracks[1].capStartRound, false)
    assert.notEqual(splitTracks[1].capEndRound, false)
    assert.notEqual(splitTracks[0].capStartSideWall, false)
    assert.equal(splitTracks[0].capEndSideWall, false)
    assert.equal(splitTracks[1].capStartSideWall, false)
    assert.notEqual(splitTracks[1].capEndSideWall, false)
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
    const clearance =
        Number(drilledPad.holeDiameter) / 2 + Number(endpointTrack.width) / 2

    assert.ok(endpointTrack.x2 <= drilledPad.x - clearance + 0.000001)
    assert.equal(endpointTrack.capEndRound, false)
    assert.equal(endpointTrack.capEndSideWall, false)
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
})
