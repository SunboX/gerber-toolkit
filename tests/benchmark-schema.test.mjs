import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { GerberBenchmarkSuite } from '../benchmarks/GerberBenchmarkSuite.mjs'
import {
    compareBenchmarks,
    currentBenchmarkIdentity
} from '../scripts/run-benchmarks.mjs'

/**
 * Reseals one mutated benchmark report.
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

/**
 * Produces a timing-valid current report from the frozen baseline.
 * @param {Record<string, any>} baseline Frozen report.
 * @returns {Record<string, any>} Passing candidate.
 */
function passingCandidate(baseline) {
    const current = structuredClone(baseline)
    const identity = currentBenchmarkIdentity()
    const contract = GerberBenchmarkSuite.contract({ profile: 'current' })
    current.schema = identity.schema
    current.package = identity.package
    current.packageVersion = identity.packageVersion
    current.provenance = identity.provenance
    current.fixtureChecksum = GerberBenchmarkSuite.fixtureChecksum({
        profile: 'current'
    })
    for (const row of current.cases) {
        const expected = contract.find((entry) => entry.id === row.id)
        if (expected) {
            row.primary = expected.primary
            row.size = expected.size
            row.workload = expected.workload
            row.fixtureChecksum = expected.fixtureChecksum
            row.structuralChecksum = expected.structuralChecksum
        }
        const value = row.primary
            ? Math.max(0.001, row.medianMilliseconds * 0.7)
            : row.medianMilliseconds
        row.samples = row.samples.map(() => value)
        row.medianMilliseconds = value
    }
    return seal(current)
}

test('Gerber benchmark comparison rejects resealed unknown schema fields', async () => {
    const baseline = JSON.parse(
        await readFile('benchmarks/baseline-v0.1.21.json', 'utf8')
    )
    const mutations = [
        (report) => {
            report.unexpectedTopLevel = true
        },
        (report) => {
            report.cases[0].unexpectedCaseField = true
        },
        (report) => {
            report.cases[0].retainedHeap.unexpectedHeapField = true
        },
        (report) => {
            report.environment.unexpectedEnvironmentField = true
        },
        (report) => {
            report.provenance.unexpectedProvenanceField = true
        }
    ]

    assert.equal(
        compareBenchmarks(passingCandidate(baseline), baseline).passed,
        true
    )

    for (const mutate of mutations) {
        const report = passingCandidate(baseline)
        mutate(report)
        seal(report)
        assert.equal(compareBenchmarks(report, baseline).passed, false)

        const divergentBaseline = structuredClone(baseline)
        mutate(divergentBaseline)
        seal(divergentBaseline)
        assert.equal(
            compareBenchmarks(passingCandidate(baseline), divergentBaseline)
                .passed,
            false
        )
    }
})

test('Gerber benchmark comparison anchors canonical identity and catalog', async () => {
    const baseline = JSON.parse(
        await readFile('benchmarks/baseline-v0.1.21.json', 'utf8')
    )
    const mutations = [
        (report) => {
            report.schema = 'attacker.benchmark.v1'
        },
        (report) => {
            report.package = 'attacker-package'
        },
        (report) => {
            report.packageVersion = '999.0.0'
        },
        (report) => {
            report.provenance.sourceCommit = '0'.repeat(40)
        },
        (report) => {
            report.environment.cpu = 'different canonical runner'
        },
        (report) => {
            report.cases[0].id = 'replacement-case'
        },
        (report) => {
            report.cases.pop()
        },
        (report) => {
            report.cases.reverse()
        }
    ]

    for (const mutate of mutations) {
        const changedBaseline = structuredClone(baseline)
        mutate(changedBaseline)
        seal(changedBaseline)
        const current = passingCandidate(changedBaseline)
        assert.equal(compareBenchmarks(current, changedBaseline).passed, false)
    }
})

test('Gerber benchmark comparison independently anchors every case contract', async () => {
    const baseline = JSON.parse(
        await readFile('benchmarks/baseline-v0.1.21.json', 'utf8')
    )
    const mutations = [
        (row) => {
            row.primary = !row.primary
        },
        (row) => {
            row.size = row.size === 'small' ? 'large' : 'small'
        },
        (row) => {
            row.workload = 'attacker-workload'
        },
        (row) => {
            row.fixtureChecksum = '0'.repeat(64)
        },
        (row) => {
            row.structuralChecksum = 'f'.repeat(64)
        }
    ]

    for (const mutate of mutations) {
        const changedBaseline = structuredClone(baseline)
        mutate(changedBaseline.cases[0])
        seal(changedBaseline)
        const current = passingCandidate(changedBaseline)
        assert.equal(compareBenchmarks(current, changedBaseline).passed, false)
    }
})

test('Gerber benchmark comparison anchors baseline methodology and measurements', async () => {
    const baseline = JSON.parse(
        await readFile('benchmarks/baseline-v0.1.21.json', 'utf8')
    )
    const mutations = [
        (report) => {
            report.cases[0].warmups = 1
        },
        (report) => {
            report.cases[0].samples = [report.cases[0].medianMilliseconds]
        },
        (report) => {
            report.cases[0].resultBytes *= 100
        },
        (report) => {
            report.cases[0].cloneBytes *= 100
        },
        (report) => {
            report.cases[0].retainedHeap.gcControlled = false
        },
        (report) => {
            report.cases[0].samples = report.cases[0].samples.map(
                (sample) => sample * 100
            )
            report.cases[0].medianMilliseconds *= 100
        }
    ]

    for (const mutate of mutations) {
        const changedBaseline = structuredClone(baseline)
        mutate(changedBaseline)
        seal(changedBaseline)
        const current = passingCandidate(changedBaseline)
        assert.equal(compareBenchmarks(current, changedBaseline).passed, false)
    }
})
