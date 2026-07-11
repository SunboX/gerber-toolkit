import { parsers } from 'prettier/plugins/babel'

import { GerberResultExpressionAnalysis } from './GerberResultExpressionAnalysis.mjs'
import { GerberSourceAstSupport } from './GerberSourceAstSupport.mjs'
import { GerberSourceCallable } from './GerberSourceCallable.mjs'

const ELEMENT_METHODS = new Set(['at', 'find', 'findLast', 'pop', 'shift'])
const ARRAY_METHODS = new Set(['concat', 'slice', 'splice'])

/**
 * Resolves exact result shapes for intrinsic collection selectors.
 */
export class GerberResultCollectionSelection {
    /**
     * Selects expressions represented by one collection operation.
     * @param {string} expression Result expression.
     * @param {Record<string, any>} state Callable analysis state.
     * @param {number} position Expression source position.
     * @returns {{ handled: boolean, expressions: string[] } | null} Selection or null.
     */
    static resolve(expression, state, position) {
        const parsed = parseExpression(expression)
        const node = parsed?.node
        if (!isCall(node) || !isMember(node.callee)) return null
        const method = staticName(node.callee)
        const receiver = text(parsed, node.callee.object)
        if (!receiver) return null
        if (
            GerberResultCollectionSelection.#methodOverridden(
                node.callee.object,
                method,
                state,
                position
            )
        ) {
            return { handled: true, expressions: [] }
        }
        if (
            ['map', 'flatMap'].includes(method) &&
            GerberResultCollectionSelection.#nonValueCallback(
                node.arguments[0],
                parsed,
                state,
                position
            )
        ) {
            return { handled: true, expressions: [] }
        }
        if (!ELEMENT_METHODS.has(method) && !ARRAY_METHODS.has(method)) {
            return null
        }
        if (
            GerberResultExpressionAnalysis.collectionDepth(
                receiver,
                state,
                position
            ) <= 0
        ) {
            return null
        }
        const elements = elementExpressions(receiver, state, position)
        if (ELEMENT_METHODS.has(method)) {
            return {
                handled: true,
                expressions: selectElementExpressions(
                    method,
                    elements,
                    node.arguments,
                    parsed,
                    receiver
                )
            }
        }
        return {
            handled: true,
            expressions: selectArrayExpressions(
                method,
                elements,
                node.arguments,
                parsed,
                receiver,
                state,
                position
            )
        }
    }

    /**
     * Checks whether an Array method was replaced before this expression.
     * @param {Record<string, any>} receiver Receiver AST.
     * @param {string} method Method name.
     * @param {Record<string, any>} state Callable state.
     * @param {number} position Expression position.
     * @returns {boolean} Whether intrinsic semantics are unavailable.
     */
    static #methodOverridden(receiver, method, state, position) {
        const target = GerberSourceAstSupport.memberTarget(receiver)
        if (!target || !method) return false
        const path = [target.path, method].filter(Boolean).join('.')
        return (state.assignments?.get(target.root) || []).some(
            (assignment) =>
                assignment.index <= position && assignment.path === path
        )
    }

    /**
     * Checks callbacks whose runtime elements are promises or iterators.
     * @param {Record<string, any> | null} callback Callback AST.
     * @param {Record<string, any>} parsed Parsed outer expression.
     * @param {Record<string, any>} state Callable state.
     * @param {number} position Use position.
     * @returns {boolean} Whether callback values must not be flattened.
     */
    static #nonValueCallback(callback, parsed, state, position) {
        let source = callback
            ? text(parsed, callback.expression || callback)
            : ''
        if (/^[A-Za-z_$][\w$]*$/u.test(source)) {
            const candidates = new Set(
                GerberSourceCallable.bindingExpressions(source, state, position)
            )
            source = candidates.size === 1 ? [...candidates][0] : ''
        }
        if (!source) return false
        try {
            const { callable } = GerberSourceAstSupport.parseCallable(
                source,
                false
            )
            return Boolean(callable.async || callable.generator)
        } catch {
            return false
        }
    }
}

/**
 * Selects element-returning operation expressions.
 * @param {string} method Selector method.
 * @param {string[] | null} elements Static elements or null.
 * @param {Record<string, any>[]} argumentsList Call arguments.
 * @param {Record<string, any>} parsed Parsed expression.
 * @param {string} receiver Receiver source fallback.
 * @returns {string[]} Possible selected element expressions.
 */
function selectElementExpressions(
    method,
    elements,
    argumentsList,
    parsed,
    receiver
) {
    if (!elements) return [receiver]
    if (!elements.length) return []
    if (method === 'pop') return [elements.at(-1)]
    if (method === 'shift') return [elements[0]]
    if (method === 'at') {
        const index = staticInteger(argumentsList[0])
        return index === null ? elements : [elements.at(index)].filter(Boolean)
    }
    const truth = callbackTruth(argumentsList[0])
    if (truth === false) return []
    if (truth === true) {
        return method === 'findLast' ? [elements.at(-1)] : [elements[0]]
    }
    void parsed
    return elements
}

/**
 * Selects array-returning operation expressions.
 * @param {string} method Array operation.
 * @param {string[] | null} elements Static receiver elements.
 * @param {Record<string, any>[]} argumentsList Call arguments.
 * @param {Record<string, any>} parsed Parsed expression.
 * @param {string} receiver Receiver source fallback.
 * @param {Record<string, any>} state Callable state.
 * @param {number} position Use position.
 * @returns {string[]} Possible output element expressions.
 */
function selectArrayExpressions(
    method,
    elements,
    argumentsList,
    parsed,
    receiver,
    state,
    position
) {
    if (method === 'concat') {
        const output = elements ? [...elements] : [receiver]
        for (const argument of argumentsList) {
            const source = text(parsed, argument.expression || argument)
            output.push(
                ...(elementExpressions(source, state, position) || [source])
            )
        }
        return output
    }
    if (!elements) return [receiver]
    const start = staticInteger(argumentsList[0])
    const end = staticInteger(argumentsList[1])
    if (method === 'slice') {
        return start === null || (argumentsList[1] && end === null)
            ? elements
            : elements.slice(start || 0, argumentsList[1] ? end : undefined)
    }
    const deleteCount = staticInteger(argumentsList[1])
    if (start === null || (argumentsList[1] && deleteCount === null)) {
        return elements
    }
    return elements.slice(
        start,
        argumentsList[1] ? start + deleteCount : undefined
    )
}

/**
 * Resolves static Array element source expressions.
 * @param {string} source Collection source.
 * @param {Record<string, any>} state Callable state.
 * @param {number} position Use position.
 * @param {Set<string>} [seen] Active identifiers.
 * @returns {string[] | null} Elements or null when unknown.
 */
function elementExpressions(source, state, position, seen = new Set()) {
    const parsed = parseExpression(source)
    if (!parsed) return null
    if (parsed.node.type === 'ArrayExpression') {
        return parsed.node.elements
            .filter(Boolean)
            .map((element) => text(parsed, element.expression || element))
    }
    if (parsed.node.type !== 'Identifier' || seen.has(parsed.node.name)) {
        return null
    }
    const candidates = new Set(
        GerberSourceCallable.bindingExpressions(
            parsed.node.name,
            state,
            position
        )
    )
    if (candidates.size !== 1) return null
    return elementExpressions(
        [...candidates][0],
        state,
        position,
        new Set(seen).add(parsed.node.name)
    )
}

/**
 * Resolves a literal integer argument.
 * @param {Record<string, any> | null} node Argument AST.
 * @returns {number | null} Integer or null.
 */
function staticInteger(node) {
    const value = node?.expression || node
    if (value?.type === 'NumericLiteral' && Number.isInteger(value.value)) {
        return value.value
    }
    if (
        value?.type === 'UnaryExpression' &&
        value.operator === '-' &&
        value.argument?.type === 'NumericLiteral' &&
        Number.isInteger(value.argument.value)
    ) {
        return -value.argument.value
    }
    return null
}

/**
 * Resolves a callback that always returns one Boolean literal.
 * @param {Record<string, any> | null} node Callback AST.
 * @returns {boolean | null} Constant truth or null.
 */
function callbackTruth(node) {
    const callback = node?.expression || node
    if (!callback) return null
    let value = callback.body
    if (value?.type === 'BlockStatement' && value.body.length === 1) {
        value =
            value.body[0]?.type === 'ReturnStatement'
                ? value.body[0].argument
                : null
    }
    return value?.type === 'BooleanLiteral' ? value.value : null
}

/**
 * Parses one isolated result expression.
 * @param {string} source Expression source.
 * @returns {{ source: string, offset: number, node: Record<string, any> } | null} Parsed expression.
 */
function parseExpression(source) {
    const value = String(source || '').trim()
    if (!value) return null
    const prefix = 'const __gerber_collection__ = ('
    try {
        const ast = parsers.babel.parse(`${prefix}${value})`, {
            filepath: 'gerber-result-collection.mjs'
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

/** @param {Record<string, any> | null} node AST node. @returns {boolean} Call status. */
function isCall(node) {
    return ['CallExpression', 'OptionalCallExpression'].includes(node?.type)
}

/** @param {Record<string, any> | null} node AST node. @returns {boolean} Member status. */
function isMember(node) {
    return ['MemberExpression', 'OptionalMemberExpression'].includes(node?.type)
}

/** @param {Record<string, any>} node Member node. @returns {string} Static name. */
function staticName(node) {
    const property = node?.property
    if (!property) return ''
    if (!node.computed && property.type === 'Identifier') return property.name
    return ['StringLiteral', 'NumericLiteral'].includes(property.type)
        ? String(property.value)
        : ''
}
