import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { format } from 'prettier'

import { GerberApiContractInspector } from './GerberApiContractInspector.mjs'

const repositoryRoot = new URL('../', import.meta.url)
const repositoryPath = fileURLToPath(repositoryRoot)
const execFileAsync = promisify(execFile)
const BASELINE_VERSION = '0.1.21'
const META_TEST_PATHS = new Set([
    'tests/convergence-baselines.test.mjs',
    'tests/feature-preservation-check.test.mjs'
])
const PROVENANCE = Object.freeze({
    sourceCommit: '11ba9df32ce966d6626f99f444909ff6c50d2281',
    sourceTree: '1b7813598247b9ec3907a9589aefe084e4a448bd',
    evidenceCommit: '65e42e5edca8b88cab41f5de33c8348e34f96e5b',
    evidenceTree: 'ab80b452f402941f2dbc1dcf03328f0106c82a17',
    harnessCommit: '65e42e5edca8b88cab41f5de33c8348e34f96e5b',
    harnessTree: 'ab80b452f402941f2dbc1dcf03328f0106c82a17'
})
const TOOLKIT_AVAILABILITY = Object.freeze({
    shared: Object.freeze({
        'circuitjson-toolkit': 'shared',
        'gerber-toolkit': 'native',
        'altium-toolkit': 'derived',
        'kicad-toolkit': 'derived'
    }),
    native: Object.freeze({
        'circuitjson-toolkit': 'unavailable',
        'gerber-toolkit': 'native',
        'altium-toolkit': 'unavailable',
        'kicad-toolkit': 'unavailable'
    })
})
const POLICIES = Object.freeze({
    'parser.document.parse': Object.freeze({
        disposition: 'shared',
        replacement: 'Parser.parse()/extensions.gerber',
        availability: TOOLKIT_AVAILABILITY.shared,
        reason: 'The canonical parser envelope is shared while lossless CAM facts remain Gerber-native.',
        documentation: ['docs/api.md', 'docs/model-format.md']
    }),
    'project.archive.load': Object.freeze({
        disposition: 'shared',
        replacement: 'ProjectLoader.load()/ArchiveLimits',
        availability: TOOLKIT_AVAILABILITY.shared,
        reason: 'Project loading uses the shared safe-entry contract with Gerber-owned archive decoding.',
        documentation: ['docs/api.md', 'spec/library-scope.md']
    }),
    'extension.gerber.coordinate': Object.freeze({
        disposition: 'native-extension',
        replacement: 'gerber-toolkit/extensions#GerberCoordinateParser',
        availability: TOOLKIT_AVAILABILITY.native,
        reason: 'Fixed-point Gerber coordinate decoding is meaningful only for Gerber and Excellon sources.',
        documentation: ['docs/model-format.md', 'spec/library-scope.md']
    }),
    'extension.gerber.layer': Object.freeze({
        disposition: 'native-extension',
        replacement: 'gerber-toolkit/extensions#GerberLayerRoleResolver',
        availability: TOOLKIT_AVAILABILITY.native,
        reason: 'Fabrication file naming and X2 role inference remain a Gerber-native extension.',
        documentation: ['docs/model-format.md', 'spec/library-scope.md']
    }),
    'renderer.pcb.render': Object.freeze({
        disposition: 'shared',
        replacement: 'PcbSvgRenderer.render()',
        availability: TOOLKIT_AVAILABILITY.shared,
        reason: 'PCB rendering uses the common facade and preserves polarity-sensitive native fidelity.',
        documentation: ['docs/api.md', 'docs/model-format.md']
    }),
    'interaction.pcb.hitTest': Object.freeze({
        disposition: 'shared',
        replacement: 'PcbInteractionIndex.create()/hitTest()/pick()',
        availability: TOOLKIT_AVAILABILITY.shared,
        reason: 'PCB interaction shares one contract while Gerber geometry supplies native candidates.',
        documentation: ['docs/api.md', 'spec/library-scope.md']
    }),
    'scene3d.pcb.build': Object.freeze({
        disposition: 'shared',
        replacement: 'PcbScene3dBuilder.build()/PcbScene3dPreparator.prepare()',
        availability: TOOLKIT_AVAILABILITY.shared,
        reason: 'Bare-board scene data uses the common facade without inventing fabrication semantics.',
        documentation: ['docs/api.md', 'docs/model-format.md']
    }),
    'extension.gerber.sceneModels': Object.freeze({
        disposition: 'native-extension',
        replacement: 'gerber-toolkit/extensions#PcbScene3dModelRegistry',
        availability: TOOLKIT_AVAILABILITY.native,
        reason: 'The no-op fabrication model registry remains an explicit Gerber compatibility extension.',
        documentation: ['docs/api.md', 'spec/library-scope.md']
    })
})
const BEHAVIORS = [
    behavior(
        'parser preserves apertures, macros, blocks, polarity, attributes, and step-repeat',
        'parser.document.parse',
        'GerberParser'
    ),
    behavior(
        'parser preserves Excellon tools, drill hits, routes, and slots',
        'parser.document.parse',
        'GerberParser'
    ),
    behavior(
        'project loader expands synthetic ZIP fabrication packages',
        'project.archive.load',
        'GerberProjectLoader'
    ),
    behavior(
        'renderer preserves composite polarity and separated source layers',
        'renderer.pcb.render',
        'GerberPcbSvgRenderer'
    ),
    behavior(
        'interaction indexes mask, drill, route, and slot bounds',
        'interaction.pcb.hitTest',
        'PcbInteractionIndex'
    ),
    behavior(
        'scene builder emits a deterministic bare board without invented components',
        'scene3d.pcb.build',
        'PcbScene3dBuilder'
    )
]

/**
 * Creates one observable behavior feature.
 * @param {string} feature Stable behavior description.
 * @param {string} capabilityId Owning capability id.
 * @param {string} evidenceToken Public symbol used by tests.
 * @returns {Record<string, any>} Behavior feature.
 */
function behavior(feature, capabilityId, evidenceToken) {
    return {
        feature,
        kind: 'behavior',
        capabilityId,
        evidenceToken,
        sourceContract: { type: 'behavior', description: feature }
    }
}

/**
 * Captures the immutable historical API independently of the live worktree.
 * @param {{ write?: boolean, update?: boolean }} [options] Capture options.
 * @returns {Promise<{ baseline: Record<string, any>, ledger: Record<string, any>[] }>} Captured artifacts.
 */
export async function captureApiBaseline(options = {}) {
    return withHistoricalSnapshot(async (snapshotRoot) => {
        const pkg = await readJson('package.json', snapshotRoot)
        if (pkg.version !== BASELINE_VERSION) {
            throw new Error(
                `Historical Gerber API source must be version ${BASELINE_VERSION}.`
            )
        }
        const imported = []
        for (const [entrypoint, definition] of Object.entries(pkg.exports).sort(
            ([left], [right]) => left.localeCompare(right)
        )) {
            const target = exportTarget(definition)
            imported.push({
                entrypoint,
                target,
                api: await import(
                    `${new URL(target, snapshotRoot).href}?baseline=${PROVENANCE.sourceCommit}`
                )
            })
        }
        const contracts = GerberApiContractInspector.inspect(imported)
        const testSources = (
            await readTestSources(new URL('tests/', repositoryRoot))
        ).filter((testSource) => !META_TEST_PATHS.has(testSource.path))
        const features = [
            ...contracts.features.map((feature) => mapContract(feature)),
            ...BEHAVIORS
        ]
            .map((feature) => mapFeature(feature, testSources))
            .sort((left, right) => left.feature.localeCompare(right.feature))
        const body = {
            schema: 'gerber-toolkit.api-baseline.v1',
            package: pkg.name,
            packageVersion: pkg.version,
            provenance: { ...PROVENANCE },
            entrypoints: contracts.entrypoints,
            exports: contracts.entrypoints
                .find((entry) => entry.entrypoint === '.')
                .exports.map((entry) => entry.name),
            features
        }
        const baseline = {
            ...body,
            artifactChecksum: checksum(body)
        }
        const ledger = features.map((feature) => ledgerRow(pkg, feature))

        if (options.write !== false) {
            await writeImmutableJson(
                'spec/api-baseline-v0.1.21.json',
                baseline,
                options.update === true
            )
            await writeImmutableJson(
                'spec/feature-preservation.json',
                ledger,
                options.update === true
            )
        }
        return { baseline, ledger }
    })
}

/**
 * Adds capability and evidence policy to one source contract.
 * @param {Record<string, any>} contract Source contract.
 * @returns {Record<string, any>} Capability-mapped contract.
 */
function mapContract(contract) {
    return { ...contract, capabilityId: capabilityFor(contract.exportName) }
}

/**
 * Resolves the stable capability id for one public export.
 * @param {string} exportName Public export.
 * @returns {string} Capability id.
 */
function capabilityFor(exportName) {
    if (exportName === 'GerberProjectLoader') return 'project.archive.load'
    if (exportName === 'GerberCoordinateParser') {
        return 'extension.gerber.coordinate'
    }
    if (exportName === 'GerberLayerRoleResolver') {
        return 'extension.gerber.layer'
    }
    if (exportName === 'GerberPcbSvgRenderer') return 'renderer.pcb.render'
    if (exportName.startsWith('PcbInteraction')) {
        return 'interaction.pcb.hitTest'
    }
    if (exportName === 'PcbScene3dModelRegistry') {
        return 'extension.gerber.sceneModels'
    }
    if (exportName.startsWith('PcbScene3d')) return 'scene3d.pcb.build'
    return 'parser.document.parse'
}

/**
 * Adds an explicit preservation policy and evidence paths to one feature.
 * @param {Record<string, any>} feature Baseline feature.
 * @param {{ path: string, source: string }[]} testSources Test sources.
 * @returns {Record<string, any>} Complete mapped feature.
 */
function mapFeature(feature, testSources) {
    const policy = POLICIES[feature.capabilityId]
    if (!policy) {
        throw new Error(
            `Missing preservation policy for ${feature.capabilityId}.`
        )
    }
    const evidenceTokens = featureEvidenceTokens(feature)
    const tests = testSources
        .filter((testSource) =>
            evidenceTokens.every((token) => testSource.source.includes(token))
        )
        .map((testSource) => testSource.path)
    if (!tests.length) {
        throw new Error(
            `No historical repository test references ${evidenceTokens.join(' + ')} for ${feature.feature}.`
        )
    }
    return {
        ...feature,
        disposition: policy.disposition,
        replacement: policy.replacement,
        availability: { ...policy.availability },
        reason: policy.reason,
        evidenceToken: evidenceTokens.at(-1),
        evidenceTokens,
        tests,
        documentation: [...policy.documentation]
    }
}

/**
 * Selects feature-specific evidence tokens without using Task 1 tests.
 * @param {Record<string, any>} feature Captured feature.
 * @returns {string[]} Evidence tokens.
 */
function featureEvidenceTokens(feature) {
    if (feature.kind === 'behavior') return [feature.evidenceToken]
    const tokens = [feature.exportName]
    if (feature.methodName && feature.methodName !== 'constructor') {
        tokens.push(feature.methodName)
    }
    if (
        feature.sourceContract?.type === 'property' ||
        feature.sourceContract?.type === 'result-field'
    ) {
        tokens.push(String(feature.sourceContract.name).split('.').at(-1))
    }
    return [...new Set(tokens.filter(Boolean))]
}

/**
 * Creates one immutable ledger row from a mapped API feature.
 * @param {Record<string, any>} pkg Package metadata.
 * @param {Record<string, any>} feature Mapped baseline feature.
 * @returns {Record<string, any>} Ledger row.
 */
function ledgerRow(pkg, feature) {
    return {
        package: `${pkg.name}@${pkg.version}`,
        feature: feature.feature,
        kind: feature.kind,
        capabilityId: feature.capabilityId,
        disposition: feature.disposition,
        replacement: feature.replacement,
        availability: feature.availability,
        reason: feature.reason,
        evidenceToken: feature.evidenceToken,
        evidenceTokens: feature.evidenceTokens,
        sourceContract: feature.sourceContract,
        tests: feature.tests,
        documentation: feature.documentation
    }
}

/**
 * Recursively reads repository-owned test sources.
 * @param {URL} directory Test directory.
 * @param {string} [relativeDirectory] Repository-relative directory.
 * @returns {Promise<{ path: string, source: string }[]>} Test sources.
 */
async function readTestSources(directory, relativeDirectory = 'tests') {
    const sources = []
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = `${relativeDirectory}/${entry.name}`
        if (entry.isDirectory()) {
            sources.push(
                ...(await readTestSources(
                    new URL(`${entry.name}/`, directory),
                    path
                ))
            )
        } else if (entry.name.endsWith('.test.mjs')) {
            sources.push({
                path,
                source: await readFile(new URL(entry.name, directory), 'utf8')
            })
        }
    }
    return sources.sort((left, right) => left.path.localeCompare(right.path))
}

/**
 * Extracts the immutable source commit beneath this repository for one capture.
 * @template T
 * @param {(snapshotRoot: URL) => Promise<T>} operation Snapshot operation.
 * @returns {Promise<T>} Operation result.
 */
async function withHistoricalSnapshot(operation) {
    const snapshotPath = await mkdtemp(
        join(repositoryPath, '.gerber-api-baseline-')
    )
    const archivePath = join(snapshotPath, 'source.tar')
    try {
        await execFileAsync(
            'git',
            [
                'archive',
                '--format=tar',
                '--output',
                archivePath,
                PROVENANCE.sourceCommit
            ],
            { cwd: repositoryPath }
        )
        await execFileAsync('tar', ['-xf', archivePath, '-C', snapshotPath])
        await rm(archivePath)
        return await operation(pathToFileURL(snapshotPath + '/'))
    } finally {
        await rm(snapshotPath, { recursive: true, force: true })
    }
}

/**
 * Resolves one package export definition to an import target.
 * @param {string | Record<string, string>} definition Export definition.
 * @returns {string} Import target.
 */
function exportTarget(definition) {
    if (typeof definition === 'string') return definition
    const target = definition?.import || definition?.default
    if (typeof target !== 'string') {
        throw new Error('Package export does not define an import target.')
    }
    return target
}

/**
 * Reads repository JSON.
 * @param {string} path Repository-relative path.
 * @returns {Promise<any>} Parsed value.
 */
async function readJson(path, root = repositoryRoot) {
    return JSON.parse(await readFile(new URL(path, root), 'utf8'))
}

/**
 * Writes a stable JSON artifact once and rejects later drift.
 * @param {string} path Repository-relative path.
 * @param {unknown} value JSON value.
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
 * Computes one deterministic SHA-256 checksum.
 * @param {unknown} value JSON-shaped value.
 * @returns {string} Hex checksum.
 */
function checksum(value) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex')
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
