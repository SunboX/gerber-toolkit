/**
 * Joins lexical source states across mutually exclusive reachable paths.
 */
export class GerberSourceBindingJoin {
    /**
     * Captures mutable declaration maps from one scope chain.
     * @param {Record<string, any>} scope Innermost lexical scope.
     * @returns {{ scope: Record<string, any>, declarations: Map<string, Record<string, any>> }[]} Scope snapshot.
     */
    static snapshot(scope) {
        const snapshot = []
        for (let current = scope; current; current = current.parent) {
            snapshot.push({
                scope: current,
                declarations: new Map(current.declarations),
                pathAlternatives: (current.pathAlternatives || []).map(
                    cloneSnapshot
                )
            })
        }
        return snapshot
    }

    /**
     * Restores declaration maps in a captured scope chain.
     * @param {{ scope: Record<string, any>, declarations: Map<string, Record<string, any>> }[]} snapshot Scope snapshot.
     * @returns {void}
     */
    static restore(snapshot) {
        for (const entry of snapshot) {
            entry.scope.declarations = new Map(entry.declarations)
            entry.scope.pathAlternatives =
                entry.pathAlternatives.map(cloneSnapshot)
        }
    }

    /**
     * Merges declaration metadata from paths that can reach a join point.
     * @param {{ scope: Record<string, any>, declarations: Map<string, Record<string, any>> }[]} base Pre-branch state.
     * @param {{ scope: Record<string, any>, declarations: Map<string, Record<string, any>> }[][]} alternatives Reachable post-path states.
     * @returns {void}
     */
    static mergeScopes(base, alternatives) {
        GerberSourceBindingJoin.restore(base)
        if (!alternatives.length) return
        base[0].scope.pathAlternatives = alternatives.map(cloneSnapshot)
        for (const baseEntry of base) {
            const destination = baseEntry.scope.declarations
            for (const name of baseEntry.declarations.keys()) {
                const values = alternatives.map(
                    (snapshot) =>
                        snapshot
                            .find((entry) => entry.scope === baseEntry.scope)
                            ?.declarations.get(name) ||
                        baseEntry.declarations.get(name)
                )
                destination.set(
                    name,
                    GerberSourceBindingJoin.#mergeMetadata(values)
                )
            }
        }
    }

    /**
     * Selects correlated path snapshots compatible with one static condition.
     * @param {Record<string, any>} scope Active scope.
     * @param {Record<string, any>} test Condition AST.
     * @param {boolean} expected Selected truth value.
     * @param {(test: Record<string, any>, scope: Record<string, any>) => boolean | null} truth Static evaluator.
     * @returns {Record<string, any>[][]} Compatible snapshots.
     */
    static selectAlternatives(scope, test, expected, truth) {
        const baseline = GerberSourceBindingJoin.snapshot(scope)
        const alternatives = scope.pathAlternatives?.length
            ? scope.pathAlternatives.map(cloneSnapshot)
            : [cloneSnapshot(baseline)]
        const selected = []
        for (const alternative of alternatives) {
            GerberSourceBindingJoin.restore(alternative)
            const value = truth(test, scope)
            if (value === expected || value === null) {
                selected.push(cloneSnapshot(alternative))
            }
        }
        GerberSourceBindingJoin.restore(baseline)
        return selected
    }

    /**
     * Appends equally positioned binding alternatives for later lookups.
     * @param {Record<string, any>[]} bindings Mutable binding fact list.
     * @param {number} baselineCount Number of records before branching.
     * @param {Record<string, any>[][]} alternatives Records from paths reaching the join.
     * @param {number} position Join source position.
     * @returns {void}
     */
    static mergeRecords(bindings, baselineCount, alternatives, position) {
        if (!alternatives.length) return
        const baseline = bindings.slice(0, baselineCount)
        const names = new Set()
        for (const record of bindings.slice(baselineCount)) {
            if (record.scopeStart <= position && position <= record.scopeEnd) {
                names.add(record.name)
            }
        }
        for (const name of names) {
            const candidates = []
            for (const records of alternatives) {
                candidates.push(
                    ...GerberSourceBindingJoin.#active(
                        [...baseline, ...records],
                        name,
                        position
                    )
                )
            }
            const unique = new Map()
            for (const candidate of candidates) {
                const key = JSON.stringify([
                    candidate.expression,
                    candidate.scopeStart,
                    candidate.scopeEnd,
                    candidate.collectionDepth || 0
                ])
                unique.set(key, candidate)
            }
            for (const candidate of unique.values()) {
                bindings.push({
                    ...candidate,
                    start: position,
                    kind: 'join'
                })
            }
        }
    }

    /**
     * Selects equally specific active records from one path state.
     * @param {Record<string, any>[]} bindings Candidate records.
     * @param {string} name Binding name.
     * @param {number} position Lookup position.
     * @returns {Record<string, any>[]} Active records.
     */
    static #active(bindings, name, position) {
        const candidates = bindings.filter(
            (binding) =>
                binding.name === name &&
                binding.start <= position &&
                binding.scopeStart <= position &&
                position <= binding.scopeEnd
        )
        if (!candidates.length) return []
        const width = Math.min(
            ...candidates.map(
                (binding) => binding.scopeEnd - binding.scopeStart
            )
        )
        const scoped = candidates.filter(
            (binding) => binding.scopeEnd - binding.scopeStart === width
        )
        const latest = Math.max(...scoped.map((binding) => binding.start))
        return scoped.filter((binding) => binding.start === latest)
    }

    /**
     * Conservatively combines mutable metadata used by static reachability.
     * @param {Record<string, any>[]} values Alternative binding metadata.
     * @returns {Record<string, any>} Merged metadata.
     */
    static #mergeMetadata(values) {
        const first = values[0] || {}
        const sameInitializer = values.every(
            (value) => value?.initializer === first.initializer
        )
        const sameCallable = values.every(
            (value) => value?.callable === first.callable
        )
        const depths = values.map((value) => value?.collectionDepth || 0)
        return {
            ...first,
            initializer: sameInitializer ? first.initializer : null,
            callable: sameCallable ? first.callable : null,
            collectionDepth:
                depths.length && depths.every((depth) => depth > 0)
                    ? Math.min(...depths)
                    : 0,
            collectionPaths: GerberSourceBindingJoin.#commonPaths(values),
            objectMethods: GerberSourceBindingJoin.#commonMethods(values)
        }
    }

    /**
     * Intersects collection-path proofs across alternative metadata.
     * @param {Record<string, any>[]} values Alternative binding metadata.
     * @returns {Map<string, number>} Shared collection paths.
     */
    static #commonPaths(values) {
        const paths = new Map(values[0]?.collectionPaths || [])
        for (const [path, depth] of paths) {
            if (
                values.some(
                    (value) => value?.collectionPaths?.get(path) !== depth
                )
            ) {
                paths.delete(path)
            }
        }
        return paths
    }

    /**
     * Intersects object-method declarations across alternative metadata.
     * @param {Record<string, any>[]} values Alternative binding metadata.
     * @returns {Map<string, Record<string, any>>} Shared methods.
     */
    static #commonMethods(values) {
        const methods = new Map(values[0]?.objectMethods || [])
        for (const [name, method] of methods) {
            if (
                values.some(
                    (value) => value?.objectMethods?.get(name) !== method
                )
            ) {
                methods.delete(name)
            }
        }
        return methods
    }
}

/**
 * Clones one scope snapshot without recursively retaining path catalogs.
 * @param {Record<string, any>[]} snapshot Scope snapshot.
 * @returns {Record<string, any>[]} Independent snapshot.
 */
function cloneSnapshot(snapshot) {
    return snapshot.map((entry) => ({
        scope: entry.scope,
        declarations: new Map(entry.declarations),
        pathAlternatives: []
    }))
}
