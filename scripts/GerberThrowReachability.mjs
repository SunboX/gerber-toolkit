import { GerberStatementCompletion } from './GerberStatementCompletion.mjs'

const THROWING_NODE_TYPES = new Set([
    'AwaitExpression',
    'CallExpression',
    'ClassExpression',
    'MemberExpression',
    'NewExpression',
    'OptionalCallExpression',
    'OptionalMemberExpression',
    'SpreadElement',
    'TaggedTemplateExpression',
    'ThrowStatement',
    'UpdateExpression',
    'YieldExpression'
])

/**
 * Conservatively detects reachable operations that can transfer into catch.
 */
export class GerberThrowReachability {
    /**
     * Checks whether executing an AST subtree can throw.
     * @param {Record<string, any> | null} node AST subtree.
     * @returns {boolean} Whether a catch alternative is reachable.
     */
    static canThrow(node) {
        if (!node || typeof node !== 'object') return false
        if (GerberThrowReachability.#isNestedFunction(node)) return false
        if (THROWING_NODE_TYPES.has(node.type)) return true
        if (node.type === 'BlockStatement' || node.type === 'Program') {
            for (const statement of node.body || []) {
                if (GerberThrowReachability.canThrow(statement)) return true
                if (GerberStatementCompletion.terminates(statement)) break
            }
            return false
        }
        for (const [key, value] of Object.entries(node)) {
            if (
                ['loc', 'start', 'end', 'type', 'comments', 'errors'].includes(
                    key
                )
            ) {
                continue
            }
            for (const child of Array.isArray(value) ? value : [value]) {
                if (GerberThrowReachability.canThrow(child)) return true
            }
        }
        return false
    }

    /**
     * Checks function bodies that are created but not executed in place.
     * @param {Record<string, any>} node AST node.
     * @returns {boolean} Whether this is a nested callable.
     */
    static #isNestedFunction(node) {
        return [
            'ArrowFunctionExpression',
            'FunctionDeclaration',
            'FunctionExpression',
            'ObjectMethod'
        ].includes(node.type)
    }
}
