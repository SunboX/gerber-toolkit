import { parsers } from 'prettier/plugins/babel'

import { GerberJsdocCollectionProvenance } from './GerberJsdocCollectionProvenance.mjs'
import { GerberSourceAst } from './GerberSourceAst.mjs'
import { GerberSourceCallable } from './GerberSourceCallable.mjs'
import { GerberSourceCollectionProvenance } from './GerberSourceCollectionProvenance.mjs'
import { GerberSourceExpression } from './GerberSourceExpression.mjs'

const CALLABLE_CACHE = new Map()

/**
 * Proves private member collections from reachable discriminated constructors.
 */
export class GerberDiscriminatedCollectionProvenance {
    /**
     * Catalogs collection-valued fields on reachable object variants.
     * @param {Map<string, Record<string, any>>} nodesByKey Callable graph.
     * @param {Map<string, number>} callDepths Declared collection call depths.
     * @returns {{ variants: Set<string>, externalParameters: Map<string, Set<string>> }} Variant and external-input facts.
     */
    static catalog(nodesByKey, callDepths) {
        const variants = new Set()
        const scope = collectionScope(callDepths)
        const called = calledNodeKeys(nodesByKey)
        for (const node of nodesByKey.values()) {
            if (
                String(node.methodType).includes('private') &&
                !called.has(node.key)
            ) {
                continue
            }
            const collectionParameters =
                GerberJsdocCollectionProvenance.parameters(node.jsdoc)
            const facts = GerberSourceAst.facts(node.source, false, {
                collectionParameters
            })
            for (const returned of facts.returns) {
                for (const object of expressionObjects(returned.expression)) {
                    addObjectVariants(
                        variants,
                        node.entrypoint,
                        node.exportName,
                        object,
                        scope
                    )
                }
            }
        }
        return {
            variants,
            externalParameters: externalParameterMap(nodesByKey)
        }
    }

    /**
     * Checks whether an active discriminator selects a constructed collection.
     * @param {{ root: string, path: string }} receiver Callback receiver.
     * @param {Record<string, any>} state Callable analysis state.
     * @param {number} position Callback source position.
     * @returns {boolean} Whether the member collection is structurally proven.
     */
    static supports(receiver, state, position) {
        if (
            !(state.discriminatedCollections instanceof Set) ||
            state.externalParameters?.has(receiver.root)
        ) {
            return false
        }
        return activeGuards(state.source, position).some(
            (guard) =>
                guard.root === receiver.root &&
                state.discriminatedCollections.has(
                    variantKey(
                        state.entrypoint,
                        state.exportName,
                        guard.path,
                        guard.value,
                        receiver.path
                    )
                )
        )
    }
}

/**
 * Propagates direct external-object aliases through modeled call parameters.
 * @param {Map<string, Record<string, any>>} nodesByKey Callable graph.
 * @returns {Map<string, Set<string>>} External parameter names by node key.
 */
function externalParameterMap(nodesByKey) {
    const external = new Map(
        [...nodesByKey.values()].map((node) => [node.key, new Set()])
    )
    const states = new Map(
        [...nodesByKey.values()].map((node) => [node.key, aliasState(node)])
    )
    const targets = callableTargets(nodesByKey)
    const externalReturns = new Set()
    for (const node of nodesByKey.values()) {
        if (
            node.entrypoint === '*' ||
            String(node.methodType).includes('private')
        ) {
            continue
        }
        for (const parameter of node.parameters) {
            external.get(node.key).add(parameter.name)
        }
    }
    let changed = true
    while (changed) {
        changed = false
        for (const node of nodesByKey.values()) {
            if (
                !externalReturns.has(node.key) &&
                states
                    .get(node.key)
                    .facts.returns.some((returned) =>
                        externalExpression(
                            returned.expression,
                            states.get(node.key),
                            returned.index,
                            external.get(node.key),
                            { caller: node, targets, externalReturns }
                        )
                    )
            ) {
                externalReturns.add(node.key)
                changed = true
            }
        }
        for (const caller of nodesByKey.values()) {
            const facts = states.get(caller.key).facts
            for (const call of facts.calls) {
                const target = callTarget(call, caller, targets)
                if (!target) continue
                for (
                    let index = 0;
                    index < target.parameters.length;
                    index += 1
                ) {
                    if (
                        !externalExpression(
                            call.arguments[index],
                            states.get(caller.key),
                            call.index,
                            external.get(caller.key),
                            { caller, targets, externalReturns }
                        )
                    ) {
                        continue
                    }
                    const name = target.parameters[index].name
                    if (!external.get(target.key).has(name)) {
                        external.get(target.key).add(name)
                        changed = true
                    }
                }
            }
        }
    }
    return external
}

/**
 * Creates the alias-resolution state for one callable.
 * @param {Record<string, any>} node Callable graph node.
 * @returns {Record<string, any>} Mutable-location state.
 */
function aliasState(node) {
    const collectionParameters = GerberJsdocCollectionProvenance.parameters(
        node.jsdoc
    )
    const facts = GerberSourceAst.facts(node.source, false, {
        collectionParameters
    })
    const variables = new Map(
        facts.bindings
            .filter((binding) => binding.expression)
            .map((binding) => [binding.name, binding.expression])
    )
    const iterations = new Map()
    for (const binding of facts.bindings) {
        if (binding.kind !== 'iteration') continue
        const values = iterations.get(binding.name) || []
        values.push({
            expression: binding.expression,
            start: binding.scopeStart,
            end: binding.scopeEnd
        })
        iterations.set(binding.name, values)
    }
    return {
        facts,
        lexicalBindings: facts.bindings,
        variables,
        iterations,
        parameters: new Set(node.parameters.map((parameter) => parameter.name))
    }
}

/**
 * Checks whether an expression aliases one externally supplied object.
 * @param {string | undefined} expression Argument expression.
 * @param {Record<string, any>} state Caller alias state.
 * @param {number} position Call position.
 * @param {Set<string>} external External caller parameters.
 * @param {{ caller: Record<string, any>, targets: Map<string, Record<string, any>>, externalReturns: Set<string> }} context Call graph context.
 * @returns {boolean} Whether the argument remains externally sourced.
 */
function externalExpression(expression, state, position, external, context) {
    const value = GerberSourceExpression.stripParentheses(
        String(expression || '').trim()
    )
    const conditional = GerberSourceExpression.conditionalBranches(value)
    const alternatives =
        conditional || GerberSourceExpression.logicalAlternatives(value)
    if (alternatives.length > 1) {
        return alternatives.some((candidate) =>
            externalExpression(candidate, state, position, external, context)
        )
    }
    const call = staticCall(value)
    if (call) {
        const target = callTarget(call, context.caller, context.targets)
        return Boolean(target && context.externalReturns.has(target.key))
    }
    const member = GerberSourceExpression.memberAccess(value)
    const identifier = /^([A-Za-z_$][\w$]*)$/u.exec(value)?.[1]
    const root = member?.root || identifier
    if (!root) return false
    return GerberSourceCallable.mutableLocations(
        root,
        member?.path || '',
        state,
        position
    ).some((location) => external.has(location.root))
}

/**
 * Parses one complete static call expression.
 * @param {string} expression Expression source.
 * @returns {{ receiver: string, methodName: string, arguments: string[] } | null} Call.
 */
function staticCall(expression) {
    const match = /^(this|[A-Za-z_$][\w$]*)\.(#?[A-Za-z_$][\w$]*)\s*\(/u.exec(
        expression
    )
    if (!match) return null
    const open = expression.indexOf('(', match.index)
    const close = GerberSourceExpression.matchingDelimiter(
        expression,
        open,
        '(',
        ')'
    )
    if (close < 0 || expression.slice(close + 1).trim()) return null
    return {
        receiver: match[1],
        methodName: match[2],
        arguments: GerberSourceExpression.splitTopLevel(
            expression.slice(open + 1, close)
        )
    }
}

/**
 * Adds every collection field paired with every literal discriminator.
 * @param {Set<string>} catalog Destination catalog.
 * @param {string} entrypoint Owning package entrypoint.
 * @param {string} exportName Owning class.
 * @param {Record<string, any>} object Object expression.
 * @param {Record<string, any>} scope Collection lookup.
 * @returns {void}
 */
function addObjectVariants(catalog, entrypoint, exportName, object, scope) {
    const properties = (object.properties || []).filter(
        (property) => property.type === 'ObjectProperty' && !property.computed
    )
    const discriminators = properties
        .map((property) => ({
            path: propertyName(property),
            value: literalValue(property.value)
        }))
        .filter((entry) => entry.path && entry.value.known)
    const collections = properties.filter(
        (property) =>
            propertyName(property) &&
            GerberSourceCollectionProvenance.depth(property.value, scope) > 0
    )
    for (const discriminator of discriminators) {
        for (const collection of collections) {
            catalog.add(
                variantKey(
                    entrypoint,
                    exportName,
                    discriminator.path,
                    discriminator.value.value,
                    propertyName(collection)
                )
            )
        }
    }
}

/**
 * Resolves every callable node reached by another modeled static call.
 * @param {Map<string, Record<string, any>>} nodesByKey Callable graph.
 * @returns {Set<string>} Reached node keys.
 */
function calledNodeKeys(nodesByKey) {
    const targets = callableTargets(nodesByKey)
    const called = new Set()
    for (const caller of nodesByKey.values()) {
        for (const call of caller.calls || []) {
            const target = callTarget(call, caller, targets)
            if (target) called.add(target.key)
        }
    }
    return called
}

/**
 * Indexes callable nodes for exact and supporting-class resolution.
 * @param {Map<string, Record<string, any>>} nodesByKey Callable graph.
 * @returns {Map<string, Record<string, any>>} Callable lookup.
 */
function callableTargets(nodesByKey) {
    const targets = new Map()
    for (const node of nodesByKey.values()) {
        targets.set(
            callableKey(
                node.entrypoint,
                node.exportName,
                node.methodName,
                node.methodType
            ),
            node
        )
    }
    return targets
}

/**
 * Resolves one static call to its same-entrypoint or supporting node.
 * @param {Record<string, any>} call Call fact.
 * @param {Record<string, any>} caller Caller node.
 * @param {Map<string, Record<string, any>>} targets Callable lookup.
 * @returns {Record<string, any> | null} Target node.
 */
function callTarget(call, caller, targets) {
    const methodType = call.methodName.startsWith('#')
        ? 'static-private'
        : 'static'
    const exportName =
        call.receiver === 'this'
            ? caller.exportName
            : call.receiver || call.exportName
    const exact = callableKey(
        caller.entrypoint,
        exportName,
        call.methodName,
        methodType
    )
    const fallback = callableKey('*', exportName, call.methodName, methodType)
    return targets.get(exact) || targets.get(fallback) || null
}

/**
 * Encodes a callable lookup key.
 * @param {string} entrypoint Package entrypoint.
 * @param {string} exportName Owning class.
 * @param {string} methodName Method name.
 * @param {string} methodType Method type.
 * @returns {string} Callable key.
 */
function callableKey(entrypoint, exportName, methodName, methodType) {
    return JSON.stringify([entrypoint, exportName, methodName, methodType])
}

/**
 * Creates a collection lookup for known callable return depths.
 * @param {Map<string, number>} callDepths Collection depth by callable.
 * @returns {Record<string, any>} Collection-provenance scope.
 */
function collectionScope(callDepths) {
    return {
        get() {
            return null
        },
        callDepth(node) {
            if (!isCall(node) || !isMember(node.callee)) return 0
            const owner = node.callee.object
            const method = memberName(node.callee)
            return owner?.type === 'Identifier' && method
                ? callDepths.get(`${owner.name}.${method}`) || 0
                : 0
        }
    }
}

/**
 * Finds object literals within one reachable returned expression.
 * @param {string} expression Expression source.
 * @returns {Record<string, any>[]} Object expressions.
 */
function expressionObjects(expression) {
    const prefix = 'const __gerber_variant__ = ('
    try {
        const ast = parsers.babel.parse(`${prefix}${expression})`, {
            filepath: 'gerber-variant-expression.mjs'
        })
        const objects = []
        walk(ast.program.body[0].declarations[0].init, (node) => {
            if (node.type === 'ObjectExpression') objects.push(node)
        })
        return objects
    } catch {
        return []
    }
}

/**
 * Lists equality guards whose consequent contains one source position.
 * @param {string} source Callable source.
 * @param {number} position Normalized callable position.
 * @returns {{ root: string, path: string, value: unknown }[]} Active guards.
 */
function activeGuards(source, position) {
    const parsed = parseCallable(source)
    if (!parsed) return []
    const absolute = parsed.offset + position
    const guards = []
    walk(parsed.node, (node) => {
        if (
            node.type !== 'IfStatement' ||
            absolute < node.consequent.start ||
            absolute > node.consequent.end
        ) {
            return
        }
        const guard = equalityGuard(node.test)
        if (guard) guards.push(guard)
    })
    return guards
}

/**
 * Parses one class-method source while retaining normalized offsets.
 * @param {string} source Callable source.
 * @returns {{ node: Record<string, any>, offset: number } | null} Parsed method.
 */
function parseCallable(source) {
    if (CALLABLE_CACHE.has(source)) return CALLABLE_CACHE.get(source)
    const prefix = 'class __GerberVariant__ {'
    let parsed = null
    try {
        const ast = parsers.babel.parse(`${prefix}${source}}`, {
            filepath: 'gerber-variant-callable.mjs'
        })
        parsed = {
            node: ast.program.body[0].body.body[0],
            offset: prefix.length
        }
    } catch {
        parsed = null
    }
    CALLABLE_CACHE.set(source, parsed)
    return parsed
}

/**
 * Resolves a member-to-literal equality test.
 * @param {Record<string, any>} node Test expression.
 * @returns {{ root: string, path: string, value: unknown } | null} Guard.
 */
function equalityGuard(node) {
    if (
        node?.type !== 'BinaryExpression' ||
        !['===', '=='].includes(node.operator)
    ) {
        return null
    }
    for (const [member, literal] of [
        [node.left, node.right],
        [node.right, node.left]
    ]) {
        const target = memberTarget(member)
        const value = literalValue(literal)
        if (target?.path && value.known)
            return { ...target, value: value.value }
    }
    return null
}

/**
 * Resolves one static member target.
 * @param {Record<string, any>} node Candidate member.
 * @returns {{ root: string, path: string } | null} Member target.
 */
function memberTarget(node) {
    if (node?.type === 'Identifier') return { root: node.name, path: '' }
    if (!isMember(node)) return null
    const parent = memberTarget(node.object)
    const name = memberName(node)
    return parent && name
        ? {
              root: parent.root,
              path: [parent.path, name].filter(Boolean).join('.')
          }
        : null
}

/**
 * Resolves a primitive literal without executing code.
 * @param {Record<string, any>} node Candidate literal.
 * @returns {{ known: boolean, value?: unknown }} Literal result.
 */
function literalValue(node) {
    if (node?.type === 'StringLiteral' || node?.type === 'NumericLiteral') {
        return { known: true, value: node.value }
    }
    if (node?.type === 'BooleanLiteral')
        return { known: true, value: node.value }
    if (node?.type === 'NullLiteral') return { known: true, value: null }
    return { known: false }
}

/**
 * Reads one static property name.
 * @param {Record<string, any>} node Property or member node.
 * @returns {string} Static name.
 */
function propertyName(node) {
    const key = node?.key
    if (!key) return ''
    if (key.type === 'Identifier') return key.name
    return ['StringLiteral', 'NumericLiteral'].includes(key.type)
        ? String(key.value)
        : ''
}

/**
 * Reads one static member name.
 * @param {Record<string, any>} node Member node.
 * @returns {string} Static name.
 */
function memberName(node) {
    const property = node?.property
    if (!property) return ''
    if (!node.computed && property.type === 'Identifier') return property.name
    if (!node.computed && property.type === 'PrivateName')
        return `#${property.id.name}`
    return ['StringLiteral', 'NumericLiteral'].includes(property.type)
        ? String(property.value)
        : ''
}

/**
 * Encodes one discriminated collection fact without string collisions.
 * @param {string} entrypoint Owning package entrypoint.
 * @param {string} exportName Owning class.
 * @param {string} discriminator Discriminator member path.
 * @param {unknown} value Literal discriminator value.
 * @param {string} collection Collection member path.
 * @returns {string} Stable fact key.
 */
function variantKey(entrypoint, exportName, discriminator, value, collection) {
    return JSON.stringify([
        entrypoint,
        exportName,
        discriminator,
        value,
        collection
    ])
}

/**
 * Walks AST descendants.
 * @param {Record<string, any>} node Root node.
 * @param {(node: Record<string, any>) => void} visit Visitor.
 * @returns {void}
 */
function walk(node, visit) {
    if (!node || typeof node !== 'object') return
    if (typeof node.type === 'string') visit(node)
    for (const [key, value] of Object.entries(node)) {
        if (['loc', 'start', 'end', 'comments', 'errors'].includes(key))
            continue
        for (const child of Array.isArray(value) ? value : [value]) {
            if (child && typeof child === 'object') walk(child, visit)
        }
    }
}

/**
 * Checks call-expression variants.
 * @param {Record<string, any>} node AST node.
 * @returns {boolean} Whether this is a call.
 */
function isCall(node) {
    return ['CallExpression', 'OptionalCallExpression'].includes(node?.type)
}

/**
 * Checks member-expression variants.
 * @param {Record<string, any>} node AST node.
 * @returns {boolean} Whether this is a member.
 */
function isMember(node) {
    return ['MemberExpression', 'OptionalMemberExpression'].includes(node?.type)
}
