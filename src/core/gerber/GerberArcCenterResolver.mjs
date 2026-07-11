/** Resolves signed center offsets for Gerber single-quadrant arcs. */
export class GerberArcCenterResolver {
    /**
     * Resolves I/J offsets according to G74/G75 semantics.
     * @param {{ x1: number, y1: number, x2: number, y2: number, i: number, j: number, clockwise: boolean }} arc Parsed arc.
     * @param {'single' | 'multi'} quadrantMode Active quadrant mode.
     * @returns {{ x1: number, y1: number, x2: number, y2: number, i: number, j: number, clockwise: boolean }} Resolved arc.
     */
    static resolve(arc, quadrantMode) {
        if (quadrantMode !== 'single') return arc
        const magnitudeI = Math.abs(Number(arc.i) || 0)
        const magnitudeJ = Math.abs(Number(arc.j) || 0)
        const signsI = magnitudeI === 0 ? [1] : [-1, 1]
        const signsJ = magnitudeJ === 0 ? [1] : [-1, 1]
        const candidates = []
        for (const signI of signsI) {
            for (const signJ of signsJ) {
                const i = magnitudeI * signI
                const j = magnitudeJ * signJ
                const centerX = arc.x1 + i
                const centerY = arc.y1 + j
                const startRadius = Math.hypot(
                    arc.x1 - centerX,
                    arc.y1 - centerY
                )
                const endRadius = Math.hypot(arc.x2 - centerX, arc.y2 - centerY)
                const error = Math.abs(startRadius - endRadius)
                const tolerance = Math.max(startRadius, endRadius, 1) * 1e-6
                const sweep = GerberArcCenterResolver.#sweep(
                    arc,
                    centerX,
                    centerY
                )
                if (error <= tolerance && sweep <= Math.PI / 2 + 1e-7) {
                    candidates.push({ i, j, error, sweep })
                }
            }
        }
        candidates.sort(
            (left, right) =>
                left.error - right.error || left.sweep - right.sweep
        )
        const selected = candidates[0]
        return selected ? { ...arc, i: selected.i, j: selected.j } : arc
    }

    /**
     * Computes the positive directed sweep magnitude for a center candidate.
     * @param {Record<string, any>} arc Arc endpoints and direction.
     * @param {number} centerX Center X.
     * @param {number} centerY Center Y.
     * @returns {number} Directed sweep radians.
     */
    static #sweep(arc, centerX, centerY) {
        const start = Math.atan2(arc.y1 - centerY, arc.x1 - centerX)
        const end = Math.atan2(arc.y2 - centerY, arc.x2 - centerX)
        let sweep = end - start
        if (arc.clockwise) {
            while (sweep >= 0) sweep -= Math.PI * 2
            return Math.abs(sweep)
        }
        while (sweep <= 0) sweep += Math.PI * 2
        return sweep
    }
}

Object.freeze(GerberArcCenterResolver.prototype)
Object.freeze(GerberArcCenterResolver)
