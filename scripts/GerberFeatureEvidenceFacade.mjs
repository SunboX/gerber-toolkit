import { GerberSourceExpression } from './GerberSourceExpression.mjs'
import { analyzeSource } from './GerberFeatureEvidence.mjs'

const MASK_CACHE = new Map()

/** Matches immutable API evidence against reachable lexical result paths. */
export class GerberFeatureEvidence {
    /** @param {object} feature Feature. @param {string[]} tokens Tokens. @param {string} source Source. @returns {boolean} Match. */
    static matches(feature, tokens, source) {
        return GerberFeatureEvidence.matchesAcross(feature, tokens, [source])
    }

    /** @param {object} feature Feature. @param {string[]} tokens Tokens. @param {string[]} sources Sources. @returns {boolean} Match. */
    static matchesAcross(feature, tokens, sources) {
        return (
            sources.some((source) =>
                GerberFeatureEvidence.tokensMatch(tokens, source)
            ) && GerberFeatureEvidence.#resultMatches(feature, sources)
        )
    }

    /** @param {object} feature Feature. @param {string} source Source. @returns {boolean} Invocation match. */
    static invocationMatches(feature, source) {
        const identity = GerberFeatureEvidence.#identity(feature)
        if (!identity.exportName || !identity.methodName) return false
        return analyzeSource(source).invocations.has(
            `${identity.exportName}.${identity.methodName}`
        )
    }

    /** @param {string[]} tokens Tokens. @param {string} source Source. @returns {boolean} Token match. */
    static tokensMatch(tokens, source) {
        let mask = MASK_CACHE.get(source)
        if (mask === undefined) {
            mask = GerberSourceExpression.codeMask(source)
            MASK_CACHE.set(source, mask)
        }
        return tokens.every((token) => mask.includes(token))
    }

    /** @param {object} feature Feature. @param {string} source Source. @returns {boolean} Result match. */
    static resultPathMatches(feature, source) {
        return GerberFeatureEvidence.#resultMatches(feature, [source])
    }

    /** @param {object} feature Feature. @param {string[]} sources Sources. @returns {boolean} Match. */
    static #resultMatches(feature, sources) {
        if (feature?.sourceContract?.type !== 'result-field') return true
        const expected = String(feature.sourceContract.name || '')
            .split('.')
            .filter(Boolean)
        const identity = GerberFeatureEvidence.#identity(feature)
        if (!expected.length || !identity.exportName || !identity.methodName) {
            return false
        }
        const callable = `${identity.exportName}.${identity.methodName}`
        const analyses = sources.map((source) => analyzeSource(source))
        const parent = expected.slice(0, -1).join('.')
        const leaf = expected.at(-1)
        const path = expected.join('.')
        return analyses.some(
            (analysis) =>
                analysis.accesses.some(
                    (entry) =>
                        entry.origin === callable &&
                        (entry.path === path ||
                            entry.path.startsWith(`${path}.`)) &&
                        !analysis.keySets.some(
                            (keys) =>
                                keys.origin === entry.origin &&
                                keys.invocation === entry.invocation &&
                                keys.path === parent &&
                                !keys.keys.has(leaf)
                        )
                ) || (analysis.delegations.get(callable) || new Set()).size > 0
        )
    }

    /** @param {object} feature Feature. @returns {{ exportName: string, methodName: string }} Identity. */
    static #identity(feature) {
        if (feature.exportName && feature.methodName) {
            return {
                exportName: feature.exportName,
                methodName: feature.methodName
            }
        }
        const match =
            /#([A-Za-z_$][\w$]*)(?:\.prototype)?\.([#A-Za-z_$][\w$]*)\(\)\.result(?:\.|$)/u.exec(
                String(feature.feature || '')
            )
        return {
            exportName: match?.[1] || '',
            methodName: match?.[2] || ''
        }
    }
}

Object.freeze(GerberFeatureEvidence.prototype)
Object.freeze(GerberFeatureEvidence)
