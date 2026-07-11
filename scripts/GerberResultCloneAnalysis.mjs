import { parsers } from 'prettier/plugins/babel'

/**
 * Models JSON and structured-clone shape transformations without execution.
 */
export class GerberResultCloneAnalysis {
    /**
     * Resolves one supported clone expression.
     * @param {string} expression Clone expression.
     * @param {{ JSON: boolean, structuredClone: boolean, undefined: boolean, Symbol: boolean }} intrinsics Available intrinsics.
     * @returns {{ source: string, removed: Set<string>, throws: boolean } | null} Clone contract.
     */
    static resolve(expression, intrinsics) {
        const parsed = parseExpression(expression)
        const node = parsed?.node
        if (!node) return null
        if (
            intrinsics.structuredClone &&
            isIdentifierCall(node, 'structuredClone')
        ) {
            const value = node.arguments[0]?.expression || node.arguments[0]
            if (!value) return null
            return {
                source: text(parsed, value),
                removed: new Set(),
                throws: structuredCloneThrows(value, intrinsics)
            }
        }
        if (!intrinsics.JSON || !isMemberCall(node, 'JSON', 'parse')) {
            return null
        }
        const serialized = node.arguments[0]?.expression || node.arguments[0]
        if (!isMemberCall(serialized, 'JSON', 'stringify')) return null
        const value =
            serialized.arguments[0]?.expression || serialized.arguments[0]
        if (!value) return null
        const removed = new Set()
        return {
            source: text(parsed, value),
            removed,
            throws: jsonTransform(value, '', removed, intrinsics)
        }
    }
}

/**
 * Collects JSON-omitted object properties and definite serialization errors.
 * @param {Record<string, any>} node Value node.
 * @param {string} prefix Property prefix.
 * @param {Set<string>} removed Omitted paths.
 * @param {Record<string, boolean>} intrinsics Intrinsic availability.
 * @returns {boolean} Whether serialization definitely throws.
 */
function jsonTransform(node, prefix, removed, intrinsics) {
    if (isBigInt(node)) return true
    if (node?.type === 'ArrayExpression') {
        return node.elements.some((element) =>
            jsonTransform(
                element?.argument || element,
                prefix,
                removed,
                intrinsics
            )
        )
    }
    if (node?.type !== 'ObjectExpression') return false
    for (const property of node.properties || []) {
        if (property.type === 'SpreadElement') continue
        const name = staticName(property)
        if (!name) continue
        const path = [prefix, name].filter(Boolean).join('.')
        if (
            (property.type === 'ObjectMethod' && property.kind === 'method') ||
            jsonOmitted(property.value, intrinsics)
        ) {
            removed.add(path)
            continue
        }
        if (jsonTransform(property.value, path, removed, intrinsics)) {
            return true
        }
    }
    return false
}

/**
 * Checks a value omitted from an object by JSON.stringify.
 * @param {Record<string, any> | null} node Value node.
 * @param {Record<string, boolean>} intrinsics Intrinsic availability.
 * @returns {boolean} Omission status.
 */
function jsonOmitted(node, intrinsics) {
    return Boolean(
        ['ArrowFunctionExpression', 'FunctionExpression'].includes(
            node?.type
        ) ||
        (intrinsics.undefined &&
            node?.type === 'Identifier' &&
            node.name === 'undefined') ||
        (intrinsics.Symbol && isIdentifierCall(node, 'Symbol'))
    )
}

/**
 * Checks definite structured-clone errors in a literal value graph.
 * @param {Record<string, any> | null} node Value node.
 * @param {Record<string, boolean>} intrinsics Intrinsic availability.
 * @returns {boolean} Definite DataCloneError status.
 */
function structuredCloneThrows(node, intrinsics) {
    if (!node) return false
    if (
        ['ArrowFunctionExpression', 'FunctionExpression'].includes(node.type) ||
        (node.type === 'ObjectMethod' && node.kind === 'method') ||
        (intrinsics.Symbol && isIdentifierCall(node, 'Symbol'))
    ) {
        return true
    }
    if (
        node.type === 'NewExpression' &&
        node.callee?.type === 'Identifier' &&
        ['Promise', 'WeakMap', 'WeakSet'].includes(node.callee.name)
    ) {
        return true
    }
    for (const [key, value] of Object.entries(node)) {
        if (['loc', 'start', 'end', 'type', 'comments'].includes(key)) continue
        for (const child of Array.isArray(value) ? value : [value]) {
            if (
                child &&
                typeof child === 'object' &&
                structuredCloneThrows(child, intrinsics)
            ) {
                return true
            }
        }
    }
    return false
}

/** @param {Record<string, any>} node Node. @returns {boolean} BigInt status. */
function isBigInt(node) {
    return ['BigIntLiteral', 'BigInt'].includes(node?.type)
}

/**
 * Checks a direct identifier call.
 * @param {Record<string, any> | null} node Call node.
 * @param {string} name Identifier name.
 * @returns {boolean} Match status.
 */
function isIdentifierCall(node, name) {
    return (
        ['CallExpression', 'OptionalCallExpression'].includes(node?.type) &&
        node.callee?.type === 'Identifier' &&
        node.callee.name === name
    )
}

/**
 * Checks one static object method call.
 * @param {Record<string, any> | null} node Call node.
 * @param {string} owner Owner name.
 * @param {string} method Method name.
 * @returns {boolean} Match status.
 */
function isMemberCall(node, owner, method) {
    return (
        ['CallExpression', 'OptionalCallExpression'].includes(node?.type) &&
        ['MemberExpression', 'OptionalMemberExpression'].includes(
            node.callee?.type
        ) &&
        node.callee.object?.type === 'Identifier' &&
        node.callee.object.name === owner &&
        staticName(node.callee) === method
    )
}

/** @param {Record<string, any>} node Property node. @returns {string} Name. */
function staticName(node) {
    const key = node?.key || node?.property
    if (!key) return ''
    if (!node.computed && key.type === 'Identifier') return key.name
    return ['StringLiteral', 'NumericLiteral'].includes(key.type)
        ? String(key.value)
        : ''
}

/**
 * Parses an isolated expression.
 * @param {string} source Expression source.
 * @returns {{ source: string, offset: number, node: Record<string, any> } | null} Parsed expression.
 */
function parseExpression(source) {
    const value = String(source || '').trim()
    const prefix = 'const __gerber_clone__ = ('
    try {
        const ast = parsers.babel.parse(`${prefix}${value})`, {
            filepath: 'gerber-result-clone.mjs'
        })
        return {
            source: value,
            offset: prefix.length,
            node: ast.program.body[0].declarations[0].init
        }
    } catch {
        return null
    }
}

/**
 * Reads one AST node from its isolated source.
 * @param {Record<string, any>} parsed Parsed source.
 * @param {Record<string, any>} node AST node.
 * @returns {string} Node source.
 */
function text(parsed, node) {
    return parsed.source.slice(
        node.start - parsed.offset,
        node.end - parsed.offset
    )
}
