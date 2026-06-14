/**
 * Mutable bounds accumulator for normalized board geometry.
 */
export class GerberBounds {
    /**
     * Creates an empty bounds accumulator.
     */
    constructor() {
        this.minX = Infinity
        this.minY = Infinity
        this.maxX = -Infinity
        this.maxY = -Infinity
    }

    /**
     * Expands the accumulator around a point and radius.
     * @param {number} x Point X coordinate.
     * @param {number} y Point Y coordinate.
     * @param {number} [radius] Expansion radius.
     * @returns {void}
     */
    includePoint(x, y, radius = 0) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            return
        }

        this.minX = Math.min(this.minX, x - radius)
        this.minY = Math.min(this.minY, y - radius)
        this.maxX = Math.max(this.maxX, x + radius)
        this.maxY = Math.max(this.maxY, y + radius)
    }

    /**
     * Expands the accumulator around a line segment and stroke radius.
     * @param {number} x1 Start X coordinate.
     * @param {number} y1 Start Y coordinate.
     * @param {number} x2 End X coordinate.
     * @param {number} y2 End Y coordinate.
     * @param {number} [radius] Stroke radius.
     * @returns {void}
     */
    includeSegment(x1, y1, x2, y2, radius = 0) {
        this.includePoint(x1, y1, radius)
        this.includePoint(x2, y2, radius)
    }

    /**
     * Expands the accumulator around another bounds object.
     * @param {{ minX?: number, minY?: number, maxX?: number, maxY?: number } | null | undefined} bounds Bounds to include.
     * @returns {void}
     */
    includeBounds(bounds) {
        if (!bounds) {
            return
        }

        this.includePoint(Number(bounds.minX), Number(bounds.minY))
        this.includePoint(Number(bounds.maxX), Number(bounds.maxY))
    }

    /**
     * Returns a plain bounds object.
     * @returns {{ minX: number, minY: number, maxX: number, maxY: number }}
     */
    toObject() {
        if (!Number.isFinite(this.minX)) {
            return { minX: 0, minY: 0, maxX: 1, maxY: 1 }
        }

        return {
            minX: GerberBounds.#round(this.minX),
            minY: GerberBounds.#round(this.minY),
            maxX: GerberBounds.#round(this.maxX),
            maxY: GerberBounds.#round(this.maxY)
        }
    }

    /**
     * Rounds geometry to a stable decimal precision.
     * @param {number} value Geometry value.
     * @returns {number}
     */
    static #round(value) {
        return Number(value.toFixed(6))
    }
}
