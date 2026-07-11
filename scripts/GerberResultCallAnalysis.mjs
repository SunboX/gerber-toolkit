import { GerberSourceExpression } from './GerberSourceExpression.mjs'

/**
 * Parses graph-call targets and their receiver kinds.
 */
export class GerberResultCallAnalysis {
    /**
     * Parses one complete receiver-method call.
     * @param {string} expression Expression source.
     * @param {Record<string, any>} state Local analysis state.
     * @returns {{ exportName: string, methodName: string, methodType: string, argumentSources: string[] } | null} Call target.
     */
    static directCall(expression, state) {
        const match =
            /^([A-Za-z_$][\w$]*(?:(?:\?\.|\.)[A-Za-z_$][\w$]*)*)\.(#?[A-Za-z_$][\w$]*)\s*\(/u.exec(
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
        if (expression.slice(close + 1).trim()) return null
        return {
            ...GerberResultCallAnalysis.callTarget(match[1], match[2], state),
            argumentSources: GerberSourceExpression.splitTopLevel(
                expression.slice(open + 1, close)
            )
        }
    }

    /**
     * Converts a call receiver into one graph target.
     * @param {string} receiver Call receiver.
     * @param {string} methodName Method name.
     * @param {Record<string, any>} state Local analysis state.
     * @returns {{ exportName: string, receiver: string, methodName: string, methodType: string }} Call target.
     */
    static callTarget(receiver, methodName, state) {
        const normalizedReceiver = receiver.replace(/\?\./gu, '.')
        const instanceClass = state.variableTypes.get(normalizedReceiver)
        const inferredInstance =
            !instanceClass && normalizedReceiver.includes('.')
        return {
            exportName:
                instanceClass || (inferredInstance ? '' : normalizedReceiver),
            receiver: normalizedReceiver,
            methodName,
            methodType: instanceClass
                ? 'instance'
                : inferredInstance
                  ? 'instance-inferred'
                  : methodName.startsWith('#')
                    ? 'static-private'
                    : 'static'
        }
    }
}
