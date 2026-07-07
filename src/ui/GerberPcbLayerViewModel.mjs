import { GerberMaskOpeningClassifier } from '../core/gerber/GerberMaskOpeningClassifier.mjs'

const ROLE_ORDER = [
    'board-outline',
    'nonplated-drill',
    'plated-drill',
    'bottom-copper',
    'bottom-soldermask',
    'bottom-paste',
    'top-copper',
    'top-soldermask',
    'top-paste',
    'bottom-silkscreen',
    'top-silkscreen',
    'fabrication-layer',
    'drill-map'
]
const VIA_FLASH_MAX_DIAMETER = 0.85
const VIA_DRILL_MAX_DIAMETER = 0.45

/**
 * Resolves Gerber source layers into active-side PCB view semantics.
 */
export class GerberPcbLayerViewModel {
    /**
     * Normalizes caller-provided board side values.
     * @param {unknown} side Requested side.
     * @returns {'top' | 'bottom'}
     */
    static normalizeSide(side) {
        return side === 'bottom' ? 'bottom' : 'top'
    }

    /**
     * Checks whether a layer belongs in composite PCB view.
     * @param {object} layer Source layer.
     * @param {'top' | 'bottom'} side Active board side.
     * @returns {boolean}
     */
    static isCompositeLayerVisible(layer, side) {
        if (!layer || layer.isDocumentation) return false
        if (GerberPcbLayerViewModel.isBoardOutlineLayer(layer)) return true
        if (GerberPcbLayerViewModel.isDrillLayer(layer)) return true
        if (GerberPcbLayerViewModel.isCopperLayer(layer)) return true
        if (GerberPcbLayerViewModel.isSilkscreenLayer(layer)) {
            return GerberPcbLayerViewModel.isSurfaceLayer(layer, side)
        }

        return false
    }

    /**
     * Resolves one source layer's render order.
     * @param {object} layer Source layer.
     * @param {'top' | 'bottom'} side Active board side.
     * @returns {number}
     */
    static roleOrder(layer, side) {
        if (GerberPcbLayerViewModel.isBoardOutlineLayer(layer)) return 0
        if (GerberPcbLayerViewModel.isCopperLayer(layer)) {
            return GerberPcbLayerViewModel.isSurfaceLayer(layer, side) ? 30 : 10
        }
        if (GerberPcbLayerViewModel.isSilkscreenLayer(layer)) return 40
        if (GerberPcbLayerViewModel.isDrillLayer(layer)) return 50

        const index = ROLE_ORDER.indexOf(layer?.role)
        return index === -1 ? ROLE_ORDER.length : index
    }

    /**
     * Builds app palette classes for one layer.
     * @param {object} layer Source layer.
     * @param {'top' | 'bottom'} side Active board side.
     * @param {{ renderMode?: string }} [options] Layer render context.
     * @returns {string}
     */
    static layerAppClasses(layer, side, options = {}) {
        if (!GerberPcbLayerViewModel.isCopperLayer(layer)) return ''
        const isSurface =
            options.renderMode === 'separated' ||
            GerberPcbLayerViewModel.isSurfaceLayer(layer, side)

        return (
            ' pcb-copper ' +
            (isSurface ? 'pcb-copper--surface' : 'pcb-copper--subsurface')
        )
    }

    /**
     * Builds render-time lookup data from the selected fabrication layers.
     * @param {object[]} layers Source layers selected for rendering.
     * @param {object[]} [sourceLayers] All source fabrication layers.
     * @returns {{ smallPlatedDrillCenters: Set<string>, solderMaskOpeningPrimitives: WeakSet<object>, solderMaskSides: Set<string> }}
     */
    static renderContext(layers, sourceLayers = layers) {
        const smallPlatedDrillCenters = new Set()
        for (const layer of Array.isArray(layers) ? layers : []) {
            if (!GerberPcbLayerViewModel.isDrillLayer(layer)) continue
            for (const drill of Array.isArray(layer.drills)
                ? layer.drills
                : []) {
                if (
                    drill?.type === 'slot' ||
                    drill?.plated === false ||
                    Number(drill?.diameter) > VIA_DRILL_MAX_DIAMETER
                ) {
                    continue
                }
                smallPlatedDrillCenters.add(
                    GerberPcbLayerViewModel.#pointKey(drill.x, drill.y)
                )
            }
        }

        return {
            smallPlatedDrillCenters,
            ...GerberMaskOpeningClassifier.build(sourceLayers)
        }
    }

    /**
     * Builds app palette classes for one primitive.
     * @param {object} primitive Primitive model.
     * @param {object} layer Source layer.
     * @param {{ smallPlatedDrillCenters?: Set<string>, solderMaskOpeningPrimitives?: WeakSet<object>, solderMaskSides?: Set<string> }} [renderContext] Render context.
     * @returns {string}
     */
    static primitiveAppClasses(primitive, layer, renderContext = {}) {
        if (GerberPcbLayerViewModel.isCopperLayer(layer)) {
            const maskClass = GerberPcbLayerViewModel.#solderMaskAppClass(
                primitive,
                layer,
                renderContext
            )
            if (primitive.type === 'line' || primitive.type === 'arc') {
                return ' pcb-track' + maskClass
            }
            if (primitive.type === 'region') return ' pcb-region' + maskClass
            if (
                GerberPcbLayerViewModel.#isSmallDrilledFlash(
                    primitive,
                    renderContext
                )
            ) {
                return ' pcb-via' + maskClass
            }
            return ' pcb-pad' + maskClass
        }

        if (GerberPcbLayerViewModel.isSilkscreenLayer(layer)) {
            return ' pcb-drawing pcb-drawing--silk'
        }

        return ''
    }

    /**
     * Maps fabrication-space Y-up coordinates into SVG's Y-down viewport.
     * @param {{ minX: number, minY: number, width: number, height: number }} bounds Render bounds.
     * @param {'top' | 'bottom'} side Active board side.
     * @returns {string}
     */
    static coordinateTransform(bounds, side) {
        const maxY = GerberPcbLayerViewModel.#round(bounds.minY + bounds.height)
        const translateY = GerberPcbLayerViewModel.#round(bounds.minY + maxY)
        if (side !== 'bottom') {
            return 'translate(0 ' + translateY + ') scale(1 -1)'
        }

        const maxX = GerberPcbLayerViewModel.#round(bounds.minX + bounds.width)
        const translateX = GerberPcbLayerViewModel.#round(bounds.minX + maxX)
        return 'translate(' + translateX + ' ' + translateY + ') scale(-1 -1)'
    }

    /**
     * Returns true when a layer is a board outline/profile layer.
     * @param {object} layer Source layer.
     * @returns {boolean}
     */
    static isBoardOutlineLayer(layer) {
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
     * Returns true when a layer contains drill hits or slots.
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

    /**
     * Returns true when the layer belongs to the active board side.
     * @param {object} layer Source layer.
     * @param {'top' | 'bottom'} side Active board side.
     * @returns {boolean}
     */
    static isSurfaceLayer(layer, side) {
        return GerberPcbLayerViewModel.#layerSide(layer) === side
    }

    /**
     * Resolves a source layer to a board side.
     * @param {object} layer Source layer.
     * @returns {'top' | 'bottom' | 'both'}
     */
    static #layerSide(layer) {
        if (layer?.side === 'top' || layer?.side === 'bottom') {
            return layer.side
        }

        const role = String(layer?.role || '')
        if (role.startsWith('bottom-')) return 'bottom'
        if (role.startsWith('top-')) return 'top'
        return 'both'
    }

    /**
     * Returns true for a small drilled circular flash that should be styled like
     * the app's normal via rings.
     * @param {object} primitive Primitive model.
     * @param {{ smallPlatedDrillCenters?: Set<string> }} renderContext Render context.
     * @returns {boolean}
     */
    static #isSmallDrilledFlash(primitive, renderContext) {
        if (primitive?.type !== 'flash' || primitive?.shape !== 'circle') {
            return false
        }
        const diameter = Number(primitive.diameter)
        if (!Number.isFinite(diameter) || diameter > VIA_FLASH_MAX_DIAMETER) {
            return false
        }

        return Boolean(
            renderContext.smallPlatedDrillCenters?.has(
                GerberPcbLayerViewModel.#pointKey(primitive.x, primitive.y)
            )
        )
    }

    /**
     * Builds a same-side solder-mask visibility class for copper primitives.
     * @param {object} primitive Copper primitive.
     * @param {object} layer Copper source layer.
     * @param {{ solderMaskOpeningPrimitives?: WeakSet<object>, solderMaskSides?: Set<string> }} renderContext Render context.
     * @returns {string}
     */
    static #solderMaskAppClass(primitive, layer, renderContext) {
        const side = GerberPcbLayerViewModel.#layerSide(layer)
        if (
            !GerberMaskOpeningClassifier.hasSolderMaskForSide(
                renderContext.solderMaskSides,
                side
            )
        ) {
            return ''
        }

        return renderContext.solderMaskOpeningPrimitives?.has(primitive)
            ? ' pcb-copper--mask-open'
            : ' pcb-copper--mask-covered'
    }

    /**
     * Rounds a fabrication point into a stable lookup key.
     * @param {number} x X coordinate.
     * @param {number} y Y coordinate.
     * @returns {string}
     */
    static #pointKey(x, y) {
        return (
            GerberPcbLayerViewModel.#round(Number(x || 0)) +
            ':' +
            GerberPcbLayerViewModel.#round(Number(y || 0))
        )
    }

    /**
     * Rounds an SVG coordinate.
     * @param {number} value Coordinate value.
     * @returns {number}
     */
    static #round(value) {
        return Number(Number(value || 0).toFixed(6))
    }
}
