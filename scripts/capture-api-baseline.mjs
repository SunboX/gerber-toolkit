import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

import { format } from 'prettier'

const repositoryRoot = new URL('../', import.meta.url)
const BASELINE_VERSION = '0.1.21'
const PROVENANCE = Object.freeze({
    sourceCommit: '11ba9df32ce966d6626f99f444909ff6c50d2281',
    sourceTree: '1b7813598247b9ec3907a9589aefe084e4a448bd'
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
    return { feature, kind: 'behavior', capabilityId, evidenceToken }
}

/**
 * Captures and writes immutable API and feature-preservation baselines.
 * @returns {Promise<{ baseline: Record<string, any>, ledger: Record<string, any>[] }>} Captured artifacts.
 */
export async function captureApiBaseline() {
    const pkg = await readJson('package.json')
    if (pkg.version !== BASELINE_VERSION) {
        throw new Error(
            `Gerber API baseline capture requires version ${BASELINE_VERSION}.`
        )
    }

    const entrypoints = []
    const contractFeatures = []
    for (const [entrypoint, definition] of Object.entries(pkg.exports).sort(
        ([left], [right]) => left.localeCompare(right)
    )) {
        const captured = await captureEntrypoint(entrypoint, definition)
        entrypoints.push(captured.entrypoint)
        contractFeatures.push(...captured.features)
    }

    const testSources = await readTestSources(new URL('tests/', repositoryRoot))
    const features = [...contractFeatures, ...BEHAVIORS]
        .map((feature) => mapFeature(feature, testSources))
        .sort((left, right) => left.feature.localeCompare(right.feature))
    const body = {
        schema: 'gerber-toolkit.api-baseline.v1',
        package: pkg.name,
        packageVersion: pkg.version,
        provenance: { ...PROVENANCE },
        entrypoints,
        exports: entrypoints
            .find((entry) => entry.entrypoint === '.')
            .exports.map((entry) => entry.name),
        features
    }
    const baseline = {
        ...body,
        artifactChecksum: checksum(body)
    }
    const ledger = features.map((feature) => ledgerRow(pkg, feature))

    await writeImmutableJson('spec/api-baseline-v0.1.21.json', baseline)
    await writeImmutableJson('spec/feature-preservation.json', ledger)
    return { baseline, ledger }
}

/**
 * Captures one package entrypoint and its public contracts.
 * @param {string} entrypoint Package export key.
 * @param {string | Record<string, string>} definition Export definition.
 * @returns {Promise<{ entrypoint: Record<string, any>, features: Record<string, any>[] }>} Captured entrypoint.
 */
async function captureEntrypoint(entrypoint, definition) {
    const target = exportTarget(definition)
    const api = await import(new URL(target, repositoryRoot))
    const exports = []
    const features = []
    for (const exportName of Object.keys(api).sort()) {
        const value = api[exportName]
        const methods = publicMembers(value)
        exports.push({ name: exportName, type: typeof value, ...methods })
        features.push(
            mapContract({
                feature: `${entrypoint}#${exportName}`,
                kind: 'export',
                entrypoint,
                exportName,
                sourceContract: { type: 'export', valueType: typeof value }
            })
        )
        features.push(
            ...callableFeatures(entrypoint, exportName, value, methods)
        )
    }
    return {
        entrypoint: { entrypoint, target, exports },
        features
    }
}

/**
 * Lists callable and accessor members without invoking them.
 * @param {unknown} value Exported value.
 * @returns {{ staticMethods: string[], instanceMethods: string[], instanceAccessors: string[] }} Public member names.
 */
function publicMembers(value) {
    if (typeof value !== 'function') {
        return { staticMethods: [], instanceMethods: [], instanceAccessors: [] }
    }
    const staticMethods = Object.getOwnPropertyNames(value)
        .filter((name) => {
            const descriptor = Object.getOwnPropertyDescriptor(value, name)
            return (
                !['length', 'name', 'prototype'].includes(name) &&
                typeof descriptor?.value === 'function'
            )
        })
        .sort()
    const prototypeDescriptors = value.prototype
        ? Object.getOwnPropertyDescriptors(value.prototype)
        : {}
    const instanceMethods = Object.entries(prototypeDescriptors)
        .filter(
            ([name, descriptor]) =>
                name !== 'constructor' && typeof descriptor.value === 'function'
        )
        .map(([name]) => name)
        .sort()
    const instanceAccessors = Object.entries(prototypeDescriptors)
        .filter(
            ([name, descriptor]) =>
                name !== 'constructor' &&
                (typeof descriptor.get === 'function' ||
                    typeof descriptor.set === 'function')
        )
        .map(([name]) => name)
        .sort()
    return { staticMethods, instanceMethods, instanceAccessors }
}

/**
 * Captures callable and accessor features from one exported class.
 * @param {string} entrypoint Package entrypoint.
 * @param {string} exportName Exported class name.
 * @param {unknown} value Exported value.
 * @param {{ staticMethods: string[], instanceMethods: string[], instanceAccessors: string[] }} members Public members.
 * @returns {Record<string, any>[]} Public contract features.
 */
function callableFeatures(entrypoint, exportName, value, members) {
    if (typeof value !== 'function') return []
    const features = []
    const classSource = Function.prototype.toString.call(value)
    const constructorSource = extractConstructor(classSource)
    if (constructorSource) {
        features.push(
            ...methodFeatures({
                entrypoint,
                exportName,
                methodName: 'constructor',
                methodType: 'constructor',
                source: constructorSource,
                jsdoc: jsdocBefore(
                    classSource,
                    classSource.indexOf(constructorSource)
                )
            })
        )
    }
    for (const methodName of members.staticMethods) {
        const source = Function.prototype.toString.call(value[methodName])
        features.push(
            ...methodFeatures({
                entrypoint,
                exportName,
                methodName,
                methodType: 'static',
                source,
                jsdoc: jsdocBefore(classSource, classSource.indexOf(source))
            })
        )
    }
    for (const methodName of members.instanceMethods) {
        const source = Function.prototype.toString.call(
            value.prototype[methodName]
        )
        features.push(
            ...methodFeatures({
                entrypoint,
                exportName,
                methodName,
                methodType: 'instance',
                source,
                jsdoc: jsdocBefore(classSource, classSource.indexOf(source))
            })
        )
    }
    for (const name of members.instanceAccessors) {
        features.push(
            mapContract({
                feature: `${entrypoint}#${exportName}.prototype.${name}`,
                kind: 'field',
                entrypoint,
                exportName,
                methodName: name,
                methodType: 'instance-accessor',
                sourceContract: { type: 'accessor', name }
            })
        )
    }
    return features
}

/**
 * Captures one method plus arguments, option properties, and result fields.
 * @param {Record<string, any>} method Method metadata.
 * @returns {Record<string, any>[]} Method contract features.
 */
function methodFeatures(method) {
    const parameters = parseParameters(method.source)
    const owner =
        method.methodType === 'instance'
            ? `${method.exportName}.prototype`
            : method.exportName
    const methodId = `${method.entrypoint}#${owner}.${method.methodName}()`
    const common = {
        entrypoint: method.entrypoint,
        exportName: method.exportName,
        methodName: method.methodName,
        methodType: method.methodType
    }
    const features = [
        mapContract({
            ...common,
            feature: methodId,
            kind: 'method',
            sourceContract: {
                type: 'method',
                signature: `(${parameters.map((entry) => entry.source).join(', ')})`,
                parameters
            }
        })
    ]
    for (const parameter of parameters) {
        features.push(
            mapContract({
                ...common,
                feature: `${methodId}.argument.${parameter.name}`,
                kind: 'option',
                sourceContract: { type: 'argument', ...parameter }
            })
        )
        for (const property of parameterProperties(
            method.source,
            method.jsdoc,
            parameter.name
        )) {
            features.push(
                mapContract({
                    ...common,
                    feature: `${methodId}.argument.${parameter.name}.property.${property}`,
                    kind: 'option',
                    sourceContract: {
                        type: 'property',
                        argument: parameter.name,
                        name: property
                    }
                })
            )
        }
    }
    for (const field of resultFields(method.source, method.jsdoc)) {
        features.push(
            mapContract({
                ...common,
                feature: `${methodId}.result.${field}`,
                kind: 'field',
                sourceContract: { type: 'result-field', name: field }
            })
        )
    }
    return features
}

/**
 * Parses one callable's parameter list.
 * @param {string} source Callable source.
 * @returns {Record<string, any>[]} Parameter records.
 */
function parseParameters(source) {
    const open = source.indexOf('(')
    if (open < 0) return []
    const close = matchingDelimiter(source, open, '(', ')')
    return splitTopLevel(source.slice(open + 1, close)).map(
        (parameter, index) => {
            const equals = topLevelIndex(parameter, '=')
            const binding = (
                equals < 0 ? parameter : parameter.slice(0, equals)
            )
                .trim()
                .replace(/^\.\.\./u, '')
            return {
                index,
                name: /^[A-Za-z_$][\w$]*$/u.test(binding)
                    ? binding
                    : `argument${index}`,
                source: parameter.trim(),
                hasDefault: equals >= 0,
                defaultSource:
                    equals < 0 ? null : parameter.slice(equals + 1).trim()
            }
        }
    )
}

/**
 * Finds source-read and JSDoc-declared fields for one parameter.
 * @param {string} source Callable source.
 * @param {string} jsdoc Callable JSDoc.
 * @param {string} parameter Parameter name.
 * @returns {string[]} Sorted property names.
 */
function parameterProperties(source, jsdoc, parameter) {
    const fields = new Set()
    const escaped = parameter.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    const direct = new RegExp(
        `\\b${escaped}\\s*(?:\\?\\.\\s*|\\.\\s*)([A-Za-z_$][\\w$]*)`,
        'gu'
    )
    for (const match of source.matchAll(direct)) fields.add(match[1])
    for (const field of jsdocParameterFields(jsdoc, parameter))
        fields.add(field)
    return [...fields].sort()
}

/**
 * Finds top-level result fields from source and JSDoc.
 * @param {string} source Callable source.
 * @param {string} jsdoc Callable JSDoc.
 * @returns {string[]} Sorted field names.
 */
function resultFields(source, jsdoc) {
    const fields = new Set(jsdocReturnFields(jsdoc))
    for (const match of source.matchAll(/\breturn\s*\{/gu)) {
        const open = source.indexOf('{', match.index)
        const close = matchingDelimiter(source, open, '{', '}')
        for (const field of objectFields(source.slice(open + 1, close))) {
            fields.add(field)
        }
    }
    return [...fields].sort()
}

/**
 * Extracts object fields from a method parameter JSDoc type.
 * @param {string} jsdoc Method JSDoc.
 * @param {string} parameter Parameter name.
 * @returns {string[]} Declared property names.
 */
function jsdocParameterFields(jsdoc, parameter) {
    const fields = []
    for (const match of jsdoc.matchAll(/@param\s+\{/gu)) {
        const open = match.index + match[0].lastIndexOf('{')
        const close = matchingDelimiter(jsdoc, open, '{', '}')
        const suffix = jsdoc.slice(close + 1).match(/^\s+(\[[^\]]+\]|[^\s*]+)/u)
        const name = String(suffix?.[1] || '')
            .replace(/^\[/u, '')
            .replace(/\]$/u, '')
            .split('=')[0]
        if (name !== parameter) continue
        fields.push(...typeObjectFields(jsdoc.slice(open + 1, close)))
    }
    return fields
}

/**
 * Extracts top-level object fields from a return JSDoc type.
 * @param {string} jsdoc Method JSDoc.
 * @returns {string[]} Return field names.
 */
function jsdocReturnFields(jsdoc) {
    const match = /@returns?\s+\{/u.exec(jsdoc)
    if (!match) return []
    const open = match.index + match[0].lastIndexOf('{')
    const close = matchingDelimiter(jsdoc, open, '{', '}')
    return typeObjectFields(jsdoc.slice(open + 1, close))
}

/**
 * Extracts the first nested object type's fields.
 * @param {string} source JSDoc type body.
 * @returns {string[]} Field names.
 */
function typeObjectFields(source) {
    const open = source.indexOf('{')
    if (open < 0) return []
    const close = matchingDelimiter(source, open, '{', '}')
    return objectFields(source.slice(open + 1, close))
}

/**
 * Extracts simple top-level object keys.
 * @param {string} source Object body.
 * @returns {string[]} Field names.
 */
function objectFields(source) {
    return splitTopLevel(source)
        .map(
            (part) =>
                part.trim().match(/^([A-Za-z_$][\w$]*)\??\s*(?::|,|$)/u)?.[1]
        )
        .filter(Boolean)
}

/**
 * Extracts an explicitly declared constructor from class source.
 * @param {string} classSource Class source.
 * @returns {string} Constructor source or empty string.
 */
function extractConstructor(classSource) {
    const match = /(?:^|\n)\s*constructor\s*\(/u.exec(classSource)
    if (!match) return ''
    const start = classSource.indexOf('constructor', match.index)
    const openParameters = classSource.indexOf('(', start)
    const closeParameters = matchingDelimiter(
        classSource,
        openParameters,
        '(',
        ')'
    )
    const openBody = classSource.indexOf('{', closeParameters)
    const closeBody = matchingDelimiter(classSource, openBody, '{', '}')
    return classSource.slice(start, closeBody + 1)
}

/**
 * Returns the nearest JSDoc block preceding one class member.
 * @param {string} classSource Class source.
 * @param {number} memberIndex Member source index.
 * @returns {string} JSDoc source.
 */
function jsdocBefore(classSource, memberIndex) {
    if (memberIndex < 0) return ''
    const end = classSource.lastIndexOf('*/', memberIndex)
    const start = classSource.lastIndexOf('/**', end)
    return start < 0 || end < 0 ? '' : classSource.slice(start, end + 2)
}

/**
 * Splits a comma-delimited expression at top level.
 * @param {string} source Expression source.
 * @returns {string[]} Top-level parts.
 */
function splitTopLevel(source) {
    const parts = []
    let start = 0
    let depth = 0
    let quote = ''
    for (let index = 0; index < source.length; index += 1) {
        const character = source[index]
        if (quote) {
            if (character === quote && source[index - 1] !== '\\') quote = ''
            continue
        }
        if (["'", '"', '`'].includes(character)) {
            quote = character
        } else if ('([{'.includes(character)) {
            depth += 1
        } else if (')]}'.includes(character)) {
            depth -= 1
        } else if (character === ',' && depth === 0) {
            parts.push(source.slice(start, index))
            start = index + 1
        }
    }
    const final = source.slice(start).trim()
    if (final) parts.push(final)
    return parts
}

/**
 * Finds a character at top-level nesting depth.
 * @param {string} source Expression source.
 * @param {string} target Target character.
 * @returns {number} Character index or -1.
 */
function topLevelIndex(source, target) {
    let depth = 0
    for (let index = 0; index < source.length; index += 1) {
        if ('([{'.includes(source[index])) depth += 1
        else if (')]}'.includes(source[index])) depth -= 1
        else if (source[index] === target && depth === 0) return index
    }
    return -1
}

/**
 * Finds the matching delimiter while respecting nested delimiters.
 * @param {string} source Source text.
 * @param {number} openIndex Opening delimiter index.
 * @param {string} open Opening delimiter.
 * @param {string} close Closing delimiter.
 * @returns {number} Closing delimiter index.
 */
function matchingDelimiter(source, openIndex, open, close) {
    let depth = 0
    let quote = ''
    for (let index = openIndex; index < source.length; index += 1) {
        const character = source[index]
        if (quote) {
            if (character === quote && source[index - 1] !== '\\') quote = ''
            continue
        }
        if (["'", '"', '`'].includes(character)) {
            quote = character
        } else if (character === open) {
            depth += 1
        } else if (character === close) {
            depth -= 1
            if (depth === 0) return index
        }
    }
    return source.length - 1
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
    const evidenceToken = feature.evidenceToken || feature.exportName
    const tests = testSources
        .filter((testSource) => testSource.source.includes(evidenceToken))
        .map((testSource) => testSource.path)
    if (!tests.length) {
        throw new Error(`No repository test references ${evidenceToken}.`)
    }
    return {
        ...feature,
        disposition: policy.disposition,
        replacement: policy.replacement,
        availability: { ...policy.availability },
        reason: policy.reason,
        evidenceToken,
        tests,
        documentation: [...policy.documentation]
    }
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
async function readJson(path) {
    return JSON.parse(await readFile(new URL(path, repositoryRoot), 'utf8'))
}

/**
 * Writes a stable JSON artifact once and rejects later drift.
 * @param {string} path Repository-relative path.
 * @param {unknown} value JSON value.
 * @returns {Promise<void>}
 */
async function writeImmutableJson(path, value) {
    const target = new URL(path, repositoryRoot)
    const content = await format(JSON.stringify(value, null, 4), {
        parser: 'json',
        tabWidth: 4,
        trailingComma: 'none'
    })
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
    await captureApiBaseline()
}
