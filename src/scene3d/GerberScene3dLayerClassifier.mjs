const TOP_COPPER_LAYER_ID = 1
const BOTTOM_COPPER_LAYER_ID = 32

/**
 * Classifies Gerber fabrication layers for scene construction.
 */
export class GerberScene3dLayerClassifier {
    /**
     * Builds public layer summary metadata.
     * @param {object[]} layers Fabrication layers.
     * @returns {object[]}
     */
    static buildLayerSummary(layers) {
        return (layers || []).map((layer) => ({
            id: layer.id,
            fileName: layer.fileName,
            role: layer.role,
            side: layer.side
        }))
    }

    /**
     * Resolves the scene copper layer id for one source layer.
     * @param {object} layer Source layer.
     * @returns {number}
     */
    static layerId(layer) {
        return GerberScene3dLayerClassifier.layerSide(layer) === 'bottom'
            ? BOTTOM_COPPER_LAYER_ID
            : TOP_COPPER_LAYER_ID
    }

    /**
     * Resolves the board side for one source layer.
     * @param {object} layer Source layer.
     * @returns {'top' | 'bottom' | 'both'}
     */
    static layerSide(layer) {
        if (layer?.side === 'top' || layer?.side === 'bottom') {
            return layer.side
        }

        const role = String(layer?.role || '')
        if (role.startsWith('bottom-')) return 'bottom'
        if (role.startsWith('top-')) return 'top'
        return 'both'
    }

    /**
     * Returns true when a layer contains board outline geometry.
     * @param {object} layer Source layer.
     * @returns {boolean}
     */
    static isBoardOutline(layer) {
        return layer?.role === 'board-outline'
    }

    /**
     * Returns true when a layer contains copper artwork.
     * @param {object} layer Source layer.
     * @returns {boolean}
     */
    static isCopperLayer(layer) {
        return /(?:^|-)?copper$/u.test(String(layer?.role || ''))
    }

    /**
     * Returns true when a layer contains drill data.
     * @param {object} layer Source layer.
     * @returns {boolean}
     */
    static isDrillLayer(layer) {
        return /(?:^|-)?drill(?:-|$)/u.test(String(layer?.role || ''))
    }

    /**
     * Returns true when a layer contains silkscreen artwork.
     * @param {object} layer Source layer.
     * @returns {boolean}
     */
    static isSilkscreenLayer(layer) {
        return String(layer?.role || '').includes('silkscreen')
    }
}
