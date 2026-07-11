/**
 * Captures evidence environments immediately before potentially throwing calls.
 */
export class GerberEvidenceThrowCapture {
    constructor() {
        this.stack = []
    }

    /**
     * Executes a try block while collecting direct call throw points.
     * @param {() => Record<string, any>} execute Block executor.
     * @returns {{ outcome: Record<string, any>, points: Record<string, any>[] }} Outcome and throw states.
     */
    run(execute) {
        const points = []
        this.stack.push(points)
        try {
            return { outcome: execute(), points }
        } finally {
            this.stack.pop()
        }
    }

    /**
     * Records one independent pre-call environment.
     * @param {Record<string, any>} environment Active environment.
     * @returns {void}
     */
    record(environment) {
        this.stack.at(-1)?.push(environment.fork())
    }
}
