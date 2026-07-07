const PAD_SHAPE_CIRCLE = 1
const PAD_SHAPE_RECT = 2

/**
 * Resolves Gerber flash apertures into scene pad dimensions.
 */
export class GerberScene3dFlashGeometry {
    /**
     * Resolves one flash primitive's visible dimensions.
     * @param {object} primitive Source primitive.
     * @returns {{ width: number, height: number, shapeCode: number, cornerRadiusRatio: number } | null}
     */
    static dimensions(primitive) {
        if (primitive?.shape === 'circle') {
            return GerberScene3dFlashGeometry.#dimensionResult(
                primitive.diameter,
                primitive.diameter,
                PAD_SHAPE_CIRCLE,
                0
            )
        }

        if (primitive?.shape === 'rect') {
            return GerberScene3dFlashGeometry.#dimensionResult(
                primitive.width,
                primitive.height,
                PAD_SHAPE_RECT,
                0
            )
        }

        if (primitive?.shape === 'obround') {
            return GerberScene3dFlashGeometry.#dimensionResult(
                primitive.width,
                primitive.height,
                PAD_SHAPE_RECT,
                0.5
            )
        }

        if (primitive?.shape === 'polygon') {
            return GerberScene3dFlashGeometry.#dimensionResult(
                primitive.diameter,
                primitive.diameter,
                PAD_SHAPE_CIRCLE,
                0
            )
        }

        if (primitive?.shape === 'macro') {
            return GerberScene3dFlashGeometry.#macroDimensions(primitive)
        }

        return null
    }

    /**
     * Builds a normalized dimension result.
     * @param {number} width Width in mm.
     * @param {number} height Height in mm.
     * @param {number} shapeCode Scene pad shape code.
     * @param {number} cornerRadiusRatio Rounded-rectangle corner ratio.
     * @returns {object | null}
     */
    static #dimensionResult(width, height, shapeCode, cornerRadiusRatio) {
        const normalizedWidth = Number(width || 0)
        const normalizedHeight = Number(height || 0)
        if (normalizedWidth <= 0 || normalizedHeight <= 0) {
            return null
        }

        return {
            width: normalizedWidth,
            height: normalizedHeight,
            shapeCode,
            cornerRadiusRatio
        }
    }

    /**
     * Approximates a macro flash from child primitive bounds.
     * @param {object} primitive Macro primitive.
     * @returns {object | null}
     */
    static #macroDimensions(primitive) {
        const bounds = (primitive.primitives || []).reduce(
            (currentBounds, child) =>
                GerberScene3dFlashGeometry.#mergeBounds(
                    currentBounds,
                    GerberScene3dFlashGeometry.#primitiveBoundsMm(child)
                ),
            null
        )
        if (!bounds) {
            return null
        }

        return GerberScene3dFlashGeometry.#dimensionResult(
            bounds.maxX - bounds.minX,
            bounds.maxY - bounds.minY,
            PAD_SHAPE_RECT,
            0
        )
    }

    /**
     * Resolves approximate primitive bounds in mm.
     * @param {object} primitive Source primitive.
     * @returns {object | null}
     */
    static #primitiveBoundsMm(primitive) {
        if (primitive?.type === 'line' || primitive?.type === 'arc') {
            const radius = Number(primitive.width || 0) / 2
            return {
                minX: Math.min(primitive.x1, primitive.x2) - radius,
                minY: Math.min(primitive.y1, primitive.y2) - radius,
                maxX: Math.max(primitive.x1, primitive.x2) + radius,
                maxY: Math.max(primitive.y1, primitive.y2) + radius
            }
        }

        if (primitive?.type === 'region') {
            return (primitive.points || []).reduce(
                (bounds, point) =>
                    GerberScene3dFlashGeometry.#mergeBounds(bounds, {
                        minX: Number(point.x),
                        minY: Number(point.y),
                        maxX: Number(point.x),
                        maxY: Number(point.y)
                    }),
                null
            )
        }

        const width = Number(primitive?.width || primitive?.diameter || 0)
        const height = Number(primitive?.height || primitive?.diameter || width)
        if (width <= 0 || height <= 0) {
            return null
        }

        return {
            minX: Number(primitive.x || 0) - width / 2,
            minY: Number(primitive.y || 0) - height / 2,
            maxX: Number(primitive.x || 0) + width / 2,
            maxY: Number(primitive.y || 0) + height / 2
        }
    }

    /**
     * Merges two bounds objects.
     * @param {object | null} bounds Existing bounds.
     * @param {object | null} candidate Candidate bounds.
     * @returns {object | null}
     */
    static #mergeBounds(bounds, candidate) {
        if (
            !Number.isFinite(candidate?.minX) ||
            !Number.isFinite(candidate?.minY) ||
            !Number.isFinite(candidate?.maxX) ||
            !Number.isFinite(candidate?.maxY)
        ) {
            return bounds
        }

        if (!bounds) {
            return { ...candidate }
        }

        return {
            minX: Math.min(bounds.minX, candidate.minX),
            minY: Math.min(bounds.minY, candidate.minY),
            maxX: Math.max(bounds.maxX, candidate.maxX),
            maxY: Math.max(bounds.maxY, candidate.maxY)
        }
    }
}
