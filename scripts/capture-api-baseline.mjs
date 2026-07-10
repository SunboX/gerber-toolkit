import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import { format } from 'prettier'

import { GERBER_TASK1_PROVENANCE } from './GerberTask1Provenance.mjs'

const repositoryRoot = new URL('../', import.meta.url)
const repositoryPath = fileURLToPath(repositoryRoot)
const execFileAsync = promisify(execFile)
const BASELINE_VERSION = '0.1.21'

/**
 * Captures the historical API using commit-pinned source, evidence, and code.
 * @param {{ write?: boolean, update?: boolean }} [options] Capture options.
 * @returns {Promise<{ baseline: Record<string, any>, ledger: Record<string, any>[] }>} Captured artifacts.
 */
export async function captureApiBaseline(options = {}) {
    const result = await withPinnedSnapshots(async (roots) => {
        const harnessUrl = new URL(
            'scripts/GerberApiBaselineHarness.mjs',
            roots.harness
        )
        const { GerberApiBaselineHarness } = await import(
            `${harnessUrl.href}?harness=${GERBER_TASK1_PROVENANCE.harnessCommit}`
        )
        return GerberApiBaselineHarness.capture({
            sourceRoot: roots.source,
            evidenceRoot: roots.evidence,
            provenance: { ...GERBER_TASK1_PROVENANCE },
            baselineVersion: BASELINE_VERSION
        })
    })

    if (options.write !== false) {
        await writeImmutableJson(
            'spec/api-baseline-v0.1.21.json',
            result.baseline,
            options.update === true
        )
        await writeImmutableJson(
            'spec/feature-preservation.json',
            result.ledger,
            options.update === true
        )
    }
    return result
}

/**
 * Extracts and verifies all immutable inputs for one capture operation.
 * @template T
 * @param {(roots: { source: URL, evidence: URL, harness: URL }) => Promise<T>} operation Capture operation.
 * @returns {Promise<T>} Operation result.
 */
async function withPinnedSnapshots(operation) {
    const temporaryPath = await mkdtemp(
        join(repositoryPath, '.gerber-api-baseline-')
    )
    try {
        const source = await extractSnapshot(
            temporaryPath,
            'source',
            GERBER_TASK1_PROVENANCE.sourceCommit,
            GERBER_TASK1_PROVENANCE.sourceTree
        )
        const evidence = await extractSnapshot(
            temporaryPath,
            'evidence',
            GERBER_TASK1_PROVENANCE.evidenceCommit,
            GERBER_TASK1_PROVENANCE.evidenceTree
        )
        const harness = await extractSnapshot(
            temporaryPath,
            'harness',
            GERBER_TASK1_PROVENANCE.harnessCommit,
            GERBER_TASK1_PROVENANCE.harnessTree
        )
        return await operation({ source, evidence, harness })
    } finally {
        await rm(temporaryPath, { recursive: true, force: true })
    }
}

/**
 * Verifies and extracts one Git commit beneath a temporary capture root.
 * @param {string} temporaryPath Temporary capture root.
 * @param {string} label Snapshot label.
 * @param {string} commit Immutable commit.
 * @param {string} expectedTree Expected commit tree.
 * @returns {Promise<URL>} Extracted snapshot URL.
 */
async function extractSnapshot(temporaryPath, label, commit, expectedTree) {
    const { stdout } = await execFileAsync(
        'git',
        ['rev-parse', `${commit}^{tree}`],
        { cwd: repositoryPath }
    )
    if (stdout.trim() !== expectedTree) {
        throw new Error(
            `Pinned ${label} tree mismatch for ${commit}: expected ${expectedTree}, received ${stdout.trim()}.`
        )
    }
    const snapshotPath = join(temporaryPath, label)
    const archivePath = join(temporaryPath, `${label}.tar`)
    await mkdir(snapshotPath)
    await execFileAsync(
        'git',
        ['archive', '--format=tar', '--output', archivePath, commit],
        { cwd: repositoryPath }
    )
    await execFileAsync('tar', ['-xf', archivePath, '-C', snapshotPath])
    await rm(archivePath)
    return pathToFileURL(`${snapshotPath}/`)
}

/**
 * Writes a stable JSON artifact once and rejects later drift.
 * @param {string} path Repository-relative path.
 * @param {unknown} value JSON value.
 * @param {boolean} [update] Whether explicit regeneration is allowed.
 * @returns {Promise<void>}
 */
async function writeImmutableJson(path, value, update = false) {
    const target = new URL(path, repositoryRoot)
    const content = await format(JSON.stringify(value, null, 4), {
        parser: 'json',
        tabWidth: 4,
        trailingComma: 'none'
    })
    try {
        const existing = await readFile(target, 'utf8')
        if (existing !== content) {
            if (update) {
                await writeFile(target, content)
                return
            }
            throw new Error(`Refusing to overwrite immutable baseline: ${path}`)
        }
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error
        await writeFile(target, content)
    }
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
    const argumentsList = process.argv.slice(2)
    const unknown = argumentsList.filter((argument) => argument !== '--update')
    if (unknown.length) {
        throw new Error(`Unknown API capture argument: ${unknown[0]}`)
    }
    await captureApiBaseline({ update: argumentsList.includes('--update') })
}
