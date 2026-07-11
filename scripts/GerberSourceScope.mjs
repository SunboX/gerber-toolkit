/**
 * One mutable lexical scope used while walking a single callable.
 */
export class GerberSourceScope {
    /**
     * @param {GerberSourceScope | null} parent Parent scope.
     * @param {number} start Inclusive source start.
     * @param {number} end Inclusive source end.
     * @param {{ known: boolean, value?: any } | null} [thisValue] Callable this binding.
     */
    constructor(parent, start, end, thisValue = null) {
        this.parent = parent
        this.start = start
        this.end = end
        this.declarations = new Map()
        this.pathAlternatives = []
        this.thisValue =
            thisValue || parent?.thisValue || Object.freeze({ known: false })
    }

    /**
     * Finds the scope that owns a binding name.
     * @param {string} name Binding name.
     * @returns {GerberSourceScope | null} Owning scope.
     */
    owner(name) {
        if (this.declarations.has(name)) return this
        return this.parent?.owner(name) || null
    }

    /**
     * Finds the current declaration metadata for a binding.
     * @param {string} name Binding name.
     * @returns {Record<string, any> | null} Declaration metadata.
     */
    get(name) {
        return this.declarations.get(name) || this.parent?.get(name) || null
    }
}
