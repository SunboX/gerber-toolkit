/**
 * Resolves SVG arc flags from Gerber arc center metadata.
 */
export class GerberSvgArcFlags {
    /**
     * Resolves SVG arc rendering parameters for one Gerber arc.
     * @param {object} primitive Gerber arc primitive.
     * @returns {{ radius: number, largeArc: 0 | 1, sweep: 0 | 1 }}
     */
    static resolve(primitive) {
        const radius = GerberSvgArcFlags.radius(primitive)
        const sweepDelta = GerberSvgArcFlags.#sourceSweepDelta(primitive)
        const largeArc = Math.abs(sweepDelta) > 180 ? 1 : 0

        return {
            radius,
            largeArc,
            sweep: GerberSvgArcFlags.#resolveSweepFlag(
                primitive,
                radius,
                largeArc
            )
        }
    }

    /**
     * Resolves one Gerber arc center.
     * @param {object} primitive Gerber arc primitive.
     * @returns {{ x: number, y: number }}
     */
    static center(primitive) {
        return {
            x: Number(primitive?.x1 || 0) + Number(primitive?.i || 0),
            y: Number(primitive?.y1 || 0) + Number(primitive?.j || 0)
        }
    }

    /**
     * Resolves one Gerber arc radius.
     * @param {object} primitive Gerber arc primitive.
     * @returns {number}
     */
    static radius(primitive) {
        return Math.hypot(Number(primitive?.i || 0), Number(primitive?.j || 0))
    }

    /**
     * Resolves the source sweep in Gerber's Y-up coordinate space.
     * @param {object} primitive Gerber arc primitive.
     * @returns {number}
     */
    static #sourceSweepDelta(primitive) {
        const center = GerberSvgArcFlags.center(primitive)
        const startAngle = GerberSvgArcFlags.#angleDeg(
            Number(primitive?.x1 || 0) - center.x,
            Number(primitive?.y1 || 0) - center.y
        )
        const endAngle = GerberSvgArcFlags.#angleDeg(
            Number(primitive?.x2 || 0) - center.x,
            Number(primitive?.y2 || 0) - center.y
        )
        let delta = endAngle - startAngle

        if (primitive?.clockwise === true) {
            while (delta >= 0) delta -= 360
            return delta
        }

        while (delta <= 0) delta += 360
        return delta
    }

    /**
     * Resolves the SVG sweep flag that preserves the authored Gerber center.
     * @param {object} primitive Gerber arc primitive.
     * @param {number} radius Arc radius.
     * @param {0 | 1} largeArc SVG large-arc flag.
     * @returns {0 | 1}
     */
    static #resolveSweepFlag(primitive, radius, largeArc) {
        const sourceCenter = GerberSvgArcFlags.center(primitive)
        const sweep0Center = GerberSvgArcFlags.#svgCenter(
            primitive,
            radius,
            largeArc,
            0
        )
        const sweep1Center = GerberSvgArcFlags.#svgCenter(
            primitive,
            radius,
            largeArc,
            1
        )

        if (!sweep0Center || !sweep1Center) {
            return primitive?.clockwise === true ? 1 : 0
        }

        return GerberSvgArcFlags.#centerDistanceSquared(
            sourceCenter,
            sweep0Center
        ) <=
            GerberSvgArcFlags.#centerDistanceSquared(sourceCenter, sweep1Center)
            ? 0
            : 1
    }

    /**
     * Resolves the SVG center for one candidate flag combination.
     * @param {object} primitive Gerber arc primitive.
     * @param {number} radius Arc radius.
     * @param {0 | 1} largeArc SVG large-arc flag.
     * @param {0 | 1} sweep SVG sweep flag.
     * @returns {{ x: number, y: number } | null}
     */
    static #svgCenter(primitive, radius, largeArc, sweep) {
        const x1 = Number(primitive?.x1 || 0)
        const y1 = Number(primitive?.y1 || 0)
        const x2 = Number(primitive?.x2 || 0)
        const y2 = Number(primitive?.y2 || 0)
        const dx = (x1 - x2) / 2
        const dy = (y1 - y2) / 2
        const denominator = dx * dx + dy * dy

        if (!Number.isFinite(radius) || radius <= 0 || denominator <= 0) {
            return null
        }

        const factor = Math.sqrt(
            Math.max(0, (radius * radius - denominator) / denominator)
        )
        const sign = largeArc !== sweep ? 1 : -1
        return {
            x: (x1 + x2) / 2 + sign * factor * dy,
            y: (y1 + y2) / 2 - sign * factor * dx
        }
    }

    /**
     * Resolves the squared distance between two centers.
     * @param {{ x: number, y: number }} first First center.
     * @param {{ x: number, y: number }} second Second center.
     * @returns {number}
     */
    static #centerDistanceSquared(first, second) {
        return (first.x - second.x) ** 2 + (first.y - second.y) ** 2
    }

    /**
     * Resolves a vector angle in degrees.
     * @param {number} x X vector.
     * @param {number} y Y vector.
     * @returns {number}
     */
    static #angleDeg(x, y) {
        return (Math.atan2(y, x) * 180) / Math.PI
    }
}
