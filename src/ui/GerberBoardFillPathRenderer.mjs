import { GerberSvgArcFlags } from './GerberSvgArcFlags.mjs'
import { GerberScene3dOutlineContourResolver } from '../scene3d/GerberScene3dOutlineContourResolver.mjs'

const POINT_EPSILON = 0.01

/**
 * Renders a filled board surface from Gerber profile primitives.
 */
export class GerberBoardFillPathRenderer {
    /**
     * Renders a board surface from the profile layer when one is available.
     * @param {object[]} layers Source layers selected for rendering.
     * @returns {string}
     */
    static render(layers) {
        const outline = GerberScene3dOutlineContourResolver.resolve(
            Array.isArray(layers) ? layers : []
        )
        const path = GerberBoardFillPathRenderer.#boardFillPath(
            outline.segments,
            outline.cutouts
        )
        if (!path) return ''

        return (
            '<path class="gerber-board-fill pcb-board" d="' +
            path +
            '" fill-rule="evenodd" />'
        )
    }

    /**
     * Builds a fillable path from ordered board-outline contours.
     * @param {object[]} segments Selected outer outline segments.
     * @param {{ x: number, y: number }[][]} cutouts Selected inner cutout contours.
     * @returns {string}
     */
    static #boardFillPath(segments, cutouts) {
        const outerPath = GerberBoardFillPathRenderer.#segmentContourPath(
            segments || []
        )
        if (!outerPath) return ''

        const cutoutPaths = (cutouts || [])
            .map((points) =>
                GerberBoardFillPathRenderer.#pointContourPath(points)
            )
            .filter(Boolean)

        return [outerPath, ...cutoutPaths].join(' ')
    }

    /**
     * Builds one contour path from ordered outline segments.
     * @param {object[]} segments Ordered contour segments.
     * @returns {string}
     */
    static #segmentContourPath(segments) {
        if (!segments.length) return ''

        const commands = []
        let firstPoint = null
        let currentPoint = null
        for (const segment of segments) {
            const start = GerberBoardFillPathRenderer.#segmentStart(segment)
            const end = GerberBoardFillPathRenderer.#segmentEnd(segment)
            if (!start || !end) continue

            if (
                !currentPoint ||
                !GerberBoardFillPathRenderer.#samePoint(currentPoint, start)
            ) {
                if (
                    currentPoint &&
                    firstPoint &&
                    GerberBoardFillPathRenderer.#samePoint(
                        currentPoint,
                        firstPoint
                    )
                ) {
                    commands.push('Z')
                }
                commands.push(
                    'M ' +
                        GerberBoardFillPathRenderer.#round(start.x) +
                        ' ' +
                        GerberBoardFillPathRenderer.#round(start.y)
                )
                firstPoint = start
            }

            commands.push(
                GerberBoardFillPathRenderer.#segmentPathCommand(segment)
            )
            currentPoint = end
        }

        if (
            currentPoint &&
            firstPoint &&
            GerberBoardFillPathRenderer.#samePoint(currentPoint, firstPoint)
        ) {
            commands.push('Z')
        }

        return commands.join(' ')
    }

    /**
     * Builds one closed cutout contour path from points.
     * @param {{ x: number, y: number }[]} points Contour points.
     * @returns {string}
     */
    static #pointContourPath(points) {
        const normalizedPoints = (points || [])
            .map((point) => ({
                x: Number(point?.x),
                y: Number(point?.y)
            }))
            .filter(
                (point) => Number.isFinite(point.x) && Number.isFinite(point.y)
            )
        if (normalizedPoints.length < 3) {
            return ''
        }

        const commands = normalizedPoints.map((point, index) => {
            const command = index === 0 ? 'M' : 'L'
            return (
                command +
                ' ' +
                GerberBoardFillPathRenderer.#round(point.x) +
                ' ' +
                GerberBoardFillPathRenderer.#round(point.y)
            )
        })
        commands.push('Z')
        return commands.join(' ')
    }

    /**
     * Returns one segment start point.
     * @param {object} segment Outline segment.
     * @returns {{ x: number, y: number } | null}
     */
    static #segmentStart(segment) {
        const x = Number(segment?.x1)
        const y = Number(segment?.y1)
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null
        return { x, y }
    }

    /**
     * Returns one segment end point.
     * @param {object} segment Outline segment.
     * @returns {{ x: number, y: number } | null}
     */
    static #segmentEnd(segment) {
        const x = Number(segment?.x2)
        const y = Number(segment?.y2)
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null
        return { x, y }
    }

    /**
     * Renders one outline segment as an SVG path command.
     * @param {object} segment Outline segment.
     * @returns {string}
     */
    static #segmentPathCommand(segment) {
        const end = GerberBoardFillPathRenderer.#segmentEnd(segment)
        if (!end) return ''

        if (segment.type === 'arc') {
            const arcFlags = GerberSvgArcFlags.resolve(segment)
            if (arcFlags.radius > 0) {
                return (
                    'A ' +
                    GerberBoardFillPathRenderer.#round(arcFlags.radius) +
                    ' ' +
                    GerberBoardFillPathRenderer.#round(arcFlags.radius) +
                    ' 0 ' +
                    arcFlags.largeArc +
                    ' ' +
                    arcFlags.sweep +
                    ' ' +
                    GerberBoardFillPathRenderer.#round(end.x) +
                    ' ' +
                    GerberBoardFillPathRenderer.#round(end.y)
                )
            }
        }

        return (
            'L ' +
            GerberBoardFillPathRenderer.#round(end.x) +
            ' ' +
            GerberBoardFillPathRenderer.#round(end.y)
        )
    }

    /**
     * Checks whether two points can be treated as connected.
     * @param {{ x: number, y: number } | null} first First point.
     * @param {{ x: number, y: number } | null} second Second point.
     * @returns {boolean}
     */
    static #samePoint(first, second) {
        if (!first || !second) return false
        return (
            Math.hypot(
                Number(first.x) - Number(second.x),
                Number(first.y) - Number(second.y)
            ) <= POINT_EPSILON
        )
    }

    /**
     * Rounds a numeric value for deterministic compact SVG output.
     * @param {number} value Number.
     * @returns {number}
     */
    static #round(value) {
        return Number(Number(value || 0).toFixed(6))
    }
}
