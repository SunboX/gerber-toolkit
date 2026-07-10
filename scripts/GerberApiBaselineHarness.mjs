import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { GerberApiContractInspector } from './GerberApiContractInspector.mjs'

const META_TEST_PATHS = new Set([
    'tests/convergence-baselines.test.mjs',
    'tests/feature-preservation-check.test.mjs'
])
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
 * Captures API and evidence artifacts from already extracted immutable roots.
 */
export class GerberApiBaselineHarness {
    /**
     * Captures one historical package using pinned source and evidence roots.
     * @param {{ sourceRoot: URL, evidenceRoot: URL, provenance: Record<string, string>, baselineVersion: string }} options Capture inputs.
     * @returns {Promise<{ baseline: Record<string, any>, ledger: Record<string, any>[] }>} Captured artifacts.
     */
    static async capture(options) {
        const pkg = await readJson('package.json', options.sourceRoot)
        if (pkg.version !== options.baselineVersion) {
            throw new Error(
                `Historical Gerber API source must be version ${options.baselineVersion}.`
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
                    `${new URL(target, options.sourceRoot).href}?baseline=${options.provenance.sourceCommit}`
                )
            })
        }
        const contracts = await GerberApiContractInspector.inspect(imported, {
            sourceRoot: fileURLToPath(options.sourceRoot)
        })
        const testSources = (
            await readTestSources(new URL('tests/', options.evidenceRoot))
        ).filter((testSource) => !META_TEST_PATHS.has(testSource.path))
        const features = [
            ...contracts.features.map((feature) => mapContract(feature)),
            ...BEHAVIORS
        ]
            .map((feature) => mapFeature(feature, testSources))
            .filter(Boolean)
            .sort((left, right) => left.feature.localeCompare(right.feature))
        const body = {
            schema: 'gerber-toolkit.api-baseline.v1',
            package: pkg.name,
            packageVersion: pkg.version,
            provenance: { ...options.provenance },
            entrypoints: contracts.entrypoints,
            exports: contracts.entrypoints
                .find((entry) => entry.entrypoint === '.')
                .exports.map((entry) => entry.name),
            features
        }
        const baseline = { ...body, artifactChecksum: checksum(body) }
        return {
            baseline,
            ledger: features.map((feature) => ledgerRow(pkg, feature))
        }
    }
}

/**
 * Adds a capability id to one source contract.
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
 * Adds preservation policy and pinned evidence paths to one feature.
 * @param {Record<string, any>} feature Baseline feature.
 * @param {{ path: string, source: string }[]} testSources Pinned tests.
 * @returns {Record<string, any> | null} Complete mapped feature or an untested inferred result.
 */
function mapFeature(feature, testSources) {
    const policy = POLICIES[feature.capabilityId]
    if (!policy) {
        throw new Error(
            `Missing preservation policy for ${feature.capabilityId}.`
        )
    }
    let evidenceTokens = []
    let tests = []
    for (const candidateTokens of featureEvidenceTokenSets(feature)) {
        const candidateTests = testSources
            .filter((testSource) =>
                candidateTokens.every((token) =>
                    testSource.source.includes(token)
                )
            )
            .map((testSource) => testSource.path)
        if (!candidateTests.length) continue
        evidenceTokens = candidateTokens
        tests = candidateTests
        break
    }
    if (!tests.length) {
        if (feature.sourceContract?.type === 'result-field') return null
        throw new Error(
            `No historical repository test references ${featureEvidenceTokens(feature).join(' + ')} for ${feature.feature}.`
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
 * Builds precise and result-shape fallback evidence token sets.
 * @param {Record<string, any>} feature Captured feature.
 * @returns {string[][]} Ordered evidence token candidates.
 */
function featureEvidenceTokenSets(feature) {
    const precise = featureEvidenceTokens(feature)
    if (feature.sourceContract?.type !== 'result-field') return [precise]
    const fallback = [
        feature.exportName,
        String(feature.sourceContract.name).split('.').at(-1)
    ].filter(Boolean)
    return [precise, [...new Set(fallback)]]
}

/**
 * Selects feature-specific evidence tokens.
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
        feature.sourceContract?.type === 'result-field' ||
        feature.sourceContract?.type === 'instance-field' ||
        feature.sourceContract?.type === 'accessor'
    ) {
        tokens.push(String(feature.sourceContract.name).split('.').at(-1))
    }
    return [...new Set(tokens.filter(Boolean))]
}

/**
 * Creates one immutable ledger row.
 * @param {Record<string, any>} pkg Package metadata.
 * @param {Record<string, any>} feature Mapped feature.
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
 * Recursively reads pinned test sources.
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
 * Reads repository JSON below one immutable root.
 * @param {string} path Repository-relative path.
 * @param {URL} root Immutable repository root.
 * @returns {Promise<any>} Parsed JSON.
 */
async function readJson(path, root) {
    return JSON.parse(await readFile(new URL(path, root), 'utf8'))
}

/**
 * Computes one deterministic SHA-256 checksum.
 * @param {unknown} value JSON-shaped value.
 * @returns {string} Hex checksum.
 */
function checksum(value) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
