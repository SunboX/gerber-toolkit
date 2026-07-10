import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { GerberBenchmarkData } from '../benchmarks/GerberBenchmarkData.mjs'
import { GerberBenchmarkSuite } from '../benchmarks/GerberBenchmarkSuite.mjs'
import { GerberLegacyProjectionBenchmarkAdapter } from '../benchmarks/GerberLegacyProjectionBenchmarkAdapter.mjs'
import { captureApiBaseline } from '../scripts/capture-api-baseline.mjs'

const EXPECTED_ENTRYPOINTS = ['.', './parser', './renderers', './scene3d']
const EXPECTED_ROOT_EXPORTS = [
    'GerberCoordinateParser',
    'GerberLayerRoleResolver',
    'GerberParser',
    'GerberPcbSvgRenderer',
    'GerberProjectLoader',
    'PcbInteractionIndex',
    'PcbInteractionLayerModel',
    'PcbScene3dBuilder',
    'PcbScene3dModelRegistry',
    'PcbScene3dScenePreparator'
]
const EXPECTED_BENCHMARK_CASES = [
    { id: 'archive-parse-projection', primary: true, size: 'large' },
    { id: 'mask-drill-hit-test', primary: true, size: 'large' },
    { id: 'step-repeat-large', primary: false, size: 'large' },
    { id: 'separated-render-large', primary: false, size: 'large' },
    { id: 'worker-clone-default', primary: false, size: 'large' },
    { id: 'parse-small', primary: false, size: 'small' },
    { id: 'render-small', primary: false, size: 'small' }
]
const EXPECTED_PROVENANCE = {
    sourceCommit: '11ba9df32ce966d6626f99f444909ff6c50d2281',
    sourceTree: '1b7813598247b9ec3907a9589aefe084e4a448bd'
}

/**
 * Reads one repository JSON artifact.
 * @param {string} path Repository-relative path.
 * @returns {Promise<any>} Parsed JSON value.
 */
async function readJson(path) {
    return JSON.parse(await readFile(path, 'utf8'))
}

test('Gerber synthetic benchmark catalog is deterministic and semantics-bearing', () => {
    assert.deepEqual(
        GerberBenchmarkData.fixtureDescriptor(),
        GerberBenchmarkData.fixtureDescriptor()
    )
    assert.deepEqual(
        GerberBenchmarkSuite.cases().map(({ id, primary, size }) => ({
            id,
            primary,
            size
        })),
        EXPECTED_BENCHMARK_CASES
    )

    const model = GerberLegacyProjectionBenchmarkAdapter.project({
        documents: [GerberBenchmarkData.smallDocument()]
    })
    assert.equal(
        model.some((row) => row.type === 'pcb_board'),
        true
    )
    assert.equal(
        model.some((row) => row.type === 'pcb_trace'),
        true
    )
    assert.equal(
        model.some((row) => row.type === 'pcb_hole'),
        true
    )
    assert.equal(
        model.some((row) => row.type === 'source_component'),
        false
    )
    assert.equal(
        GerberLegacyProjectionBenchmarkAdapter.structuralChecksum(model),
        GerberLegacyProjectionBenchmarkAdapter.structuralChecksum(model)
    )
})

test('Gerber API capture accepts its canonical formatted artifacts unchanged', async () => {
    await assert.doesNotReject(() => captureApiBaseline())
})

test('Gerber convergence baselines cover every public export and primary case', async () => {
    const api = await readJson('spec/api-baseline-v0.1.21.json')
    const ledger = await readJson('spec/feature-preservation.json')
    const benchmark = await readJson('benchmarks/baseline-v0.1.21.json')

    assert.equal(api.package, 'gerber-toolkit')
    assert.equal(api.packageVersion, '0.1.21')
    assert.deepEqual(api.provenance, EXPECTED_PROVENANCE)
    assert.deepEqual(
        api.entrypoints.map((entry) => entry.entrypoint),
        EXPECTED_ENTRYPOINTS
    )
    assert.deepEqual(api.exports, EXPECTED_ROOT_EXPORTS)
    assert.equal(ledger.length, api.features.length)
    assert.deepEqual(
        benchmark.cases.filter((row) => row.primary).map((row) => row.id),
        ['archive-parse-projection', 'mask-drill-hit-test']
    )
})

test('Gerber API baseline records complete callable, option, field, and behavior evidence', async () => {
    const api = await readJson('spec/api-baseline-v0.1.21.json')
    const kinds = new Set(api.features.map((feature) => feature.kind))

    for (const kind of ['export', 'method', 'option', 'field', 'behavior']) {
        assert.equal(kinds.has(kind), true, `Missing API feature kind: ${kind}`)
    }
    assert.equal(
        api.features.some(
            (feature) =>
                feature.exportName === 'GerberCoordinateParser' &&
                feature.methodName === 'parseX'
        ),
        true
    )
    assert.equal(
        api.features.some(
            (feature) =>
                feature.exportName === 'PcbScene3dModelRegistry' &&
                feature.methodName === 'resolveComponentModel'
        ),
        true
    )
    assert.equal(
        api.features.every(
            (feature) =>
                typeof feature.evidenceToken === 'string' &&
                feature.evidenceToken.length > 0 &&
                Array.isArray(feature.tests) &&
                feature.tests.length > 0 &&
                Array.isArray(feature.documentation) &&
                feature.documentation.length > 0
        ),
        true
    )
})

test('Gerber feature ledger freezes every preservation decision and availability map', async () => {
    const ledger = await readJson('spec/feature-preservation.json')
    const requiredKeys = [
        'package',
        'feature',
        'kind',
        'capabilityId',
        'disposition',
        'replacement',
        'availability',
        'reason',
        'tests',
        'documentation'
    ]

    assert.equal(
        ledger.every((row) =>
            requiredKeys.every((key) => Object.hasOwn(row, key))
        ),
        true
    )
    assert.equal(
        ledger.some((row) => row.disposition === 'native-extension'),
        true
    )
    assert.equal(
        ledger.some((row) => row.disposition === 'shared'),
        true
    )
    assert.equal(
        ledger.every(
            (row) =>
                Object.keys(row.availability).sort().join(',') ===
                [
                    'altium-toolkit',
                    'circuitjson-toolkit',
                    'gerber-toolkit',
                    'kicad-toolkit'
                ].join(',')
        ),
        true
    )
})

test('Gerber benchmark baseline freezes primary semantics and measurement structure', async () => {
    const benchmark = await readJson('benchmarks/baseline-v0.1.21.json')
    const { reportChecksum, ...reportBody } = benchmark

    assert.equal(
        reportChecksum,
        createHash('sha256').update(JSON.stringify(reportBody)).digest('hex')
    )
    assert.deepEqual(benchmark.provenance, EXPECTED_PROVENANCE)
    assert.deepEqual(
        benchmark.cases.map(({ id, primary, size }) => ({ id, primary, size })),
        EXPECTED_BENCHMARK_CASES
    )
    assert.match(benchmark.fixtureChecksum, /^[a-f0-9]{64}$/u)
    assert.match(benchmark.environment.node, /^v20\./u)
    assert.equal(typeof benchmark.environment.cpu, 'string')

    for (const row of benchmark.cases) {
        assert.equal(Number.isInteger(row.warmups) && row.warmups > 0, true)
        assert.equal(
            Array.isArray(row.samples) &&
                row.samples.length > 0 &&
                row.samples.every(
                    (sample) => Number.isFinite(sample) && sample >= 0
                ),
            true
        )
        assert.equal(
            Number.isFinite(row.medianMilliseconds) &&
                row.medianMilliseconds >= 0,
            true
        )
        assert.equal(
            Number.isInteger(row.resultBytes) && row.resultBytes > 0,
            true
        )
        assert.equal(
            Number.isInteger(row.cloneBytes) && row.cloneBytes > 0,
            true
        )
        assert.equal(row.retainedHeap.gcControlled, true)
        assert.equal(
            Number.isInteger(row.retainedHeap.retainedBytes) &&
                row.retainedHeap.retainedBytes >= 0,
            true
        )
    }

    const projection = benchmark.cases.find(
        (row) => row.id === 'archive-parse-projection'
    )
    assert.equal(projection.workload, 'legacy-generic-projection')
    assert.match(projection.structuralChecksum, /^[a-f0-9]{64}$/u)
})
