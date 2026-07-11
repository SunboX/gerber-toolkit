import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { GerberBenchmarkData } from '../benchmarks/GerberBenchmarkData.mjs'
import { GerberBenchmarkSuite } from '../benchmarks/GerberBenchmarkSuite.mjs'
import { GerberBenchmarkWorkloads } from '../benchmarks/GerberBenchmarkWorkloads.mjs'
import { ProjectLoader } from '../src/project.mjs'
import {
    compareBenchmarks,
    currentBenchmarkIdentity,
    runBenchmarks
} from '../scripts/run-benchmarks.mjs'

/**
 * Computes the report checksum after a controlled mutation.
 * @param {Record<string, any>} report Benchmark report.
 * @returns {Record<string, any>} Resealed report.
 */
function seal(report) {
    const { reportChecksum: ignored, ...body } = report
    void ignored
    report.reportChecksum = createHash('sha256')
        .update(JSON.stringify(body))
        .digest('hex')
    return report
}

test('current primary workloads have independent baseline-compatible seams', async () => {
    const calls = { archive: 0, build: 0, hit: 0 }
    const baselineCases = GerberBenchmarkSuite.cases({ profile: 'baseline' })
    const baselineArchive = baselineCases.find(
        (entry) => entry.id === 'archive-parse-projection'
    )
    const baselineHitTest = baselineCases.find(
        (entry) => entry.id === 'mask-drill-hit-test'
    )
    const archiveResult = await baselineArchive.run()
    const hitIndex = await baselineHitTest.prepare()
    const hitResult = await baselineHitTest.run(hitIndex)
    const workloads = GerberBenchmarkWorkloads.current({
        archiveProjection: async () => {
            calls.archive += 1
            return structuredClone(archiveResult)
        },
        createInteractionIndex: async () => {
            calls.build += 1
            return { itemCount: hitResult.itemCount, target: {} }
        },
        hitTest: () => {
            calls.hit += 1
            return calls.hit === 1
                ? Array.from({ length: hitResult.hitCount }, () => ({}))
                : []
        }
    })
    const currentCases = GerberBenchmarkSuite.cases({
        profile: 'current',
        workloads
    })
    const currentArchive = currentCases.find(
        (entry) => entry.id === 'archive-parse-projection'
    )
    const currentHitTest = currentCases.find(
        (entry) => entry.id === 'mask-drill-hit-test'
    )

    const currentArchiveResult = await currentArchive.run()
    const currentHitIndex = await currentHitTest.prepare()
    const currentHitResult = await currentHitTest.run(currentHitIndex)

    assert.deepEqual(currentArchiveResult, archiveResult)
    assert.deepEqual(currentHitResult, hitResult)
    assert.deepEqual(calls, { archive: 1, build: 1, hit: 180 })
    assert.notEqual(
        currentArchive.expectedStructuralChecksum,
        baselineArchive.expectedStructuralChecksum
    )
    assert.notEqual(
        currentHitTest.expectedStructuralChecksum,
        baselineHitTest.expectedStructuralChecksum
    )
})

test('worker clone prepares a public default result outside the cloned run', async () => {
    const publicResult = {
        documents: [{ sourceFormat: 'gerber', kind: 'pcb' }],
        diagnostics: []
    }
    let preparations = 0
    const workloads = GerberBenchmarkWorkloads.current({
        defaultResult: async () => {
            preparations += 1
            return publicResult
        }
    })
    const cloneCase = GerberBenchmarkSuite.cases({
        profile: 'current',
        workloads
    }).find((entry) => entry.id === 'worker-clone-default')

    const prepared = await cloneCase.prepare()
    const cloned = await cloneCase.run(prepared)

    assert.equal(preparations, 1)
    assert.strictEqual(prepared, publicResult)
    assert.deepEqual(cloned, publicResult)
    assert.notStrictEqual(cloned, publicResult)

    const currentClone = GerberBenchmarkSuite.cases({
        profile: 'current'
    }).find((entry) => entry.id === 'worker-clone-default')
    const expected = ProjectLoader.load(
        GerberBenchmarkData.archiveEntries().map((entry) => ({
            name: entry.name,
            data: entry.bytes
        })),
        { worker: false }
    )
    const actual = await currentClone.prepare()
    assert.deepEqual(actual, expected)
    assert.equal(
        createHash('sha256')
            .update(JSON.stringify(await currentClone.run(actual)))
            .digest('hex'),
        currentClone.expectedStructuralChecksum
    )
})

test('current benchmark identity derives from package and checkout code', async () => {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'))
    const baseline = JSON.parse(
        await readFile('benchmarks/baseline-v0.1.21.json', 'utf8')
    )
    const identity = currentBenchmarkIdentity()

    assert.equal(identity.package, pkg.name)
    assert.equal(identity.packageVersion, pkg.version)
    assert.notDeepEqual(identity.provenance, baseline.provenance)
    assert.match(identity.provenance.sourceCommit, /^[a-f0-9]{40}$/u)
    assert.match(identity.provenance.sourceTree, /^[a-f0-9]{40}$/u)
})

test('comparison validates distinct baseline and current identities', async () => {
    const baseline = JSON.parse(
        await readFile('benchmarks/baseline-v0.1.21.json', 'utf8')
    )
    const current = await runBenchmarks({ warmups: 1, samples: 1 })
    const comparison = compareBenchmarks(current, baseline)

    assert.equal(comparison.baselineIdentityPassed, true)
    assert.equal(comparison.currentIdentityPassed, true)
    assert.equal(
        comparison.cases.every((row) => row.absoluteTimePassed === true),
        true
    )

    const slowCurrent = structuredClone(current)
    slowCurrent.cases[0].samples = [1000]
    slowCurrent.cases[0].medianMilliseconds = 1000
    seal(slowCurrent)
    const slowComparison = compareBenchmarks(slowCurrent, baseline)
    assert.equal(slowComparison.passed, false)
    assert.equal(slowComparison.cases[0].absoluteTimePassed, false)

    const wrongCurrent = structuredClone(current)
    wrongCurrent.provenance.sourceTree = '0'.repeat(40)
    seal(wrongCurrent)
    assert.equal(
        compareBenchmarks(wrongCurrent, baseline).currentIdentityPassed,
        false
    )

    const wrongBaseline = structuredClone(baseline)
    wrongBaseline.packageVersion = '999.0.0'
    seal(wrongBaseline)
    assert.equal(
        compareBenchmarks(current, wrongBaseline).baselineIdentityPassed,
        false
    )
})
