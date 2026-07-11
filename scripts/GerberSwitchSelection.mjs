import { GerberStaticValue } from './GerberStaticValue.mjs'

/**
 * Selects an exact switch entry when its discriminant and cases are static.
 */
export class GerberSwitchSelection {
    /**
     * Resolves the first executed case while retaining JavaScript default rules.
     * @param {Record<string, any>} statement Switch statement.
     * @param {{ get: (name: string) => Record<string, any> | null }} environment Lexical environment.
     * @returns {{ known: boolean, startIndex: number }} Switch selection.
     */
    static resolve(statement, environment) {
        const discriminant = GerberStaticValue.resolve(
            statement.discriminant,
            environment
        )
        if (!discriminant.known) return { known: false, startIndex: -1 }
        let defaultIndex = -1
        for (let index = 0; index < statement.cases.length; index += 1) {
            const branch = statement.cases[index]
            if (!branch.test) {
                defaultIndex = index
                continue
            }
            const candidate = GerberStaticValue.resolve(
                branch.test,
                environment
            )
            if (!candidate.known) return { known: false, startIndex: -1 }
            if (candidate.value === discriminant.value) {
                return { known: true, startIndex: index }
            }
        }
        return { known: true, startIndex: defaultIndex }
    }
}
