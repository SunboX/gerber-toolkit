import { GerberResultExpressionAnalysis } from './GerberResultExpressionAnalysis.mjs'
import { GerberSourceCallable } from './GerberSourceCallable.mjs'

/**
 * Resolves collection callback result shapes with explicit provenance.
 */
export class GerberResultCallbackAnalysis {
    /**
     * Analyzes one proven callback expression.
     * @param {{ expression: string, prefix: string, state: Record<string, any>, shape: Record<string, any>, resolving: Set<string>, position: number, services: { analyze: Function, copy: Function, createShape: Function } }} options Analysis inputs and recursive services.
     * @returns {{ handled: boolean, collectionDepth: number }} Callback result.
     */
    static analyze(options) {
        const collectionDepth = GerberResultExpressionAnalysis.collectionDepth(
            options.expression,
            options.state,
            options.position
        )
        const candidate = GerberSourceCallable.arrayCallback(
            options.expression,
            (name) =>
                GerberResultCallbackAnalysis.#callbackBinding(
                    name,
                    options.state,
                    options.position
                )
        )
        const callback =
            candidate &&
            GerberResultExpressionAnalysis.callbackReachable(
                options.expression,
                options.state,
                options.position
            ) &&
            (collectionDepth > 0 ||
                GerberResultExpressionAnalysis.supportsProjection(
                    candidate,
                    options.state,
                    options.position
                ))
                ? candidate
                : null
        if (!callback) return { handled: false, collectionDepth }

        const elements = options.services.createShape()
        options.services.analyze(
            callback.source,
            '',
            options.state,
            elements,
            options.resolving,
            options.position
        )
        if (['filter', 'flat'].includes(callback.method)) {
            options.services.copy(options.shape, elements, '', options.prefix)
            return { handled: true, collectionDepth }
        }

        const state = GerberResultCallbackAnalysis.#callbackState(
            callback,
            elements,
            options.state,
            options.position
        )
        for (const returned of callback.returns) {
            options.services.analyze(
                returned,
                options.prefix,
                state,
                options.shape,
                options.resolving,
                options.position
            )
        }
        return { handled: true, collectionDepth }
    }

    /**
     * Adds callback element shape and collection provenance to a child state.
     * @param {Record<string, any>} callback Parsed callback.
     * @param {Record<string, any>} elements Source element shape.
     * @param {Record<string, any>} state Parent analysis state.
     * @param {number} position Source position.
     * @returns {Record<string, any>} Callback child state.
     */
    static #callbackState(callback, elements, state, position) {
        const bindings = new Map(state.bindings)
        const collectionBindings = new Map(state.collectionBindings)
        if (callback.parameter) {
            bindings.set(callback.parameter, elements)
            const sourceDepth = GerberResultExpressionAnalysis.collectionDepth(
                callback.source,
                state,
                position
            )
            collectionBindings.set(
                callback.parameter,
                Math.max(0, sourceDepth - 1)
            )
        }
        return { ...state, bindings, collectionBindings }
    }

    /**
     * Resolves one callback only when every reachable binding is identical.
     * @param {string} name Callback identifier.
     * @param {Record<string, any>} state Callable analysis state.
     * @param {number} position Callback use position.
     * @returns {string} Callable source or an empty string.
     */
    static #callbackBinding(name, state, position) {
        const candidates = new Set(
            GerberSourceCallable.bindingExpressions(name, state, position)
        )
        return candidates.size === 1 ? [...candidates][0] : ''
    }
}
