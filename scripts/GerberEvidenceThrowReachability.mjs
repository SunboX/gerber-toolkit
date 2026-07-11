const THROWING_EXPRESSIONS = new Set([
    'AwaitExpression',
    'CallExpression',
    'ImportExpression',
    'MemberExpression',
    'NewExpression',
    'OptionalCallExpression',
    'OptionalMemberExpression',
    'SpreadElement',
    'TaggedTemplateExpression',
    'UpdateExpression'
])
const FUNCTION_NODES = new Set([
    'ArrowFunctionExpression',
    'ClassMethod',
    'ClassPrivateMethod',
    'FunctionDeclaration',
    'FunctionExpression',
    'ObjectMethod'
])

/**
 * Detects reachable syntax whose evaluation can enter a catch handler.
 */
export class GerberEvidenceThrowReachability {
    /**
     * Checks a statement or expression without entering nested callables.
     * @param {Record<string, any> | null} node AST node.
     * @returns {boolean} Whether evaluating the node may throw.
     */
    static canThrow(node) {
        return canThrow(node)
    }
}

/**
 * Recursively checks one reachable AST node.
 * @param {Record<string, any> | null} node AST node.
 * @returns {boolean} Whether evaluating the node may throw.
 */
function canThrow(node) {
    if (!node || typeof node !== 'object') return false
    if (node.type === 'ThrowStatement') return true
    if (FUNCTION_NODES.has(node.type)) {
        return node.computed ? canThrow(node.key) : false
    }
    if (THROWING_EXPRESSIONS.has(node.type)) return true
    if (node.type === 'BlockStatement' || node.type === 'Program') {
        return statementListCanThrow(node.body)
    }
    for (const [key, child] of Object.entries(node)) {
        if (['comments', 'loc', 'tokens'].includes(key)) continue
        if (Array.isArray(child)) {
            if (child.some((entry) => canThrow(entry))) return true
        } else if (canThrow(child)) {
            return true
        }
    }
    return false
}

/**
 * Stops scanning a statement list after an unconditional direct completion.
 * @param {Record<string, any>[]} statements AST statements.
 * @returns {boolean} Whether a reachable statement may throw.
 */
function statementListCanThrow(statements) {
    for (const statement of statements || []) {
        if (canThrow(statement)) return true
        if (GerberStatementCompletion.terminates(statement)) break
    }
    return false
}

import { GerberStatementCompletion } from './GerberStatementCompletion.mjs'
