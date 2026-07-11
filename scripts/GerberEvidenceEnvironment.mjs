/**
 * One lexical binding environment used during reachable evidence analysis.
 */
export class GerberEvidenceEnvironment {
    /**
     * @param {GerberEvidenceEnvironment | null} parent Parent environment.
     * @param {{ known: boolean, value?: any } | null} [thisValue] This binding.
     */
    constructor(parent = null, thisValue = null) {
        this.parent = parent
        this.bindings = new Map()
        this.collections = parent?.collections || new Set()
        this.revokedCallables = parent?.revokedCallables || new Set()
        this.collectionMethodOverrides =
            parent?.collectionMethodOverrides || new Map()
        this.pathAlternatives = []
        this.thisValue =
            thisValue || parent?.thisValue || Object.freeze({ known: false })
    }

    /**
     * Declares one lexical binding.
     * @param {string} name Binding name.
     * @param {Record<string, any>} binding Symbolic binding.
     * @returns {void}
     */
    declare(name, binding) {
        if (name) this.bindings.set(name, binding)
    }

    /**
     * Resolves one lexical binding from the nearest scope.
     * @param {string} name Binding name.
     * @returns {Record<string, any> | null} Binding or null.
     */
    get(name) {
        return this.bindings.get(name) || this.parent?.get(name) || null
    }

    /**
     * Reassigns the nearest existing binding or declares a local fallback.
     * @param {string} name Binding name.
     * @param {Record<string, any>} binding Replacement binding.
     * @returns {void}
     */
    assign(name, binding) {
        if (this.bindings.has(name) || !this.parent) {
            this.bindings.set(name, binding)
        } else {
            this.parent.assign(name, binding)
        }
    }

    /**
     * Marks one exact collection method identity as replaced.
     * @param {object | string} identity Collection identity.
     * @param {string} method Method name.
     * @returns {void}
     */
    overrideCollectionMethod(identity, method) {
        if (!identity || !method) return
        const methods =
            this.collectionMethodOverrides.get(identity) || new Set()
        methods.add(method)
        this.collectionMethodOverrides.set(identity, methods)
    }

    /**
     * Checks whether intrinsic semantics were revoked for one method.
     * @param {object | string} identity Collection identity.
     * @param {string} method Method name.
     * @returns {boolean} Override status.
     */
    collectionMethodOverridden(identity, method) {
        return Boolean(
            identity &&
            method &&
            this.collectionMethodOverrides.get(identity)?.has(method)
        )
    }

    /**
     * Creates an isolated flattened snapshot for an uncertain branch.
     * @returns {GerberEvidenceEnvironment} Independent environment.
     */
    fork(includeAlternatives = true) {
        const chain = []
        for (let current = this; current; current = current.parent) {
            chain.unshift(current)
        }
        const fork = new GerberEvidenceEnvironment()
        fork.thisValue = this.thisValue
        fork.collections = new Set(this.collections)
        fork.revokedCallables = new Set(this.revokedCallables)
        fork.collectionMethodOverrides = new Map(
            [...this.collectionMethodOverrides].map(([identity, methods]) => [
                identity,
                new Set(methods)
            ])
        )
        for (const scope of chain) {
            for (const [name, binding] of scope.bindings) {
                fork.bindings.set(name, cloneEvidenceBinding(binding))
            }
        }
        if (includeAlternatives) {
            fork.pathAlternatives = (this.pathAlternatives || []).map(
                (environment) => environment.fork(false)
            )
        }
        return fork
    }

    /**
     * Joins independent branch snapshots back into visible lexical bindings.
     * @param {GerberEvidenceEnvironment[]} environments Reachable snapshots.
     * @returns {void}
     */
    mergeFrom(environments) {
        const reachable = (environments || []).filter(Boolean)
        if (!reachable.length) return
        this.pathAlternatives = reachable.flatMap((environment) =>
            environment.pathAlternatives?.length
                ? environment.pathAlternatives.map((path) => path.fork(false))
                : [environment.fork(false)]
        )
        const commonCollections = new Set(reachable[0].collections || [])
        for (const proof of commonCollections) {
            if (
                reachable.some(
                    (environment) => !environment.collections?.has(proof)
                )
            ) {
                commonCollections.delete(proof)
            }
        }
        this.collections.clear()
        for (const proof of commonCollections) this.collections.add(proof)
        this.revokedCallables.clear()
        for (const environment of reachable) {
            for (const identity of environment.revokedCallables || []) {
                this.revokedCallables.add(identity)
            }
        }
        this.collectionMethodOverrides.clear()
        for (const environment of reachable) {
            for (const [
                identity,
                methods
            ] of environment.collectionMethodOverrides || []) {
                for (const method of methods) {
                    this.overrideCollectionMethod(identity, method)
                }
            }
        }
        for (const name of visibleBindingNames(this)) {
            const bindings = reachable.map((environment) =>
                environment.get(name)
            )
            if (bindings.some((binding) => !binding)) continue
            this.assign(name, mergeEvidenceBindings(bindings))
        }
    }
}

/**
 * Clones one binding without sharing mutable symbolic collections.
 * @param {Record<string, any>} binding Binding record.
 * @returns {Record<string, any>} Cloned record.
 */
export function cloneEvidenceBinding(binding = {}) {
    return {
        ...binding,
        values: new Set(binding.values || []),
        methods: new Map(binding.methods || [])
    }
}

/**
 * Lists the nearest visible binding name from every lexical scope.
 * @param {GerberEvidenceEnvironment} environment Active environment.
 * @returns {string[]} Visible names.
 */
function visibleBindingNames(environment) {
    const names = new Set()
    for (let current = environment; current; current = current.parent) {
        for (const name of current.bindings.keys()) names.add(name)
    }
    return [...names]
}

/**
 * Conservatively merges symbolic binding metadata across reachable paths.
 * @param {Record<string, any>[]} bindings Branch bindings.
 * @returns {Record<string, any>} Joined binding.
 */
function mergeEvidenceBindings(bindings) {
    const merged = {
        values: new Set(
            bindings.flatMap((binding) => [...(binding.values || [])])
        ),
        methods: commonMethods(bindings)
    }
    const keys = new Set(
        bindings.flatMap((binding) => Object.keys(binding || {}))
    )
    keys.delete('values')
    keys.delete('methods')
    for (const key of keys) {
        const value = bindings[0]?.[key]
        if (bindings.every((binding) => Object.is(binding?.[key], value))) {
            merged[key] = value
        }
    }
    if (merged.callable && !merged.closure) merged.callable = null
    if (merged.methods.size && !merged.closure) merged.methods.clear()
    return merged
}

/**
 * Intersects object-method bindings that are identical on every path.
 * @param {Record<string, any>[]} bindings Branch bindings.
 * @returns {Map<string, Record<string, any>>} Common methods.
 */
function commonMethods(bindings) {
    const common = new Map(bindings[0]?.methods || [])
    for (const [name, method] of [...common]) {
        if (bindings.some((binding) => binding.methods?.get(name) !== method)) {
            common.delete(name)
        }
    }
    return common
}
