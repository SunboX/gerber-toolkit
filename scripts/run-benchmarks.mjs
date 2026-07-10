import { createHash } from 'node:crypto'
import { cpus } from 'node:os'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'

import { format } from 'prettier'

import { GerberBenchmarkSuite } from '../benchmarks/GerberBenchmarkSuite.mjs'

const PROVENANCE = Object.freeze({
    sourceCommit: '11ba9df32ce966d6626f99f444909ff6c50d2281',
    sourceTree: '1b7813598247b9ec3907a9589aefe084e4a448bd'
})

/**
 * Runs the complete Gerber performance baseline suite.
 * @param {{ warmups?: number, samples?: number }} [options] Measurement options.
 * @returns {Promise<Record<string, any>>} Benchmark report.
 */
export async function runBenchmarks(options = {}) {
    const warmups = positiveInteger(options.warmups, 2)
    const sampleCount = positiveInteger(options.samples, 5)
    const cases = []
    for (const benchmarkCase of GerberBenchmarkSuite.cases()) {
        cases.push(await measureCase(benchmarkCase, { warmups, sampleCount }))
    }
    const body = {
        schema: 'gerber-toolkit.benchmark-report.v1',
        package: 'gerber-toolkit',
        packageVersion: '0.1.21',
        provenance: { ...PROVENANCE },
        environment: environmentRecord(),
        fixtureChecksum: GerberBenchmarkSuite.fixtureChecksum(),
        cases
    }
    return { ...body, reportChecksum: checksum(body) }
}

/**
 * Compares a current report with a frozen baseline and applies release gates.
 * @param {Record<string, any>} current Current report.
 * @param {Record<string, any>} baseline Frozen baseline.
 * @returns {{ passed: boolean, cases: Record<string, any>[] }} Comparison summary.
 */
export function compareBenchmarks(current, baseline) {
    const currentRows = Array.isArray(current?.cases) ? current.cases : []
    const baselineRows = Array.isArray(baseline?.cases) ? baseline.cases : []
    const duplicateCurrentIds = duplicateIds(currentRows)
    const duplicateBaselineIds = duplicateIds(baselineRows)
    const baselineById = new Map(baselineRows.map((row) => [row.id, row]))
    const currentById = new Map(currentRows.map((row) => [row.id, row]))
    const cases = baselineRows.map((previous) => {
        const row = currentById.get(previous.id)
        if (!row) {
            return {
                id: previous.id,
                passed: false,
                reason: 'missing-current'
            }
        }
        const changePercent = percentChange(
            row.medianMilliseconds,
            previous.medianMilliseconds
        )
        const timeLimitPercent = previous.primary
            ? -20
            : previous.size === 'small'
              ? 10
              : 5
        const timePassed = changePercent <= timeLimitPercent
        const resultBytesPassed = row.resultBytes <= previous.resultBytes
        const cloneBytesPassed = row.cloneBytes <= previous.cloneBytes
        const fixtureChecksumPassed =
            row.fixtureChecksum === previous.fixtureChecksum
        const structuralChecksumPassed =
            row.structuralChecksum === previous.structuralChecksum
        const metadataPassed =
            row.primary === previous.primary &&
            row.size === previous.size &&
            row.workload === previous.workload &&
            !duplicateCurrentIds.has(row.id) &&
            !duplicateBaselineIds.has(previous.id)
        return {
            id: row.id,
            primary: previous.primary,
            size: previous.size,
            changePercent,
            timeLimitPercent,
            timePassed,
            resultBytesPassed,
            cloneBytesPassed,
            fixtureChecksumPassed,
            structuralChecksumPassed,
            metadataPassed,
            passed:
                timePassed &&
                resultBytesPassed &&
                cloneBytesPassed &&
                fixtureChecksumPassed &&
                structuralChecksumPassed &&
                metadataPassed
        }
    })
    for (const row of currentRows) {
        if (!baselineById.has(row.id)) {
            cases.push({
                id: row.id,
                passed: false,
                reason: 'unexpected-current'
            })
        }
    }
    const fixtureChecksumPassed =
        current?.fixtureChecksum === baseline?.fixtureChecksum
    const catalogPassed = currentRows.length > 0 && baselineRows.length > 0
    return {
        passed:
            catalogPassed &&
            fixtureChecksumPassed &&
            cases.every((row) => row.passed === true),
        catalogPassed,
        fixtureChecksumPassed,
        cases
    }
}

/**
 * Measures one benchmark workload.
 * @param {{ id: string, primary: boolean, size: string, workload: string, run: () => Promise<unknown> }} benchmarkCase Case definition.
 * @param {{ warmups: number, sampleCount: number }} options Measurement options.
 * @returns {Promise<Record<string, any>>} Case measurement.
 */
async function measureCase(benchmarkCase, options) {
    for (let index = 0; index < options.warmups; index += 1) {
        await benchmarkCase.run()
    }

    const samples = []
    let result
    for (let index = 0; index < options.sampleCount; index += 1) {
        const started = performance.now()
        result = await benchmarkCase.run()
        samples.push(roundMilliseconds(performance.now() - started))
    }

    const retainedHeap = await measureHeap(benchmarkCase.run)
    const serialized = JSON.stringify(result)
    const clone = structuredClone(result)
    const cloneSerialized = JSON.stringify(clone)
    return {
        id: benchmarkCase.id,
        primary: benchmarkCase.primary,
        size: benchmarkCase.size,
        workload: benchmarkCase.workload,
        fixtureChecksum: benchmarkCase.fixtureChecksum,
        warmups: options.warmups,
        samples,
        medianMilliseconds: median(samples),
        resultBytes: Buffer.byteLength(serialized, 'utf8'),
        cloneBytes: Buffer.byteLength(cloneSerialized, 'utf8'),
        retainedHeap,
        structuralChecksum: checksum(result)
    }
}

/**
 * Finds duplicate case ids without trusting map overwrite behavior.
 * @param {Record<string, any>[]} rows Benchmark case rows.
 * @returns {Set<string>} Duplicate ids.
 */
function duplicateIds(rows) {
    const seen = new Set()
    const duplicates = new Set()
    for (const row of rows) {
        const id = String(row?.id || '')
        if (seen.has(id)) duplicates.add(id)
        seen.add(id)
    }
    return duplicates
}

/**
 * Measures retained heap around one workload with explicit GC when available.
 * @param {() => Promise<unknown>} run Workload.
 * @returns {Promise<{ gcControlled: boolean, beforeBytes: number, afterBytes: number, retainedBytes: number }>} Heap measurement.
 */
async function measureHeap(run) {
    const gcControlled = typeof globalThis.gc === 'function'
    if (gcControlled) globalThis.gc()
    const beforeBytes = process.memoryUsage().heapUsed
    await run()
    if (gcControlled) globalThis.gc()
    const afterBytes = process.memoryUsage().heapUsed
    return {
        gcControlled,
        beforeBytes,
        afterBytes,
        retainedBytes: Math.max(0, afterBytes - beforeBytes)
    }
}

/**
 * Returns stable runtime environment metadata.
 * @returns {Record<string, any>} Environment record.
 */
function environmentRecord() {
    const processors = cpus()
    return {
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
        cpu: String(processors[0]?.model || 'unknown'),
        logicalCpuCount: processors.length
    }
}

/**
 * Returns a positive integer option or a fallback.
 * @param {unknown} value Option value.
 * @param {number} fallback Default value.
 * @returns {number} Positive integer.
 */
function positiveInteger(value, fallback) {
    if (value === undefined) return fallback
    const number = Number(value)
    if (!Number.isSafeInteger(number) || number <= 0) {
        throw new TypeError('Benchmark counts must be positive integers.')
    }
    return number
}

/**
 * Computes the median for a non-empty numeric sample list.
 * @param {number[]} samples Measurement samples.
 * @returns {number} Median value.
 */
function median(samples) {
    const sorted = [...samples].sort((left, right) => left - right)
    const middle = Math.floor(sorted.length / 2)
    return sorted.length % 2
        ? sorted[middle]
        : roundMilliseconds((sorted[middle - 1] + sorted[middle]) / 2)
}

/**
 * Rounds a millisecond value without hiding zero-duration samples.
 * @param {number} value Milliseconds.
 * @returns {number} Rounded milliseconds.
 */
function roundMilliseconds(value) {
    return Math.max(0, Number(value.toFixed(6)))
}

/**
 * Computes a percentage change with stable zero-baseline behavior.
 * @param {number} current Current value.
 * @param {number} baseline Baseline value.
 * @returns {number} Percentage change.
 */
function percentChange(current, baseline) {
    if (baseline === 0) return current === 0 ? 0 : Infinity
    return Number((((current - baseline) / baseline) * 100).toFixed(3))
}

/**
 * Computes one deterministic SHA-256 checksum.
 * @param {unknown} value JSON-shaped value.
 * @returns {string} Hex checksum.
 */
function checksum(value) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/**
 * Parses benchmark command-line options.
 * @param {string[]} argumentsList Command arguments.
 * @returns {Record<string, any>} Parsed options.
 */
function parseArguments(argumentsList) {
    const options = {}
    for (let index = 0; index < argumentsList.length; index += 1) {
        const argument = argumentsList[index]
        if (argument === '--record') options.record = argumentsList[++index]
        else if (argument === '--output')
            options.output = argumentsList[++index]
        else if (argument === '--compare')
            options.compare = argumentsList[++index]
        else if (argument === '--warmups')
            options.warmups = argumentsList[++index]
        else if (argument === '--samples')
            options.samples = argumentsList[++index]
        else throw new Error(`Unknown benchmark argument: ${argument}`)
    }
    return options
}

/**
 * Writes an immutable baseline or accepts byte-identical existing content.
 * @param {string} path Output path.
 * @param {unknown} value JSON value.
 * @returns {Promise<void>}
 */
async function writeImmutable(path, value) {
    const target = resolve(path)
    const content = await formatJson(value)
    try {
        const existing = await readFile(target, 'utf8')
        if (existing !== content) {
            throw new Error(`Refusing to overwrite immutable baseline: ${path}`)
        }
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error
        await writeFile(target, content)
    }
}

/**
 * Formats generated JSON with the repository's canonical indentation.
 * @param {unknown} value JSON-shaped value.
 * @returns {Promise<string>} Canonical JSON text.
 */
async function formatJson(value) {
    return format(JSON.stringify(value, null, 4), {
        parser: 'json',
        tabWidth: 4,
        trailingComma: 'none'
    })
}

/**
 * Returns whether this module is the active Node entry script.
 * @returns {boolean} Whether the module is running as a command.
 */
function isMain() {
    return Boolean(
        process.argv[1] &&
        pathToFileURL(process.argv[1]).href === import.meta.url
    )
}

if (isMain()) {
    try {
        const options = parseArguments(process.argv.slice(2))
        const report = await runBenchmarks(options)
        if (options.record) await writeImmutable(options.record, report)
        if (options.output) {
            await writeFile(resolve(options.output), await formatJson(report))
        }
        if (options.compare) {
            const baseline = JSON.parse(
                await readFile(resolve(options.compare), 'utf8')
            )
            const comparison = compareBenchmarks(report, baseline)
            process.stdout.write(`${JSON.stringify(comparison, null, 4)}\n`)
            if (!comparison.passed) process.exitCode = 1
        } else if (!options.record && !options.output) {
            process.stdout.write(`${JSON.stringify(report, null, 4)}\n`)
        } else {
            process.stdout.write(
                `Measured ${report.cases.length} Gerber benchmark cases.\n`
            )
        }
    } catch (error) {
        process.stderr.write(`${String(error?.message || error)}\n`)
        process.exitCode = 1
    }
}
