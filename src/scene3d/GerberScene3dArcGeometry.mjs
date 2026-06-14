/**
 * Resolves arc geometry used by Gerber 3D scene conversion.
 */
export class GerberScene3dArcGeometry {
    /**
     * Resolves arc center metadata in mm.
     * @param {object} primitive Arc primitive.
     * @returns {{ x: number, y: number, radius: number }}
     */
    static center(primitive) {
        const centerX = Number(primitive.x1 || 0) + Number(primitive.i || 0)
        const centerY = Number(primitive.y1 || 0) + Number(primitive.j || 0)
        return {
            x: centerX,
            y: centerY,
            radius: Math.hypot(
                Number(primitive.i || 0),
                Number(primitive.j || 0)
            )
        }
    }

    /**
     * Converts a vector to degrees.
     * @param {number} x X vector.
     * @param {number} y Y vector.
     * @returns {number}
     */
    static angleDeg(x, y) {
        return (Math.atan2(y, x) * 180) / Math.PI
    }
}
