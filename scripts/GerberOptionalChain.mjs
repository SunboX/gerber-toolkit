import { GerberStaticValue } from './GerberStaticValue.mjs'

/**
 * Resolves statically short-circuited optional calls and members.
 */
export class GerberOptionalChain {
    /**
     * Checks whether an optional call skips its argument list.
     * @param {Record<string, any>} node Call expression.
     * @param {Record<string, any>} scope Lexical scope.
     * @returns {boolean} Whether the call short-circuits.
     */
    static skipsCall(node, scope) {
        return (
            node?.type === 'OptionalCallExpression' &&
            node.optional === true &&
            GerberStaticValue.nullish(node.callee, scope) === true
        )
    }

    /**
     * Checks whether an optional member skips its key evaluation.
     * @param {Record<string, any>} node Member expression.
     * @param {Record<string, any>} scope Lexical scope.
     * @returns {boolean} Whether the member short-circuits.
     */
    static skipsMember(node, scope) {
        return (
            node?.type === 'OptionalMemberExpression' &&
            node.optional === true &&
            GerberStaticValue.nullish(node.object, scope) === true
        )
    }
}
