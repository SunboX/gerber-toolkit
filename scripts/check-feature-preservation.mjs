import { execFile } from 'node:child_process'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const TOOLKITS = [
    'circuitjson-toolkit',
    'gerber-toolkit',
    'altium-toolkit',
    'kicad-toolkit'
]
const AVAILABILITY = new Set(['native', 'shared', 'derived', 'unavailable'])
const DISPOSITIONS = new Set(['shared', 'native-extension', 'unavailable'])
const MAPPING_FIELDS = [
    'kind',
    'capabilityId',
    'disposition',
    'replacement',
    'availability',
    'evidenceToken',
    'tests',
    'documentation'
]

/**
 * Validates an in-memory API baseline and preservation ledger.
 * @param {{ apiBaseline: Record<string, any>, ledger: Record<string, any>[], strict?: boolean, packageRoot?: string, repositoryRoot?: string }} options Validation inputs.
 * @returns {Promise<{ featureCount: number, strict: boolean }>} Validation summary.
 */
export async function validateFeaturePreservation(options) {
    const apiBaseline = options?.apiBaseline || {}
    const ledger = Array.isArray(options?.ledger) ? options.ledger : []
    const features = Array.isArray(apiBaseline.features)
        ? apiBaseline.features
        : []

    assertUniqueFeatures(features, 'baseline')
    assertUniqueFeatures(ledger, 'ledger')

    const featureIds = new Set(features.map((row) => row.feature))
    const ledgerIds = new Set(ledger.map((row) => row.feature))
    const missing = [...featureIds].filter((feature) => !ledgerIds.has(feature))
    const stale = [...ledgerIds].filter((feature) => !featureIds.has(feature))
    if (missing.length) {
        throw new Error(
            `Missing feature-preservation mappings: ${missing.sort().join(', ')}`
        )
    }
    if (stale.length) {
        throw new Error(
            `Stale feature-preservation mappings: ${stale.sort().join(', ')}`
        )
    }

    const baselineByFeature = new Map(
        features.map((feature) => [feature.feature, feature])
    )
    for (const row of ledger) {
        assertValidRow(row)
        assertMatchingMapping(baselineByFeature.get(row.feature), row)
    }

    if (options?.strict === true) {
        const packageRoot = resolve(String(options.packageRoot || ''))
        const repositoryRoot = resolve(
            String(options.repositoryRoot || process.cwd())
        )
        await assertEvidence(ledger, repositoryRoot)
        const imported = await importEntrypoints(
            apiBaseline.entrypoints || [],
            packageRoot
        )
        assertPackedApi(features, imported)
        assertCapabilities(ledger, imported)
    }

    return { featureCount: features.length, strict: options?.strict === true }
}

/**
 * Reads and validates file-backed preservation artifacts.
 * @param {{ apiPath?: string, ledgerPath?: string, repositoryRoot?: string, packageRoot?: string, strict?: boolean }} [options] File-backed options.
 * @returns {Promise<{ featureCount: number, strict: boolean }>} Validation summary.
 */
export async function checkFeaturePreservation(options = {}) {
    const repositoryRoot = resolve(options.repositoryRoot || process.cwd())
    const apiPath = resolve(
        options.apiPath ||
            join(repositoryRoot, 'spec/api-baseline-v0.1.21.json')
    )
    const ledgerPath = resolve(
        options.ledgerPath ||
            join(repositoryRoot, 'spec/feature-preservation.json')
    )
    const [apiBaseline, ledger] = await Promise.all([
        readJson(apiPath),
        readJson(ledgerPath)
    ])

    let packed = null
    try {
        if (options.strict === true && !options.packageRoot) {
            packed = await packRepository(repositoryRoot)
        }
        return await validateFeaturePreservation({
            apiBaseline,
            ledger,
            strict: options.strict === true,
            packageRoot: options.packageRoot || packed?.packageRoot,
            repositoryRoot
        })
    } finally {
        await packed?.cleanup()
    }
}

/**
 * Rejects duplicate feature ids in one artifact.
 * @param {Record<string, any>[]} rows Artifact rows.
 * @param {'baseline' | 'ledger'} label Artifact label.
 * @returns {void}
 */
function assertUniqueFeatures(rows, label) {
    const seen = new Set()
    const duplicates = new Set()
    for (const row of rows) {
        const feature = String(row?.feature || '')
        if (seen.has(feature)) duplicates.add(feature)
        seen.add(feature)
    }
    if (duplicates.size) {
        throw new Error(
            `Duplicate ${label} features: ${[...duplicates].sort().join(', ')}`
        )
    }
}

/**
 * Validates one complete preservation row.
 * @param {Record<string, any>} row Preservation row.
 * @returns {void}
 */
function assertValidRow(row) {
    const valid =
        row &&
        typeof row.package === 'string' &&
        row.package.length > 0 &&
        typeof row.feature === 'string' &&
        row.feature.length > 0 &&
        ['export', 'method', 'option', 'field', 'behavior'].includes(
            row.kind
        ) &&
        typeof row.capabilityId === 'string' &&
        row.capabilityId.includes('.') &&
        DISPOSITIONS.has(row.disposition) &&
        typeof row.replacement === 'string' &&
        row.replacement.length > 0 &&
        typeof row.reason === 'string' &&
        row.reason.length > 0 &&
        typeof row.evidenceToken === 'string' &&
        row.evidenceToken.length > 0 &&
        nonEmptyStringList(row.tests) &&
        nonEmptyStringList(row.documentation) &&
        validAvailability(row.availability)
    if (!valid) {
        throw new Error(
            `Invalid feature-preservation row for ${String(row?.feature || '(missing)')}`
        )
    }
}

/**
 * Returns true for one non-empty string list.
 * @param {unknown} value Candidate list.
 * @returns {boolean} Whether the value is valid.
 */
function nonEmptyStringList(value) {
    return (
        Array.isArray(value) &&
        value.length > 0 &&
        value.every((entry) => typeof entry === 'string' && entry.length > 0)
    )
}

/**
 * Returns true for the exact four-toolkit availability map.
 * @param {unknown} value Availability candidate.
 * @returns {boolean} Whether the map is valid.
 */
function validAvailability(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false
    const keys = Object.keys(value).sort()
    return (
        JSON.stringify(keys) === JSON.stringify([...TOOLKITS].sort()) &&
        keys.every((key) => AVAILABILITY.has(value[key]))
    )
}

/**
 * Requires the baseline and ledger to freeze identical mapping values.
 * @param {Record<string, any>} baseline Baseline feature.
 * @param {Record<string, any>} ledger Ledger row.
 * @returns {void}
 */
function assertMatchingMapping(baseline, ledger) {
    const differs = MAPPING_FIELDS.some(
        (field) =>
            JSON.stringify(baseline?.[field]) !== JSON.stringify(ledger[field])
    )
    if (differs) {
        throw new Error(
            `Baseline and ledger mapping differ for ${ledger.feature}`
        )
    }
}

/**
 * Verifies evidence files exist and test files mention their public token.
 * @param {Record<string, any>[]} ledger Ledger rows.
 * @param {string} repositoryRoot Repository root.
 * @returns {Promise<void>}
 */
async function assertEvidence(ledger, repositoryRoot) {
    const paths = [
        ...new Set(
            ledger.flatMap((row) => [...row.tests, ...row.documentation])
        )
    ].sort()
    const missing = []
    for (const path of paths) {
        try {
            await access(resolve(repositoryRoot, path))
        } catch {
            missing.push(path)
        }
    }
    if (missing.length) {
        throw new Error(`Missing evidence paths: ${missing.join(', ')}`)
    }

    const sourceByPath = new Map()
    for (const path of new Set(ledger.flatMap((row) => row.tests))) {
        sourceByPath.set(
            path,
            await readFile(resolve(repositoryRoot, path), 'utf8')
        )
    }
    for (const row of ledger) {
        if (
            !row.tests.some((path) =>
                sourceByPath.get(path)?.includes(row.evidenceToken)
            )
        ) {
            throw new Error(
                `Evidence tests do not reference ${row.evidenceToken} for ${row.feature}`
            )
        }
    }
}

/**
 * Imports every captured package entrypoint from an extracted package.
 * @param {Record<string, any>[]} entrypoints Entrypoint baseline.
 * @param {string} packageRoot Extracted package root.
 * @returns {Promise<Map<string, Record<string, any>>>} Imported modules.
 */
async function importEntrypoints(entrypoints, packageRoot) {
    if (!packageRoot) {
        throw new Error('Strict feature validation requires a package root.')
    }
    const imported = new Map()
    for (const entrypoint of entrypoints) {
        imported.set(
            entrypoint.entrypoint,
            await import(
                `${pathToFileURL(resolve(packageRoot, entrypoint.target)).href}?strict=${Date.now()}`
            )
        )
    }
    return imported
}

/**
 * Verifies each captured export and method still exists in the packed API.
 * @param {Record<string, any>[]} features Baseline features.
 * @param {Map<string, Record<string, any>>} imported Imported entrypoints.
 * @returns {void}
 */
function assertPackedApi(features, imported) {
    const stale = []
    for (const feature of features) {
        if (!feature.entrypoint || !feature.exportName) continue
        const value = imported.get(feature.entrypoint)?.[feature.exportName]
        let present = value !== undefined
        if (present && feature.methodName) {
            const owner =
                feature.methodType === 'instance' ? value?.prototype : value
            present = typeof owner?.[feature.methodName] === 'function'
        }
        if (!present) stale.push(feature.feature)
    }
    if (stale.length) {
        throw new Error(`Stale packed API features: ${stale.sort().join(', ')}`)
    }
}

/**
 * Verifies capability ids against the packed inventory and its identity fields.
 * @param {Record<string, any>[]} ledger Ledger rows.
 * @param {Map<string, Record<string, any>>} imported Imported entrypoints.
 * @returns {void}
 */
function assertCapabilities(ledger, imported) {
    const provider = [...imported.values()]
        .map((api) => api.ToolkitCapabilities)
        .find((value) => typeof value?.inventory === 'function')
    if (!provider) {
        throw new Error(
            'Packed API does not expose ToolkitCapabilities.inventory().'
        )
    }
    const inventory = provider.inventory()
    const byId = new Map(inventory.map((row) => [row.id, row]))
    const ids = [...new Set(ledger.map((row) => row.capabilityId))]
    const fictitious = ids.filter((id) => !byId.has(id))
    if (fictitious.length) {
        throw new Error(
            `Fictitious capabilityId mappings: ${fictitious.sort().join(', ')}`
        )
    }
    for (const id of ids) {
        const row = byId.get(id)
        const parts = id.split('.')
        const category = parts.slice(0, -1).join('.')
        const operation = parts.at(-1)
        if (row.category !== category || row.operation !== operation) {
            throw new Error(`Capability inventory identity mismatch: ${id}`)
        }
    }
}

/**
 * Packs and extracts a repository for strict entrypoint verification.
 * @param {string} repositoryRoot Repository root.
 * @returns {Promise<{ packageRoot: string, cleanup: () => Promise<void> }>} Packed fixture.
 */
async function packRepository(repositoryRoot) {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'gerber-feature-pack-'))
    try {
        const { stdout } = await execFileAsync(
            'npm',
            ['pack', '--json', '--pack-destination', temporaryRoot],
            { cwd: repositoryRoot, maxBuffer: 10 * 1024 * 1024 }
        )
        const filename = JSON.parse(stdout)?.[0]?.filename
        if (typeof filename !== 'string' || !filename) {
            throw new Error('npm pack did not report a tarball filename.')
        }
        await execFileAsync(
            'tar',
            ['-xzf', join(temporaryRoot, filename), '-C', temporaryRoot],
            { maxBuffer: 10 * 1024 * 1024 }
        )
        return {
            packageRoot: join(temporaryRoot, 'package'),
            cleanup: () => rm(temporaryRoot, { recursive: true, force: true })
        }
    } catch (error) {
        await rm(temporaryRoot, { recursive: true, force: true })
        throw error
    }
}

/**
 * Reads one JSON artifact.
 * @param {string} path Absolute path.
 * @returns {Promise<any>} Parsed JSON value.
 */
async function readJson(path) {
    return JSON.parse(await readFile(path, 'utf8'))
}

/**
 * Parses command-line flags into checker options.
 * @param {string[]} argumentsList Command arguments.
 * @returns {Record<string, any>} Checker options.
 */
function parseArguments(argumentsList) {
    const options = {}
    for (let index = 0; index < argumentsList.length; index += 1) {
        const argument = argumentsList[index]
        if (argument === '--strict') {
            options.strict = true
        } else if (argument === '--api') {
            options.apiPath = argumentsList[++index]
        } else if (argument === '--ledger') {
            options.ledgerPath = argumentsList[++index]
        } else if (argument === '--repository-root') {
            options.repositoryRoot = argumentsList[++index]
        } else {
            throw new Error(`Unknown feature-check argument: ${argument}`)
        }
    }
    return options
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
        const result = await checkFeaturePreservation(
            parseArguments(process.argv.slice(2))
        )
        process.stdout.write(
            `Validated ${result.featureCount} Gerber feature-preservation mappings${result.strict ? ' in strict mode' : ''}.\n`
        )
    } catch (error) {
        process.stderr.write(`${String(error?.message || error)}\n`)
        process.exitCode = 1
    }
}
