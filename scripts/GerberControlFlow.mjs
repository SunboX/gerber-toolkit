/**
 * Encodes and resolves labeled JavaScript break/continue outcomes.
 */
export class GerberControlFlow {
    /**
     * Encodes a break or continue statement without discarding its label.
     * @param {'break' | 'continue'} kind Control-flow kind.
     * @param {Record<string, any>} node Statement AST node.
     * @returns {string} Encoded abrupt outcome.
     */
    static encode(kind, node) {
        const label = node?.label?.name || ''
        return label ? `${kind}:${label}` : kind
    }

    /**
     * Extracts the base abrupt kind from an encoded outcome.
     * @param {string} flow Encoded flow.
     * @returns {string} Base abrupt kind.
     */
    static kind(flow) {
        return String(flow || '').split(':', 1)[0]
    }

    /**
     * Extracts an optional control-flow label.
     * @param {string} flow Encoded flow.
     * @returns {string} Label or an empty string.
     */
    static label(flow) {
        const separator = String(flow || '').indexOf(':')
        return separator < 0 ? '' : String(flow).slice(separator + 1)
    }

    /**
     * Checks whether a loop consumes an abrupt outcome.
     * @param {string} flow Encoded flow.
     * @param {string} [loopLabel] Label attached directly to the loop.
     * @returns {boolean} Whether the loop is the outcome's target.
     */
    static consumedByLoop(flow, loopLabel = '') {
        const kind = GerberControlFlow.kind(flow)
        if (!['break', 'continue'].includes(kind)) return false
        const target = GerberControlFlow.label(flow)
        return !target || target === loopLabel
    }

    /**
     * Checks whether a labeled statement consumes a matching break.
     * @param {string} flow Encoded flow.
     * @param {string} label Statement label.
     * @returns {boolean} Whether this label is the break target.
     */
    static consumedByLabel(flow, label) {
        return (
            GerberControlFlow.kind(flow) === 'break' &&
            Boolean(label) &&
            GerberControlFlow.label(flow) === label
        )
    }
}
