import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { promisify } from 'node:util'

import { GerberBenchmarkData } from '../benchmarks/GerberBenchmarkData.mjs'
import { GerberBenchmarkSuite } from '../benchmarks/GerberBenchmarkSuite.mjs'
import { GerberLegacyProjectionBenchmarkAdapter } from '../benchmarks/GerberLegacyProjectionBenchmarkAdapter.mjs'
import { captureApiBaseline } from '../scripts/capture-api-baseline.mjs'
import { compareBenchmarks } from '../scripts/run-benchmarks.mjs'

const execFileAsync = promisify(execFile)

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
const EXPECTED_PROJECTION_CHECKSUM =
    '51d74710d2699af3982f923c94c91a34146d9eca3f9cb08543987f71c616290a'

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

test('Gerber benchmark comparison rejects missing and structurally divergent workloads', async () => {
    const baseline = await readJson('benchmarks/baseline-v0.1.21.json')
    const missing = compareBenchmarks({ ...baseline, cases: [] }, baseline)

    assert.equal(missing.passed, false)
    assert.deepEqual(
        missing.cases
            .filter((row) => row.reason === 'missing-current')
            .map((row) => row.id),
        EXPECTED_BENCHMARK_CASES.map((row) => row.id)
    )
    assert.equal(compareBenchmarks({ cases: [] }, { cases: [] }).passed, false)

    const divergent = structuredClone(baseline)
    divergent.cases = divergent.cases.map((row) => ({
        ...row,
        medianMilliseconds: 0,
        resultBytes: 1,
        cloneBytes: 1,
        structuralChecksum: '0'.repeat(64)
    }))
    const comparison = compareBenchmarks(divergent, baseline)

    assert.equal(comparison.passed, false)
    assert.equal(
        comparison.cases.every((row) => row.structuralChecksumPassed === false),
        true
    )
})

test('Gerber benchmark rows freeze every case input and exact projection output', async () => {
    const benchmark = await readJson('benchmarks/baseline-v0.1.21.json')
    const cases = GerberBenchmarkSuite.cases()

    assert.deepEqual(
        benchmark.cases.map((row) => row.fixtureChecksum),
        cases.map((row) => row.fixtureChecksum)
    )
    assert.equal(
        benchmark.cases.every((row) =>
            /^[a-f0-9]{64}$/u.test(row.fixtureChecksum)
        ),
        true
    )
    const projection = benchmark.cases.find(
        (row) => row.id === 'archive-parse-projection'
    )
    assert.equal(projection.structuralChecksum, EXPECTED_PROJECTION_CHECKSUM)
    assert.equal(
        GerberLegacyProjectionBenchmarkAdapter.structuralChecksum(
            await cases
                .find((row) => row.id === 'archive-parse-projection')
                .run()
        ),
        EXPECTED_PROJECTION_CHECKSUM
    )
})

test('Gerber API capture reproduces the historical source independently of the live package', async () => {
    const { baseline } = await captureApiBaseline({ write: false })

    assert.equal(baseline.packageVersion, '0.1.21')
    assert.equal(
        baseline.provenance.sourceCommit,
        EXPECTED_PROVENANCE.sourceCommit
    )
    assert.equal(
        baseline.provenance.evidenceCommit,
        baseline.provenance.harnessCommit
    )
    assert.match(baseline.provenance.harnessCommit, /^[a-f0-9]{40}$/u)
    assert.match(baseline.provenance.harnessTree, /^[a-f0-9]{40}$/u)
})

test('Gerber convergence baselines cover every public export and primary case', async () => {
    const api = await readJson('spec/api-baseline-v0.1.21.json')
    const ledger = await readJson('spec/feature-preservation.json')
    const benchmark = await readJson('benchmarks/baseline-v0.1.21.json')

    assert.equal(api.package, 'gerber-toolkit')
    assert.equal(api.packageVersion, '0.1.21')
    assert.equal(api.provenance.sourceCommit, EXPECTED_PROVENANCE.sourceCommit)
    assert.equal(api.provenance.sourceTree, EXPECTED_PROVENANCE.sourceTree)
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
    for (const feature of [
        '.#GerberParser.parseArrayBuffer().argument.options.property.renderMode',
        '.#GerberParser.parseArrayBuffer().result.pcb.fabrication.renderMode',
        '.#PcbScene3dScenePreparator.prepare().argument.options.property.boardThicknessMil',
        '.#PcbScene3dScenePreparator.prepare().result.board'
    ]) {
        assert.equal(
            api.features.some((row) => row.feature === feature),
            true,
            `Missing delegated or nested contract: ${feature}`
        )
    }
    assert.equal(
        api.features.every(
            (feature) =>
                !feature.tests.includes(
                    'tests/convergence-baselines.test.mjs'
                ) &&
                !feature.tests.includes(
                    'tests/feature-preservation-check.test.mjs'
                )
        ),
        true
    )
})

test('Gerber baseline provenance separates source, evidence, and harness trees', async () => {
    const api = await readJson('spec/api-baseline-v0.1.21.json')
    const benchmark = await readJson('benchmarks/baseline-v0.1.21.json')

    for (const artifact of [api, benchmark]) {
        assert.equal(
            artifact.provenance.sourceCommit,
            EXPECTED_PROVENANCE.sourceCommit
        )
        assert.equal(
            artifact.provenance.sourceTree,
            EXPECTED_PROVENANCE.sourceTree
        )
        assert.equal(
            artifact.provenance.evidenceCommit,
            artifact.provenance.harnessCommit
        )
        assert.equal(
            artifact.provenance.evidenceTree,
            artifact.provenance.harnessTree
        )
        assert.match(artifact.provenance.harnessCommit, /^[a-f0-9]{40}$/u)
        assert.match(artifact.provenance.harnessTree, /^[a-f0-9]{40}$/u)
        const { stdout } = await execFileAsync('git', [
            'rev-parse',
            `${artifact.provenance.harnessCommit}^{tree}`
        ])
        assert.equal(stdout.trim(), artifact.provenance.harnessTree)
    }
})

test('Gerber development baselines stay outside the published package', async () => {
    const { stdout } = await execFileAsync('npm', [
        'pack',
        '--dry-run',
        '--json'
    ])
    const packed = JSON.parse(stdout)[0]
    const paths = packed.files.map((entry) => entry.path)

    assert.equal(paths.includes('spec/api-baseline-v0.1.21.json'), false)
    assert.equal(paths.includes('spec/feature-preservation.json'), false)
    assert.equal(
        paths.some((path) => path.startsWith('benchmarks/')),
        false
    )
    assert.equal(
        paths.some((path) => path.startsWith('scripts/')),
        false
    )
    assert.equal(
        paths.some((path) => path.startsWith('tests/')),
        false
    )
    assert.equal(packed.unpackedSize < 500_000, true)
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
        'sourceContract',
        'evidenceToken',
        'evidenceTokens',
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
    assert.equal(
        benchmark.provenance.sourceCommit,
        EXPECTED_PROVENANCE.sourceCommit
    )
    assert.equal(
        benchmark.provenance.sourceTree,
        EXPECTED_PROVENANCE.sourceTree
    )
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
    assert.equal(projection.structuralChecksum, EXPECTED_PROJECTION_CHECKSUM)
})
