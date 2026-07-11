import { ParserWorkerClient } from 'circuitjson-toolkit/parser'

let client = null

/** Owns the Gerber worker while reusing the shared worker protocol. */
export class GerberWorkerClient {
    /** @returns {boolean} Whether Worker construction is available. */
    static isAvailable() {
        try {
            return typeof globalThis.Worker === 'function'
        } catch {
            return false
        }
    }

    /** @param {object} input Input. @param {object} options Options. @returns {Promise<object>} Document. */
    static async parse(input, options) {
        return await GerberWorkerClient.#client().parse(input, options)
    }

    /** @param {object} input Input. @param {object} options Options. @returns {Promise<object>} Attempt. */
    static async parseAttempt(input, options) {
        return await GerberWorkerClient.#client().parseAttempt(input, options)
    }

    /** @param {object[]} entries Entries. @param {object} options Options. @returns {Promise<object>} Project. */
    static async loadProject(entries, options) {
        return await GerberWorkerClient.#client().loadProject(entries, options)
    }

    /** @param {object[]} entries Entries. @param {object} options Options. @returns {Promise<object>} Attempt. */
    static async loadProjectAttempt(entries, options) {
        return await GerberWorkerClient.#client().loadProjectAttempt(
            entries,
            options
        )
    }

    /** Disposes the lazy client. */
    static dispose() {
        client?.dispose()
        client = null
    }

    /** @returns {ParserWorkerClient} Shared-protocol client. */
    static #client() {
        if (!client) {
            client = new ParserWorkerClient({
                createWorker: () =>
                    Reflect.construct(globalThis.Worker, [
                        new URL(
                            '../workers/parser.worker.mjs',
                            import.meta.url
                        ),
                        { type: 'module' }
                    ])
            })
        }
        return client
    }
}

Object.freeze(GerberWorkerClient.prototype)
Object.freeze(GerberWorkerClient)
