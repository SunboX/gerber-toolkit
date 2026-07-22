import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { promisify } from 'node:util'

import { GerberBenchmarkData } from '../benchmarks/GerberBenchmarkData.mjs'
import { GerberBenchmarkSuite } from '../benchmarks/GerberBenchmarkSuite.mjs'
import { GerberLegacyProjectionBenchmarkAdapter } from '../benchmarks/GerberLegacyProjectionBenchmarkAdapter.mjs'
import { PcbInteractionIndex } from '../src/legacy-renderers.mjs'
import { GerberApiContractInspector } from '../scripts/GerberApiContractInspector.mjs'
import { captureApiBaseline } from '../scripts/capture-api-baseline.mjs'
import {
    compareBenchmarks,
    currentBenchmarkEnvironment,
    currentBenchmarkIdentity,
    runBenchmarks
} from '../scripts/run-benchmarks.mjs'

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

/**
 * Computes the JSON checksum used by benchmark reports.
 * @param {unknown} value JSON-shaped value.
 * @returns {string} SHA-256 checksum.
 */
function jsonChecksum(value) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/**
 * Recomputes one benchmark report checksum after a test mutation.
 * @param {Record<string, any>} report Benchmark report.
 * @returns {Record<string, any>} Mutated report.
 */
function sealBenchmarkReport(report) {
    const { reportChecksum: ignored, ...body } = report
    report.reportChecksum = jsonChecksum(body)
    return report
}

/**
 * Builds a semantically valid report that satisfies the timing thresholds.
 * @param {Record<string, any>} baseline Frozen benchmark report.
 * @returns {Record<string, any>} Passing comparison candidate.
 */
function passingBenchmarkCandidate(baseline) {
    const current = structuredClone(baseline)
    const identity = currentBenchmarkIdentity()
    const contract = GerberBenchmarkSuite.contract({ profile: 'current' })
    current.schema = identity.schema
    current.package = identity.package
    current.packageVersion = identity.packageVersion
    current.provenance = identity.provenance
    current.environment = currentBenchmarkEnvironment()
    current.fixtureChecksum = GerberBenchmarkSuite.fixtureChecksum({
        profile: 'current'
    })
    for (const row of current.cases) {
        const expected = contract.find((entry) => entry.id === row.id)
        row.primary = expected.primary
        row.size = expected.size
        row.workload = expected.workload
        row.fixtureChecksum = expected.fixtureChecksum
        row.structuralChecksum = expected.structuralChecksum
        const factor = row.primary ? 0.75 : 1
        const sample = Number((row.medianMilliseconds * factor).toFixed(6))
        row.samples = row.samples.map(() => sample)
        row.medianMilliseconds = sample
    }
    return sealBenchmarkReport(current)
}

/**
 * Captures from a disposable worktree after poisoning live harness/evidence.
 * @param {Record<string, any>} canonicalApi Canonical API baseline.
 * @returns {Promise<Record<string, any>>} Disposable capture result.
 */
async function captureWithLiveWorktreePoison(canonicalApi) {
    const temporaryRoot = await mkdtemp(
        join(tmpdir(), 'gerber-baseline-live-poison-')
    )
    const worktree = join(temporaryRoot, 'worktree')
    try {
        await execFileAsync('git', [
            'worktree',
            'add',
            '--detach',
            worktree,
            'HEAD'
        ])
        await writeFile(
            join(worktree, 'scripts/GerberTask1Provenance.mjs'),
            await readFile(
                join(process.cwd(), 'scripts/GerberTask1Provenance.mjs'),
                'utf8'
            )
        )
        await symlink(
            join(process.cwd(), 'node_modules'),
            join(worktree, 'node_modules'),
            'dir'
        )

        const inspectorPath = join(
            worktree,
            'scripts/GerberApiContractInspector.mjs'
        )
        const inspectorSource = await readFile(inspectorPath, 'utf8')
        await writeFile(
            inspectorPath,
            `${inspectorSource}\nconst liveInspect = GerberApiContractInspector.inspect\nGerberApiContractInspector.inspect = (...args) => {\n    const result = liveInspect(...args)\n    return { ...result, features: result.features.slice(0, -1) }\n}\n`
        )

        const evidenceTokens = [
            ...new Set(
                canonicalApi.features.flatMap(
                    (feature) => feature.evidenceTokens || []
                )
            )
        ]
        await writeFile(
            join(worktree, 'tests/live-only-evidence.test.mjs'),
            `// ${evidenceTokens.join(' ')}\n`
        )

        const captureUrl = pathToFileURL(
            join(worktree, 'scripts/capture-api-baseline.mjs')
        ).href
        const evaluation = [
            `import { captureApiBaseline } from ${JSON.stringify(captureUrl)}`,
            'const result = await captureApiBaseline({ write: false })',
            'process.stdout.write(JSON.stringify(result))'
        ].join(';')
        const { stdout } = await execFileAsync(
            process.execPath,
            ['--input-type=module', '--eval', evaluation],
            { cwd: worktree, maxBuffer: 20 * 1024 * 1024 }
        )
        return JSON.parse(stdout)
    } finally {
        await execFileAsync(
            'git',
            ['worktree', 'remove', '--force', worktree],
            { cwd: process.cwd() }
        ).catch(() => {})
        await rm(temporaryRoot, { recursive: true, force: true })
    }
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

test('Gerber benchmark comparison gates exact metadata, configuration, samples, and checksums', async () => {
    const baseline = await readJson('benchmarks/baseline-v0.1.21.json')
    const current = passingBenchmarkCandidate(baseline)

    assert.equal(compareBenchmarks(current, baseline).passed, true)

    const mutations = [
        {
            label: 'schema',
            mutate: (report) => {
                report.schema = 'wrong.schema'
            }
        },
        {
            label: 'package',
            mutate: (report) => {
                report.package = 'wrong-package'
            }
        },
        {
            label: 'package version',
            mutate: (report) => {
                report.packageVersion = '999.0.0'
            }
        },
        {
            label: 'provenance',
            mutate: (report) => {
                report.provenance.harnessTree = '0'.repeat(40)
            }
        },
        {
            label: 'environment',
            mutate: (report) => {
                report.environment.cpu = 'different benchmark runner'
            }
        },
        {
            label: 'warmup configuration',
            mutate: (report) => {
                report.cases[0].warmups += 1
            }
        },
        {
            label: 'sample configuration',
            mutate: (report) => {
                report.cases[0].samples.pop()
            }
        },
        {
            label: 'sample median consistency',
            mutate: (report) => {
                report.cases[0].medianMilliseconds = 0
            }
        }
    ]

    for (const { label, mutate } of mutations) {
        const divergent = structuredClone(current)
        mutate(divergent)
        sealBenchmarkReport(divergent)
        assert.equal(
            compareBenchmarks(divergent, baseline).passed,
            false,
            `Accepted divergent benchmark ${label}`
        )
    }

    const invalidCurrentChecksum = structuredClone(current)
    invalidCurrentChecksum.reportChecksum = '0'.repeat(64)
    assert.equal(
        compareBenchmarks(invalidCurrentChecksum, baseline).passed,
        false
    )

    const invalidBaselineChecksum = structuredClone(baseline)
    invalidBaselineChecksum.reportChecksum = '0'.repeat(64)
    assert.equal(
        compareBenchmarks(current, invalidBaselineChecksum).passed,
        false
    )
})

test('Gerber benchmark comparison rejects resealed invalid measurement records', async () => {
    const baseline = await readJson('benchmarks/baseline-v0.1.21.json')
    const current = passingBenchmarkCandidate(baseline)
    const mutations = [
        {
            label: 'zero result bytes',
            mutate: (report) => {
                report.cases[0].resultBytes = 0
            }
        },
        {
            label: 'fractional clone bytes',
            mutate: (report) => {
                report.cases[0].cloneBytes = 1.5
            }
        },
        {
            label: 'incomplete retained heap',
            mutate: (report) => {
                delete report.cases[0].retainedHeap.afterBytes
            }
        },
        {
            label: 'negative retained heap observation',
            mutate: (report) => {
                report.cases[0].retainedHeap.beforeBytes = -1
            }
        },
        {
            label: 'inconsistent retained heap total',
            mutate: (report) => {
                report.cases[0].retainedHeap.retainedBytes += 1
            }
        }
    ]

    for (const { label, mutate } of mutations) {
        const divergent = structuredClone(current)
        mutate(divergent)
        sealBenchmarkReport(divergent)
        assert.equal(
            compareBenchmarks(divergent, baseline).passed,
            false,
            `Accepted invalid benchmark measurement: ${label}`
        )
    }

    const invalidBaseline = structuredClone(baseline)
    invalidBaseline.cases[0].retainedHeap.afterBytes =
        Number.MAX_SAFE_INTEGER + 1
    sealBenchmarkReport(invalidBaseline)
    assert.equal(compareBenchmarks(current, invalidBaseline).passed, false)
})

test('Gerber benchmark reports distinguish current and frozen provenance', async () => {
    const baseline = await readJson('benchmarks/baseline-v0.1.21.json')
    const measured = await runBenchmarks({ warmups: 1, samples: 1 })
    const identity = currentBenchmarkIdentity()

    assert.deepEqual(measured.provenance, identity.provenance)
    assert.notDeepEqual(measured.provenance, baseline.provenance)
    assert.equal(measured.packageVersion, identity.packageVersion)
    assert.equal(baseline.packageVersion, '0.1.21')
})

test('Gerber hit-test benchmark freezes every query point and tolerance', () => {
    const queries = GerberBenchmarkData.interactionQueries()
    const items = PcbInteractionIndex.build(
        GerberBenchmarkData.interactionDocument()
    )
    const benchmarkCase = GerberBenchmarkSuite.cases().find(
        (entry) => entry.id === 'mask-drill-hit-test'
    )

    assert.equal(queries.length, 180)
    assert.equal(
        queries.every(
            (query) =>
                Number.isFinite(query.point.x) &&
                Number.isFinite(query.point.y) &&
                query.options.tolerance === 0.05
        ),
        true
    )
    assert.equal(
        benchmarkCase.fixtureChecksum,
        jsonChecksum({ items, queries })
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

test('Gerber API capture loads evidence and its inspector-policy harness from pinned commits', async () => {
    const canonicalApi = await readJson('spec/api-baseline-v0.1.21.json')
    const poisoned = await captureWithLiveWorktreePoison(canonicalApi)

    assert.deepEqual(
        {
            artifactChecksumMatches:
                poisoned.baseline.artifactChecksum ===
                canonicalApi.artifactChecksum,
            liveEvidenceRows: poisoned.ledger.filter((row) =>
                row.tests.includes('tests/live-only-evidence.test.mjs')
            ).length
        },
        { artifactChecksumMatches: true, liveEvidenceRows: 0 }
    )
})

test('Gerber API inspector keeps callable identities entrypoint-qualified', async () => {
    class RootParser {
        static parse(input) {
            return input
        }
    }
    class SubpathParser {
        static parse(input, options = {}) {
            return { input, options }
        }
    }
    const contracts = await GerberApiContractInspector.inspect([
        {
            entrypoint: '.',
            target: './root.mjs',
            api: { GerberParser: RootParser }
        },
        {
            entrypoint: './parser',
            target: './parser.mjs',
            api: { GerberParser: SubpathParser }
        }
    ])

    assert.equal(
        contracts.features.find(
            (feature) => feature.feature === '.#GerberParser.parse()'
        ).sourceContract.signature,
        '(input)'
    )
    assert.equal(
        contracts.features.find(
            (feature) => feature.feature === './parser#GerberParser.parse()'
        ).sourceContract.signature,
        '(input, options = {})'
    )
})

test('Gerber API inspector captures public instance fields and recursive private-call results', async () => {
    class CoordinateParser {
        constructor() {
            this.xInteger = 2
            this.xDecimal = 4
        }
    }
    class SceneBuilder {
        static build() {
            const board = SceneBuilder.#buildBoard()
            return { board }
        }

        static #buildBoard() {
            return { widthMil: 100, heightMil: 50, thicknessMil: 63 }
        }
    }
    const contracts = await GerberApiContractInspector.inspect([
        {
            entrypoint: '.',
            target: './index.mjs',
            api: { CoordinateParser, SceneBuilder }
        }
    ])
    const features = new Set(
        contracts.features.map((feature) => feature.feature)
    )

    for (const feature of [
        '.#CoordinateParser.prototype.xInteger',
        '.#CoordinateParser.prototype.xDecimal',
        '.#SceneBuilder.build().result.board.widthMil',
        '.#SceneBuilder.build().result.board.heightMil',
        '.#SceneBuilder.build().result.board.thicknessMil'
    ]) {
        assert.equal(features.has(feature), true, `Missing ${feature}`)
    }
})

test('Gerber API inspector resolves instance results and array element shapes across call boundaries', async () => {
    class Bounds {
        toObject() {
            return { minX: 0, maxY: 1 }
        }
    }
    class Parser {
        static parse() {
            const layer = Parser.#layer()
            return Parser.fromLayers([layer])
        }

        static fromLayers(layers) {
            const bounds = new Bounds()
            const normalizedBounds = bounds.toObject()
            return {
                pcb: { bounds: normalizedBounds, fabrication: { layers } }
            }
        }

        static #layer() {
            return { role: 'top-copper', primitives: [] }
        }
    }
    class SceneBuilder {
        static build() {
            const board = SceneBuilder.#board()
            return { board }
        }

        static #board() {
            const board = { segments: [], cutouts: [] }
            board.segments = SceneBuilder.#segments()
            board.cutouts = SceneBuilder.#cutouts()
            return board
        }

        static #segments() {
            return [null].map(() => SceneBuilder.#line())
        }

        static #line() {
            return { y1: 1 }
        }

        static #cutouts() {
            return [null].map(() => ({ points: [] }))
        }
    }
    const contracts = await GerberApiContractInspector.inspect([
        {
            entrypoint: '.',
            target: './index.mjs',
            api: { Bounds, Parser, SceneBuilder }
        }
    ])
    const features = new Set(
        contracts.features.map((feature) => feature.feature)
    )

    for (const feature of [
        '.#Parser.parse().result.pcb.bounds.minX',
        '.#Parser.fromLayers().result.pcb.bounds.maxY',
        '.#Parser.parse().result.pcb.fabrication.layers.role',
        '.#Parser.fromLayers().result.pcb.fabrication.layers.primitives',
        '.#SceneBuilder.build().result.board.segments.y1',
        '.#SceneBuilder.build().result.board.cutouts.points'
    ]) {
        assert.equal(features.has(feature), true, `Missing ${feature}`)
    }
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
        api.features.every((feature) => {
            const usage = feature.evidence?.usage
            const sourceOnly =
                usage === null &&
                feature.sourceContract?.type === 'result-field' &&
                feature.evidenceToken === null &&
                feature.evidenceTokens?.length === 0 &&
                feature.tests?.length === 0
            const used =
                usage &&
                typeof feature.evidenceToken === 'string' &&
                feature.evidenceTokens?.length > 0 &&
                feature.tests?.length > 0
            return (
                feature.evidence?.source?.kind === 'source-contract' &&
                Boolean(sourceOnly || used) &&
                feature.documentation?.length > 0
            )
        }),
        true
    )
    assert.equal(
        api.features
            .filter((feature) => feature.kind === 'behavior')
            .every(
                (feature) =>
                    feature.evidence.usage.kind === 'behavior-matcher' &&
                    feature.evidence.usage.contract.requirements.length > 0
            ),
        true
    )
    for (const feature of [
        '.#GerberParser.parseArrayBuffer().argument.options.property.renderMode',
        '.#GerberParser.parseArrayBuffer().result.pcb.fabrication.renderMode',
        '.#PcbScene3dScenePreparator.prepare().argument.options.property.boardThicknessMil',
        '.#PcbScene3dScenePreparator.prepare().result.board',
        '.#GerberCoordinateParser.prototype.xInteger',
        '.#GerberCoordinateParser.prototype.xDecimal',
        '.#GerberCoordinateParser.prototype.yInteger',
        '.#GerberCoordinateParser.prototype.yDecimal',
        '.#GerberCoordinateParser.prototype.zeroSuppression',
        '.#GerberCoordinateParser.prototype.unit',
        './parser#GerberCoordinateParser.prototype.xInteger',
        '.#GerberParser.fromLayers().result.pcb.boardOutline.widthMil',
        './parser#GerberParser.fromLayers().result.pcb.boardOutline.widthMil',
        '.#PcbScene3dBuilder.build().result.board.widthMil',
        '.#PcbScene3dBuilder.build().result.board.heightMil',
        '.#PcbScene3dBuilder.build().result.board.thicknessMil',
        './scene3d#PcbScene3dBuilder.build().result.board.widthMil',
        '.#PcbScene3dScenePreparator.prepare().result.board.widthMil',
        '.#GerberParser.parseArrayBuffer().result.pcb.bounds.minX',
        '.#GerberParser.parseArrayBuffer().result.pcb.bounds.maxY',
        './parser#GerberParser.fromLayers().result.pcb.bounds.minX',
        '.#GerberParser.parseArrayBuffer().result.pcb.fabrication.layers.role',
        '.#GerberParser.parseArrayBuffer().result.pcb.fabrication.layers.primitives',
        '.#GerberParser.fromLayers().result.pcb.fabrication.layers.role',
        './parser#GerberParser.fromLayers().result.pcb.fabrication.layers.primitives',
        '.#PcbScene3dBuilder.build().result.board.segments.y1',
        '.#PcbScene3dBuilder.build().result.board.cutouts.points',
        '.#GerberParser.parseArrayBuffer().result.pcb.fabrication.layers.primitives.type',
        '.#GerberParser.parseArrayBuffer().result.pcb.fabrication.layers.primitives.width',
        '.#GerberParser.parseArrayBuffer().result.pcb.fabrication.layers.primitives.polarity',
        '.#GerberParser.parseArrayBuffer().result.pcb.fabrication.layers.primitives.attributes.object',
        '.#GerberParser.parseArrayBuffer().result.pcb.fabrication.layers.drills.diameter',
        './parser#GerberParser.fromLayers().result.pcb.fabrication.layers.primitives.type',
        '.#PcbScene3dBuilder.build().result.detail.tracks.layerId',
        '.#PcbScene3dBuilder.build().result.detail.tracks.y1',
        './scene3d#PcbScene3dBuilder.build().result.detail.tracks.layerId',
        ...['.', './parser'].flatMap((entrypoint) =>
            ['type', 'exposure', 'diameter', 'width'].map(
                (field) =>
                    `${entrypoint}#GerberParser.parseArrayBuffer().result.pcb.fabrication.layers.primitives.primitives.${field}`
            )
        ),
        ...['.', './parser'].flatMap((entrypoint) =>
            ['minX', 'minY', 'maxX', 'maxY'].map(
                (field) =>
                    `${entrypoint}#GerberParser.parseArrayBuffer().result.pcb.fabrication.layers.bounds.${field}`
            )
        ),
        ...['.', './renderers'].flatMap((entrypoint) =>
            [
                'id',
                'sourceFormat',
                'layerId',
                'role',
                'kind',
                'bounds.minX',
                'bounds.minY',
                'bounds.maxX',
                'bounds.maxY'
            ].map(
                (field) =>
                    `${entrypoint}#PcbInteractionIndex.build().result.${field}`
            )
        ),
        ...['.', './scene3d'].flatMap((entrypoint) =>
            [
                'x',
                'y',
                'diameter',
                'holeDiameter',
                'isPlated',
                'barrelOnly'
            ].map(
                (field) =>
                    `${entrypoint}#PcbScene3dBuilder.build().result.detail.vias.${field}`
            )
        ),
        ...['.', './scene3d'].flatMap((entrypoint) => [
            `${entrypoint}#PcbScene3dBuilder.build().result.detail.polygons.holes.x`,
            `${entrypoint}#PcbScene3dBuilder.build().result.detail.polygons.holes.y`,
            `${entrypoint}#PcbScene3dBuilder.build().result.detail.tracks.solderMaskOpening`
        ])
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
                ) &&
                !feature.tests.includes(
                    'tests/api-result-contract-resolver.test.mjs'
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
    assert.equal(packed.unpackedSize < 714_000, true)
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
        'evidence',
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
