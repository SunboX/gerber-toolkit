import { GerberSourceBindingJoin } from './GerberSourceBindingJoin.mjs'

/**
 * Captures source state immediately before potentially throwing calls.
 */
export class GerberSourceThrowCapture {
    /** @param {Record<string, any>[]} bindings Shared binding facts. */
    constructor(bindings) {
        this.bindings = bindings
        this.stack = []
    }

    /**
     * Executes a try block while collecting its direct call throw points.
     * @param {number} start Baseline binding index.
     * @param {() => string} execute Block executor.
     * @returns {{ flow: string, points: { records: Record<string, any>[], scope: Record<string, any>[] }[] }} Flow and throw states.
     */
    run(start, execute) {
        const capture = { start, points: [] }
        this.stack.push(capture)
        try {
            return { flow: execute(), points: capture.points }
        } finally {
            this.stack.pop()
        }
    }

    /**
     * Records state before one call when a try capture is active.
     * @param {Record<string, any>} scope Active lexical scope.
     * @returns {void}
     */
    record(scope) {
        const capture = this.stack.at(-1)
        if (!capture) return
        capture.points.push({
            records: this.bindings.slice(capture.start),
            scope: GerberSourceBindingJoin.snapshot(scope)
        })
    }
}
