import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { GerberApiContractInspector } from './GerberApiContractInspector.mjs'
import { GerberBehaviorEvidence } from './GerberBehaviorEvidence.mjs'
import { GerberFeatureEvidence } from './GerberFeatureEvidence.mjs'

const META_TEST_PATHS = new Set([
    'tests/api-result-contract-artifacts.test.mjs',
    'tests/api-result-contract-resolver.test.mjs',
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
        'GerberParser',
        'parser-gerber-structures-v1'
    ),
    behavior(
        'parser preserves Excellon tools, drill hits, routes, and slots',
        'parser.document.parse',
        'GerberParser',
        'parser-excellon-routes-v1'
    ),
    behavior(
        'project loader expands synthetic ZIP fabrication packages',
        'project.archive.load',
        'GerberProjectLoader',
        'project-zip-expansion-v1'
    ),
    behavior(
        'renderer preserves composite polarity and separated source layers',
        'renderer.pcb.render',
        'GerberPcbSvgRenderer',
        'renderer-composite-separated-v1'
    ),
    behavior(
        'interaction indexes mask, drill, route, and slot bounds',
        'interaction.pcb.hitTest',
        'PcbInteractionIndex',
        'interaction-mask-drill-route-v1'
    ),
    behavior(
        'scene builder emits a deterministic bare board without invented components',
        'scene3d.pcb.build',
        'PcbScene3dBuilder',
        'scene-bare-board-v1'
    )
]

/**
 * Creates one observable behavior feature.
 * @param {string} feature Stable behavior description.
 * @param {string} capabilityId Owning capability id.
 * @param {string} evidenceToken Public symbol used by tests.
 * @param {string} behaviorMatcher Stable behavior matcher id.
 * @returns {Record<string, any>} Behavior feature.
 */
function behavior(feature, capabilityId, evidenceToken, behaviorMatcher) {
    return {
        feature,
        kind: 'behavior',
        capabilityId,
        evidenceToken,
        requiredExport: evidenceToken,
        behaviorMatcher,
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
        ).filter((testSource) => !isMetaTestSource(testSource))
        const features = [
            ...contracts.features.map((feature) => mapContract(feature)),
            ...availableBehaviors(contracts.entrypoints)
        ]
            .map((feature) => mapFeature(feature, testSources))
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
 * Selects behaviors whose owning public export exists in the captured package.
 * @param {Record<string, any>[]} entrypoints Captured entrypoints.
 * @returns {Record<string, any>[]} Applicable behavior contracts.
 */
function availableBehaviors(entrypoints) {
    const exports = new Set(
        entrypoints.flatMap((entrypoint) =>
            (entrypoint.exports || []).map((entry) => entry.name)
        )
    )
    return BEHAVIORS.filter((feature) => exports.has(feature.requiredExport))
}

/**
 * Identifies capture, verifier, artifact, and benchmark tests that describe the
 * baseline machinery rather than historical public package behavior.
 * @param {{ path: string, source: string }} testSource Candidate test source.
 * @returns {boolean} Whether the source must be excluded from API evidence.
 */
function isMetaTestSource(testSource) {
    if (META_TEST_PATHS.has(testSource.path)) return true
    if (/(?:^|\/)baseline[^/]*\.test\.mjs$/u.test(testSource.path)) return true
    return (
        /(?:from\s+|import\s*\()\s*['"]\.\.\/scripts\//u.test(
            testSource.source
        ) ||
        /(?:spec\/(?:api-baseline|feature-preservation)|benchmarks\/baseline-)/u.test(
            testSource.source
        )
    )
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
 * @returns {Record<string, any>} Complete mapped feature.
 */
function mapFeature(feature, testSources) {
    const policy = POLICIES[feature.capabilityId]
    if (!policy) {
        throw new Error(
            `Missing preservation policy for ${feature.capabilityId}.`
        )
    }
    if (feature.kind === 'behavior') {
        return mapBehaviorFeature(feature, policy, testSources)
    }
    let evidenceTokens = []
    let tests = []
    for (const candidateTokens of featureEvidenceTokenSets(feature)) {
        const candidateSources = [
            ...new Map(
                testSources
                    .filter(
                        (testSource) =>
                            GerberFeatureEvidence.tokensMatch(
                                candidateTokens,
                                testSource.source
                            ) ||
                            GerberFeatureEvidence.invocationMatches(
                                feature,
                                testSource.source
                            )
                    )
                    .map((testSource) => [testSource.path, testSource])
            ).values()
        ]
        if (
            !GerberFeatureEvidence.matchesAcross(
                feature,
                candidateTokens,
                candidateSources.map((testSource) => testSource.source)
            )
        ) {
            continue
        }
        evidenceTokens = candidateTokens
        tests = candidateSources.map((testSource) => testSource.path)
        break
    }
    if (!tests.length) {
        if (feature.sourceContract?.type === 'result-field') {
            return mappedFeature(feature, policy, [], [], null)
        }
        throw new Error(
            `No historical repository test references ${featureEvidenceTokens(feature).join(' + ')} for ${feature.feature}.`
        )
    }
    return mappedFeature(feature, policy, evidenceTokens, tests, {
        kind:
            feature.sourceContract?.type === 'result-field'
                ? 'result-path'
                : 'token-reference'
    })
}

/**
 * Maps one behavior only when its stable matcher is fully satisfied.
 * @param {Record<string, any>} feature Behavior feature.
 * @param {Record<string, any>} policy Preservation policy.
 * @param {{ path: string, source: string }[]} testSources Pinned tests.
 * @returns {Record<string, any>} Mapped behavior.
 */
function mapBehaviorFeature(feature, policy, testSources) {
    const sources = testSources.filter((testSource) =>
        GerberBehaviorEvidence.relevant(
            feature.behaviorMatcher,
            testSource.source
        )
    )
    if (
        !GerberBehaviorEvidence.matches(
            feature.behaviorMatcher,
            sources.map((source) => source.source)
        )
    ) {
        throw new Error(
            `No behavior-specific historical evidence satisfies ${feature.behaviorMatcher} for ${feature.feature}.`
        )
    }
    return mappedFeature(
        feature,
        policy,
        [feature.evidenceToken],
        sources.map((source) => source.path),
        {
            kind: 'behavior-matcher',
            matcher: feature.behaviorMatcher,
            contract: GerberBehaviorEvidence.contract(feature.behaviorMatcher)
        }
    )
}

/**
 * Adds preservation and separated source/usage evidence metadata.
 * @param {Record<string, any>} feature Captured feature.
 * @param {Record<string, any>} policy Preservation policy.
 * @param {string[]} evidenceTokens Usage-evidence tokens.
 * @param {string[]} tests Usage-evidence test paths.
 * @param {Record<string, any> | null} usage Usage-evidence descriptor.
 * @returns {Record<string, any>} Complete mapped feature.
 */
function mappedFeature(feature, policy, evidenceTokens, tests, usage) {
    const {
        behaviorMatcher: ignoredMatcher,
        requiredExport: ignoredExport,
        ...captured
    } = feature
    void ignoredMatcher
    void ignoredExport
    return {
        ...captured,
        disposition: policy.disposition,
        replacement: policy.replacement,
        availability: { ...policy.availability },
        reason: policy.reason,
        evidence: {
            source: { kind: 'source-contract' },
            usage
        },
        evidenceToken: evidenceTokens.at(-1) || null,
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
        evidence: feature.evidence,
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
