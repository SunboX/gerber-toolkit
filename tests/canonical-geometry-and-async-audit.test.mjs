import assert from 'node:assert/strict'
import test from 'node:test'

import { zipSync } from 'fflate'
import { ToolkitLoopbackWorker } from 'circuitjson-toolkit/testing'

import * as toolkit from '../src/index.mjs'
import { GerberWorkerClient } from '../src/convergence/GerberWorkerClient.mjs'
import { Parser } from '../src/parser.mjs'
import { ProjectLoader } from '../src/project.mjs'

const ENCODER = new TextEncoder()

/**
 * Builds one small standards-valid Gerber program with representative artwork.
 * @param {string} fileFunction X2 FileFunction value or an empty string.
 * @returns {string} Gerber source.
 */
function artwork(fileFunction = '') {
    return [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        ...(fileFunction ? [`%TF.FileFunction,${fileFunction}*%`] : []),
        '%ADD10C,1.000*%',
        '%ADD11R,2.000X1.000*%',
        'D10*',
        'X010000Y020000D03*',
        'D11*',
        'X030000Y020000D03*',
        'D10*',
        'X000000Y000000D02*',
        'X020000Y000000D01*',
        'G36*',
        'X030000Y030000D02*',
        'X040000Y030000D01*',
        'X040000Y040000D01*',
        'X030000Y040000D01*',
        'G37*',
        'M02*'
    ].join('\n')
}

/**
 * Builds one profile file from axis-aligned closed contours.
 * @param {{ minX: number, minY: number, maxX: number, maxY: number }[]} boxes Contours.
 * @returns {string} Profile Gerber source.
 */
function profile(boxes) {
    const coordinate = (value) =>
        String(Math.round(value * 10_000)).padStart(6, '0')
    const rows = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%TF.FileFunction,Profile,NP*%',
        '%ADD10C,0.100*%',
        'D10*'
    ]
    for (const box of boxes) {
        rows.push(
            `X${coordinate(box.minX)}Y${coordinate(box.minY)}D02*`,
            `X${coordinate(box.maxX)}Y${coordinate(box.minY)}D01*`,
            `X${coordinate(box.maxX)}Y${coordinate(box.maxY)}D01*`,
            `X${coordinate(box.minX)}Y${coordinate(box.maxY)}D01*`,
            `X${coordinate(box.minX)}Y${coordinate(box.minY)}D01*`
        )
    }
    rows.push('M02*')
    return rows.join('\n')
}

test('macro, polygon, and aperture-block flashes survive canonical projection', () => {
    const header = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%TF.FileFunction,Copper,L1,Top*%'
    ]
    const sources = [
        [
            ...header,
            '%AMRING*',
            '1,1,1.000,0,0*',
            '1,0,0.400,0,0*%',
            '%ADD10RING,0*%',
            'D10*',
            'X020000Y020000D03*',
            'M02*'
        ].join('\n'),
        [
            ...header,
            '%ADD10P,2.000X6X15*%',
            'D10*',
            'X020000Y020000D03*',
            'M02*'
        ].join('\n'),
        [
            ...header,
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
    ]

    for (let index = 0; index < sources.length; index += 1) {
        const model = ProjectLoader.load([
            { name: `complex-${index}.gtl`, data: sources[index] }
        ]).documents[0].model
        assert.equal(
            model.some(
                (element) =>
                    element.type === 'pcb_copper_pour' &&
                    element.shape === 'brep'
            ),
            true
        )
    }
})

test('polygon and aperture-block flashes compose definition and layer transforms', () => {
    const polygonSource = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%TF.FileFunction,Copper,L1,Top*%',
        '%ADD10P,2.000X3X0*%',
        '%LMX*%',
        '%LR90*%',
        'D10*',
        'X020000Y020000D03*',
        'M02*'
    ].join('\n')
    const blockSource = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%TF.FileFunction,Copper,L1,Top*%',
        '%ABD10*%',
        '%ADD11C,0.500*%',
        'D11*',
        'X000000Y000000D03*',
        'X020000Y000000D03*',
        '%AB*%',
        '%LR90*%',
        'D10*',
        'X050000Y050000D03*',
        'M02*'
    ].join('\n')
    const polygon = ProjectLoader.load([
        { name: 'polygon.gtl', data: polygonSource }
    ]).documents[0].model.find((element) => element.type === 'pcb_copper_pour')
    const blocks = ProjectLoader.load([
        { name: 'block.gtl', data: blockSource }
    ]).documents[0].model.filter(
        (element) => element.type === 'pcb_copper_pour'
    )
    const vertices = polygon.brep_shape.outer_ring.vertices

    assert.equal(
        vertices.some(
            (point) =>
                Math.abs(point.x - 2) < 1e-6 && Math.abs(point.y - 1) < 1e-6
        ),
        true
    )
    const blockCenters = blocks
        .map((pour) => {
            const ring = pour.brep_shape.outer_ring.vertices
            return {
                x: ring.reduce((sum, point) => sum + point.x, 0) / ring.length,
                y: ring.reduce((sum, point) => sum + point.y, 0) / ring.length
            }
        })
        .sort((left, right) => left.y - right.y)
    assert.equal(blockCenters.length, 2)
    assert.equal(Math.abs(blockCenters[0].x - 5) < 1e-6, true)
    assert.equal(Math.abs(blockCenters[0].y - 5) < 1e-6, true)
    assert.equal(Math.abs(blockCenters[1].x - 5) < 1e-6, true)
    assert.equal(Math.abs(blockCenters[1].y - 7) < 1e-6, true)
})

test('X2 stack evidence determines the declared board layer count', () => {
    const entries = [1, 2, 3, 4].map((level) => ({
        name: `layer-${level}.gbr`,
        data: artwork(
            `Copper,L${level},${level === 1 ? 'Top' : level === 4 ? 'Bot' : 'Inr'}`
        )
    }))
    const model = ProjectLoader.load(entries).documents[0].model

    assert.equal(
        model.find((element) => element.type === 'pcb_board').num_layers,
        4
    )
})

test('rotated obround copper uses the canonical variant and paste stays neutral', () => {
    const source = (fileFunction) =>
        [
            '%FSLAX24Y24*%',
            '%MOMM*%',
            `%TF.FileFunction,${fileFunction}*%`,
            '%ADD10O,4.000X2.000*%',
            '%LR45*%',
            'D10*',
            'X050000Y050000D03*',
            'M02*'
        ].join('\n')
    const copper = ProjectLoader.load([
        { name: 'rotated.gtl', data: source('Copper,L1,Top') }
    ]).documents[0].model
    const paste = ProjectLoader.load([
        { name: 'rotated.gtp', data: source('Paste,Top') }
    ]).documents[0].model
    const pad = copper.find((element) => element.type === 'pcb_smtpad')

    assert.equal(pad.shape, 'rotated_pill')
    assert.equal(pad.ccw_rotation, 45)
    assert.equal(
        paste.some((element) => element.type === 'pcb_solder_paste'),
        false
    )
    assert.equal(
        paste.some((element) => element.type === 'pcb_note_path'),
        true
    )
})

test('rectangular copper pads use rect unless a rotation is present', () => {
    const source = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%TF.FileFunction,Copper,L1,Top*%',
        '%ADD10R,2.000X1.000*%',
        'D10*',
        'X010000Y010000D03*',
        '%LR45*%',
        'X040000Y010000D03*',
        'M02*'
    ].join('\n')
    const pads = Parser.parse({
        fileName: 'rectangles.gtl',
        data: source
    }).model.filter((element) => element.type === 'pcb_smtpad')

    assert.equal(pads[0].shape, 'rect')
    assert.equal(Object.hasOwn(pads[0], 'ccw_rotation'), false)
    assert.equal(pads[1].shape, 'rotated_rect')
    assert.equal(pads[1].ccw_rotation, 45)
})

test('drill-only plated slots preserve pill rotation without inventing face copper', () => {
    const drill = [
        'M48',
        'METRIC,TZ',
        'T01C0.600',
        '%',
        'T01',
        'X000000Y000000',
        'G85X020000Y020000',
        'M30'
    ].join('\n')
    const model = ProjectLoader.load([{ name: 'slot-PTH.drl', data: drill }])
        .documents[0].model
    const slot = model.find(
        (element) =>
            element.type === 'pcb_plated_hole' && element.shape === 'pill'
    )

    assert.equal(slot.shape, 'pill')
    assert.equal(slot.ccw_rotation, 45)
    assert.equal(slot.outer_width, slot.hole_width)
    assert.equal(slot.outer_height, slot.hole_height)
    assert.equal(Object.hasOwn(slot, 'pad_outline'), false)
})

test('disjoint profile loops remain separate boards while nested loops are cutouts', () => {
    const disjoint = ProjectLoader.load([
        {
            name: 'panel.gko',
            data: profile([
                { minX: 0, minY: 0, maxX: 10, maxY: 10 },
                { minX: 20, minY: 0, maxX: 30, maxY: 10 }
            ])
        }
    ]).documents[0].model
    const nested = ProjectLoader.load([
        {
            name: 'nested.gko',
            data: profile([
                { minX: 0, minY: 0, maxX: 30, maxY: 20 },
                { minX: 5, minY: 5, maxX: 10, maxY: 10 }
            ])
        }
    ]).documents[0].model

    assert.equal(
        disjoint.filter((element) => element.type === 'pcb_board').length,
        2
    )
    assert.equal(
        disjoint.filter((element) => element.type === 'pcb_cutout').length,
        0
    )
    assert.equal(
        nested.filter((element) => element.type === 'pcb_board').length,
        1
    )
    assert.equal(
        nested.filter((element) => element.type === 'pcb_cutout').length,
        1
    )
})

test('profile cutouts target only their containing board', () => {
    const model = ProjectLoader.load([
        {
            name: 'owned-panel.gko',
            data: profile([
                { minX: 0, minY: 0, maxX: 10, maxY: 10 },
                { minX: 20, minY: 0, maxX: 40, maxY: 20 },
                { minX: 25, minY: 5, maxX: 30, maxY: 10 }
            ])
        }
    ]).documents[0].model
    const cutout = model.find((element) => element.type === 'pcb_cutout')

    assert.equal(cutout.pcb_board_id, 'gerber_board_1')
})

test('async parser owns source bytes and assets before progress callbacks', async () => {
    const source = ENCODER.encode(artwork('Copper,L1,Top'))
    const asset = new Uint8Array([1, 2, 3])
    const document = await Parser.parseAsync(
        {
            fileName: 'owned.gtl',
            data: source,
            assets: [{ name: 'owned.step', data: asset }]
        },
        {
            worker: false,
            decodeAssets: 'full',
            onProgress: ({ stage }) => {
                if (stage !== 'detect') return
                source.fill(0)
                asset.fill(9)
            }
        }
    )

    assert.equal(
        document.model.some((element) => element.type === 'pcb_smtpad'),
        true
    )
    assert.deepEqual(document.assets[0].data, new Uint8Array([1, 2, 3]))
})

test('async parser isolates an exact SharedArrayBuffer-backed byte window', async () => {
    if (typeof SharedArrayBuffer !== 'function') return
    const payload = ENCODER.encode(artwork('Copper,L1,Top'))
    const backing = new SharedArrayBuffer(payload.byteLength + 8)
    const full = new Uint8Array(backing)
    full.set(payload, 4)
    const window = new Uint8Array(backing, 4, payload.byteLength)
    const document = await Parser.parseAsync(
        { fileName: 'shared.gtl', data: window },
        {
            worker: false,
            onProgress: ({ stage }) => {
                if (stage === 'detect') full.fill(0)
            }
        }
    )

    assert.equal(
        document.model.some((element) => element.type === 'pcb_smtpad'),
        true
    )
})

test('worker parser and project paths accept binary assets without recopy failures', async () => {
    const previousWorker = globalThis.Worker
    const observations = { parse: 0, loadProject: 0 }
    globalThis.Worker = ToolkitLoopbackWorker.constructorFor(
        toolkit,
        observations
    )
    try {
        const asset = new Uint8Array([1, 2, 3, 4])
        const document = await Parser.parseAsync(
            {
                fileName: 'worker.gtl',
                data: artwork('Copper,L1,Top'),
                assets: [{ name: 'worker.step', data: asset }]
            },
            { worker: true, decodeAssets: 'full' }
        )
        const project = await ProjectLoader.loadAsync(
            [
                {
                    name: 'worker.gtl',
                    data: artwork('Copper,L1,Top'),
                    assets: [{ name: 'worker.step', data: asset }]
                }
            ],
            { worker: true, decodeAssets: 'full' }
        )

        assert.deepEqual(document.assets[0].data, asset)
        assert.deepEqual(project.assets[0].data, asset)
        assert.deepEqual(observations, { parse: 1, loadProject: 1 })
    } finally {
        GerberWorkerClient.dispose()
        if (previousWorker === undefined) delete globalThis.Worker
        else globalThis.Worker = previousWorker
    }
})

test('option lists and filenames reject objects without executing caller code', () => {
    let reads = 0
    const extensions = new Array(1)
    Object.defineProperty(extensions, 0, {
        enumerable: true,
        get() {
            reads += 1
            return 'gerber.native-model'
        }
    })
    const fileName = {
        toString() {
            reads += 1
            return 'unsafe.gtl'
        }
    }

    assert.equal(
        Parser.tryParse(
            { fileName, data: artwork('Copper,L1,Top') },
            { extensions }
        ).ok,
        false
    )
    assert.equal(reads, 0)
})

test('async project loading snapshots entries and reports every candidate', async () => {
    const first = ENCODER.encode(artwork('Copper,L1,Top'))
    const second = ENCODER.encode(artwork('Legend,Top'))
    const entries = [
        { name: 'first.gtl', data: first },
        { name: 'second.gto', data: second }
    ]
    const completed = []
    const project = await ProjectLoader.loadAsync(entries, {
        worker: false,
        onProgress: (row) => {
            if (row.stage === 'detect') {
                entries[0].name = 'changed.bin'
                first.fill(0)
            }
            if (row.stage === 'project' && row.completed > 0) {
                completed.push(row.completed)
            }
        }
    })

    assert.deepEqual(project.source.entryNames, ['first.gtl', 'second.gto'])
    assert.deepEqual(completed, [1, 2])
})

test('ZIP preflight handles metadata, content-sniffed members, and caller statistics', () => {
    const gerber = ENCODER.encode(artwork('Copper,L1,Top'))
    const archive = zipSync({
        'board.TXT': gerber,
        '__MACOSX/._board.TXT': ENCODER.encode('metadata')
    })
    const entries = [{ name: 'bundle.zip', data: archive }]

    assert.equal(ProjectLoader.supports(entries), true)
    const project = ProjectLoader.load(entries, { decodeAssets: 'metadata' })
    assert.equal(project.statistics.entryCount, 1)
    assert.equal(project.statistics.totalBytes, archive.byteLength)
    assert.equal(project.statistics.expandedEntryCount, 1)
    assert.equal(project.statistics.expandedBytes, gerber.byteLength)
    assert.deepEqual(project.source.entryNames, ['bundle.zip'])
})

test('ZIP support claims only real Gerber candidates and verifies CRC integrity', () => {
    const unrelated = zipSync({
        'board.kicad_pcb': ENCODER.encode('(kicad_pcb (version 20240108))'),
        'readme.pdf': new Uint8Array([0x25, 0x50, 0x44, 0x46])
    })
    const valid = ENCODER.encode(artwork('Copper,L1,Top'))
    const corrupt = zipSync({ 'board.gtl': valid }, { level: 0 })
    const marker = corrupt.findIndex(
        (value, index) =>
            index > 30 && value === valid[0] && corrupt[index + 1] === valid[1]
    )
    assert.equal(marker > 0, true)
    corrupt[marker] ^= 0xff

    assert.equal(
        ProjectLoader.supports([{ name: 'unrelated.zip', data: unrelated }]),
        false
    )
    assert.equal(
        ProjectLoader.supports([{ name: 'corrupt.zip', data: corrupt }]),
        true
    )
    assert.throws(
        () => ProjectLoader.load([{ name: 'corrupt.zip', data: corrupt }]),
        (error) => error?.code === 'ERR_ARCHIVE_INVALID'
    )
})

test('project input failures stay typed and supports validates every entry', () => {
    assert.throws(
        () => ProjectLoader.load([null]),
        (error) =>
            error?.code === 'ERR_PROJECT_INPUT' &&
            error?.category === 'validation' &&
            error?.format === 'gerber'
    )
    assert.equal(
        ProjectLoader.supports([
            { name: 'valid.gtl', data: artwork('Copper,L1,Top') },
            { name: '../unsafe.txt', data: 'not fabrication' }
        ]),
        false
    )
})

test('ZIP depth and size violations are rejected from metadata before inflation', () => {
    const nested = zipSync({
        'nested.zip': zipSync({
            'board.gtl': ENCODER.encode(artwork('Copper,L1,Top'))
        })
    })
    const oversized = zipSync({
        'large.gtl': new Uint8Array(4096).fill(65)
    })
    oversized[40] ^= 0xff

    assert.throws(
        () => ProjectLoader.load([{ name: 'nested.zip', data: nested }]),
        (error) =>
            error?.code === 'ERR_ARCHIVE_LIMIT_EXCEEDED' &&
            error?.details?.limit === 'maxArchiveDepth'
    )
    assert.throws(
        () =>
            ProjectLoader.load([{ name: 'large.zip', data: oversized }], {
                archiveLimits: { maxEntryBytes: 1024 }
            }),
        (error) =>
            error?.code === 'ERR_ARCHIVE_LIMIT_EXCEEDED' &&
            error?.details?.limit === 'maxEntryBytes'
    )
})
