import { GerberStaticValue } from './GerberStaticValue.mjs'

/**
 * Resolves statically empty for-of and for-in iteration sources.
 */
export class GerberLoopIterationReachability {
    /**
     * Checks whether a loop source can yield at least one iteration.
     * @param {'ForOfStatement' | 'ForInStatement'} type Loop type.
     * @param {Record<string, any> | null} node Iteration source.
     * @param {{ get: (name: string) => Record<string, any> | null }} scope Scope.
     * @param {Set<string>} [seen] Active identifier chain.
     * @returns {boolean | null} Known reachability or null.
     */
    static mayIterate(type, node, scope, seen = new Set()) {
        if (!node) return null
        if (node.type === 'Identifier') {
            if (seen.has(node.name)) return null
            const initializer = scope.get(node.name)?.initializer
            return initializer
                ? GerberLoopIterationReachability.mayIterate(
                      type,
                      initializer,
                      scope,
                      new Set(seen).add(node.name)
                  )
                : null
        }
        if (node.type === 'ArrayExpression') {
            return type === 'ForOfStatement'
                ? node.elements.length > 0
                : node.elements.some(Boolean)
        }
        if (node.type === 'ObjectExpression') {
            if (
                node.properties.some(
                    (property) => property.type === 'SpreadElement'
                )
            ) {
                return null
            }
            return type === 'ForInStatement' ? node.properties.length > 0 : null
        }
        if (type === 'ForOfStatement') {
            const value = GerberStaticValue.resolve(node, scope)
            if (value.known && typeof value.value === 'string') {
                return value.value.length > 0
            }
        }
        if (
            node.type === 'NewExpression' &&
            node.callee?.type === 'Identifier' &&
            ['Map', 'Set'].includes(node.callee.name) &&
            !scope.get(node.callee.name) &&
            !node.arguments.length
        ) {
            return false
        }
        return null
    }
}
