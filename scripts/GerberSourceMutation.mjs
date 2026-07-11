import { GerberSourceCallable } from './GerberSourceCallable.mjs'

/**
 * Extracts structural mutation effects from reachable callable AST facts.
 */
export class GerberSourceMutation {
    /**
     * Extracts property assignments plus array and map element writes.
     * @param {string} source Callable source.
     * @param {Record<string, any>} state Callable analysis state.
     * @param {{ createShape: () => Record<string, any>, analyze: (expression: string, prefix: string, shape: Record<string, any>, position: number) => void }} services Shape services.
     * @returns {{ root: string, shape: Record<string, any> }[]} Mutations.
     */
    static contracts(source, state, services) {
        void source
        const mutations = []
        for (const effect of state.facts.mutations) {
            if (effect.type === 'assignment') {
                const assignment = effect.arguments[0]
                if (assignment) {
                    GerberSourceMutation.#record(
                        mutations,
                        effect.root,
                        effect.path,
                        assignment,
                        state,
                        services,
                        effect.index,
                        true
                    )
                }
                continue
            }
            if (effect.type === 'push') {
                for (const argument of effect.arguments) {
                    GerberSourceMutation.#record(
                        mutations,
                        effect.root,
                        effect.path,
                        argument.trim().replace(/^\.\.\./u, ''),
                        state,
                        services,
                        effect.index
                    )
                }
                continue
            }
            if (effect.type === 'set') {
                const value = effect.arguments[0]
                if (value) {
                    GerberSourceMutation.#record(
                        mutations,
                        effect.root,
                        effect.path,
                        value,
                        state,
                        services,
                        effect.index
                    )
                }
                continue
            }
            if (effect.type === 'assign') {
                for (const value of effect.arguments) {
                    GerberSourceMutation.#record(
                        mutations,
                        effect.root,
                        effect.path,
                        value,
                        state,
                        services,
                        effect.index
                    )
                }
            }
        }
        return mutations
    }

    /**
     * Records one value shape at every canonical mutable location.
     * @param {{ root: string, shape: Record<string, any> }[]} mutations Output.
     * @param {string} root Source mutation root.
     * @param {string} path Mutation path below the root.
     * @param {string} expression Assigned or appended value.
     * @param {Record<string, any>} state Callable analysis state.
     * @param {{ createShape: () => Record<string, any>, analyze: (expression: string, prefix: string, shape: Record<string, any>, position: number) => void }} services Shape services.
     * @param {number} position Mutation source position.
     * @param {boolean} [includePath] Whether assignment itself creates a field.
     * @returns {void}
     */
    static #record(
        mutations,
        root,
        path,
        expression,
        state,
        services,
        position,
        includePath = false
    ) {
        for (const location of GerberSourceCallable.mutableLocations(
            root,
            path,
            state,
            position
        )) {
            const shape = services.createShape()
            if (includePath && location.path) shape.fields.add(location.path)
            services.analyze(expression, location.path, shape, position)
            mutations.push({ root: location.root, shape })
        }
    }
}
