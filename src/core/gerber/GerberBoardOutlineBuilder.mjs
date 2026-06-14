const MILS_PER_MM = 1000 / 25.4

/**
 * Builds PCB board-outline metadata from Gerber fabrication bounds.
 */
export class GerberBoardOutlineBuilder {
    /**
     * Builds a board-outline envelope from Gerber-space bounds.
     * @param {{ minX: number, minY: number, maxX: number, maxY: number }} bounds Bounds in millimeters.
     * @returns {{ minX: number, minY: number, widthMil: number, heightMil: number, segments: object[] }}
     */
    static fromBounds(bounds) {
        const minX = GerberBoardOutlineBuilder.#mmToMil(bounds?.minX)
        const minY = GerberBoardOutlineBuilder.#mmToMil(bounds?.minY)
        const maxX = GerberBoardOutlineBuilder.#mmToMil(bounds?.maxX)
        const maxY = GerberBoardOutlineBuilder.#mmToMil(bounds?.maxY)
        const widthMil = Math.max(maxX - minX, 1)
        const heightMil = Math.max(maxY - minY, 1)

        return {
            minX: GerberBoardOutlineBuilder.#roundMil(minX),
            minY: GerberBoardOutlineBuilder.#roundMil(minY),
            widthMil: GerberBoardOutlineBuilder.#roundMil(widthMil),
            heightMil: GerberBoardOutlineBuilder.#roundMil(heightMil),
            segments: GerberBoardOutlineBuilder.#rectangularOutlineSegments(
                minX,
                minY,
                widthMil,
                heightMil
            )
        }
    }

    /**
     * Builds rectangular fallback outline segments in viewer scene units.
     * @param {number} minX Left edge in mils.
     * @param {number} minY Bottom edge in mils.
     * @param {number} widthMil Width in mils.
     * @param {number} heightMil Height in mils.
     * @returns {object[]}
     */
    static #rectangularOutlineSegments(minX, minY, widthMil, heightMil) {
        const maxX = minX + widthMil
        const maxY = minY + heightMil

        return [
            GerberBoardOutlineBuilder.#outlineLine(minX, minY, maxX, minY),
            GerberBoardOutlineBuilder.#outlineLine(maxX, minY, maxX, maxY),
            GerberBoardOutlineBuilder.#outlineLine(maxX, maxY, minX, maxY),
            GerberBoardOutlineBuilder.#outlineLine(minX, maxY, minX, minY)
        ]
    }

    /**
     * Builds one rounded outline line segment.
     * @param {number} x1 Start X in mils.
     * @param {number} y1 Start Y in mils.
     * @param {number} x2 End X in mils.
     * @param {number} y2 End Y in mils.
     * @returns {object}
     */
    static #outlineLine(x1, y1, x2, y2) {
        return {
            type: 'line',
            x1: GerberBoardOutlineBuilder.#roundMil(x1),
            y1: GerberBoardOutlineBuilder.#roundMil(y1),
            x2: GerberBoardOutlineBuilder.#roundMil(x2),
            y2: GerberBoardOutlineBuilder.#roundMil(y2)
        }
    }

    /**
     * Converts millimeters to mils.
     * @param {number} value Millimeter value.
     * @returns {number}
     */
    static #mmToMil(value) {
        return Number(value || 0) * MILS_PER_MM
    }

    /**
     * Rounds one mil value for stable JSON output.
     * @param {number} value Mil value.
     * @returns {number}
     */
    static #roundMil(value) {
        return Number(value.toFixed(6))
    }
}
