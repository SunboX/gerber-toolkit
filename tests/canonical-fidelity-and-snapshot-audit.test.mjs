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

test('ambiguous Gerber artwork stays neutral instead of becoming copper', () => {
    const model = ProjectLoader.load([{ name: 'neutral.gbr', data: artwork() }])
        .documents[0].model

    assert.equal(
        model.some((element) =>
            ['pcb_smtpad', 'pcb_trace', 'pcb_copper_pour'].includes(
                element.type
            )
        ),
        false
    )
    assert.equal(
        model.filter((element) => element.type.startsWith('pcb_note_')).length,
        4
    )
})

test('X2 legend, paste, and soldermask preserve their distinct semantics', () => {
    const legend = ProjectLoader.load([
        { name: 'legend.gbr', data: artwork('Legend,Top') }
    ]).documents[0].model
    const paste = ProjectLoader.load([
        { name: 'paste.gbr', data: artwork('Paste,Top') }
    ]).documents[0].model
    const mask = ProjectLoader.load([
        { name: 'mask.gbr', data: artwork('Soldermask,Top') }
    ]).documents[0].model

    assert.deepEqual(
        legend
            .filter((element) => element.type.startsWith('pcb_silkscreen_'))
            .map((element) => element.type)
            .sort(),
        [
            'pcb_silkscreen_circle',
            'pcb_silkscreen_graphic',
            'pcb_silkscreen_line',
            'pcb_silkscreen_rect'
        ]
    )
    assert.equal(
        paste.filter((element) => element.type === 'pcb_solder_paste').length,
        2
    )
    assert.equal(
        paste.filter((element) => element.type.startsWith('pcb_note_')).length,
        2
    )
    assert.equal(
        mask.filter((element) => element.type.startsWith('pcb_note_')).length,
        4
    )
    assert.equal(
        mask.some((element) =>
            ['pcb_smtpad', 'pcb_trace', 'pcb_copper_pour'].includes(
                element.type
            )
        ),
        false
    )
})

test('clear Legend artwork becomes silkscreen BREP holes', () => {
    const source = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%TF.FileFunction,Legend,Top*%',
        '%LPD*%',
        'G36*',
        'X000000Y000000D02*',
        'X100000Y000000D01*',
        'X100000Y100000D01*',
        'X000000Y100000D01*',
        'G37*',
        '%LPC*%',
        'G36*',
        'X020000Y020000D02*',
        'X040000Y020000D01*',
        'X040000Y040000D01*',
        'X020000Y040000D01*',
        'G37*',
        'M02*'
    ].join('\n')
    const model = ProjectLoader.load([{ name: 'clear.gto', data: source }])
        .documents[0].model
    const graphic = model.find(
        (element) => element.type === 'pcb_silkscreen_graphic'
    )

    assert.equal(graphic.brep_shape.inner_rings.length, 1)
    assert.equal(
        model.some((element) => element.type.startsWith('pcb_note_')),
        false
    )
})

test('solder-mask openings split canonical copper coverage', () => {
    const copper = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%TF.FileFunction,Copper,L1,Top*%',
        'G36*',
        'X000000Y000000D02*',
        'X100000Y000000D01*',
        'X100000Y100000D01*',
        'X000000Y100000D01*',
        'G37*',
        'M02*'
    ].join('\n')
    const mask = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%TF.FileFunction,Soldermask,Top*%',
        '%ADD10C,2.000*%',
        'D10*',
        'X050000Y050000D03*',
        'M02*'
    ].join('\n')
    const model = ProjectLoader.load([
        { name: 'copper.gtl', data: copper },
        { name: 'mask.gts', data: mask }
    ]).documents[0].model
    const pours = model.filter((element) => element.type === 'pcb_copper_pour')

    assert.equal(
        pours.some((pour) => pour.covered_with_solder_mask === true),
        true
    )
    assert.equal(
        pours.some((pour) => pour.covered_with_solder_mask === false),
        true
    )
})

test('clear copper regions become BREP holes instead of documentation overlays', () => {
    const source = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%TF.FileFunction,Copper,L1,Top*%',
        '%LPD*%',
        'G36*',
        'X000000Y000000D02*',
        'X100000Y000000D01*',
        'X100000Y100000D01*',
        'X000000Y100000D01*',
        'G37*',
        '%LPC*%',
        'G36*',
        'X020000Y020000D02*',
        'X040000Y020000D01*',
        'X040000Y040000D01*',
        'X020000Y040000D01*',
        'G37*',
        'M02*'
    ].join('\n')
    const model = ProjectLoader.load([{ name: 'clear.gtl', data: source }])
        .documents[0].model
    const pours = model.filter((element) => element.type === 'pcb_copper_pour')

    assert.equal(pours.length, 1)
    assert.equal(pours[0].shape, 'brep')
    assert.equal(pours[0].brep_shape.inner_rings.length, 1)
    assert.equal(
        model.some((element) => element.type.startsWith('pcb_note_')),
        false
    )
})

test('ordered copper composition subtracts clear artwork from all accumulated shapes', () => {
    const source = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%TF.FileFunction,Copper,L1,Top*%',
        '%ADD10C,2.000*%',
        '%LPD*%',
        'G36*',
        'X000000Y000000D02*',
        'X080000Y000000D01*',
        'X080000Y080000D01*',
        'X000000Y080000D01*',
        'G37*',
        'G36*',
        'X040000Y000000D02*',
        'X120000Y000000D01*',
        'X120000Y080000D01*',
        'X040000Y080000D01*',
        'G37*',
        'D10*',
        'X000000Y040000D02*',
        'X120000Y040000D01*',
        '%LPC*%',
        'X060000Y040000D03*',
        'M02*'
    ].join('\n')
    const model = ProjectLoader.load([{ name: 'ordered.gtl', data: source }])
        .documents[0].model
    const pours = model.filter((element) => element.type === 'pcb_copper_pour')

    assert.equal(pours.length > 0, true)
    assert.equal(
        pours.some((pour) => pour.brep_shape?.inner_rings?.length > 0),
        true
    )
    assert.equal(
        model.some((element) =>
            ['pcb_trace', 'pcb_smtpad', 'pcb_note_path'].includes(element.type)
        ),
        false
    )
})

test('standard aperture holes survive native parsing and canonical projection', () => {
    const source = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%TF.FileFunction,Copper,L1,Top*%',
        '%ADD10C,2.000X1.000*%',
        '%ADD11R,3.000X2.000X1.000X0.500*%',
        'D10*',
        'X020000Y020000D03*',
        'D11*',
        'X060000Y020000D03*',
        'M02*'
    ].join('\n')
    const result = Parser.parse(
        { fileName: 'aperture-holes.gtl', data: source },
        { extensions: 'full' }
    )
    const flashes =
        result.extensions.gerber.native.pcb.fabrication.layers[0].primitives
    const pours = result.model.filter(
        (element) => element.type === 'pcb_copper_pour'
    )

    assert.deepEqual(flashes[0].hole, {
        shape: 'circle',
        diameter: 1
    })
    assert.deepEqual(flashes[1].hole, {
        shape: 'rect',
        width: 1,
        height: 0.5
    })
    assert.equal(pours.length, 2)
    assert.deepEqual(
        pours.map((pour) => pour.brep_shape.inner_rings.length),
        [1, 1]
    )
})

test('macro vector lines use rectangular rather than round end caps', () => {
    const source = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%TF.FileFunction,Copper,L1,Top*%',
        '%AMBAR*',
        '20,1,1.000,-1.000,0,1.000,0,0*%',
        '%ADD10BAR,0*%',
        'D10*',
        'X050000Y050000D03*',
        'M02*'
    ].join('\n')
    const model = ProjectLoader.load([{ name: 'bar.gtl', data: source }])
        .documents[0].model
    const pour = model.find((element) => element.type === 'pcb_copper_pour')
    const vertices = pour.brep_shape.outer_ring.vertices

    assert.equal(Math.min(...vertices.map((point) => point.x)), 4)
    assert.equal(Math.max(...vertices.map((point) => point.x)), 6)
    assert.equal(Math.min(...vertices.map((point) => point.y)), 4.5)
    assert.equal(Math.max(...vertices.map((point) => point.y)), 5.5)
})

test('fully covered or open copper retains canonical trace and pad rows', () => {
    const copper = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%TF.FileFunction,Copper,L1,Top*%',
        '%ADD10C,1.000*%',
        'D10*',
        'X010000Y010000D03*',
        'X020000Y010000D02*',
        'X040000Y010000D01*',
        'M02*'
    ].join('\n')
    const mask = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%TF.FileFunction,Soldermask,Top*%',
        '%ADD10C,2.000*%',
        'D10*',
        'X010000Y010000D03*',
        'M02*'
    ].join('\n')
    const model = ProjectLoader.load([
        { name: 'features.gtl', data: copper },
        { name: 'features.gts', data: mask }
    ]).documents[0].model

    assert.equal(
        model.some((element) => element.type === 'pcb_smtpad'),
        true
    )
    assert.equal(
        model.find((element) => element.type === 'pcb_smtpad')
            .is_covered_with_solder_mask,
        false
    )
    assert.equal(
        model.some((element) => element.type === 'pcb_trace'),
        true
    )
})

test('X2 negative copper complements the composed image inside the board domain', () => {
    const copper = (filePolarity) =>
        [
            '%FSLAX24Y24*%',
            '%MOMM*%',
            '%TF.FileFunction,Copper,L1,Top*%',
            `%TF.FilePolarity,${filePolarity}*%`,
            '%ADD10C,2.000*%',
            'D10*',
            'X050000Y050000D03*',
            'M02*'
        ].join('\n')
    const board = profile([{ minX: 0, minY: 0, maxX: 10, maxY: 10 }])
    const negative = ProjectLoader.load([
        { name: 'board.gko', data: board },
        { name: 'plane.gtl', data: copper('Negative') }
    ]).documents[0].model
    const positive = ProjectLoader.load([
        { name: 'board.gko', data: board },
        { name: 'signal.gtl', data: copper('Positive') }
    ]).documents[0].model
    const plane = negative.find((element) => element.type === 'pcb_copper_pour')

    assert.equal(plane.shape, 'brep')
    assert.equal(plane.brep_shape.inner_rings.length, 1)
    assert.equal(
        positive.some((element) => element.type === 'pcb_smtpad'),
        true
    )
    assert.equal(
        negative.some((element) => element.type === 'pcb_smtpad'),
        false
    )
})

test('negative copper respects disjoint boards and owned profile cutouts', () => {
    const board = profile([
        { minX: 0, minY: 0, maxX: 10, maxY: 10 },
        { minX: 2, minY: 2, maxX: 4, maxY: 4 },
        { minX: 20, minY: 0, maxX: 30, maxY: 10 }
    ])
    const copper = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%TF.FileFunction,Copper,L1,Top*%',
        '%TF.FilePolarity,Negative*%',
        'M02*'
    ].join('\n')
    const pours = ProjectLoader.load([
        { name: 'panel.gko', data: board },
        { name: 'plane.gtl', data: copper }
    ]).documents[0].model.filter(
        (element) => element.type === 'pcb_copper_pour'
    )
    const ranges = pours
        .map((pour) => {
            const xs = pour.brep_shape.outer_ring.vertices.map(
                (point) => point.x
            )
            return [Math.min(...xs), Math.max(...xs)]
        })
        .sort((left, right) => left[0] - right[0])

    assert.equal(pours.length, 2)
    assert.deepEqual(ranges, [
        [0, 10],
        [20, 30]
    ])
    assert.equal(
        pours.reduce(
            (count, pour) => count + (pour.brep_shape.inner_rings?.length || 0),
            0
        ),
        1
    )
})

test('legacy IPNEG reverses image generation before material interpretation', () => {
    const board = profile([{ minX: 0, minY: 0, maxX: 10, maxY: 10 }])
    const copper = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%TF.FileFunction,Copper,L1,Top*%',
        '%IPNEG*%',
        '%ADD10C,2.000*%',
        'D10*',
        'X050000Y050000D03*',
        'M02*'
    ].join('\n')
    const model = ProjectLoader.load([
        { name: 'board.gko', data: board },
        { name: 'legacy.gtl', data: copper }
    ]).documents[0].model
    const plane = model.find((element) => element.type === 'pcb_copper_pour')

    assert.equal(plane.brep_shape.inner_rings.length, 1)
    assert.equal(
        model.some((element) => element.type === 'pcb_smtpad'),
        false
    )
})

test('negative X2 legend material is projected through the board domain', () => {
    const board = profile([{ minX: 0, minY: 0, maxX: 10, maxY: 10 }])
    const legend = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%TF.FileFunction,Legend,Top*%',
        '%TF.FilePolarity,Negative*%',
        '%ADD10C,2.000*%',
        'D10*',
        'X050000Y050000D03*',
        'M02*'
    ].join('\n')
    const graphic = ProjectLoader.load([
        { name: 'board.gko', data: board },
        { name: 'negative.gto', data: legend }
    ]).documents[0].model.find(
        (element) => element.type === 'pcb_silkscreen_graphic'
    )

    assert.equal(graphic.brep_shape.inner_rings.length, 1)
})

test('positive and negative X2 mask files resolve to equivalent openings', () => {
    const board = profile([{ minX: 0, minY: 0, maxX: 10, maxY: 10 }])
    const copper = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%TF.FileFunction,Copper,L1,Top*%',
        'G36*',
        'X000000Y000000D02*',
        'X100000Y000000D01*',
        'X100000Y100000D01*',
        'X000000Y100000D01*',
        'G37*',
        'M02*'
    ].join('\n')
    const mask = (polarity, positive) =>
        [
            '%FSLAX24Y24*%',
            '%MOMM*%',
            '%TF.FileFunction,Soldermask,Top*%',
            `%TF.FilePolarity,${polarity}*%`,
            '%ADD10C,2.000*%',
            ...(positive
                ? [
                      'G36*',
                      'X000000Y000000D02*',
                      'X100000Y000000D01*',
                      'X100000Y100000D01*',
                      'X000000Y100000D01*',
                      'G37*',
                      '%LPC*%'
                  ]
                : []),
            'D10*',
            'X050000Y050000D03*',
            'M02*'
        ].join('\n')
    const project = (maskSource) =>
        ProjectLoader.load([
            { name: 'board.gko', data: board },
            { name: 'copper.gtl', data: copper },
            { name: 'mask.gts', data: maskSource }
        ]).documents[0].model.filter(
            (element) => element.type === 'pcb_copper_pour'
        )
    const negative = project(mask('Negative', false))
    const positive = project(mask('Positive', true))

    assert.deepEqual(
        negative.map((row) => row.covered_with_solder_mask).sort(),
        [false, true]
    )
    assert.deepEqual(
        positive.map((row) => row.covered_with_solder_mask).sort(),
        [false, true]
    )
    assert.deepEqual(
        positive.map((row) => row.brep_shape),
        negative.map((row) => row.brep_shape)
    )
})

test('empty explicit mask images still define covered and open copper state', () => {
    const board = profile([{ minX: 0, minY: 0, maxX: 10, maxY: 10 }])
    const copper = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%TF.FileFunction,Copper,L1,Top*%',
        '%ADD10C,1.000*%',
        'D10*',
        'X050000Y050000D03*',
        'M02*'
    ].join('\n')
    const mask = (polarity) =>
        [
            '%FSLAX24Y24*%',
            '%MOMM*%',
            '%TF.FileFunction,Soldermask,Top*%',
            `%TF.FilePolarity,${polarity}*%`,
            'M02*'
        ].join('\n')
    const covered = ProjectLoader.load([
        { name: 'board.gko', data: board },
        { name: 'copper.gtl', data: copper },
        { name: 'covered.gts', data: mask('Negative') }
    ]).documents[0].model.find((element) => element.type === 'pcb_smtpad')
    const open = ProjectLoader.load([
        { name: 'board.gko', data: board },
        { name: 'copper.gtl', data: copper },
        { name: 'open.gts', data: mask('Positive') }
    ]).documents[0].model.find((element) => element.type === 'pcb_smtpad')

    assert.equal(covered.is_covered_with_solder_mask, true)
    assert.equal(open.is_covered_with_solder_mask, false)
})

test('negative file polarity without a profile reports its finite fallback domain', () => {
    const source = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%TF.FileFunction,Copper,L1,Top*%',
        '%TF.FilePolarity,Negative*%',
        '%ADD10C,2.000*%',
        'D10*',
        'X050000Y050000D03*',
        'M02*'
    ].join('\n')
    const document = Parser.parse({ fileName: 'fallback.gtl', data: source })

    assert.equal(
        document.diagnostics.some(
            (diagnostic) =>
                diagnostic.code === 'GERBER_FILE_POLARITY_DOMAIN_FALLBACK'
        ),
        true
    )
})

test('X2 object attributes become shared component, port, and net ownership', () => {
    const copper = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%TF.FileFunction,Copper,L1,Top*%',
        '%TA.AperFunction,SMDPad*%',
        '%ADD10C,1.000*%',
        'D10*',
        '%TO.P,U1,1,VCC*%',
        '%TO.N,VCC*%',
        'X010000Y010000D03*',
        'X020000Y010000D03*',
        '%TD.P*%',
        '%TD.N*%',
        '%TO.P,U1,2,GND*%',
        '%TO.N,GND*%',
        'X030000Y010000D03*',
        'M02*'
    ].join('\n')
    const legend = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%TF.FileFunction,Legend,Top*%',
        '%ADD10C,0.200*%',
        'D10*',
        '%TO.C,R2*%',
        'X000000Y030000D02*',
        'X020000Y030000D01*',
        'M02*'
    ].join('\n')
    const model = ProjectLoader.load([
        { name: 'owned.gtl', data: copper },
        { name: 'owned.gto', data: legend }
    ]).documents[0].model
    const components = model.filter(
        (element) => element.type === 'source_component'
    )
    const u1 = components.find((component) => component.name === 'U1')
    const r2 = components.find((component) => component.name === 'R2')
    const r2Pcb = model.find(
        (element) =>
            element.type === 'pcb_component' &&
            element.source_component_id === r2.source_component_id
    )
    const ports = model.filter(
        (element) =>
            element.type === 'source_port' &&
            element.source_component_id === u1.source_component_id
    )
    const pads = model.filter((element) => element.type === 'pcb_smtpad')
    const nets = model
        .filter((element) => element.type === 'source_net')
        .map((net) => net.name)
        .sort()
    const legendLine = model.find(
        (element) => element.type === 'pcb_silkscreen_line'
    )

    assert.equal(components.length, 2)
    assert.equal(ports.length, 2)
    assert.deepEqual(nets, ['GND', 'VCC'])
    assert.equal(pads[0].pcb_port_id, pads[1].pcb_port_id)
    assert.equal(pads[0].pcb_component_id, pads[2].pcb_component_id)
    assert.equal(legendLine.pcb_component_id, r2Pcb.pcb_component_id)
    assert.equal(
        model.filter((element) => element.type === 'pcb_net').length,
        2
    )
})

test('X2 P ownership wins over conflicting C ownership with a diagnostic', () => {
    const source = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%TF.FileFunction,Copper,L1,Top*%',
        '%ADD10C,1.000*%',
        'D10*',
        '%TO.C,U2*%',
        '%TO.P,U1,1,SIG*%',
        '%TO.N,SIG*%',
        'X010000Y010000D03*',
        'M02*'
    ].join('\n')
    const document = Parser.parse({ fileName: 'conflict.gtl', data: source })
    const pad = document.model.find((element) => element.type === 'pcb_smtpad')
    const u1 = document.model.find(
        (element) =>
            element.type === 'pcb_component' &&
            document.model.find(
                (sourceElement) =>
                    sourceElement.type === 'source_component' &&
                    sourceElement.source_component_id ===
                        element.source_component_id &&
                    sourceElement.name === 'U1'
            )
    )

    assert.equal(pad.pcb_component_id, u1.pcb_component_id)
    assert.equal(
        document.diagnostics.some(
            (diagnostic) =>
                diagnostic.code === 'GERBER_X2_COMPONENT_OWNERSHIP_CONFLICT'
        ),
        true
    )
})

test('X2 N/C is shared by repeated flashes of one port but not globally', () => {
    const source = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%TF.FileFunction,Copper,L1,Top*%',
        '%ADD10C,1.000*%',
        'D10*',
        '%TO.P,U1,1*%',
        '%TO.N,N/C*%',
        'X010000Y010000D03*',
        'X020000Y010000D03*',
        '%TO.P,U1,2*%',
        'X030000Y010000D03*',
        'M02*'
    ].join('\n')
    const model = Parser.parse({ fileName: 'nc.gtl', data: source }).model
    const pads = model.filter((element) => element.type === 'pcb_smtpad')
    const nets = model.filter(
        (element) => element.type === 'source_net' && element.name === 'N/C'
    )

    assert.equal(nets.length, 2)
    assert.equal(pads[0].pcb_port_id, pads[1].pcb_port_id)
    assert.notEqual(pads[1].pcb_port_id, pads[2].pcb_port_id)
})

test('X2 absent and explicit-empty net attributes remain distinguishable', () => {
    const source = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%TF.FileFunction,Copper,L1,Top*%',
        '%ADD10C,1.000*%',
        'D10*',
        '%TO.P,U2,1*%',
        'X010000Y010000D03*',
        '%TO.P,U2,2*%',
        '%TO.N*%',
        'X020000Y010000D03*',
        'M02*'
    ].join('\n')
    const model = Parser.parse({
        fileName: 'empty-net.gtl',
        data: source
    }).model
    const ports = model.filter((element) => element.type === 'source_port')
    const traces = model.filter((element) => element.type === 'source_trace')

    assert.equal(traces.length, 1)
    assert.deepEqual(traces[0].connected_source_net_ids, [])
    assert.deepEqual(traces[0].connected_source_port_ids, [
        ports.find((port) => port.name === '2').source_port_id
    ])
    assert.equal(
        traces.some((trace) =>
            trace.connected_source_port_ids.includes(
                ports.find((port) => port.name === '1').source_port_id
            )
        ),
        false
    )
})

test('X2 multi-net copper traces preserve every named connection', () => {
    const source = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%TF.FileFunction,Copper,L1,Top*%',
        '%ADD10C,0.500*%',
        'D10*',
        '%TO.N,A,B*%',
        'X000000Y000000D02*',
        'X020000Y000000D01*',
        'M02*'
    ].join('\n')
    const model = Parser.parse({
        fileName: 'multi-net.gtl',
        data: source
    }).model
    const sourceTrace = model.find((element) => element.type === 'source_trace')
    const pcbTrace = model.find((element) => element.type === 'pcb_trace')

    assert.equal(sourceTrace.connected_source_net_ids.length, 2)
    assert.deepEqual(
        model
            .filter((element) => element.type === 'source_net')
            .map((net) => net.name)
            .sort(),
        ['A', 'B']
    )
    assert.equal(pcbTrace.source_trace_id, sourceTrace.source_trace_id)
})

test('nonconductive net attributes do not invent electrical connectivity', () => {
    const source = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%TF.FileFunction,Legend,Top*%',
        '%ADD10C,0.200*%',
        'D10*',
        '%TO.N,NOT_A_NET_HERE*%',
        'X000000Y000000D02*',
        'X020000Y000000D01*',
        'M02*'
    ].join('\n')
    const model = Parser.parse({ fileName: 'legend.gto', data: source }).model

    assert.equal(
        model.some((element) => element.type === 'source_net'),
        false
    )
    assert.equal(
        model.some((element) => element.type === 'source_trace'),
        false
    )
})

test('mixed owned and unowned composed legend never overclaims ownership', () => {
    const source = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%TF.FileFunction,Legend,Top*%',
        '%TO.C,U1*%',
        'G36*',
        'X000000Y000000D02*',
        'X040000Y000000D01*',
        'X040000Y040000D01*',
        'X000000Y040000D01*',
        'G37*',
        '%TD.C*%',
        '%LPC*%',
        'G36*',
        'X010000Y010000D02*',
        'X020000Y010000D01*',
        'X020000Y020000D01*',
        'X010000Y020000D01*',
        'G37*',
        'M02*'
    ].join('\n')
    const graphic = Parser.parse({
        fileName: 'mixed.gto',
        data: source
    }).model.find((element) => element.type === 'pcb_silkscreen_graphic')

    assert.equal(graphic.pcb_component_id, '')
})
