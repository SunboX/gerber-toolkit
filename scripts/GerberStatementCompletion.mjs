/**
 * Resolves syntax that unconditionally completes the current statement list.
 */
export class GerberStatementCompletion {
    /**
     * Checks whether a statement has no normal fallthrough path.
     * @param {Record<string, any> | null} statement Statement AST.
     * @returns {boolean} Whether every path completes abruptly.
     */
    static terminates(statement) {
        if (!statement) return false
        if (
            [
                'BreakStatement',
                'ContinueStatement',
                'ReturnStatement',
                'ThrowStatement'
            ].includes(statement.type)
        ) {
            return true
        }
        if (statement.type === 'BlockStatement') {
            return GerberStatementCompletion.listTerminates(statement.body)
        }
        if (statement.type === 'IfStatement') {
            return (
                Boolean(statement.alternate) &&
                GerberStatementCompletion.terminates(statement.consequent) &&
                GerberStatementCompletion.terminates(statement.alternate)
            )
        }
        if (statement.type === 'TryStatement') {
            if (GerberStatementCompletion.terminates(statement.finalizer)) {
                return true
            }
            return (
                GerberStatementCompletion.terminates(statement.block) &&
                (!statement.handler ||
                    GerberStatementCompletion.terminates(
                        statement.handler.body
                    ))
            )
        }
        return false
    }

    /**
     * Checks whether a statement list reaches an unconditional completion.
     * @param {Record<string, any>[]} statements Statement list.
     * @returns {boolean} Whether normal execution cannot leave the list.
     */
    static listTerminates(statements) {
        return (statements || []).some((statement) =>
            GerberStatementCompletion.terminates(statement)
        )
    }
}
