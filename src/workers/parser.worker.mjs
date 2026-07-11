import { ToolkitWorkerProtocol } from 'circuitjson-toolkit/parser'

import { Parser } from '../convergence/Parser.mjs'
import { ProjectLoader } from '../convergence/ProjectLoader.mjs'

/** @param {object} payload Request. @param {object} runtime Runtime. @returns {Promise<object>} Document. */
async function parseInWorker(payload, runtime) {
    return await Parser.parseAsync(payload.input, {
        ...(payload.options || {}),
        worker: false,
        signal: runtime.signal,
        onProgress: runtime.onProgress
    })
}

/** @param {object} payload Request. @param {object} runtime Runtime. @returns {Promise<object>} Project. */
async function loadProjectInWorker(payload, runtime) {
    return await ProjectLoader.loadAsync(payload.entries, {
        ...(payload.options || {}),
        worker: false,
        signal: runtime.signal,
        onProgress: runtime.onProgress
    })
}

/**
 * Installs the shared parser/project protocol.
 * @param {unknown} scope Worker-like scope.
 * @returns {object} Installation controller.
 */
export function installParserWorker(scope) {
    return ToolkitWorkerProtocol.install(scope, {
        parse: parseInWorker,
        loadProject: loadProjectInWorker
    })
}

if (
    typeof globalThis.addEventListener === 'function' &&
    typeof globalThis.postMessage === 'function'
) {
    installParserWorker(globalThis)
}
