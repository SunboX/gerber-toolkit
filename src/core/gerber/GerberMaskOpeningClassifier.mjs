const CONTAINMENT_TOLERANCE_MM = 0.0127

/**
 * Classifies Gerber copper primitives against same-side solder-mask apertures.
 */
export class GerberMaskOpeningClassifier {
    /**
     * Builds a primitive lookup for copper that is opened by solder mask.
     * @param {object[]} layers Source fabrication layers.
     * @returns {{ solderMaskOpeningPrimitives: WeakSet<object>, solderMaskSides: Set<string> }}
     */
    static build(layers) {
        const openings = GerberMaskOpeningClassifier.#buildOpenings(layers)
        const solderMaskSides = new Set(
            openings.flatMap((opening) =>
                GerberMaskOpeningClassifier.#sideList(opening.side)
            )
        )
        const solderMaskOpeningPrimitives = new WeakSet()

        for (const layer of layers || []) {
            if (!GerberMaskOpeningClassifier.#isCopperLayer(layer)) {
                continue
            }

            const side = GerberMaskOpeningClassifier.#layerSide(layer)
            if (
                !GerberMaskOpeningClassifier.hasSolderMaskForSide(
                    solderMaskSides,
                    side
                )
            ) {
                continue
            }

            for (const primitive of GerberMaskOpeningClassifier.#flattenPrimitives(
                layer.primitives
            )) {
                const bounds =
                    GerberMaskOpeningClassifier.#primitiveBounds(primitive)
                if (
                    bounds &&
                    openings.some(
                        (opening) =>
                            GerberMaskOpeningClassifier.#sidesMatch(
                                opening.side,
                                side
                            ) &&
                            GerberMaskOpeningClassifier.#contains(
                                opening.bounds,
                                bounds
                            )
                    )
                ) {
                    solderMaskOpeningPrimitives.add(primitive)
                }
            }
        }

        return { solderMaskOpeningPrimitives, solderMaskSides }
    }

    /**
     * Checks whether a copper layer side has solder-mask aperture data.
     * @param {Set<string> | undefined} solderMaskSides Sides with mask layers.
     * @param {'top' | 'bottom' | 'both'} side Copper layer side.
     * @returns {boolean}
     */
    static hasSolderMaskForSide(solderMaskSides, side) {
        if (!(solderMaskSides instanceof Set) || !solderMaskSides.size) {
            return false
        }

        return GerberMaskOpeningClassifier.#sideList(side).some((candidate) =>
            solderMaskSides.has(candidate)
        )
    }

    /**
     * Builds side-aware solder-mask aperture bounds.
     * @param {object[]} layers Source fabrication layers.
     * @returns {{ side: 'top' | 'bottom' | 'both', bounds: object }[]}
     */
    static #buildOpenings(layers) {
        const openings = []

        for (const layer of layers || []) {
            if (!GerberMaskOpeningClassifier.#isSolderMaskLayer(layer)) {
                continue
            }

            const side = GerberMaskOpeningClassifier.#layerSide(layer)
            for (const primitive of GerberMaskOpeningClassifier.#flattenPrimitives(
                layer.primitives
            )) {
                if (String(primitive?.polarity || 'dark') === 'clear') {
                    continue
                }

                const bounds =
                    GerberMaskOpeningClassifier.#primitiveBounds(primitive)
                if (bounds) {
                    openings.push({ side, bounds })
                }
            }
        }

        return openings
    }

    /**
     * Flattens block apertures into renderable child primitives.
     * @param {object[] | undefined} primitives Source primitive list.
     * @returns {object[]}
     */
    static #flattenPrimitives(primitives) {
        return (primitives || []).flatMap((primitive) => {
            if (primitive?.shape === 'block') {
                return GerberMaskOpeningClassifier.#flattenPrimitives(
                    primitive.primitives
                )
            }

            return [primitive]
        })
    }

    /**
     * Resolves conservative source-unit bounds for one primitive.
     * @param {object} primitive Source primitive.
     * @returns {{ minX: number, minY: number, maxX: number, maxY: number } | null}
     */
    static #primitiveBounds(primitive) {
        if (primitive?.type === 'line') {
            const halfWidth = Math.max(Number(primitive.width || 0), 0) / 2
            return GerberMaskOpeningClassifier.#expandBounds(
                {
                    minX: Math.min(Number(primitive.x1), Number(primitive.x2)),
                    minY: Math.min(Number(primitive.y1), Number(primitive.y2)),
                    maxX: Math.max(Number(primitive.x1), Number(primitive.x2)),
                    maxY: Math.max(Number(primitive.y1), Number(primitive.y2))
                },
                halfWidth
            )
        }

        if (primitive?.type === 'arc') {
            return GerberMaskOpeningClassifier.#arcBounds(primitive)
        }

        if (primitive?.type === 'region') {
            return GerberMaskOpeningClassifier.#pointBounds(primitive.points)
        }

        return GerberMaskOpeningClassifier.#flashBounds(primitive)
    }

    /**
     * Resolves conservative bounds for one arc primitive.
     * @param {object} primitive Arc primitive.
     * @returns {object | null}
     */
    static #arcBounds(primitive) {
        const center = GerberMaskOpeningClassifier.#arcCenter(primitive)
        if (!center) {
            return GerberMaskOpeningClassifier.#primitiveBounds({
                type: 'line',
                x1: primitive?.x1,
                y1: primitive?.y1,
                x2: primitive?.x2,
                y2: primitive?.y2,
                width: primitive?.width
            })
        }

        const radius =
            center.radius + Math.max(Number(primitive?.width || 0), 0) / 2
        return GerberMaskOpeningClassifier.#expandBounds(
            {
                minX: center.x - radius,
                minY: center.y - radius,
                maxX: center.x + radius,
                maxY: center.y + radius
            },
            0
        )
    }

    /**
     * Resolves an arc center from common Gerber center-offset fields.
     * @param {object} primitive Arc primitive.
     * @returns {{ x: number, y: number, radius: number } | null}
     */
    static #arcCenter(primitive) {
        const explicitCenter = {
            x: Number(primitive?.cx),
            y: Number(primitive?.cy),
            radius: Number(primitive?.radius)
        }
        if (
            Number.isFinite(
                explicitCenter.x + explicitCenter.y + explicitCenter.radius
            )
        ) {
            return explicitCenter
        }

        const x1 = Number(primitive?.x1)
        const y1 = Number(primitive?.y1)
        const i = Number(primitive?.i ?? 0)
        const j = Number(primitive?.j ?? 0)
        if (!Number.isFinite(x1 + y1 + i + j)) {
            return null
        }

        return {
            x: x1 + i,
            y: y1 + j,
            radius: Math.hypot(i, j)
        }
    }

    /**
     * Resolves point-list bounds.
     * @param {{ x?: number, y?: number }[] | undefined} points Point list.
     * @returns {object | null}
     */
    static #pointBounds(points) {
        if (!Array.isArray(points) || !points.length) {
            return null
        }

        return points.reduce(
            (bounds, point) => ({
                minX: Math.min(bounds.minX, Number(point?.x)),
                minY: Math.min(bounds.minY, Number(point?.y)),
                maxX: Math.max(bounds.maxX, Number(point?.x)),
                maxY: Math.max(bounds.maxY, Number(point?.y))
            }),
            {
                minX: Infinity,
                minY: Infinity,
                maxX: -Infinity,
                maxY: -Infinity
            }
        )
    }

    /**
     * Resolves flashed aperture bounds.
     * @param {object} primitive Flash primitive.
     * @returns {object | null}
     */
    static #flashBounds(primitive) {
        const dimensions =
            GerberMaskOpeningClassifier.#flashDimensions(primitive)
        const x = Number(primitive?.x)
        const y = Number(primitive?.y)
        if (!dimensions || !Number.isFinite(x + y)) {
            return null
        }

        return {
            minX: x - dimensions.width / 2,
            minY: y - dimensions.height / 2,
            maxX: x + dimensions.width / 2,
            maxY: y + dimensions.height / 2
        }
    }

    /**
     * Resolves rough flashed aperture dimensions.
     * @param {object} primitive Flash primitive.
     * @returns {{ width: number, height: number } | null}
     */
    static #flashDimensions(primitive) {
        if (primitive?.shape === 'circle' || primitive?.shape === 'polygon') {
            const diameter = Number(primitive.diameter)
            return Number.isFinite(diameter)
                ? { width: diameter, height: diameter }
                : null
        }

        if (primitive?.shape === 'rect' || primitive?.shape === 'obround') {
            const width = Number(primitive.width)
            const height = Number(primitive.height)
            return Number.isFinite(width + height) ? { width, height } : null
        }

        return null
    }

    /**
     * Expands bounds by symmetric padding.
     * @param {object} bounds Base bounds.
     * @param {number} padding Padding amount.
     * @returns {object | null}
     */
    static #expandBounds(bounds, padding) {
        if (
            !Number.isFinite(
                bounds.minX + bounds.minY + bounds.maxX + bounds.maxY
            )
        ) {
            return null
        }

        const safePadding = Math.max(Number(padding || 0), 0)
        return {
            minX: bounds.minX - safePadding,
            minY: bounds.minY - safePadding,
            maxX: bounds.maxX + safePadding,
            maxY: bounds.maxY + safePadding
        }
    }

    /**
     * Checks whether one opening fully contains one copper primitive.
     * @param {object} outer Opening bounds.
     * @param {object} inner Copper bounds.
     * @returns {boolean}
     */
    static #contains(outer, inner) {
        return (
            inner.minX >= outer.minX - CONTAINMENT_TOLERANCE_MM &&
            inner.minY >= outer.minY - CONTAINMENT_TOLERANCE_MM &&
            inner.maxX <= outer.maxX + CONTAINMENT_TOLERANCE_MM &&
            inner.maxY <= outer.maxY + CONTAINMENT_TOLERANCE_MM
        )
    }

    /**
     * Checks whether a source layer contains solder-mask aperture artwork.
     * @param {object} layer Source layer.
     * @returns {boolean}
     */
    static #isSolderMaskLayer(layer) {
        return String(layer?.role || '').includes('soldermask')
    }

    /**
     * Checks whether a source layer contains copper artwork.
     * @param {object} layer Source layer.
     * @returns {boolean}
     */
    static #isCopperLayer(layer) {
        return /(?:^|-)?copper$/u.test(String(layer?.role || ''))
    }

    /**
     * Resolves a layer side from explicit metadata or role prefix.
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
     * Checks whether two layer sides can interact.
     * @param {'top' | 'bottom' | 'both'} maskSide Mask side.
     * @param {'top' | 'bottom' | 'both'} copperSide Copper side.
     * @returns {boolean}
     */
    static #sidesMatch(maskSide, copperSide) {
        return GerberMaskOpeningClassifier.#sideList(maskSide).some((side) =>
            GerberMaskOpeningClassifier.#sideList(copperSide).includes(side)
        )
    }

    /**
     * Expands a side token into concrete board sides.
     * @param {'top' | 'bottom' | 'both'} side Side token.
     * @returns {('top' | 'bottom')[]}
     */
    static #sideList(side) {
        if (side === 'bottom') return ['bottom']
        if (side === 'top') return ['top']
        return ['top', 'bottom']
    }
}
