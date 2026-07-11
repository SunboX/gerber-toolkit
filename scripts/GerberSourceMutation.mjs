import { GerberSourceCallable } from './GerberSourceCallable.mjs'
import { GerberSourceExpression } from './GerberSourceExpression.mjs'

/**
 * Extracts structural mutation effects from one callable source.
 */
export class GerberSourceMutation {
    /**
     * Extracts property assignments plus array and map element writes.
     * @param {string} source Callable source.
     * @param {Record<string, any>} state Callable analysis state.
     * @param {{ createShape: () => Record<string, any>, analyze: (expression: string, prefix: string, shape: Record<string, any>) => void }} services Shape services.
     * @returns {{ root: string, shape: Record<string, any> }[]} Mutations.
     */
    static contracts(source, state, services) {
        const mutations = []
        for (const [root, assignments] of state.assignments) {
            for (const assignment of assignments) {
                GerberSourceMutation.#record(
                    mutations,
                    root,
                    assignment.path,
                    assignment.expression,
                    state,
                    services
                )
            }
        }
        for (const match of source.matchAll(
            /\b([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*))?\.push\s*\(/gu
        )) {
            const open = source.indexOf('(', match.index)
            const close = GerberSourceExpression.matchingDelimiter(
                source,
                open,
                '(',
                ')'
            )
            for (const argument of GerberSourceExpression.splitTopLevel(
                source.slice(open + 1, close)
            )) {
                GerberSourceMutation.#record(
                    mutations,
                    match[1],
                    match[2] || '',
                    argument.trim().replace(/^\.\.\./u, ''),
                    state,
                    services
                )
            }
        }
        for (const match of source.matchAll(
            /\b([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*))?\.set\s*\(/gu
        )) {
            const open = source.indexOf('(', match.index)
            const close = GerberSourceExpression.matchingDelimiter(
                source,
                open,
                '(',
                ')'
            )
            const value = GerberSourceExpression.splitTopLevel(
                source.slice(open + 1, close)
            )[1]
            if (!value) continue
            GerberSourceMutation.#record(
                mutations,
                match[1],
                match[2] || '',
                value,
                state,
                services
            )
        }
        return mutations
    }

    /**
     * Records one value shape at every canonical mutable location.
     * @param {{ root: string, shape: Record<string, any> }[]} mutations Mutation output.
     * @param {string} root Source mutation root.
     * @param {string} path Source mutation path.
     * @param {string} expression Assigned or appended value.
     * @param {Record<string, any>} state Callable analysis state.
     * @param {{ createShape: () => Record<string, any>, analyze: (expression: string, prefix: string, shape: Record<string, any>) => void }} services Shape services.
     * @returns {void}
     */
    static #record(mutations, root, path, expression, state, services) {
        for (const location of GerberSourceCallable.mutableLocations(
            root,
            path,
            state
        )) {
            const shape = services.createShape()
            if (location.path) shape.fields.add(location.path)
            services.analyze(expression, location.path, shape)
            mutations.push({ root: location.root, shape })
        }
    }
}
