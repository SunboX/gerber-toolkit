/** Samples native Gerber arcs for region and projection consumers. */
export class GerberArcSampler {
    /**
     * Samples one Gerber arc with at most five-degree segments.
     * @param {Record<string, any>} arc Native arc.
     * @returns {{ x: number, y: number }[]} Sampled points.
     */
    static points(arc) {
        const x1 = GerberArcSampler.#number(arc?.x1)
        const y1 = GerberArcSampler.#number(arc?.y1)
        const x2 = GerberArcSampler.#number(arc?.x2)
        const y2 = GerberArcSampler.#number(arc?.y2)
        const centerX = x1 + GerberArcSampler.#number(arc?.i)
        const centerY = y1 + GerberArcSampler.#number(arc?.j)
        const radius = Math.hypot(x1 - centerX, y1 - centerY)
        if (!(radius > 0)) {
            return [
                { x: x1, y: y1 },
                { x: x2, y: y2 }
            ]
        }
        const start = Math.atan2(y1 - centerY, x1 - centerX)
        const end = Math.atan2(y2 - centerY, x2 - centerX)
        let sweep = end - start
        if (arc?.clockwise && sweep >= 0) sweep -= Math.PI * 2
        if (!arc?.clockwise && sweep <= 0) sweep += Math.PI * 2
        const steps = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 36)))
        return Array.from({ length: steps + 1 }, (_, index) => {
            if (index === steps) return { x: x2, y: y2 }
            const angle = start + (sweep * index) / steps
            return {
                x: centerX + Math.cos(angle) * radius,
                y: centerY + Math.sin(angle) * radius
            }
        })
    }

    /**
     * Returns endpoints plus every analytic cardinal extremum on the directed
     * sweep, avoiding sampled-bounds underestimation.
     * @param {Record<string, any>} arc Native arc.
     * @returns {{ x: number, y: number }[]} Exact bound-critical points.
     */
    static extrema(arc) {
        const x1 = GerberArcSampler.#number(arc?.x1)
        const y1 = GerberArcSampler.#number(arc?.y1)
        const x2 = GerberArcSampler.#number(arc?.x2)
        const y2 = GerberArcSampler.#number(arc?.y2)
        const centerX = x1 + GerberArcSampler.#number(arc?.i)
        const centerY = y1 + GerberArcSampler.#number(arc?.j)
        const radius = Math.hypot(x1 - centerX, y1 - centerY)
        const points = [
            { x: x1, y: y1 },
            { x: x2, y: y2 }
        ]
        if (!(radius > 0)) return points
        const start = Math.atan2(y1 - centerY, x1 - centerX)
        const end = Math.atan2(y2 - centerY, x2 - centerX)
        let sweep = end - start
        if (arc?.clockwise && sweep >= 0) sweep -= Math.PI * 2
        if (!arc?.clockwise && sweep <= 0) sweep += Math.PI * 2
        for (const angle of [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2]) {
            if (!GerberArcSampler.#containsAngle(start, sweep, angle)) continue
            points.push({
                x: centerX + Math.cos(angle) * radius,
                y: centerY + Math.sin(angle) * radius
            })
        }
        return points
    }

    /**
     * Tests whether a cardinal angle lies on a directed sweep.
     * @param {number} start Start angle.
     * @param {number} sweep Signed sweep.
     * @param {number} angle Candidate angle.
     * @returns {boolean} Whether the angle is included.
     */
    static #containsAngle(start, sweep, angle) {
        const full = Math.PI * 2
        const progress =
            sweep < 0
                ? GerberArcSampler.#positiveModulo(start - angle, full)
                : GerberArcSampler.#positiveModulo(angle - start, full)
        return progress <= Math.abs(sweep) + 1e-12
    }

    /**
     * Returns a positive modulo.
     * @param {number} value Input value.
     * @param {number} modulus Positive modulus.
     * @returns {number} Normalized value.
     */
    static #positiveModulo(value, modulus) {
        return ((value % modulus) + modulus) % modulus
    }

    /**
     * Returns a finite number or zero.
     * @param {unknown} value Numeric candidate.
     * @returns {number} Finite value.
     */
    static #number(value) {
        const number = Number(value)
        return Number.isFinite(number) ? number : 0
    }
}

Object.freeze(GerberArcSampler.prototype)
Object.freeze(GerberArcSampler)
