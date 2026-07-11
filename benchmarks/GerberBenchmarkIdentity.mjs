import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url))

/**
 * Resolves the identity of code that produces a current benchmark report.
 */
export class GerberBenchmarkIdentity {
    /**
     * Reads package identity and the checked-out Git source identity.
     * @returns {Promise<Readonly<{ schema: string, package: string, packageVersion: string, provenance: Readonly<Record<string, string>> }>>} Current identity.
     */
    static async current() {
        const pkg = JSON.parse(
            await readFile(new URL('../package.json', import.meta.url), 'utf8')
        )
        const [{ stdout }, tree] = await Promise.all([
            execFileAsync('git', ['rev-parse', 'HEAD'], {
                cwd: REPOSITORY_ROOT
            }),
            GerberBenchmarkIdentity.#worktreeTree()
        ])
        const commit = stdout.trim()
        if (!GerberBenchmarkIdentity.#objectId(commit)) {
            throw new Error('Unable to derive current benchmark commit.')
        }
        if (!GerberBenchmarkIdentity.#objectId(tree)) {
            throw new Error('Unable to derive current benchmark tree.')
        }
        return Object.freeze({
            schema: 'gerber-toolkit.benchmark-report.v1',
            package: String(pkg.name),
            packageVersion: String(pkg.version),
            provenance: Object.freeze({
                sourceCommit: commit,
                sourceTree: tree,
                evidenceCommit: commit,
                evidenceTree: tree,
                harnessCommit: commit,
                harnessTree: tree
            })
        })
    }

    /**
     * Checks one Git SHA-1 object id.
     * @param {unknown} value Object id candidate.
     * @returns {boolean} Whether the id is complete.
     */
    static #objectId(value) {
        return /^[a-f0-9]{40}$/u.test(String(value || ''))
    }

    /**
     * Computes a real Git tree id for tracked and untracked current files without changing the user's index.
     * @returns {Promise<string>} Effective worktree tree id.
     */
    static async #worktreeTree() {
        const directory = await mkdtemp(
            join(tmpdir(), 'gerber-benchmark-index-')
        )
        const environment = {
            ...process.env,
            GIT_INDEX_FILE: join(directory, 'index')
        }
        try {
            await execFileAsync('git', ['read-tree', 'HEAD'], {
                cwd: REPOSITORY_ROOT,
                env: environment
            })
            await execFileAsync('git', ['add', '-A', '--', '.'], {
                cwd: REPOSITORY_ROOT,
                env: environment
            })
            const { stdout } = await execFileAsync('git', ['write-tree'], {
                cwd: REPOSITORY_ROOT,
                env: environment
            })
            return stdout.trim()
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    }
}
