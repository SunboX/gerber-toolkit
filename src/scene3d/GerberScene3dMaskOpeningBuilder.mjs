import { GerberScene3dArcGeometry } from './GerberScene3dArcGeometry.mjs'
import { GerberScene3dCoordinateMapper } from './GerberScene3dCoordinateMapper.mjs'
import { GerberScene3dLayerClassifier } from './GerberScene3dLayerClassifier.mjs'

const MILS_PER_MM = 1000 / 25.4
const TOP_COPPER_LAYER_ID = 1
const BOTTOM_COPPER_LAYER_ID = 32
const CONTAINMENT_TOLERANCE_MIL = 0.5

/**
 * Marks copper primitives that are fully opened by Gerber solder-mask artwork.
 */
export class GerberScene3dMaskOpeningBuilder {
    /**
     * Applies solder-mask opening flags to copper detail.
     * @param {{ tracks?: object[], arcs?: object[], polygons?: object[], pads?: object[], vias?: object[] }} detail
     * Scene detail accumulator.
     * @param {object[]} layers Source fabrication layers.
     * @param {object} board Board metadata.
     * @returns {void}
     */
    static apply(detail, layers, board) {
        const maskLayerIds = new Set(
            (layers || [])
                .filter((layer) =>
                    String(layer?.role || '').includes('soldermask')
                )
                .flatMap((layer) =>
                    GerberScene3dMaskOpeningBuilder.#layerIds(layer)
                )
        )
        const openings = GerberScene3dMaskOpeningBuilder.#buildOpenings(
            layers,
            board
        )

        GerberScene3dMaskOpeningBuilder.#markPrimitives(
            detail?.tracks,
            openings,
            GerberScene3dMaskOpeningBuilder.#lineBounds
        )
        GerberScene3dMaskOpeningBuilder.#markPrimitives(
            detail?.arcs,
            openings,
            GerberScene3dMaskOpeningBuilder.#sceneArcBounds
        )
        GerberScene3dMaskOpeningBuilder.#markPrimitives(
            detail?.polygons,
            openings,
            GerberScene3dMaskOpeningBuilder.#pointBounds
        )
        GerberScene3dMaskOpeningBuilder.#markPads(
            detail?.pads,
            detail?.vias,
            maskLayerIds,
            openings
        )
    }

    /**
     * Builds side-aware mask opening bounds in scene coordinates.
     * @param {object[]} layers Source fabrication layers.
     * @param {object} board Board metadata.
     * @returns {{ layerId: number, bounds: object }[]}
     */
    static #buildOpenings(layers, board) {
        const openings = []

        for (const layer of layers || []) {
            if (!String(layer?.role || '').includes('soldermask')) {
                continue
            }

            for (const primitive of layer.primitives || []) {
                const boundsList =
                    GerberScene3dMaskOpeningBuilder.#primitiveBounds(
                        primitive,
                        board
                    )
                for (const layerId of GerberScene3dMaskOpeningBuilder.#layerIds(
                    layer
                )) {
                    boundsList.forEach((bounds) =>
                        openings.push({ layerId, bounds })
                    )
                }
            }
        }

        return openings
    }

    /**
     * Resolves the matching copper layer ids for a mask layer.
     * @param {object} layer Source mask layer.
     * @returns {number[]}
     */
    static #layerIds(layer) {
        const side = GerberScene3dLayerClassifier.layerSide(layer)
        if (side === 'bottom') {
            return [BOTTOM_COPPER_LAYER_ID]
        }
        if (side === 'top') {
            return [TOP_COPPER_LAYER_ID]
        }
        return [TOP_COPPER_LAYER_ID, BOTTOM_COPPER_LAYER_ID]
    }

    /**
     * Resolves source primitive bounds in scene units.
     * @param {object} primitive Source primitive.
     * @param {object} board Board metadata.
     * @returns {object[]}
     */
    static #primitiveBounds(primitive, board) {
        if (primitive?.shape === 'block') {
            return (primitive.primitives || []).flatMap((child) =>
                GerberScene3dMaskOpeningBuilder.#primitiveBounds(child, board)
            )
        }

        if (primitive?.type === 'line') {
            return [
                GerberScene3dMaskOpeningBuilder.#sourceLineBounds(
                    primitive,
                    board
                )
            ]
        }

        if (primitive?.type === 'arc') {
            return [
                GerberScene3dMaskOpeningBuilder.#sourceArcBounds(
                    primitive,
                    board
                )
            ]
        }

        if (primitive?.type === 'region') {
            return [
                GerberScene3dMaskOpeningBuilder.#sourceRegionBounds(
                    primitive,
                    board
                )
            ]
        }

        const flashBounds = GerberScene3dMaskOpeningBuilder.#sourceFlashBounds(
            primitive,
            board
        )
        return flashBounds ? [flashBounds] : []
    }

    /**
     * Marks scene primitives contained by same-side mask openings.
     * @param {object[] | undefined} primitives Scene primitives.
     * @param {{ layerId: number, bounds: object }[]} openings Mask openings.
     * @param {(primitive: object) => object | null} boundsForPrimitive Bounds resolver.
     * @returns {void}
     */
    static #markPrimitives(primitives, openings, boundsForPrimitive) {
        for (const primitive of primitives || []) {
            const bounds = boundsForPrimitive(primitive)
            if (!bounds) {
                continue
            }

            const layerId = Number(primitive?.layerId)
            if (
                openings.some(
                    (opening) =>
                        opening.layerId === layerId &&
                        GerberScene3dMaskOpeningBuilder.#contains(
                            opening.bounds,
                            bounds
                        )
                )
            ) {
                primitive.solderMaskOpening = true
            }
        }
    }

    /**
     * Marks mask visibility.
     * @param {object[] | undefined} pads Pads.
     * @param {object[] | undefined} vias Vias.
     * @param {Set<number>} maskLayerIds Mask side lookup.
     * @param {{ layerId: number, bounds: object }[]} openings Mask openings.
     * @returns {void}
     */
    static #markPads(pads, vias, maskLayerIds, openings) {
        for (const pad of pads || []) {
            GerberScene3dMaskOpeningBuilder.#markPadSide(
                pad,
                TOP_COPPER_LAYER_ID,
                maskLayerIds,
                openings
            )
            GerberScene3dMaskOpeningBuilder.#markPadSide(
                pad,
                BOTTOM_COPPER_LAYER_ID,
                maskLayerIds,
                openings
            )
        }

        const sides = [
            [TOP_COPPER_LAYER_ID, 'isTentingTop', 'hasTopSolderMaskOpening'],
            [
                BOTTOM_COPPER_LAYER_ID,
                'isTentingBottom',
                'hasBottomSolderMaskOpening'
            ]
        ]
        const viaOwnedFlashSides = new Map()
        for (const via of vias || []) {
            for (const [layerId, tentingField, openingField] of sides) {
                if (!maskLayerIds.has(layerId)) continue
                const candidates = (pads || [])
                    .map((pad) => ({
                        pad,
                        dimensions:
                            GerberScene3dMaskOpeningBuilder.#padDimensions(
                                pad,
                                layerId
                            )
                    }))
                    .filter(
                        ({ pad, dimensions }) =>
                            dimensions &&
                            GerberScene3dMaskOpeningBuilder.#padContainsPoint(
                                pad,
                                dimensions,
                                via
                            )
                    )
                const areas = candidates.map(
                    ({ dimensions }) => dimensions.width * dimensions.height
                )
                const baseline = Math.min(...areas, Infinity)
                via[tentingField] = !candidates.some(
                    ({ pad }, index) =>
                        pad?.[openingField] === true &&
                        areas[index] > baseline + 0.001
                )
                candidates.forEach(({ pad }, index) => {
                    if (areas[index] > baseline + 0.001) return

                    // The drill matcher also creates a via-sized pad from the
                    // copper flash. Its surface belongs to the via; only a
                    // genuinely larger opened host pad should expose copper.
                    const fields = viaOwnedFlashSides.get(pad) || new Set()
                    fields.add(openingField)
                    viaOwnedFlashSides.set(pad, fields)
                })
            }
        }

        for (const [pad, openingFields] of viaOwnedFlashSides) {
            for (const openingField of openingFields) {
                pad[openingField] = false
            }
        }
    }

    /**
     * Marks one pad side as opened or covered when mask data exists.
     * @param {object} pad Scene pad primitive.
     * @param {number} layerId Scene copper layer id.
     * @param {Set<number>} maskLayerIds Mask side lookup.
     * @param {{ layerId: number, bounds: object }[]} openings Mask openings.
     * @returns {void}
     */
    static #markPadSide(pad, layerId, maskLayerIds, openings) {
        if (!maskLayerIds.has(layerId)) return

        const fieldName =
            layerId === BOTTOM_COPPER_LAYER_ID
                ? 'hasBottomSolderMaskOpening'
                : 'hasTopSolderMaskOpening'
        const bounds = GerberScene3dMaskOpeningBuilder.#padBounds(pad, layerId)
        if (!bounds) return
        pad[fieldName] = openings.some(
            (opening) =>
                opening.layerId === layerId &&
                GerberScene3dMaskOpeningBuilder.#contains(
                    opening.bounds,
                    bounds
                )
        )
    }

    /**
     * Resolves scene bounds for one pad side.
     * @param {object} pad Scene pad primitive.
     * @param {number} layerId Scene copper layer id.
     * @returns {object | null}
     */
    static #padBounds(pad, layerId) {
        const dimensions = GerberScene3dMaskOpeningBuilder.#padDimensions(
            pad,
            layerId
        )
        const x = Number(pad?.x)
        const y = Number(pad?.y)
        if (!dimensions || !Number.isFinite(x + y)) return null

        return {
            minX: x - dimensions.width / 2,
            minY: y - dimensions.height / 2,
            maxX: x + dimensions.width / 2,
            maxY: y + dimensions.height / 2
        }
    }

    /**
     * Resolves one pad side's dimensions.
     * @param {object} pad Scene pad primitive.
     * @param {number} layerId Scene copper layer id.
     * @returns {{ width: number, height: number } | null}
     */
    static #padDimensions(pad, layerId) {
        const width = Number(
            layerId === BOTTOM_COPPER_LAYER_ID
                ? pad?.sizeBottomX || 0
                : pad?.sizeTopX || 0
        )
        const height = Number(
            layerId === BOTTOM_COPPER_LAYER_ID
                ? pad?.sizeBottomY || 0
                : pad?.sizeTopY || 0
        )
        if (!Number.isFinite(width + height) || width <= 0 || height <= 0) {
            return null
        }

        return { width, height }
    }

    /**
     * Tests a scene point against a pad in pad-local coordinates.
     * @param {object} pad Scene pad primitive.
     * @param {{ width: number, height: number }} dimensions Pad dimensions.
     * @param {{ x?: number, y?: number }} point Scene point.
     * @returns {boolean}
     */
    static #padContainsPoint(pad, dimensions, point) {
        const angle = (-Number(pad?.rotation || 0) * Math.PI) / 180
        const dx = Number(point?.x) - Number(pad?.x)
        const dy = Number(point?.y) - Number(pad?.y)
        const localX = dx * Math.cos(angle) - dy * Math.sin(angle)
        const localY = dx * Math.sin(angle) + dy * Math.cos(angle)
        return (
            Math.abs(localX) <=
                dimensions.width / 2 + CONTAINMENT_TOLERANCE_MIL &&
            Math.abs(localY) <=
                dimensions.height / 2 + CONTAINMENT_TOLERANCE_MIL
        )
    }

    /**
     * Maps one source line opening to scene bounds.
     * @param {object} primitive Source line.
     * @param {object} board Board metadata.
     * @returns {object}
     */
    static #sourceLineBounds(primitive, board) {
        return GerberScene3dMaskOpeningBuilder.#lineBounds(
            GerberScene3dCoordinateMapper.line(
                {
                    x1: GerberScene3dMaskOpeningBuilder.#mmToMil(primitive.x1),
                    y1: GerberScene3dMaskOpeningBuilder.#mmToMil(primitive.y1),
                    x2: GerberScene3dMaskOpeningBuilder.#mmToMil(primitive.x2),
                    y2: GerberScene3dMaskOpeningBuilder.#mmToMil(primitive.y2),
                    width: GerberScene3dMaskOpeningBuilder.#mmToMil(
                        primitive.width || 0
                    )
                },
                board
            )
        )
    }

    /**
     * Resolves scene bounds for one line-like primitive.
     * @param {object} primitive Scene line.
     * @returns {object}
     */
    static #lineBounds(primitive) {
        const halfWidth = Math.max(Number(primitive?.width || 0), 0) / 2
        return GerberScene3dMaskOpeningBuilder.#expandBounds(
            {
                minX: Math.min(Number(primitive?.x1), Number(primitive?.x2)),
                minY: Math.min(Number(primitive?.y1), Number(primitive?.y2)),
                maxX: Math.max(Number(primitive?.x1), Number(primitive?.x2)),
                maxY: Math.max(Number(primitive?.y1), Number(primitive?.y2))
            },
            halfWidth
        )
    }

    /**
     * Maps one source arc opening to conservative scene bounds.
     * @param {object} primitive Source arc.
     * @param {object} board Board metadata.
     * @returns {object}
     */
    static #sourceArcBounds(primitive, board) {
        const center = GerberScene3dArcGeometry.center(primitive)
        return GerberScene3dMaskOpeningBuilder.#sceneArcBounds(
            GerberScene3dCoordinateMapper.line(
                {
                    x: GerberScene3dMaskOpeningBuilder.#mmToMil(center.x),
                    y: GerberScene3dMaskOpeningBuilder.#mmToMil(center.y),
                    radius: GerberScene3dMaskOpeningBuilder.#mmToMil(
                        center.radius
                    ),
                    width: GerberScene3dMaskOpeningBuilder.#mmToMil(
                        primitive.width || 0
                    )
                },
                board
            )
        )
    }

    /**
     * Resolves conservative scene bounds for one arc primitive.
     * @param {object} primitive Scene arc.
     * @returns {object}
     */
    static #sceneArcBounds(primitive) {
        const radius =
            Number(primitive?.radius || 0) +
            Math.max(Number(primitive?.width || 0), 0) / 2
        return GerberScene3dMaskOpeningBuilder.#expandBounds(
            {
                minX: Number(primitive?.x) - radius,
                minY: Number(primitive?.y) - radius,
                maxX: Number(primitive?.x) + radius,
                maxY: Number(primitive?.y) + radius
            },
            0
        )
    }

    /**
     * Maps one source region opening to scene bounds.
     * @param {object} primitive Source region.
     * @param {object} board Board metadata.
     * @returns {object}
     */
    static #sourceRegionBounds(primitive, board) {
        return GerberScene3dMaskOpeningBuilder.#pointBounds({
            points: GerberScene3dCoordinateMapper.points(
                (primitive.points || []).map((point) => ({
                    x: GerberScene3dMaskOpeningBuilder.#mmToMil(point.x),
                    y: GerberScene3dMaskOpeningBuilder.#mmToMil(point.y)
                })),
                board
            )
        })
    }

    /**
     * Maps one source flash opening to scene bounds.
     * @param {object} primitive Source flash.
     * @param {object} board Board metadata.
     * @returns {object | null}
     */
    static #sourceFlashBounds(primitive, board) {
        const dimensions =
            GerberScene3dMaskOpeningBuilder.#flashDimensions(primitive)
        if (!dimensions) {
            return null
        }

        const center = GerberScene3dCoordinateMapper.point(
            {
                x: GerberScene3dMaskOpeningBuilder.#mmToMil(primitive.x),
                y: GerberScene3dMaskOpeningBuilder.#mmToMil(primitive.y)
            },
            board
        )
        return GerberScene3dMaskOpeningBuilder.#expandBounds(
            {
                minX: center.x,
                minY: center.y,
                maxX: center.x,
                maxY: center.y
            },
            Math.max(dimensions.width, dimensions.height) / 2
        )
    }

    /**
     * Resolves scene bounds for a point list.
     * @param {{ points?: { x?: number, y?: number }[] }} primitive Scene polygon.
     * @returns {object | null}
     */
    static #pointBounds(primitive) {
        const points = primitive?.points || []
        if (!points.length) {
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
     * Resolves rough flash dimensions in scene units.
     * @param {object} primitive Source flash primitive.
     * @returns {{ width: number, height: number } | null}
     */
    static #flashDimensions(primitive) {
        if (primitive?.shape === 'circle' || primitive?.shape === 'polygon') {
            const diameter = GerberScene3dMaskOpeningBuilder.#mmToMil(
                primitive.diameter
            )
            return { width: diameter, height: diameter }
        }

        if (primitive?.shape === 'rect' || primitive?.shape === 'obround') {
            return {
                width: GerberScene3dMaskOpeningBuilder.#mmToMil(
                    primitive.width
                ),
                height: GerberScene3dMaskOpeningBuilder.#mmToMil(
                    primitive.height
                )
            }
        }

        return null
    }

    /**
     * Expands bounds by a symmetric padding.
     * @param {object} bounds Base bounds.
     * @param {number} padding Padding in scene units.
     * @returns {object}
     */
    static #expandBounds(bounds, padding) {
        const safePadding = Math.max(Number(padding || 0), 0)
        return {
            minX: Number(bounds.minX) - safePadding,
            minY: Number(bounds.minY) - safePadding,
            maxX: Number(bounds.maxX) + safePadding,
            maxY: Number(bounds.maxY) + safePadding
        }
    }

    /**
     * Checks whether one opening fully contains one primitive.
     * @param {object} outer Candidate opening bounds.
     * @param {object} inner Candidate copper bounds.
     * @returns {boolean}
     */
    static #contains(outer, inner) {
        return (
            inner.minX >= outer.minX - CONTAINMENT_TOLERANCE_MIL &&
            inner.minY >= outer.minY - CONTAINMENT_TOLERANCE_MIL &&
            inner.maxX <= outer.maxX + CONTAINMENT_TOLERANCE_MIL &&
            inner.maxY <= outer.maxY + CONTAINMENT_TOLERANCE_MIL
        )
    }

    /**
     * Converts millimeters to scene mil units.
     * @param {number | string | undefined | null} value Millimeter value.
     * @returns {number}
     */
    static #mmToMil(value) {
        return Number(Number(value || 0) * MILS_PER_MM)
    }
}
