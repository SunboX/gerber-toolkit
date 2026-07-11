import { GerberSourceBindingJoin } from './GerberSourceBindingJoin.mjs'

/**
 * Joins state mutations from uncertain expression alternatives.
 */
export class GerberSourceExpressionFlow {
    /**
     * Evaluates every reachable expression from the same baseline state.
     * @param {{ alternatives: (Record<string, any> | null)[], scope: Record<string, any>, bindings: Record<string, any>[], position: number, evaluate: (node: Record<string, any>, scope: Record<string, any>) => void }} options Join inputs.
     * @returns {void}
     */
    static join(options) {
        const baselineCount = options.bindings.length
        const baselineScope = GerberSourceBindingJoin.snapshot(options.scope)
        const records = []
        const scopes = []
        for (const alternative of options.alternatives) {
            GerberSourceBindingJoin.restore(baselineScope)
            const start = options.bindings.length
            if (alternative) options.evaluate(alternative, options.scope)
            records.push(options.bindings.slice(start))
            scopes.push(GerberSourceBindingJoin.snapshot(options.scope))
        }
        GerberSourceBindingJoin.mergeScopes(baselineScope, scopes)
        GerberSourceBindingJoin.mergeRecords(
            options.bindings,
            baselineCount,
            records,
            options.position
        )
    }
}
