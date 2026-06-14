/**
 * Maps Gerber fabrication-space geometry into the shared 3D board space.
 */
export class GerberScene3dCoordinateMapper {
    /**
     * Maps a Y coordinate around the board center so Gerber 3D matches normal
     * PCB top-view orientation.
     * @param {number} value Source Y value in mils.
     * @param {{ centerY?: number }} board Board metadata.
     * @returns {number}
     */
    static y(value, board) {
        return GerberScene3dCoordinateMapper.#roundMil(
            Number(board?.centerY || 0) * 2 - Number(value || 0)
        )
    }

    /**
     * Maps one line-like object.
     * @param {object} line Source line.
     * @param {{ centerY?: number }} board Board metadata.
     * @returns {object}
     */
    static line(line, board) {
        return GerberScene3dCoordinateMapper.#mapYFields(line, board, [
            'y',
            'y1',
            'y2',
            'cy'
        ])
    }

    /**
     * Maps one point.
     * @param {{ x?: number, y?: number }} point Source point.
     * @param {{ centerY?: number }} board Board metadata.
     * @returns {{ x?: number, y?: number }}
     */
    static point(point, board) {
        return GerberScene3dCoordinateMapper.#mapYFields(point, board, ['y'])
    }

    /**
     * Maps one point list.
     * @param {{ x?: number, y?: number }[]} points Source points.
     * @param {{ centerY?: number }} board Board metadata.
     * @returns {{ x?: number, y?: number }[]}
     */
    static points(points, board) {
        return (points || []).map((point) =>
            GerberScene3dCoordinateMapper.point(point, board)
        )
    }

    /**
     * Mirrors a local rotation after the handedness change.
     * @param {number | string | undefined | null} rotation Rotation in degrees.
     * @returns {number}
     */
    static rotation(rotation) {
        return GerberScene3dCoordinateMapper.#normalizeRotation(
            -Number(rotation || 0)
        )
    }

    /**
     * Mirrors arc angles and reverses sweep direction.
     * @param {number} startAngle Source start angle.
     * @param {number} endAngle Source end angle.
     * @param {boolean} clockwise Whether the source arc is clockwise.
     * @returns {{ startAngle: number, endAngle: number }}
     */
    static arcAngles(startAngle, endAngle, clockwise) {
        const mirroredStart = GerberScene3dCoordinateMapper.rotation(startAngle)
        const mirroredEnd = GerberScene3dCoordinateMapper.rotation(endAngle)

        const resolvedEndAngle = clockwise
            ? GerberScene3dCoordinateMapper.#counterClockwiseEndAngle(
                  mirroredStart,
                  mirroredEnd
              )
            : GerberScene3dCoordinateMapper.#clockwiseEndAngle(
                  mirroredStart,
                  mirroredEnd
              )

        return {
            startAngle: mirroredStart,
            endAngle: resolvedEndAngle,
            sweepAngle: GerberScene3dCoordinateMapper.#roundMil(
                resolvedEndAngle - mirroredStart
            )
        }
    }

    /**
     * Maps selected Y fields on an object.
     * @param {object | undefined} value Source object.
     * @param {{ centerY?: number }} board Board metadata.
     * @param {string[]} fields Y field names.
     * @returns {object}
     */
    static #mapYFields(value, board, fields) {
        const mapped = { ...(value || {}) }
        for (const field of fields) {
            if (Object.prototype.hasOwnProperty.call(value || {}, field)) {
                mapped[field] = GerberScene3dCoordinateMapper.y(
                    value[field],
                    board
                )
            }
        }

        return mapped
    }

    /**
     * Resolves the end angle for a mirrored clockwise source sweep.
     * @param {number} startAngle Start angle.
     * @param {number} endAngle End angle.
     * @returns {number}
     */
    static #clockwiseEndAngle(startAngle, endAngle) {
        let resolved = endAngle
        while (resolved >= startAngle) {
            resolved -= 360
        }
        return resolved
    }

    /**
     * Resolves the end angle for a mirrored counter-clockwise source sweep.
     * @param {number} startAngle Start angle.
     * @param {number} endAngle End angle.
     * @returns {number}
     */
    static #counterClockwiseEndAngle(startAngle, endAngle) {
        let resolved = endAngle
        while (resolved <= startAngle) {
            resolved += 360
        }
        return resolved
    }

    /**
     * Normalizes one angle into the positive degree range.
     * @param {number} rotation Rotation in degrees.
     * @returns {number}
     */
    static #normalizeRotation(rotation) {
        const value = Number(rotation) || 0
        return ((value % 360) + 360) % 360
    }

    /**
     * Rounds one mil value for stable scene output.
     * @param {number} value Mil value.
     * @returns {number}
     */
    static #roundMil(value) {
        return Number(value.toFixed(6))
    }
}
