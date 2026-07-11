import assert from 'node:assert/strict'
import test from 'node:test'

import { zipSync } from 'fflate'
import { ToolkitContractFixtures } from 'circuitjson-toolkit/testing'

import { ProjectLoader } from '../src/project.mjs'

const FIXTURE = ToolkitContractFixtures.gerber()

test('common project loader accepts app entry shape and expands one ZIP blob', () => {
    const encoded = new TextEncoder().encode(FIXTURE.parserInput.data)
    const archive = zipSync({ 'layers/contract.gtl': encoded })

    const direct = ProjectLoader.load([
        { name: FIXTURE.parserInput.fileName, data: encoded }
    ])
    const zipped = ProjectLoader.load([{ name: 'contract.zip', data: archive }])

    assert.equal(direct.schema, 'ecad-toolkit.project.v1')
    assert.equal(zipped.schema, 'ecad-toolkit.project.v1')
    assert.equal(direct.documents.length, 1)
    assert.equal(zipped.documents.length, 1)
    assert.equal(zipped.documents[0].source.format, 'gerber')
    assert.equal(zipped.extensions.gerber.archiveExpanded, true)
})

test('common parser output is directly consumable by every shared PCB service', async () => {
    const toolkit = await import('../src/index.mjs')
    const document = toolkit.Parser.parse(FIXTURE.parserInput)
    const context = toolkit.CircuitJsonDocumentContext.prepare(document)

    assert.equal(context.document, document)
    assert.match(toolkit.PcbSvgRenderer.render(context), /^<svg/u)
    assert.deepEqual(
        toolkit.PcbInteractionIndex.create(context).hitTest({ x: 0, y: 0 }),
        toolkit.PcbInteractionIndex.create(context).hitTest({ x: 0, y: 0 })
    )
    assert.equal(
        toolkit.PcbScene3dBuilder.build(context).schema,
        'ecad-toolkit.scene3d.v1'
    )
    assert.equal(
        (await toolkit.PcbScene3dPreparator.prepare(context)).schema,
        'ecad-toolkit.scene3d.v1'
    )
})

test('canonical projection retains every standards-representable fabrication primitive', () => {
    const copper = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%ADD10C,1.000*%',
        '%ADD11R,1.200X0.600*%',
        'D10*',
        'X000000Y000000D03*',
        'X000000Y000000D02*',
        'X010000Y000000D01*',
        'D11*',
        'X020000Y020000D03*',
        'G36*',
        'X030000Y030000D02*',
        'X040000Y030000D01*',
        'X040000Y040000D01*',
        'X030000Y040000D01*',
        'G37*',
        'M02*'
    ].join('\n')
    const drill = [
        'M48',
        'METRIC,TZ',
        'T01C0.600',
        '%',
        'T01',
        'X050000Y060000',
        'M30'
    ].join('\n')
    const project = ProjectLoader.load([
        { name: 'board.gtl', data: copper },
        { name: 'board.drl', data: drill }
    ])
    const types = new Set(project.documents[0].model.map((row) => row.type))

    assert.equal(types.has('pcb_board'), true)
    assert.equal(types.has('pcb_trace'), true)
    assert.equal(types.has('pcb_smtpad'), true)
    assert.equal(types.has('pcb_copper_pour'), true)
    assert.equal(types.has('pcb_hole'), true)
    assert.equal(
        project.documents[0].statistics.canonicalElementCount,
        project.documents[0].model.length
    )
})
