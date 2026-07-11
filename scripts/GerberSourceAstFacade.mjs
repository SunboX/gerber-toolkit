import { GerberCallableAstAnalyzer } from './GerberSourceAst.mjs'

const CACHE = new Map()

/** Extracts reachable, position-aware callable facts from JavaScript ASTs. */
export class GerberSourceAst {
    /**
     * Analyzes one callable source once.
     * @param {string} source Callable or callable-body source.
     * @param {boolean} [bodyOnly] Whether source contains only a body fragment.
     * @param {{ collectionParameters?: Map<string, Map<string, number>> }} [options] Structural type provenance.
     * @returns {Record<string, any>} Reachable lexical facts.
     */
    static facts(source, bodyOnly = false, options = {}) {
        const collectionParameters =
            options.collectionParameters instanceof Map
                ? options.collectionParameters
                : new Map()
        const collectionKey = JSON.stringify(
            [...collectionParameters].map(([name, paths]) => [name, [...paths]])
        )
        const key = `${bodyOnly ? 'body' : 'callable'}\u0000${collectionKey}\u0000${source}`
        let facts = CACHE.get(key)
        if (!facts) {
            facts = new GerberCallableAstAnalyzer(
                source,
                bodyOnly,
                collectionParameters
            ).analyze()
            CACHE.set(key, facts)
        }
        return facts
    }

    /**
     * Resolves nearest reachable lexical initializers at one source position.
     * @param {Record<string, any>[]} bindings Binding records.
     * @param {string} name Binding name.
     * @param {number} position Source position.
     * @returns {Record<string, any>[]} Active bindings.
     */
    static activeBindings(bindings, name, position) {
        const candidates = bindings.filter(
            (binding) =>
                binding.name === name &&
                binding.start <= position &&
                binding.scopeStart <= position &&
                position <= binding.scopeEnd
        )
        if (!candidates.length) return []
        const smallestScope = Math.min(
            ...candidates.map(
                (binding) => binding.scopeEnd - binding.scopeStart
            )
        )
        const scoped = candidates.filter(
            (binding) => binding.scopeEnd - binding.scopeStart === smallestScope
        )
        const latest = Math.max(...scoped.map((binding) => binding.start))
        return scoped.filter((binding) => binding.start === latest)
    }
}

Object.freeze(GerberSourceAst.prototype)
Object.freeze(GerberSourceAst)
