import { createHash } from 'node:crypto'
import { cpus } from 'node:os'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import { isDeepStrictEqual } from 'node:util'

import { format } from 'prettier'

import { GerberBenchmarkIdentity } from '../benchmarks/GerberBenchmarkIdentity.mjs'
import { GerberBenchmarkSuite } from '../benchmarks/GerberBenchmarkSuite.mjs'
import { GERBER_TASK1_PROVENANCE } from './GerberTask1Provenance.mjs'

const REPORT_KEYS = [
    'cases',
    'environment',
    'fixtureChecksum',
    'package',
    'packageVersion',
    'provenance',
    'reportChecksum',
    'schema'
]
const PROVENANCE_KEYS = [
    'evidenceCommit',
    'evidenceTree',
    'harnessCommit',
    'harnessTree',
    'sourceCommit',
    'sourceTree'
]
const ENVIRONMENT_KEYS = [
    'architecture',
    'cpu',
    'logicalCpuCount',
    'node',
    'platform'
]
const CASE_KEYS = [
    'cloneBytes',
    'fixtureChecksum',
    'id',
    'medianMilliseconds',
    'primary',
    'resultBytes',
    'retainedHeap',
    'samples',
    'size',
    'structuralChecksum',
    'warmups',
    'workload'
]
const RETAINED_HEAP_KEYS = [
    'afterBytes',
    'beforeBytes',
    'gcControlled',
    'retainedBytes'
]
const BASELINE_SCHEMA = 'gerber-toolkit.benchmark-report.v1'
const BASELINE_PACKAGE = 'gerber-toolkit'
const BASELINE_PACKAGE_VERSION = '0.1.21'
const CANONICAL_BASELINE_REPORT_CHECKSUM =
    '8e52d115f8247ecba3284f4a16b254938e02ff24ebdac33b868f46ede9bfac2a'
const BASELINE_PROVENANCE = GERBER_TASK1_PROVENANCE
const BASELINE_ENVIRONMENT = Object.freeze({
    node: 'v20.17.0',
    platform: 'darwin',
    architecture: 'arm64',
    cpu: 'Apple M3 Max',
    logicalCpuCount: 16
})
const BASELINE_CASES = Object.freeze(
    GerberBenchmarkSuite.contract({ profile: 'baseline' }).map((row) =>
        Object.freeze(row)
    )
)
const CURRENT_CASES = Object.freeze(
    GerberBenchmarkSuite.contract({ profile: 'current' }).map((row) =>
        Object.freeze(row)
    )
)
const BASELINE_FIXTURE_CHECKSUM = GerberBenchmarkSuite.fixtureChecksum({
    profile: 'baseline'
})
const CURRENT_FIXTURE_CHECKSUM = GerberBenchmarkSuite.fixtureChecksum({
    profile: 'current'
})
const CURRENT_TIME_ALLOWANCES_MS = Object.freeze({
    'archive-parse-projection': 25,
    'mask-drill-hit-test': 6,
    'step-repeat-large': 6,
    'separated-render-large': 12,
    'worker-clone-default': 6,
    'parse-small': 0.3,
    'render-small': 0.3
})
const CURRENT_IDENTITY = await GerberBenchmarkIdentity.current()

/**
 * Runs the complete Gerber performance baseline suite.
 * @param {{ warmups?: number, samples?: number, workloads?: Readonly<Record<string, Function>> }} [options] Measurement options and current production seams.
 * @returns {Promise<Record<string, any>>} Benchmark report.
 */
export async function runBenchmarks(options = {}) {
    const warmups = positiveInteger(options.warmups, 2)
    const sampleCount = positiveInteger(options.samples, 5)
    const cases = []
    for (const benchmarkCase of GerberBenchmarkSuite.cases({
        profile: 'current',
        workloads: options.workloads
    })) {
        cases.push(await measureCase(benchmarkCase, { warmups, sampleCount }))
    }
    const body = {
        schema: CURRENT_IDENTITY.schema,
        package: CURRENT_IDENTITY.package,
        packageVersion: CURRENT_IDENTITY.packageVersion,
        provenance: { ...CURRENT_IDENTITY.provenance },
        environment: environmentRecord(),
        fixtureChecksum: CURRENT_FIXTURE_CHECKSUM,
        cases
    }
    return { ...body, reportChecksum: checksum(body) }
}

/**
 * Returns the package and checkout identity used by current reports.
 * @returns {{ schema: string, package: string, packageVersion: string, provenance: Record<string, string> }} Current report identity.
 */
export function currentBenchmarkIdentity() {
    return {
        schema: CURRENT_IDENTITY.schema,
        package: CURRENT_IDENTITY.package,
        packageVersion: CURRENT_IDENTITY.packageVersion,
        provenance: { ...CURRENT_IDENTITY.provenance }
    }
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
    const currentContractById = new Map(
        CURRENT_CASES.map((row) => [row.id, row])
    )
    const baselineContractById = new Map(
        BASELINE_CASES.map((row) => [row.id, row])
    )
    const baselineById = new Map(baselineRows.map((row) => [row.id, row]))
    const currentById = new Map(currentRows.map((row) => [row.id, row]))
    const cases = baselineRows.map((previous) => {
        const row = currentById.get(previous.id)
        const currentContract = currentContractById.get(previous.id)
        const baselineContract = baselineContractById.get(previous.id)
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
        const comparable =
            Boolean(currentContract) &&
            Boolean(baselineContract) &&
            currentContract.fixtureChecksum ===
                baselineContract.fixtureChecksum &&
            currentContract.structuralChecksum ===
                baselineContract.structuralChecksum
        const absoluteTimeLimitMs = CURRENT_TIME_ALLOWANCES_MS[row.id]
        const absoluteTimePassed =
            Number.isFinite(absoluteTimeLimitMs) &&
            row.medianMilliseconds <= absoluteTimeLimitMs
        const timePassed = absoluteTimePassed
        const resultBytesPassed =
            positiveSafeInteger(row.resultBytes) &&
            positiveSafeInteger(previous.resultBytes) &&
            (!comparable || row.resultBytes <= previous.resultBytes)
        const cloneBytesPassed =
            positiveSafeInteger(row.cloneBytes) &&
            positiveSafeInteger(previous.cloneBytes) &&
            (!comparable || row.cloneBytes <= previous.cloneBytes)
        const fixtureChecksumPassed =
            Boolean(currentContract) &&
            Boolean(baselineContract) &&
            row.fixtureChecksum === currentContract.fixtureChecksum &&
            previous.fixtureChecksum === baselineContract.fixtureChecksum
        const structuralChecksumPassed =
            Boolean(currentContract) &&
            Boolean(baselineContract) &&
            row.structuralChecksum === currentContract.structuralChecksum &&
            previous.structuralChecksum === baselineContract.structuralChecksum
        const metadataPassed =
            Boolean(currentContract) &&
            Boolean(baselineContract) &&
            row.primary === currentContract.primary &&
            previous.primary === baselineContract.primary &&
            row.size === currentContract.size &&
            previous.size === baselineContract.size &&
            row.workload === currentContract.workload &&
            previous.workload === baselineContract.workload &&
            !duplicateCurrentIds.has(row.id) &&
            !duplicateBaselineIds.has(previous.id)
        const warmupsPassed =
            Number.isSafeInteger(row.warmups) &&
            row.warmups > 0 &&
            row.warmups === previous.warmups
        const samplesPassed =
            validSamples(row.samples) &&
            validSamples(previous.samples) &&
            row.samples.length === previous.samples.length
        const medianPassed =
            samplesPassed &&
            row.medianMilliseconds === median(row.samples) &&
            previous.medianMilliseconds === median(previous.samples)
        const retainedHeapPassed =
            validRetainedHeap(row.retainedHeap) &&
            validRetainedHeap(previous.retainedHeap)
        const heapModePassed =
            retainedHeapPassed &&
            row.retainedHeap.gcControlled === previous.retainedHeap.gcControlled
        return {
            id: row.id,
            primary: currentContract?.primary ?? previous.primary,
            size: currentContract?.size ?? previous.size,
            comparable,
            changePercent,
            timeLimitPercent,
            absoluteTimeLimitMs,
            absoluteTimePassed,
            timePassed,
            resultBytesPassed,
            cloneBytesPassed,
            fixtureChecksumPassed,
            structuralChecksumPassed,
            metadataPassed,
            warmupsPassed,
            samplesPassed,
            medianPassed,
            retainedHeapPassed,
            heapModePassed,
            passed:
                timePassed &&
                resultBytesPassed &&
                cloneBytesPassed &&
                fixtureChecksumPassed &&
                structuralChecksumPassed &&
                metadataPassed &&
                warmupsPassed &&
                samplesPassed &&
                medianPassed &&
                retainedHeapPassed &&
                heapModePassed
        }
    })
    for (const row of currentRows) {
        if (!baselineById.has(row.id) || !currentContractById.has(row.id)) {
            cases.push({
                id: row.id,
                passed: false,
                reason: 'unexpected-current'
            })
        }
    }
    const fixtureChecksumPassed =
        current?.fixtureChecksum === CURRENT_FIXTURE_CHECKSUM &&
        baseline?.fixtureChecksum === BASELINE_FIXTURE_CHECKSUM
    const catalogPassed =
        isDeepStrictEqual(caseContracts(currentRows), CURRENT_CASES) &&
        isDeepStrictEqual(caseContracts(baselineRows), BASELINE_CASES)
    const schemaPassed =
        current?.schema === CURRENT_IDENTITY.schema &&
        baseline?.schema === BASELINE_SCHEMA
    const packagePassed =
        current?.package === CURRENT_IDENTITY.package &&
        baseline?.package === BASELINE_PACKAGE
    const packageVersionPassed =
        current?.packageVersion === CURRENT_IDENTITY.packageVersion &&
        baseline?.packageVersion === BASELINE_PACKAGE_VERSION
    const provenancePassed =
        isDeepStrictEqual(current?.provenance, CURRENT_IDENTITY.provenance) &&
        isDeepStrictEqual(baseline?.provenance, BASELINE_PROVENANCE)
    const currentIdentityPassed =
        current?.schema === CURRENT_IDENTITY.schema &&
        current?.package === CURRENT_IDENTITY.package &&
        current?.packageVersion === CURRENT_IDENTITY.packageVersion &&
        isDeepStrictEqual(current?.provenance, CURRENT_IDENTITY.provenance)
    const baselineIdentityPassed =
        baseline?.schema === BASELINE_SCHEMA &&
        baseline?.package === BASELINE_PACKAGE &&
        baseline?.packageVersion === BASELINE_PACKAGE_VERSION &&
        isDeepStrictEqual(baseline?.provenance, BASELINE_PROVENANCE)
    const environmentPassed =
        isDeepStrictEqual(current?.environment, BASELINE_ENVIRONMENT) &&
        isDeepStrictEqual(baseline?.environment, BASELINE_ENVIRONMENT)
    const currentChecksumPassed = validReportChecksum(current)
    const baselineChecksumPassed = validReportChecksum(baseline)
    const baselineAnchorPassed =
        baseline?.reportChecksum === CANONICAL_BASELINE_REPORT_CHECKSUM
    const currentShapePassed = validReportShape(current)
    const baselineShapePassed = validReportShape(baseline)
    return {
        passed:
            catalogPassed &&
            schemaPassed &&
            packagePassed &&
            packageVersionPassed &&
            provenancePassed &&
            currentIdentityPassed &&
            baselineIdentityPassed &&
            environmentPassed &&
            currentChecksumPassed &&
            baselineChecksumPassed &&
            baselineAnchorPassed &&
            currentShapePassed &&
            baselineShapePassed &&
            fixtureChecksumPassed &&
            cases.every((row) => row.passed === true),
        catalogPassed,
        schemaPassed,
        packagePassed,
        packageVersionPassed,
        provenancePassed,
        currentIdentityPassed,
        baselineIdentityPassed,
        environmentPassed,
        currentChecksumPassed,
        baselineChecksumPassed,
        baselineAnchorPassed,
        currentShapePassed,
        baselineShapePassed,
        fixtureChecksumPassed,
        cases
    }
}

/**
 * Validates the complete benchmark report object schema recursively.
 * @param {unknown} report Candidate benchmark report.
 * @returns {boolean} Whether the report has exactly the frozen keys.
 */
function validReportShape(report) {
    return (
        exactKeys(report, REPORT_KEYS) &&
        exactKeys(report.provenance, PROVENANCE_KEYS) &&
        exactKeys(report.environment, ENVIRONMENT_KEYS) &&
        Array.isArray(report.cases) &&
        report.cases.every(
            (row) =>
                exactKeys(row, CASE_KEYS) &&
                exactKeys(row.retainedHeap, RETAINED_HEAP_KEYS)
        )
    )
}

/**
 * Compares an object's own enumerable keys with one exact sorted schema.
 * @param {unknown} value Candidate object.
 * @param {string[]} expected Expected own keys.
 * @returns {boolean} Whether the key sets are identical.
 */
function exactKeys(value, expected) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false
    return isDeepStrictEqual(Object.keys(value).sort(), expected)
}

/**
 * Returns whether a byte count is a positive safe integer.
 * @param {unknown} value Byte count candidate.
 * @returns {boolean} Whether the byte count is valid.
 */
function positiveSafeInteger(value) {
    return Number.isSafeInteger(value) && value > 0
}

/**
 * Returns whether a retained-heap record is complete and internally valid.
 * @param {unknown} value Retained-heap observation candidate.
 * @returns {boolean} Whether the observation is valid.
 */
function validRetainedHeap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false
    }
    const keys = Object.keys(value).sort()
    const expectedKeys = [
        'afterBytes',
        'beforeBytes',
        'gcControlled',
        'retainedBytes'
    ]
    if (!isDeepStrictEqual(keys, expectedKeys)) return false
    if (typeof value.gcControlled !== 'boolean') return false
    if (!positiveSafeInteger(value.beforeBytes)) return false
    if (!positiveSafeInteger(value.afterBytes)) return false
    if (!Number.isSafeInteger(value.retainedBytes) || value.retainedBytes < 0) {
        return false
    }
    return (
        value.retainedBytes ===
        Math.max(0, value.afterBytes - value.beforeBytes)
    )
}

/**
 * Returns whether one sample vector is finite, non-negative, and non-empty.
 * @param {unknown} samples Sample vector candidate.
 * @returns {boolean} Whether the vector is valid.
 */
function validSamples(samples) {
    return (
        Array.isArray(samples) &&
        samples.length > 0 &&
        samples.every((sample) => Number.isFinite(sample) && sample >= 0)
    )
}

/**
 * Recomputes and verifies one report's own body checksum.
 * @param {unknown} report Benchmark report candidate.
 * @returns {boolean} Whether its checksum is valid.
 */
function validReportChecksum(report) {
    if (!report || typeof report !== 'object' || Array.isArray(report)) {
        return false
    }
    const { reportChecksum, ...body } = report
    return (
        typeof reportChecksum === 'string' && reportChecksum === checksum(body)
    )
}

/**
 * Measures one benchmark workload.
 * @param {{ id: string, primary: boolean, size: string, workload: string, prepare?: () => Promise<unknown> | unknown, run: (prepared?: unknown) => Promise<unknown> }} benchmarkCase Case definition.
 * @param {{ warmups: number, sampleCount: number }} options Measurement options.
 * @returns {Promise<Record<string, any>>} Case measurement.
 */
async function measureCase(benchmarkCase, options) {
    const prepared = benchmarkCase.prepare
        ? await benchmarkCase.prepare()
        : undefined
    const run = () => benchmarkCase.run(prepared)
    for (let index = 0; index < options.warmups; index += 1) {
        await run()
    }

    const samples = []
    let result
    for (let index = 0; index < options.sampleCount; index += 1) {
        const started = performance.now()
        result = await run()
        samples.push(roundMilliseconds(performance.now() - started))
    }

    const retainedHeap = await measureHeap(run)
    const serialized = JSON.stringify(result)
    const clone = structuredClone(result)
    const cloneSerialized = JSON.stringify(clone)
    const structuralChecksum = checksum(result)
    if (structuralChecksum !== benchmarkCase.expectedStructuralChecksum) {
        throw new Error(
            `Benchmark structural contract drift for ${benchmarkCase.id}: expected ${benchmarkCase.expectedStructuralChecksum}, received ${structuralChecksum}.`
        )
    }
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
        structuralChecksum
    }
}

/**
 * Selects the independently anchored fields from report rows in order.
 * @param {Record<string, any>[]} rows Benchmark report rows.
 * @returns {{ id: string, primary: boolean, size: string, workload: string, fixtureChecksum: string, structuralChecksum: string }[]} Case contracts.
 */
function caseContracts(rows) {
    return rows.map(
        ({
            id,
            primary,
            size,
            workload,
            fixtureChecksum,
            structuralChecksum
        }) => ({
            id,
            primary,
            size,
            workload,
            fixtureChecksum,
            structuralChecksum
        })
    )
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
