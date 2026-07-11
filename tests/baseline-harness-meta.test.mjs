import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

import { GerberApiBaselineHarness } from '../scripts/GerberApiBaselineHarness.mjs'
import { GerberBehaviorEvidence } from '../scripts/GerberBehaviorEvidence.mjs'

test('Gerber API capture excludes artifact and script-owned meta tests', async (context) => {
    const root = await mkdtemp(join(tmpdir(), 'gerber-meta-evidence-'))
    const source = join(root, 'source')
    const evidence = join(root, 'evidence')
    await mkdir(join(source, 'src'), { recursive: true })
    await mkdir(join(evidence, 'tests'), { recursive: true })
    await writeFile(
        join(source, 'package.json'),
        JSON.stringify({
            name: 'gerber-toolkit',
            version: '0.1.21',
            type: 'module',
            exports: { '.': './src/index.mjs' }
        })
    )
    await writeFile(
        join(source, 'src/index.mjs'),
        'export class Example { static build() { return { value: true, metaOnly: true } } }\n'
    )
    await writeFile(
        join(evidence, 'tests/example.test.mjs'),
        `import { Example } from '../../source/src/index.mjs'
const result = Example.build()
void result.value
void GerberParser
void GerberProjectLoader
void GerberPcbSvgRenderer
void PcbInteractionIndex
void PcbScene3dBuilder
`
    )
    await writeFile(
        join(evidence, 'tests/api-result-contract-artifacts.test.mjs'),
        `import '../scripts/capture-api-baseline.mjs'
const result = Example.build()
void result.metaOnly
`
    )
    context.after(() => rm(root, { recursive: true, force: true }))

    const { baseline } = await GerberApiBaselineHarness.capture({
        sourceRoot: pathToFileURL(`${source}/`),
        evidenceRoot: pathToFileURL(`${evidence}/`),
        provenance: {
            sourceCommit: 'fixture',
            sourceTree: 'fixture',
            evidenceCommit: 'fixture',
            evidenceTree: 'fixture',
            harnessCommit: 'fixture',
            harnessTree: 'fixture'
        },
        baselineVersion: '0.1.21'
    })
    const features = new Map(baseline.features.map((row) => [row.feature, row]))

    assert.equal(features.has('.#Example.build().result.value'), true)
    assert.equal(features.has('.#Example.build().result.metaOnly'), true)
    assert.deepEqual(features.get('.#Example.build().result.value').evidence, {
        source: { kind: 'source-contract' },
        usage: { kind: 'result-path' }
    })
    assert.deepEqual(
        features.get('.#Example.build().result.metaOnly').evidence,
        {
            source: { kind: 'source-contract' },
            usage: null
        }
    )
    assert.deepEqual(
        features.get('.#Example.build().result.metaOnly').tests,
        []
    )
    assert.equal(
        baseline.features.some((row) =>
            row.tests?.includes('tests/api-result-contract-artifacts.test.mjs')
        ),
        false
    )
})

test('Gerber API capture rejects token-only behavior evidence', async (context) => {
    const root = await mkdtemp(join(tmpdir(), 'gerber-behavior-evidence-'))
    const source = join(root, 'source')
    const evidence = join(root, 'evidence')
    await mkdir(join(source, 'src'), { recursive: true })
    await mkdir(join(evidence, 'tests'), { recursive: true })
    await writeFile(
        join(source, 'package.json'),
        JSON.stringify({
            name: 'gerber-toolkit',
            version: '0.1.21',
            type: 'module',
            exports: { '.': './src/index.mjs' }
        })
    )
    await writeFile(
        join(source, 'src/index.mjs'),
        'export class GerberParser { static parseArrayBuffer() { return {} } }\n'
    )
    await writeFile(
        join(evidence, 'tests/token-only.test.mjs'),
        `void GerberParser
void GerberParser.parseArrayBuffer
void GerberProjectLoader
void GerberPcbSvgRenderer
void PcbInteractionIndex
void PcbScene3dBuilder
`
    )
    context.after(() => rm(root, { recursive: true, force: true }))

    await assert.rejects(
        () =>
            GerberApiBaselineHarness.capture({
                sourceRoot: pathToFileURL(`${source}/`),
                evidenceRoot: pathToFileURL(`${evidence}/`),
                provenance: {
                    sourceCommit: 'fixture',
                    sourceTree: 'fixture',
                    evidenceCommit: 'fixture',
                    evidenceTree: 'fixture',
                    harnessCommit: 'fixture',
                    harnessTree: 'fixture'
                },
                baselineVersion: '0.1.21'
            }),
        /No behavior-specific historical evidence/u
    )
})

test('interaction behavior requires explicit four-kind bounds evidence', async () => {
    const incidental = await Promise.all(
        ['tests/gerber-parity.test.mjs', 'tests/gerber-renderer.test.mjs'].map(
            (path) => readFile(path, 'utf8')
        )
    )
    const explicit = await readFile(
        'tests/gerber-interaction-behavior.test.mjs',
        'utf8'
    )

    assert.equal(
        GerberBehaviorEvidence.matches(
            'interaction-mask-drill-route-v1',
            incidental
        ),
        false
    )
    assert.equal(
        GerberBehaviorEvidence.matches('interaction-mask-drill-route-v1', [
            ...incidental,
            explicit
        ]),
        true
    )
})
