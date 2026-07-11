import { GerberApiResultContractResolver } from './GerberApiResultContractResolver.mjs'
import { GerberApiSupportingClassLoader } from './GerberApiSupportingClassLoader.mjs'
import { GerberSourceCallable } from './GerberSourceCallable.mjs'
import { GerberSourceExpression } from './GerberSourceExpression.mjs'
import { GerberReachableCalls } from './GerberReachableCalls.mjs'
import { GerberPublicApiSurface } from './GerberPublicApiSurface.mjs'

/**
 * Captures stable public API contracts without invoking exported callables.
 */
export class GerberApiContractInspector {
    /**
     * Inspects exported entrypoints and resolves direct delegation contracts.
     * @param {{ entrypoint: string, target: string, api: Record<string, any> }[]} entrypointApis Imported entrypoints.
     * @param {{ sourceRoot?: string }} [options] Source inspection options.
     * @returns {Promise<{ entrypoints: Record<string, any>[], features: Record<string, any>[] }>} Captured contracts.
     */
    static async inspect(entrypointApis, options = {}) {
        const supportingClasses = await GerberApiSupportingClassLoader.load(
            entrypointApis,
            options.sourceRoot
        )
        const definitions = GerberApiContractInspector.#definitions(
            entrypointApis,
            supportingClasses
        )
        GerberApiResultContractResolver.resolve(definitions.nodesByKey)
        GerberApiContractInspector.#resolveDelegates(definitions.nodesByKey)
        const entrypoints = []
        const features = []

        for (const entry of definitions.entries) {
            const exports = []
            for (const exported of entry.exports) {
                exports.push({
                    name: exported.name,
                    type: typeof exported.value,
                    ...exported.members
                })
                features.push(
                    GerberApiContractInspector.#exportFeature(
                        entry.entrypoint,
                        exported
                    )
                )
                features.push(
                    ...GerberApiContractInspector.#callableFeatures(
                        entry.entrypoint,
                        exported,
                        definitions.nodesByKey
                    )
                )
            }
            entrypoints.push({
                entrypoint: entry.entrypoint,
                target: entry.target,
                exports
            })
        }

        return {
            entrypoints,
            features: features.sort((left, right) =>
                left.feature.localeCompare(right.feature)
            )
        }
    }

    /**
     * Creates entrypoint/export records plus unique callable graph nodes.
     * @param {{ entrypoint: string, target: string, api: Record<string, any> }[]} entrypointApis Imported entrypoints.
     * @param {Map<string, Function>} supportingClasses Supporting classes.
     * @returns {{ entries: Record<string, any>[], nodesByKey: Map<string, Record<string, any>> }} Definitions.
     */
    static #definitions(entrypointApis, supportingClasses) {
        const entries = []
        const nodesByKey = new Map()
        const aliases =
            GerberApiContractInspector.#exportAliases(entrypointApis)
        for (const entrypointApi of entrypointApis) {
            const exports = Object.keys(entrypointApi.api)
                .sort()
                .map((name) => {
                    const value = entrypointApi.api[name]
                    const members = GerberPublicApiSurface.describe(value)
                    GerberApiContractInspector.#defineCallableNodes(
                        entrypointApi.entrypoint,
                        name,
                        value,
                        members,
                        nodesByKey
                    )
                    return {
                        name,
                        value,
                        members,
                        aliases: aliases.get(value) || [
                            `${entrypointApi.entrypoint}#${name}`
                        ]
                    }
                })
            entries.push({
                entrypoint: entrypointApi.entrypoint,
                target: entrypointApi.target,
                exports
            })
        }
        for (const [name, value] of supportingClasses) {
            GerberApiContractInspector.#defineCallableNodes(
                '*',
                name,
                value,
                GerberPublicApiSurface.describe(value),
                nodesByKey
            )
        }
        return { entries, nodesByKey }
    }

    /**
     * Catalogs exact export identity across package entrypoints.
     * @param {{ entrypoint: string, api: Record<string, any> }[]} entrypointApis Imported entrypoints.
     * @returns {Map<unknown, string[]>} Stable aliases by exact export value.
     */
    static #exportAliases(entrypointApis) {
        const aliases = new Map()
        for (const entrypointApi of entrypointApis) {
            for (const name of Object.keys(entrypointApi.api).sort()) {
                const value = entrypointApi.api[name]
                const entries = aliases.get(value) || []
                entries.push(`${entrypointApi.entrypoint}#${name}`)
                aliases.set(value, entries)
            }
        }
        for (const entries of aliases.values()) entries.sort()
        return aliases
    }

    /**
     * Adds unique callable nodes for one exported class or function.
     * @param {string} entrypoint Package entrypoint.
     * @param {string} exportName Export name.
     * @param {unknown} value Exported value.
     * @param {{ staticMethods: string[], instanceMethods: string[], instanceAccessors: string[], instanceFields: string[] }} members Members.
     * @param {Map<string, Record<string, any>>} nodesByKey Callable nodes.
     * @returns {void}
     */
    static #defineCallableNodes(
        entrypoint,
        exportName,
        value,
        members,
        nodesByKey
    ) {
        if (typeof value !== 'function') return
        const classSource = Function.prototype.toString.call(value)
        const constructorSource =
            GerberApiContractInspector.#extractConstructor(classSource)
        if (constructorSource) {
            GerberApiContractInspector.#addNode(
                entrypoint,
                exportName,
                'constructor',
                'constructor',
                constructorSource,
                GerberApiContractInspector.#jsdocBefore(
                    classSource,
                    classSource.indexOf(constructorSource)
                ),
                nodesByKey
            )
        }
        for (const methodName of members.staticMethods) {
            const callable = GerberPublicApiSurface.descriptor(
                value,
                'static',
                methodName
            )?.value
            const source = Function.prototype.toString.call(callable)
            GerberApiContractInspector.#addNode(
                entrypoint,
                exportName,
                methodName,
                'static',
                source,
                GerberApiContractInspector.#jsdocBefore(
                    classSource,
                    classSource.indexOf(source)
                ),
                nodesByKey
            )
        }
        for (const methodName of members.instanceMethods) {
            const callable = GerberPublicApiSurface.descriptor(
                value,
                'instance',
                methodName
            )?.value
            const source = Function.prototype.toString.call(callable)
            GerberApiContractInspector.#addNode(
                entrypoint,
                exportName,
                methodName,
                'instance',
                source,
                GerberApiContractInspector.#jsdocBefore(
                    classSource,
                    classSource.indexOf(source)
                ),
                nodesByKey
            )
        }
        for (const method of GerberApiContractInspector.#privateStaticMethods(
            classSource
        )) {
            GerberApiContractInspector.#addNode(
                entrypoint,
                exportName,
                method.name,
                'static-private',
                method.source,
                GerberApiContractInspector.#jsdocBefore(
                    classSource,
                    method.index
                ),
                nodesByKey
            )
        }
    }

    /**
     * Adds one normalized callable graph node.
     * @param {string} entrypoint Package entrypoint.
     * @param {string} exportName Export name.
     * @param {string} methodName Method name.
     * @param {string} methodType Method type.
     * @param {string} source Callable source.
     * @param {string} jsdoc Callable JSDoc.
     * @param {Map<string, Record<string, any>>} nodesByKey Callable nodes.
     * @returns {void}
     */
    static #addNode(
        entrypoint,
        exportName,
        methodName,
        methodType,
        source,
        jsdoc,
        nodesByKey
    ) {
        const key = GerberApiContractInspector.#nodeKey(
            entrypoint,
            exportName,
            methodName,
            methodType
        )
        if (nodesByKey.has(key)) return
        const native = /\{\s*\[native code\]\s*\}/u.test(source)
        const parameters = GerberApiContractInspector.#parseParameters(source)
        const analysisSource = native
            ? `${methodName}(${parameters.map((parameter) => parameter.source).join(', ')}) {}`
            : source
        const semantics = native
            ? { async: false, generator: false, resultKind: 'native' }
            : GerberPublicApiSurface.callableSemantics(source)
        nodesByKey.set(key, {
            key,
            entrypoint,
            exportName,
            methodName,
            methodType,
            ...semantics,
            source: analysisSource,
            jsdoc,
            parameters,
            parameterFields: new Map(
                parameters.map((parameter) => [
                    parameter.name,
                    new Set(
                        native
                            ? []
                            : GerberApiContractInspector.#parameterProperties(
                                  source,
                                  jsdoc,
                                  parameter.name
                              )
                    )
                ])
            ),
            resultFields: new Set(
                native || semantics.generator
                    ? []
                    : GerberApiContractInspector.#resultFields(source, jsdoc)
            ),
            calls:
                native || semantics.generator
                    ? []
                    : GerberReachableCalls.inspect(source)
        })
    }

    /**
     * Propagates parameter properties and returned result fields through calls.
     * @param {Map<string, Record<string, any>>} nodesByKey Callable graph.
     * @returns {void}
     */
    static #resolveDelegates(nodesByKey) {
        let changed = true
        let passes = 0
        while (changed && passes <= nodesByKey.size) {
            changed = false
            passes += 1
            for (const node of nodesByKey.values()) {
                for (const call of node.calls) {
                    if (call.methodName.startsWith('#')) continue
                    const target = GerberApiContractInspector.#targetNode(
                        nodesByKey,
                        node,
                        call
                    )
                    if (!target) continue
                    for (
                        let index = 0;
                        index < target.parameters.length;
                        index += 1
                    ) {
                        const argument = String(
                            call.arguments[index] || ''
                        ).trim()
                        const callerParameter = node.parameters.find(
                            (parameter) => parameter.name === argument
                        )
                        if (!callerParameter) continue
                        const destination = node.parameterFields.get(
                            callerParameter.name
                        )
                        const source = target.parameterFields.get(
                            target.parameters[index].name
                        )
                        changed =
                            GerberApiContractInspector.#addAll(
                                destination,
                                source
                            ) || changed
                    }
                    if (call.returned) {
                        changed =
                            GerberApiContractInspector.#addAll(
                                node.resultFields,
                                target.resultFields
                            ) || changed
                    }
                }
            }
        }
    }

    /**
     * Adds source values to a destination set.
     * @param {Set<string>} destination Destination set.
     * @param {Set<string> | undefined} source Source set.
     * @returns {boolean} Whether a value was added.
     */
    static #addAll(destination, source) {
        let changed = false
        for (const value of source || []) {
            if (destination.has(value)) continue
            destination.add(value)
            changed = true
        }
        return changed
    }

    /**
     * Resolves same-entrypoint calls before wildcard supporting classes.
     * @param {Map<string, Record<string, any>>} nodesByKey Callable graph.
     * @param {Record<string, any>} node Calling node.
     * @param {Record<string, any>} call Static call.
     * @returns {Record<string, any> | undefined} Target node.
     */
    static #targetNode(nodesByKey, node, call) {
        const methodType = call.methodName.startsWith('#')
            ? 'static-private'
            : 'static'
        return (
            nodesByKey.get(
                GerberApiContractInspector.#nodeKey(
                    node.entrypoint,
                    call.exportName,
                    call.methodName,
                    methodType
                )
            ) ||
            nodesByKey.get(
                GerberApiContractInspector.#nodeKey(
                    '*',
                    call.exportName,
                    call.methodName,
                    methodType
                )
            )
        )
    }

    /**
     * Creates one export feature.
     * @param {string} entrypoint Entrypoint key.
     * @param {{ name: string, value: unknown }} exported Export record.
     * @returns {Record<string, any>} Export feature.
     */
    static #exportFeature(entrypoint, exported) {
        return {
            feature: `${entrypoint}#${exported.name}`,
            kind: 'export',
            entrypoint,
            exportName: exported.name,
            sourceContract: {
                type: 'export',
                valueType: typeof exported.value,
                aliases: exported.aliases
            }
        }
    }

    /**
     * Creates callable, option, result, and accessor features for one export.
     * @param {string} entrypoint Entrypoint key.
     * @param {{ name: string, value: unknown, members: Record<string, string[]> }} exported Export record.
     * @param {Map<string, Record<string, any>>} nodesByKey Callable graph.
     * @returns {Record<string, any>[]} Contract features.
     */
    static #callableFeatures(entrypoint, exported, nodesByKey) {
        if (typeof exported.value !== 'function') return []
        const features = []
        for (const [methodName, methodType] of [
            ['constructor', 'constructor'],
            ...exported.members.staticMethods.map((name) => [name, 'static']),
            ...exported.members.instanceMethods.map((name) => [
                name,
                'instance'
            ])
        ]) {
            const node = nodesByKey.get(
                GerberApiContractInspector.#nodeKey(
                    entrypoint,
                    exported.name,
                    methodName,
                    methodType
                )
            )
            if (node) {
                features.push(
                    ...GerberApiContractInspector.#methodFeatures(
                        entrypoint,
                        node
                    )
                )
            }
        }
        for (const name of exported.members.instanceAccessors) {
            const descriptor = GerberPublicApiSurface.descriptor(
                exported.value,
                'instance',
                name
            )
            features.push({
                feature: `${entrypoint}#${exported.name}.prototype.${name}`,
                kind: 'field',
                entrypoint,
                exportName: exported.name,
                methodName: name,
                methodType: 'instance-accessor',
                sourceContract: {
                    type: 'accessor',
                    name,
                    get: typeof descriptor?.get === 'function',
                    set: typeof descriptor?.set === 'function'
                }
            })
        }
        for (const name of exported.members.staticAccessors) {
            const descriptor = GerberPublicApiSurface.descriptor(
                exported.value,
                'static',
                name
            )
            features.push({
                feature: `${entrypoint}#${exported.name}.${name}`,
                kind: 'field',
                entrypoint,
                exportName: exported.name,
                methodName: name,
                methodType: 'static-accessor',
                sourceContract: {
                    type: 'accessor',
                    name,
                    get: typeof descriptor?.get === 'function',
                    set: typeof descriptor?.set === 'function'
                }
            })
        }
        for (const name of exported.members.staticFields) {
            const descriptor = GerberPublicApiSurface.descriptor(
                exported.value,
                'static',
                name
            )
            features.push({
                feature: `${entrypoint}#${exported.name}.${name}`,
                kind: 'field',
                entrypoint,
                exportName: exported.name,
                methodName: name,
                methodType: 'static-field',
                sourceContract: {
                    type: 'static-field',
                    name,
                    valueType: typeof descriptor?.value
                }
            })
        }
        for (const name of exported.members.instanceFields) {
            features.push({
                feature: `${entrypoint}#${exported.name}.prototype.${name}`,
                kind: 'field',
                entrypoint,
                exportName: exported.name,
                methodName: name,
                methodType: 'instance-field',
                sourceContract: { type: 'instance-field', name }
            })
        }
        return features
    }

    /**
     * Creates method and subordinate contract features.
     * @param {string} entrypoint Entrypoint key.
     * @param {Record<string, any>} node Callable node.
     * @returns {Record<string, any>[]} Method features.
     */
    static #methodFeatures(entrypoint, node) {
        const owner =
            node.methodType === 'instance'
                ? `${node.exportName}.prototype`
                : node.exportName
        const methodId = `${entrypoint}#${owner}.${node.methodName}()`
        const common = {
            entrypoint,
            exportName: node.exportName,
            methodName: node.methodName,
            methodType: node.methodType
        }
        const features = [
            {
                ...common,
                feature: methodId,
                kind: 'method',
                sourceContract: {
                    type: 'method',
                    signature: `(${node.parameters.map((entry) => entry.source).join(', ')})`,
                    parameters: node.parameters,
                    async: node.async,
                    generator: node.generator,
                    resultKind: node.resultKind
                }
            }
        ]
        for (const parameter of node.parameters) {
            features.push({
                ...common,
                feature: `${methodId}.argument.${parameter.name}`,
                kind: 'option',
                sourceContract: { type: 'argument', ...parameter }
            })
            for (const property of [
                ...(node.parameterFields.get(parameter.name) || [])
            ].sort()) {
                features.push({
                    ...common,
                    feature: `${methodId}.argument.${parameter.name}.property.${property}`,
                    kind: 'option',
                    sourceContract: {
                        type: 'property',
                        argument: parameter.name,
                        name: property
                    }
                })
            }
        }
        for (const field of [...node.resultFields].sort()) {
            features.push({
                ...common,
                feature: `${methodId}.result.${field}`,
                kind: 'field',
                sourceContract: { type: 'result-field', name: field }
            })
        }
        return features
    }

    /**
     * Parses callable parameters and default expressions.
     * @param {string} source Callable source.
     * @returns {Record<string, any>[]} Parameter records.
     */
    static #parseParameters(source) {
        const open = source.indexOf('(')
        if (open < 0) return []
        const close = GerberApiContractInspector.#matchingDelimiter(
            source,
            open,
            '(',
            ')'
        )
        return GerberApiContractInspector.#splitTopLevel(
            source.slice(open + 1, close)
        ).map((parameter, index) => {
            const equals = GerberApiContractInspector.#topLevelIndex(
                parameter,
                '='
            )
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
        })
    }

    /**
     * Finds direct and JSDoc-declared parameter property paths.
     * @param {string} source Callable source.
     * @param {string} jsdoc Callable JSDoc.
     * @param {string} parameter Parameter name.
     * @returns {string[]} Property paths.
     */
    static #parameterProperties(source, jsdoc, parameter) {
        const fields = new Set(
            GerberSourceCallable.parameterProperties(source, parameter)
        )
        for (const field of GerberApiContractInspector.#jsdocParameterFields(
            jsdoc,
            parameter
        )) {
            fields.add(field)
        }
        return [...fields].sort()
    }

    /**
     * Finds returned object field paths from source and JSDoc.
     * @param {string} source Callable source.
     * @param {string} jsdoc Callable JSDoc.
     * @returns {string[]} Result field paths.
     */
    static #resultFields(source, jsdoc) {
        const fields = new Set(
            GerberApiContractInspector.#jsdocReturnFields(jsdoc)
        )
        for (const expression of GerberSourceCallable.returnExpressions(
            source
        )) {
            const value = GerberSourceExpression.stripParentheses(
                expression.replace(/^await\s+/u, '').trim()
            )
            if (
                !value.startsWith('{') ||
                GerberSourceExpression.matchingDelimiter(value, 0, '{', '}') !==
                    value.length - 1
            ) {
                continue
            }
            for (const field of GerberApiContractInspector.#objectFieldPaths(
                value.slice(1, -1)
            )) {
                fields.add(field)
            }
        }
        return [...fields].sort()
    }

    /**
     * Extracts JSDoc parameter object paths.
     * @param {string} jsdoc JSDoc source.
     * @param {string} parameter Parameter name.
     * @returns {string[]} Property paths.
     */
    static #jsdocParameterFields(jsdoc, parameter) {
        const fields = []
        for (const match of jsdoc.matchAll(/@param\s+\{/gu)) {
            const open = match.index + match[0].lastIndexOf('{')
            const close = GerberApiContractInspector.#matchingDelimiter(
                jsdoc,
                open,
                '{',
                '}'
            )
            const suffix = jsdoc
                .slice(close + 1)
                .match(/^\s+(\[[^\]]+\]|[^\s*]+)/u)
            const name = String(suffix?.[1] || '')
                .replace(/^\[/u, '')
                .replace(/\]$/u, '')
                .split('=')[0]
            if (name !== parameter) continue
            fields.push(
                ...GerberApiContractInspector.#typeObjectFieldPaths(
                    jsdoc.slice(open + 1, close)
                )
            )
        }
        return fields
    }

    /**
     * Extracts JSDoc return object paths.
     * @param {string} jsdoc JSDoc source.
     * @returns {string[]} Field paths.
     */
    static #jsdocReturnFields(jsdoc) {
        const match = /@returns?\s+\{/u.exec(jsdoc)
        if (!match) return []
        const open = match.index + match[0].lastIndexOf('{')
        const close = GerberApiContractInspector.#matchingDelimiter(
            jsdoc,
            open,
            '{',
            '}'
        )
        return GerberApiContractInspector.#typeObjectFieldPaths(
            jsdoc.slice(open + 1, close)
        )
    }

    /**
     * Extracts field paths from the first nested object type.
     * @param {string} source JSDoc type body.
     * @returns {string[]} Field paths.
     */
    static #typeObjectFieldPaths(source) {
        const open = source.indexOf('{')
        if (open < 0) return []
        const close = GerberApiContractInspector.#matchingDelimiter(
            source,
            open,
            '{',
            '}'
        )
        return GerberApiContractInspector.#objectFieldPaths(
            source.slice(open + 1, close)
        )
    }

    /**
     * Extracts recursive object literal or object type field paths.
     * @param {string} source Object body.
     * @returns {string[]} Field paths.
     */
    static #objectFieldPaths(source) {
        const fields = []
        for (const part of GerberApiContractInspector.#splitTopLevel(source)) {
            const match = part.trim().match(/^([A-Za-z_$][\w$]*)\??\s*(?::|$)/u)
            if (!match) continue
            const name = match[1]
            fields.push(name)
            const colon = GerberApiContractInspector.#topLevelIndex(part, ':')
            if (colon < 0) continue
            const value = part.slice(colon + 1).trim()
            const nested = GerberApiContractInspector.#nestedObjectBody(value)
            if (!nested) continue
            for (const child of GerberApiContractInspector.#objectFieldPaths(
                nested
            )) {
                fields.push(`${name}.${child}`)
            }
        }
        return [...new Set(fields)].sort()
    }

    /**
     * Returns a directly nested or arrow-returned object body.
     * @param {string} value Property value source.
     * @returns {string} Object body or empty string.
     */
    static #nestedObjectBody(value) {
        let open = value.startsWith('{') ? 0 : -1
        if (open < 0) {
            const arrow = /=>\s*\(?\s*\{/u.exec(value)
            if (arrow) open = value.indexOf('{', arrow.index)
        }
        if (open < 0) return ''
        const close = GerberApiContractInspector.#matchingDelimiter(
            value,
            open,
            '{',
            '}'
        )
        return value.slice(open + 1, close)
    }

    /**
     * Extracts an explicitly declared constructor.
     * @param {string} classSource Class source.
     * @returns {string} Constructor source or empty string.
     */
    static #extractConstructor(classSource) {
        const match = /(?:^|\n)\s*constructor\s*\(/u.exec(classSource)
        if (!match) return ''
        const start = classSource.indexOf('constructor', match.index)
        const openParameters = classSource.indexOf('(', start)
        const closeParameters = GerberApiContractInspector.#matchingDelimiter(
            classSource,
            openParameters,
            '(',
            ')'
        )
        const openBody = classSource.indexOf('{', closeParameters)
        const closeBody = GerberApiContractInspector.#matchingDelimiter(
            classSource,
            openBody,
            '{',
            '}'
        )
        return classSource.slice(start, closeBody + 1)
    }

    /**
     * Extracts private static method sources from a class implementation.
     * @param {string} classSource Class source.
     * @returns {{ name: string, source: string, index: number }[]} Private methods.
     */
    static #privateStaticMethods(classSource) {
        const methods = []
        const mask = GerberSourceExpression.codeMask(classSource)
        for (const match of mask.matchAll(
            /(?:^|\n)\s*static\s+(?:async\s+)?(#[A-Za-z_$][\w$]*)\s*\(/gu
        )) {
            const name = match[1]
            const index = match.index + match[0].indexOf('static')
            const openParameters = mask.indexOf('(', index)
            const closeParameters = GerberSourceExpression.matchingDelimiter(
                mask,
                openParameters,
                '(',
                ')'
            )
            const openBody = mask.indexOf('{', closeParameters)
            const closeBody = GerberSourceExpression.matchingDelimiter(
                mask,
                openBody,
                '{',
                '}'
            )
            methods.push({
                name,
                index,
                source: classSource.slice(index, closeBody + 1)
            })
        }
        return methods
    }

    /**
     * Returns the nearest JSDoc block preceding one class member.
     * @param {string} classSource Class source.
     * @param {number} memberIndex Member source index.
     * @returns {string} JSDoc source.
     */
    static #jsdocBefore(classSource, memberIndex) {
        if (memberIndex < 0) return ''
        const end = classSource.lastIndexOf('*/', memberIndex)
        const start = classSource.lastIndexOf('/**', end)
        return start < 0 || end < 0 ? '' : classSource.slice(start, end + 2)
    }

    /**
     * Splits comma-delimited source at top-level nesting depth.
     * @param {string} source Expression source.
     * @returns {string[]} Top-level parts.
     */
    static #splitTopLevel(source) {
        const parts = []
        let start = 0
        let depth = 0
        let quote = ''
        for (let index = 0; index < source.length; index += 1) {
            const character = source[index]
            if (quote) {
                if (character === quote && source[index - 1] !== '\\')
                    quote = ''
                continue
            }
            if (["'", '"', '`'].includes(character)) quote = character
            else if ('([{'.includes(character)) depth += 1
            else if (')]}'.includes(character)) depth -= 1
            else if (character === ',' && depth === 0) {
                parts.push(source.slice(start, index))
                start = index + 1
            }
        }
        const final = source.slice(start).trim()
        if (final) parts.push(final)
        return parts
    }

    /**
     * Finds one target character at top-level nesting depth.
     * @param {string} source Expression source.
     * @param {string} target Target character.
     * @returns {number} Character index or -1.
     */
    static #topLevelIndex(source, target) {
        let depth = 0
        let quote = ''
        for (let index = 0; index < source.length; index += 1) {
            const character = source[index]
            if (quote) {
                if (character === quote && source[index - 1] !== '\\')
                    quote = ''
                continue
            }
            if (["'", '"', '`'].includes(character)) quote = character
            else if ('([{'.includes(character)) depth += 1
            else if (')]}'.includes(character)) depth -= 1
            else if (character === target && depth === 0) return index
        }
        return -1
    }

    /**
     * Finds a matching delimiter while respecting strings and nesting.
     * @param {string} source Source text.
     * @param {number} openIndex Opening delimiter index.
     * @param {string} open Opening delimiter.
     * @param {string} close Closing delimiter.
     * @returns {number} Closing delimiter index.
     */
    static #matchingDelimiter(source, openIndex, open, close) {
        let depth = 0
        let quote = ''
        for (let index = openIndex; index < source.length; index += 1) {
            const character = source[index]
            if (quote) {
                if (character === quote && source[index - 1] !== '\\')
                    quote = ''
                continue
            }
            if (["'", '"', '`'].includes(character)) quote = character
            else if (character === open) depth += 1
            else if (character === close) {
                depth -= 1
                if (depth === 0) return index
            }
        }
        return source.length - 1
    }

    /**
     * Builds a stable callable graph key.
     * @param {string} entrypoint Package entrypoint.
     * @param {string} exportName Export name.
     * @param {string} methodName Method name.
     * @param {string} methodType Method type.
     * @returns {string} Graph key.
     */
    static #nodeKey(entrypoint, exportName, methodName, methodType) {
        return `${entrypoint}:${exportName}:${methodType}:${methodName}`
    }
}
