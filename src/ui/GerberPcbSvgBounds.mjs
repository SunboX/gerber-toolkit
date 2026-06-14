import { GerberSvgArcFlags } from './GerberSvgArcFlags.mjs'

const VIEW_BOX_PADDING = 4

/**
 * Resolves SVG viewBox bounds for rendered Gerber layers.
 */
export class GerberPcbSvgBounds {
    /**
     * Resolves normalized SVG bounds.
     * @param {object} documentModel Normalized Gerber document.
     * @param {object[]} layers Layers selected for rendering.
     * @returns {{ minX: number, minY: number, width: number, height: number }}
     */
    static resolve(documentModel, layers) {
        const layerBounds = GerberPcbSvgBounds.#layerBounds(layers)
        if (layerBounds) {
            return GerberPcbSvgBounds.#normalizeBounds(layerBounds)
        }

        const bounds = documentModel?.pcb?.bounds || {}
        return GerberPcbSvgBounds.#normalizeBounds(bounds)
    }

    /**
     * Normalizes arbitrary bounds into SVG viewBox dimensions.
     * @param {object} bounds Bounds candidate.
     * @returns {{ minX: number, minY: number, width: number, height: number }}
     */
    static #normalizeBounds(bounds) {
        const minX = Number(bounds.minX || 0)
        const minY = Number(bounds.minY || 0)
        const maxX = Number(bounds.maxX || minX + 1)
        const maxY = Number(bounds.maxY || minY + 1)
        const width = Math.max(1, GerberPcbSvgBounds.#round(maxX - minX))
        const height = Math.max(1, GerberPcbSvgBounds.#round(maxY - minY))
        return {
            minX: GerberPcbSvgBounds.#round(minX - VIEW_BOX_PADDING),
            minY: GerberPcbSvgBounds.#round(minY - VIEW_BOX_PADDING),
            width: GerberPcbSvgBounds.#round(width + VIEW_BOX_PADDING * 2),
            height: GerberPcbSvgBounds.#round(height + VIEW_BOX_PADDING * 2)
        }
    }

    /**
     * Resolves bounds for the layers currently visible in the SVG.
     * @param {object[]} layers Rendered layers.
     * @returns {{ minX: number, minY: number, maxX: number, maxY: number } | null}
     */
    static #layerBounds(layers) {
        return (Array.isArray(layers) ? layers : []).reduce((bounds, layer) => {
            let nextBounds = bounds
            for (const primitive of layer.primitives || []) {
                nextBounds = GerberPcbSvgBounds.#includeBounds(
                    nextBounds,
                    GerberPcbSvgBounds.#primitiveBounds(primitive)
                )
            }
            for (const drill of layer.drills || []) {
                nextBounds = GerberPcbSvgBounds.#includeBounds(
                    nextBounds,
                    GerberPcbSvgBounds.#drillBounds(drill)
                )
            }
            return nextBounds
        }, null)
    }

    /**
     * Resolves one primitive's drawing bounds.
     * @param {object} primitive Primitive model.
     * @returns {{ minX: number, minY: number, maxX: number, maxY: number } | null}
     */
    static #primitiveBounds(primitive) {
        if (primitive.type === 'arc') {
            const center = GerberSvgArcFlags.center(primitive)
            const radius =
                GerberSvgArcFlags.radius(primitive) +
                Number(primitive.width || 0) / 2
            return GerberPcbSvgBounds.#centerBounds(center.x, center.y, radius)
        }

        if (primitive.type === 'line') {
            const radius = Number(primitive.width || 0) / 2
            return {
                minX: Math.min(primitive.x1, primitive.x2) - radius,
                minY: Math.min(primitive.y1, primitive.y2) - radius,
                maxX: Math.max(primitive.x1, primitive.x2) + radius,
                maxY: Math.max(primitive.y1, primitive.y2) + radius
            }
        }

        if (primitive.type === 'region') {
            return GerberPcbSvgBounds.#pointBounds(primitive.points || [])
        }

        if (primitive.shape === 'macro') {
            return GerberPcbSvgBounds.#macroBounds(primitive)
        }

        const radius =
            Math.max(
                Number(primitive.diameter || 0),
                Number(primitive.width || 0),
                Number(primitive.height || 0)
            ) / 2
        return GerberPcbSvgBounds.#centerBounds(
            primitive.x,
            primitive.y,
            radius
        )
    }

    /**
     * Resolves one macro flash's approximate drawing bounds.
     * @param {object} primitive Macro flash primitive.
     * @returns {{ minX: number, minY: number, maxX: number, maxY: number } | null}
     */
    static #macroBounds(primitive) {
        const childBounds = (primitive.primitives || []).reduce(
            (bounds, child) =>
                GerberPcbSvgBounds.#includeBounds(
                    bounds,
                    GerberPcbSvgBounds.#primitiveBounds(child)
                ),
            null
        )
        if (!childBounds) {
            return GerberPcbSvgBounds.#centerBounds(primitive.x, primitive.y, 0)
        }

        const offsetX = Number(primitive.x || 0)
        const offsetY = Number(primitive.y || 0)
        return {
            minX: childBounds.minX + offsetX,
            minY: childBounds.minY + offsetY,
            maxX: childBounds.maxX + offsetX,
            maxY: childBounds.maxY + offsetY
        }
    }

    /**
     * Resolves one drill hit's drawing bounds.
     * @param {object} drill Drill hit.
     * @returns {{ minX: number, minY: number, maxX: number, maxY: number } | null}
     */
    static #drillBounds(drill) {
        const radius = Number(drill.diameter || 0) / 2
        if (drill.type === 'slot') {
            return {
                minX: Math.min(drill.x1, drill.x2) - radius,
                minY: Math.min(drill.y1, drill.y2) - radius,
                maxX: Math.max(drill.x1, drill.x2) + radius,
                maxY: Math.max(drill.y1, drill.y2) + radius
            }
        }

        return GerberPcbSvgBounds.#centerBounds(drill.x, drill.y, radius)
    }

    /**
     * Builds square bounds around one center point.
     * @param {number} x Center x.
     * @param {number} y Center y.
     * @param {number} radius Radius.
     * @returns {{ minX: number, minY: number, maxX: number, maxY: number } | null}
     */
    static #centerBounds(x, y, radius) {
        const centerX = Number(x)
        const centerY = Number(y)
        const extent = Math.max(Number(radius || 0), 0)
        if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) {
            return null
        }

        return {
            minX: centerX - extent,
            minY: centerY - extent,
            maxX: centerX + extent,
            maxY: centerY + extent
        }
    }

    /**
     * Resolves bounds for point-list geometry.
     * @param {{ x: number, y: number }[]} points Point list.
     * @returns {{ minX: number, minY: number, maxX: number, maxY: number } | null}
     */
    static #pointBounds(points) {
        return (Array.isArray(points) ? points : []).reduce(
            (bounds, point) =>
                GerberPcbSvgBounds.#includePoint(bounds, point.x, point.y),
            null
        )
    }

    /**
     * Merges two bounds.
     * @param {{ minX: number, minY: number, maxX: number, maxY: number } | null} bounds Current bounds.
     * @param {{ minX: number, minY: number, maxX: number, maxY: number } | null} candidate Candidate bounds.
     * @returns {{ minX: number, minY: number, maxX: number, maxY: number } | null}
     */
    static #includeBounds(bounds, candidate) {
        if (!candidate) return bounds
        return GerberPcbSvgBounds.#includePoint(
            GerberPcbSvgBounds.#includePoint(
                bounds,
                candidate.minX,
                candidate.minY
            ),
            candidate.maxX,
            candidate.maxY
        )
    }

    /**
     * Includes one point in a bounds object.
     * @param {{ minX: number, minY: number, maxX: number, maxY: number } | null} bounds Current bounds.
     * @param {number} x Point x.
     * @param {number} y Point y.
     * @returns {{ minX: number, minY: number, maxX: number, maxY: number } | null}
     */
    static #includePoint(bounds, x, y) {
        const pointX = Number(x)
        const pointY = Number(y)
        if (!Number.isFinite(pointX) || !Number.isFinite(pointY)) {
            return bounds
        }
        if (!bounds) {
            return { minX: pointX, minY: pointY, maxX: pointX, maxY: pointY }
        }

        return {
            minX: Math.min(bounds.minX, pointX),
            minY: Math.min(bounds.minY, pointY),
            maxX: Math.max(bounds.maxX, pointX),
            maxY: Math.max(bounds.maxY, pointY)
        }
    }

    /**
     * Rounds a numeric value for stable SVG coordinates.
     * @param {number} value Number.
     * @returns {number}
     */
    static #round(value) {
        return Number(Number(value || 0).toFixed(6))
    }
}
