import { GerberSourceAst } from './GerberSourceAst.mjs'
import { GerberSourceExpression } from './GerberSourceExpression.mjs'

/**
 * Projects reachable AST call facts into legacy delegate records.
 */
export class GerberReachableCalls {
    /**
     * Lists reachable direct static calls and exact returned delegates.
     * @param {string} source Callable source.
     * @returns {Record<string, any>[]} Delegate call records.
     */
    static inspect(source) {
        const facts = GerberSourceAst.facts(source)
        return facts.calls
            .filter((call) => /^[A-Za-z_$][\w$]*$/u.test(call.receiver))
            .map((call) => ({
                exportName: call.receiver,
                methodName: call.methodName,
                arguments: call.arguments,
                returned: facts.returns.some((record) =>
                    exactReturnedCall(record.expression, call)
                )
            }))
    }
}

/**
 * Checks whether one return expression is exactly the candidate call.
 * @param {string} expression Return expression.
 * @param {Record<string, any>} call Candidate call.
 * @returns {boolean} Whether the call is returned without a projection.
 */
function exactReturnedCall(expression, call) {
    const value = GerberSourceExpression.stripParentheses(
        expression.trim().replace(/^await\s+/u, '')
    )
    const prefix = `${call.receiver}.${call.methodName}`
    if (!value.startsWith(prefix)) return false
    const open = value.indexOf('(', prefix.length)
    if (open < 0) return false
    const close = GerberSourceExpression.matchingDelimiter(
        value,
        open,
        '(',
        ')'
    )
    return value.slice(close + 1).trim() === ''
}
