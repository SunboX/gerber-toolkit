import { parsers } from 'prettier/plugins/babel'

import { GerberDiscriminatedCollectionProvenance } from './GerberDiscriminatedCollectionProvenance.mjs'
import { GerberSourceAst } from './GerberSourceAst.mjs'
import { GerberSourceCallable } from './GerberSourceCallable.mjs'
import { GerberSourceCollectionProvenance } from './GerberSourceCollectionProvenance.mjs'
import { GerberSourceExpression } from './GerberSourceExpression.mjs'
import { GerberStaticValue } from './GerberStaticValue.mjs'

const EXPRESSION_CACHE = new Map()

/**
 * Applies AST reachability and intrinsic provenance to result expressions.
 */
export class GerberResultExpressionAnalysis {
    /**
     * Checks whether a modeled intrinsic is not hidden by a parameter or local.
     * @param {string} name Intrinsic identifier.
     * @param {Record<string, any>} state Callable analysis state.
     * @param {number} position Source position.
     * @returns {boolean} Whether intrinsic semantics are available.
     */
    static unshadowedIdentifier(name, state, position) {
        return (
            !state.parameters?.has(name) &&
            !GerberSourceAst.activeBindings(
                state.lexicalBindings || [],
                name,
                position
            ).length
        )
    }

    /**
     * Unwraps a clone only when its modeled intrinsic is available.
     * @param {string} expression Clone expression.
     * @param {Record<string, any>} state Callable analysis state.
     * @param {number} position Source position.
     * @returns {string | null} Cloned value or null.
     */
    static clonedValue(expression, state, position) {
        const name = expression.startsWith('structuredClone')
            ? 'structuredClone'
            : expression.startsWith('JSON.parse')
              ? 'JSON'
              : ''
        return name &&
            GerberResultExpressionAnalysis.unshadowedIdentifier(
                name,
                state,
                position
            )
            ? GerberSourceExpression.clonedValue(expression)
            : null
    }

    /**
     * Parses Object.assign only through the unshadowed intrinsic.
     * @param {string} expression Assignment expression.
     * @param {Record<string, any>} state Callable analysis state.
     * @param {number} position Source position.
     * @returns {string[] | null} Assigned sources or null.
     */
    static objectAssignSources(expression, state, position) {
        return GerberResultExpressionAnalysis.unshadowedIdentifier(
            'Object',
            state,
            position
        )
            ? GerberSourceCallable.objectAssignSources(expression)
            : null
    }

    /**
     * Resolves the proven Array depth of one result expression.
     * @param {string} expression Expression source.
     * @param {Record<string, any>} state Callable analysis state.
     * @param {number} position Source position of the expression.
     * @returns {number} Proven Array depth, or zero.
     */
    static collectionDepth(expression, state, position) {
        const parsed = GerberResultExpressionAnalysis.#parse(expression)
        if (!parsed) return 0
        return GerberSourceCollectionProvenance.depth(
            parsed.node,
            GerberResultExpressionAnalysis.#scope(state, position)
        )
    }

    /**
     * Checks whether one collection callback can execute at least once.
     * @param {string} expression Collection callback expression.
     * @param {Record<string, any>} state Callable analysis state.
     * @param {number} position Source position.
     * @returns {boolean} Whether the receiver is not definitely empty.
     */
    static callbackReachable(expression, state, position) {
        const node = GerberResultExpressionAnalysis.#parse(expression)?.node
        return GerberSourceCollectionProvenance.mayHaveElements(
            node,
            GerberResultExpressionAnalysis.#scope(state, position)
        )
    }

    /**
     * Selects statically reachable branches of a top-level logical expression.
     * @param {string} expression Expression source.
     * @param {Record<string, any>} state Callable analysis state.
     * @param {number} position Source position of the expression.
     * @returns {string[] | null} Reachable alternatives, or null when not logical.
     */
    static logicalAlternatives(expression, state, position) {
        const parsed = GerberResultExpressionAnalysis.#parse(expression)
        if (!parsed || parsed.node.type !== 'LogicalExpression') return null
        const scope = GerberResultExpressionAnalysis.#scope(state, position)
        const left = GerberResultExpressionAnalysis.#text(
            parsed,
            parsed.node.left
        )
        const right = GerberResultExpressionAnalysis.#text(
            parsed,
            parsed.node.right
        )
        const truth = GerberStaticValue.truth(parsed.node.left, scope)
        if (parsed.node.operator === '&&') {
            if (truth === false) return [left]
            if (truth === true) return [right]
        }
        if (parsed.node.operator === '||') {
            if (truth === true) return [left]
            if (truth === false) return [right]
        }
        if (parsed.node.operator === '??') {
            const nullish = GerberStaticValue.nullish(parsed.node.left, scope)
            if (nullish === false) return [left]
            if (nullish === true) return [right]
        }
        return [left, right]
    }

    /**
     * Accepts an internal member projection only when every callback result is
     * structurally derived from its element parameter. This preserves modeled
     * normalized-data projections without trusting an arbitrary `.map` name.
     * @param {{ method: string, source: string, parameter: string, returns: string[] }} callback Parsed collection callback.
     * @param {Record<string, any>} state Callable analysis state.
     * @param {number} position Callback source position.
     * @returns {boolean} Whether the callback is a constrained projection.
     */
    static supportsProjection(callback, state, position) {
        if (
            !['map', 'flatMap'].includes(callback?.method) ||
            !callback.parameter ||
            !callback.returns?.length
        ) {
            return false
        }
        const parsed = GerberResultExpressionAnalysis.#parse(callback.source)
        const receiver = GerberResultExpressionAnalysis.#projectionReceiver(
            parsed?.node
        )
        if (!receiver?.path) return false
        const internalParameter =
            String(state.methodType || '').includes('private') &&
            state.parameters?.has(receiver.root) &&
            receiver.fallback
        const discriminatedParameter =
            String(state.methodType || '').includes('private') &&
            state.parameters?.has(receiver.root) &&
            !receiver.fallback &&
            GerberDiscriminatedCollectionProvenance.supports(
                receiver,
                state,
                position
            )
        const projectedElement = state.collectionBindings?.has(receiver.root)
        const recursiveProjection = callback.returns.every((expression) =>
            GerberResultExpressionAnalysis.#isRecursiveProjection(
                expression,
                callback.parameter,
                state
            )
        )
        if (
            !internalParameter &&
            !discriminatedParameter &&
            !projectedElement &&
            !recursiveProjection
        ) {
            return false
        }
        return callback.returns.every((expression) => {
            const returned = GerberResultExpressionAnalysis.#parse(
                expression.trim().replace(/^\.\.\./u, '')
            )
            return GerberResultExpressionAnalysis.#projectsParameter(
                returned?.node,
                callback.parameter
            )
        })
    }

    /**
     * Parses one isolated expression and caches its immutable AST.
     * @param {string} expression Expression source.
     * @returns {{ source: string, offset: number, node: Record<string, any> } | null} Parsed expression.
     */
    static #parse(expression) {
        const source = String(expression || '').trim()
        if (!source) return null
        if (EXPRESSION_CACHE.has(source)) return EXPRESSION_CACHE.get(source)
        const prefix = 'const __gerber_result__ = ('
        let parsed = null
        try {
            const ast = parsers.babel.parse(`${prefix}${source})`, {
                filepath: 'gerber-result-expression.mjs'
            })
            parsed = {
                source,
                offset: prefix.length,
                node: ast.program.body[0].declarations[0].init
            }
        } catch {
            parsed = null
        }
        EXPRESSION_CACHE.set(source, parsed)
        return parsed
    }

    /**
     * Creates a lexical lookup compatible with static-value and collection analysis.
     * @param {Record<string, any>} state Callable analysis state.
     * @param {number} position Source position.
     * @returns {{ get: (name: string) => Record<string, any> | null }} Lexical lookup.
     */
    static #scope(state, position) {
        return {
            thisValue: state.thisValue || { known: false },
            get(name) {
                if (state.collectionBindings?.has(name)) {
                    return {
                        initializer: null,
                        collectionDepth:
                            state.collectionBindings.get(name) || 0,
                        collectionPaths: new Map()
                    }
                }
                const active = GerberSourceAst.activeBindings(
                    state.lexicalBindings || [],
                    name,
                    position
                )
                if (active.length) {
                    const expressions = new Set(
                        active.map((binding) => binding.expression || '')
                    )
                    const depths = active.map(
                        (binding) => binding.collectionDepth || 0
                    )
                    const expression =
                        expressions.size === 1 ? [...expressions][0] : ''
                    return {
                        initializer:
                            GerberResultExpressionAnalysis.#parse(expression)
                                ?.node || null,
                        collectionDepth:
                            depths.length && depths.every((depth) => depth > 0)
                                ? Math.min(...depths)
                                : 0,
                        collectionPaths:
                            GerberResultExpressionAnalysis.#guardPaths(
                                state,
                                name,
                                position
                            )
                    }
                }
                if (!state.parameters?.has(name)) return null
                const collectionPaths = new Map(
                    state.collectionParameters?.get(name) || []
                )
                for (const [
                    path,
                    depth
                ] of GerberResultExpressionAnalysis.#guardPaths(
                    state,
                    name,
                    position
                )) {
                    collectionPaths.set(path, depth)
                }
                return {
                    initializer: null,
                    collectionDepth: collectionPaths.get('') || 0,
                    collectionPaths
                }
            },
            callDepth(node) {
                if (
                    !['CallExpression', 'OptionalCallExpression'].includes(
                        node?.type
                    ) ||
                    !['MemberExpression', 'OptionalMemberExpression'].includes(
                        node.callee?.type
                    )
                ) {
                    return 0
                }
                const owner = node.callee.object
                const exportName =
                    owner?.type === 'Identifier'
                        ? owner.name
                        : owner?.type === 'ThisExpression'
                          ? state.exportName
                          : ''
                const methodName = GerberResultExpressionAnalysis.#memberName(
                    node.callee
                )
                return (
                    state.collectionCallDepths?.get(
                        `${exportName}.${methodName}`
                    ) || 0
                )
            }
        }
    }

    /**
     * Reads one static public or private member name.
     * @param {Record<string, any>} node Member AST node.
     * @returns {string} Static member name or an empty string.
     */
    static #memberName(node) {
        const property = node?.property
        if (!property) return ''
        if (!node.computed && property.type === 'Identifier') {
            return property.name
        }
        if (!node.computed && property.type === 'PrivateName') {
            return `#${property.id.name}`
        }
        return ['StringLiteral', 'NumericLiteral'].includes(property.type)
            ? String(property.value)
            : ''
    }

    /**
     * Resolves the static member receiver selected by a projection source.
     * @param {Record<string, any> | null} node Receiver AST node.
     * @returns {{ root: string, path: string, fallback: boolean } | null} Member receiver.
     */
    static #projectionReceiver(node) {
        const value = GerberResultExpressionAnalysis.#unwrap(node)
        if (value?.type === 'LogicalExpression') {
            for (const candidate of [value.left, value.right]) {
                const target =
                    GerberResultExpressionAnalysis.#memberTarget(candidate)
                if (target?.path) return { ...target, fallback: true }
            }
            return null
        }
        const target = GerberResultExpressionAnalysis.#memberTarget(value)
        return target ? { ...target, fallback: false } : null
    }

    /**
     * Recognizes a recursive collection projection back into the same public
     * callable, with the callback element passed as an argument.
     * @param {string} expression Callback return expression.
     * @param {string} parameter Callback parameter.
     * @param {Record<string, any>} state Callable analysis state.
     * @returns {boolean} Whether this is a same-callable recursive projection.
     */
    static #isRecursiveProjection(expression, parameter, state) {
        const parsed = GerberResultExpressionAnalysis.#parse(expression)
        const value = GerberResultExpressionAnalysis.#unwrap(parsed?.node)
        if (
            !['CallExpression', 'OptionalCallExpression'].includes(
                value?.type
            ) ||
            !['MemberExpression', 'OptionalMemberExpression'].includes(
                value.callee?.type
            ) ||
            value.callee.object?.type !== 'Identifier' ||
            value.callee.object.name !== state.exportName ||
            GerberResultExpressionAnalysis.#memberName(value.callee) !==
                state.methodName
        ) {
            return false
        }
        return value.arguments.some((argument) =>
            GerberResultExpressionAnalysis.#projectsParameter(
                argument.expression || argument,
                parameter
            )
        )
    }

    /**
     * Checks that an output expression is data-dependent on one callback
     * parameter rather than an unrelated literal ghost shape.
     * @param {Record<string, any> | null} node Output expression.
     * @param {string} parameter Callback parameter name.
     * @returns {boolean} Whether the output structurally projects the element.
     */
    static #projectsParameter(node, parameter) {
        const value = GerberResultExpressionAnalysis.#unwrap(node)
        if (!value) return false
        if (value.type === 'Identifier') return value.name === parameter
        if (
            ['MemberExpression', 'OptionalMemberExpression'].includes(
                value.type
            )
        ) {
            return GerberResultExpressionAnalysis.#projectsParameter(
                value.object,
                parameter
            )
        }
        if (['CallExpression', 'OptionalCallExpression'].includes(value.type)) {
            return value.arguments.some((argument) =>
                GerberResultExpressionAnalysis.#projectsParameter(
                    argument.expression || argument,
                    parameter
                )
            )
        }
        if (value.type === 'ObjectExpression') {
            return (
                value.properties.length > 0 &&
                value.properties.every((property) => {
                    const projected =
                        property.type === 'SpreadElement'
                            ? property.argument
                            : property.value
                    if (
                        !GerberResultExpressionAnalysis.#projectsParameter(
                            projected,
                            parameter
                        )
                    ) {
                        return false
                    }
                    if (property.type === 'SpreadElement') return true
                    const name =
                        GerberResultExpressionAnalysis.#propertyName(property)
                    return (
                        !name ||
                        GerberResultExpressionAnalysis.#containsProjectedMember(
                            projected,
                            parameter,
                            name
                        )
                    )
                })
            )
        }
        if (value.type === 'ArrayExpression') {
            return (
                value.elements.length > 0 &&
                value.elements.every((element) =>
                    GerberResultExpressionAnalysis.#projectsParameter(
                        element?.argument || element,
                        parameter
                    )
                )
            )
        }
        if (value.type === 'ConditionalExpression') {
            return (
                GerberResultExpressionAnalysis.#projectsParameter(
                    value.consequent,
                    parameter
                ) &&
                GerberResultExpressionAnalysis.#projectsParameter(
                    value.alternate,
                    parameter
                )
            )
        }
        return false
    }

    /**
     * Checks that a projected object field keeps the selected element member
     * name instead of relabeling arbitrary data as a new result contract.
     * @param {Record<string, any> | null} node Field value expression.
     * @param {string} parameter Callback parameter.
     * @param {string} name Output property name.
     * @returns {boolean} Whether the same input member feeds the output field.
     */
    static #containsProjectedMember(node, parameter, name) {
        const value = GerberResultExpressionAnalysis.#unwrap(node)
        if (!value) return false
        if (value.type === 'Identifier') {
            return value.name === parameter && value.name === name
        }
        if (
            ['MemberExpression', 'OptionalMemberExpression'].includes(
                value.type
            )
        ) {
            const target = GerberResultExpressionAnalysis.#memberTarget(value)
            if (
                target?.root === parameter &&
                target.path.split('.').at(-1) === name
            ) {
                return true
            }
        }
        for (const [key, child] of Object.entries(value)) {
            if (
                ['type', 'start', 'end', 'loc', 'comments', 'errors'].includes(
                    key
                )
            ) {
                continue
            }
            for (const candidate of Array.isArray(child) ? child : [child]) {
                if (
                    candidate &&
                    typeof candidate === 'object' &&
                    typeof candidate.type === 'string' &&
                    GerberResultExpressionAnalysis.#containsProjectedMember(
                        candidate,
                        parameter,
                        name
                    )
                ) {
                    return true
                }
            }
        }
        return false
    }

    /**
     * Reads one static object-property name.
     * @param {Record<string, any>} property Object property node.
     * @returns {string} Static key or an empty string.
     */
    static #propertyName(property) {
        const key = property?.key
        if (!key) return ''
        if (!property.computed && key.type === 'Identifier') return key.name
        return ['StringLiteral', 'NumericLiteral'].includes(key.type)
            ? String(key.value)
            : ''
    }

    /**
     * Resolves one static member target.
     * @param {Record<string, any> | null} node Member or identifier expression.
     * @returns {{ root: string, path: string } | null} Static target.
     */
    static #memberTarget(node) {
        const value = GerberResultExpressionAnalysis.#unwrap(node)
        if (!value) return null
        if (value.type === 'Identifier') {
            return { root: value.name, path: '' }
        }
        if (
            !['MemberExpression', 'OptionalMemberExpression'].includes(
                value.type
            )
        ) {
            return null
        }
        const parent = GerberResultExpressionAnalysis.#memberTarget(
            value.object
        )
        const name = GerberResultExpressionAnalysis.#memberName(value)
        if (!parent || !name || /^\d+$/u.test(name)) return null
        return {
            root: parent.root,
            path: [parent.path, name].filter(Boolean).join('.')
        }
    }

    /**
     * Removes syntax-only expression wrappers.
     * @param {Record<string, any> | null} node Expression node.
     * @returns {Record<string, any> | null} Unwrapped node.
     */
    static #unwrap(node) {
        let value = node
        while (
            [
                'ParenthesizedExpression',
                'TSAsExpression',
                'TSTypeAssertion',
                'TypeCastExpression',
                'ChainExpression'
            ].includes(value?.type)
        ) {
            value = value.expression || value.argument
        }
        return value || null
    }

    /**
     * Resolves active Array guard paths for one lexical root.
     * @param {Record<string, any>} state Callable analysis state.
     * @param {string} name Root binding name.
     * @param {number} position Source position.
     * @returns {Map<string, number>} Active member collection depths.
     */
    static #guardPaths(state, name, position) {
        return new Map(
            (state.facts?.collectionGuards || [])
                .filter(
                    (guard) =>
                        guard.root === name &&
                        guard.start <= position &&
                        position <= guard.end
                )
                .map((guard) => [guard.path, guard.depth])
        )
    }

    /**
     * Slices one parsed child expression from its original source.
     * @param {{ source: string, offset: number }} parsed Parsed wrapper.
     * @param {Record<string, any>} node Child AST node.
     * @returns {string} Exact child source.
     */
    static #text(parsed, node) {
        return parsed.source.slice(
            Math.max(0, node.start - parsed.offset),
            Math.max(0, node.end - parsed.offset)
        )
    }
}
