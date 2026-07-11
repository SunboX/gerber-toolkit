/** Builds the rectangular envelope required by aperture macro code 20. */
export class GerberCircuitJsonSquareStroke {
    /**
     * Builds a square-ended stroke between two authored center points.
     * @param {{ x: number, y: number }[]} points Two center points.
     * @param {number} width Stroke width.
     * @returns {{ x: number, y: number }[]} Rectangle vertices.
     */
    static points(points, width) {
        if (!Array.isArray(points) || points.length < 2) return []
        const start = points[0]
        const end = points.at(-1)
        const dx = Number(end.x) - Number(start.x)
        const dy = Number(end.y) - Number(start.y)
        const length = Math.hypot(dx, dy)
        if (!(length > 0)) return []
        const nx = (-(dy / length) * width) / 2
        const ny = ((dx / length) * width) / 2
        return [
            { x: Number(start.x) + nx, y: Number(start.y) + ny },
            { x: Number(end.x) + nx, y: Number(end.y) + ny },
            { x: Number(end.x) - nx, y: Number(end.y) - ny },
            { x: Number(start.x) - nx, y: Number(start.y) - ny }
        ]
    }
}

Object.freeze(GerberCircuitJsonSquareStroke.prototype)
Object.freeze(GerberCircuitJsonSquareStroke)
