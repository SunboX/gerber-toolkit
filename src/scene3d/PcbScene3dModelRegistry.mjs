/**
 * No-op model registry for fabrication-only Gerber scenes.
 */
export class PcbScene3dModelRegistry {
    /**
     * Creates a registry from session assets.
     * @param {object[]} [_sessionAssets] Session assets.
     * @returns {PcbScene3dModelRegistry}
     */
    static create(_sessionAssets = []) {
        return new PcbScene3dModelRegistry()
    }

    /**
     * Returns registered model assets.
     * @returns {object[]}
     */
    get assets() {
        return []
    }

    /**
     * Resolves a component model.
     * @returns {null}
     */
    resolveForComponent() {
        return null
    }

    /**
     * Resolves a component model using the shared method name.
     * @returns {null}
     */
    resolveComponentModel() {
        return null
    }

    /**
     * Resolves a component body model.
     * @returns {null}
     */
    resolveComponentBodyModel() {
        return null
    }
}
