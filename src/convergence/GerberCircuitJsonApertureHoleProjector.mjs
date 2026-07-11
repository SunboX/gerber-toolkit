import polygonClipping from 'polygon-clipping'

const CURVE_SEGMENTS = 32

/** Subtracts standard round and rectangular aperture holes from flash images. */
export class GerberCircuitJsonApertureHoleProjector {
    /**
     * Subtracts the flash's optional standard hole from outer geometry.
     * @param {number[][][][]} outer Outer flash image.
     * @param {Record<string, any>} primitive Native flash.
     * @returns {number[][][][]} Holed flash image.
     */
    static subtract(outer, primitive) {
        const hole = primitive?.hole
        if (!outer.length || !hole) return outer
        const x = GerberCircuitJsonApertureHoleProjector.#number(primitive.x)
        const y = GerberCircuitJsonApertureHoleProjector.#number(primitive.y)
        const points =
            hole.shape === 'rect'
                ? GerberCircuitJsonApertureHoleProjector.#rectangle(
                      x,
                      y,
                      GerberCircuitJsonApertureHoleProjector.#positive(
                          hole.width
                      ),
                      GerberCircuitJsonApertureHoleProjector.#positive(
                          hole.height
                      )
                  )
                : GerberCircuitJsonApertureHoleProjector.#circle(
                      x,
                      y,
                      GerberCircuitJsonApertureHoleProjector.#positive(
                          hole.diameter
                      ) / 2
                  )
        const transformed = GerberCircuitJsonApertureHoleProjector.#transform(
            points,
            primitive.transform,
            x,
            y
        )
        transformed.push({ ...transformed[0] })
        return polygonClipping.difference(outer, [
            [transformed.map((point) => [point.x, point.y])]
        ])
    }

    /**
     * Builds a circular point ring.
     * @param {number} x Center X.
     * @param {number} y Center Y.
     * @param {number} radius Radius.
     * @returns {{ x: number, y: number }[]} Ring points.
     */
    static #circle(x, y, radius) {
        return Array.from({ length: CURVE_SEGMENTS }, (_, index) => {
            const angle = (index / CURVE_SEGMENTS) * Math.PI * 2
            return {
                x: x + Math.cos(angle) * radius,
                y: y + Math.sin(angle) * radius
            }
        })
    }

    /**
     * Builds an axis-aligned rectangle point ring.
     * @param {number} x Center X.
     * @param {number} y Center Y.
     * @param {number} width Width.
     * @param {number} height Height.
     * @returns {{ x: number, y: number }[]} Ring points.
     */
    static #rectangle(x, y, width, height) {
        return [
            { x: x - width / 2, y: y - height / 2 },
            { x: x + width / 2, y: y - height / 2 },
            { x: x + width / 2, y: y + height / 2 },
            { x: x - width / 2, y: y + height / 2 }
        ]
    }

    /**
     * Applies LM/LR around the already positioned flash center. LS is already
     * reflected in the native hole dimensions.
     * @param {{ x: number, y: number }[]} points Hole points.
     * @param {Record<string, any>} transform Aperture transform.
     * @param {number} pivotX Pivot X.
     * @param {number} pivotY Pivot Y.
     * @returns {{ x: number, y: number }[]} Transformed points.
     */
    static #transform(points, transform = {}, pivotX, pivotY) {
        const mirror = String(transform?.mirror || 'none')
        const scaleX = mirror === 'x' || mirror === 'xy' ? -1 : 1
        const scaleY = mirror === 'y' || mirror === 'xy' ? -1 : 1
        const radians =
            (GerberCircuitJsonApertureHoleProjector.#number(
                transform?.rotation
            ) *
                Math.PI) /
            180
        const cosine = Math.cos(radians)
        const sine = Math.sin(radians)
        return points.map((point) => {
            const localX = (point.x - pivotX) * scaleX
            const localY = (point.y - pivotY) * scaleY
            return {
                x: pivotX + localX * cosine - localY * sine,
                y: pivotY + localX * sine + localY * cosine
            }
        })
    }

    /** @param {unknown} value Candidate. @returns {number} Positive value. */
    static #positive(value) {
        return Math.max(
            GerberCircuitJsonApertureHoleProjector.#number(value),
            0.000001
        )
    }

    /** @param {unknown} value Candidate. @returns {number} Finite value. */
    static #number(value) {
        const number = Number(value)
        return Number.isFinite(number) ? number : 0
    }
}

Object.freeze(GerberCircuitJsonApertureHoleProjector.prototype)
Object.freeze(GerberCircuitJsonApertureHoleProjector)
