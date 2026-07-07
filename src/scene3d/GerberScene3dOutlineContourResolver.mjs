import { GerberScene3dArcGeometry } from './GerberScene3dArcGeometry.mjs'
import { GerberScene3dLayerClassifier } from './GerberScene3dLayerClassifier.mjs'

const CONNECT_EPSILON_MM = 0.01
const CORNER_EPSILON_MM = 0.5

/**
 * Resolves the source contour that should define the generated 3D board body.
 */
export class GerberScene3dOutlineContourResolver {
    /**
     * Resolves board outline source segments and optional selected-contour bounds.
     * @param {object[]} layers Fabrication layers.
     * @returns {{ segments: object[], bounds: { minX: number, minY: number, maxX: number, maxY: number } | null }}
     */
    static resolve(layers) {
        const allSegments =
            GerberScene3dOutlineContourResolver.#sourceSegments(layers)
        const contours =
            GerberScene3dOutlineContourResolver.#connectedContours(allSegments)
        const selectedSegments =
            GerberScene3dOutlineContourResolver.#selectOuterClosedContour(
                contours
            )
        const fallbackBounds = allSegments.length
            ? GerberScene3dOutlineContourResolver.#segmentBounds(allSegments)
            : null
        const synthesizedSegments = selectedSegments.length
            ? []
            : GerberScene3dOutlineContourResolver.#synthesizeCornerPerimeter(
                  contours,
                  fallbackBounds
              )
        const boardSegments = selectedSegments.length
            ? selectedSegments
            : synthesizedSegments
        const bounds = boardSegments.length
            ? GerberScene3dOutlineContourResolver.#segmentBounds(boardSegments)
            : fallbackBounds

        return {
            segments: boardSegments,
            bounds,
            cutouts: GerberScene3dOutlineContourResolver.#closedCutoutContours(
                contours,
                selectedSegments,
                bounds
            )
        }
    }

    /**
     * Builds outline segments in source millimeter coordinates.
     * @param {object[]} layers Fabrication layers.
     * @returns {object[]}
     */
    static #sourceSegments(layers) {
        return (layers || [])
            .filter((layer) =>
                GerberScene3dLayerClassifier.isBoardOutline(layer)
            )
            .flatMap((layer) =>
                (layer.primitives || []).flatMap((primitive) =>
                    GerberScene3dOutlineContourResolver.#primitiveToSegments(
                        primitive
                    )
                )
            )
    }

    /**
     * Converts one outline primitive into source coordinate segments.
     * @param {object} primitive Source primitive.
     * @returns {object[]}
     */
    static #primitiveToSegments(primitive) {
        if (primitive?.type === 'line') {
            return GerberScene3dOutlineContourResolver.#lineSegment(primitive)
        }

        if (primitive?.type === 'arc') {
            return GerberScene3dOutlineContourResolver.#arcSegment(primitive)
        }

        if (primitive?.type === 'region') {
            return GerberScene3dOutlineContourResolver.#pointSegments(
                primitive.points || []
            )
        }

        return []
    }

    /**
     * Normalizes one source line segment.
     * @param {object} primitive Source primitive.
     * @returns {object[]}
     */
    static #lineSegment(primitive) {
        const segment = {
            type: 'line',
            x1: Number(primitive.x1),
            y1: Number(primitive.y1),
            x2: Number(primitive.x2),
            y2: Number(primitive.y2),
            width: Number(primitive.width || 0)
        }

        return GerberScene3dOutlineContourResolver.#hasFiniteEndpoints(
            segment
        ) &&
            !GerberScene3dOutlineContourResolver.#pointsNear(
                GerberScene3dOutlineContourResolver.#startPoint(segment),
                GerberScene3dOutlineContourResolver.#endPoint(segment)
            )
            ? [segment]
            : []
    }

    /**
     * Normalizes one source arc segment.
     * @param {object} primitive Source primitive.
     * @returns {object[]}
     */
    static #arcSegment(primitive) {
        const center = GerberScene3dArcGeometry.center(primitive)
        const segment = {
            type: 'arc',
            x1: Number(primitive.x1),
            y1: Number(primitive.y1),
            x2: Number(primitive.x2),
            y2: Number(primitive.y2),
            cx: Number(center.x),
            cy: Number(center.y),
            radius: Number(center.radius),
            width: Number(primitive.width || 0)
        }

        return GerberScene3dOutlineContourResolver.#hasFiniteEndpoints(
            segment
        ) && Number.isFinite(segment.cx + segment.cy + segment.radius)
            ? [segment]
            : []
    }

    /**
     * Converts a closed region point list into source line segments.
     * @param {{ x: number, y: number }[]} points Source points.
     * @returns {object[]}
     */
    static #pointSegments(points) {
        const normalizedPoints = (points || []).filter((point) =>
            Number.isFinite(Number(point?.x) + Number(point?.y))
        )
        if (normalizedPoints.length < 2) {
            return []
        }

        return normalizedPoints.flatMap((point, index) => {
            const next = normalizedPoints[(index + 1) % normalizedPoints.length]
            return GerberScene3dOutlineContourResolver.#lineSegment({
                x1: point.x,
                y1: point.y,
                x2: next.x,
                y2: next.y
            })
        })
    }

    /**
     * Selects the largest credible closed contour from source-ordered contours.
     * @param {object[][]} contours Source contours.
     * @returns {object[]}
     */
    static #selectOuterClosedContour(contours) {
        const largestConnectedArea = Math.max(
            0,
            ...contours.map((contour) =>
                GerberScene3dOutlineContourResolver.#boundingArea(contour)
            )
        )
        const selected =
            contours
                .filter((contour) =>
                    GerberScene3dOutlineContourResolver.#isClosedContour(
                        contour
                    )
                )
                .sort(
                    (left, right) =>
                        GerberScene3dOutlineContourResolver.#contourScore(
                            right
                        ) -
                        GerberScene3dOutlineContourResolver.#contourScore(left)
                )[0] || []

        return GerberScene3dOutlineContourResolver.#boundingArea(selected) >=
            largestConnectedArea * 0.75
            ? selected
            : []
    }

    /**
     * Synthesizes a closed perimeter from four boundary corner fragments.
     * @param {object[][]} contours Source contours.
     * @param {{ minX: number, minY: number, maxX: number, maxY: number } | null} bounds Source bounds.
     * @returns {object[]}
     */
    static #synthesizeCornerPerimeter(contours, bounds) {
        if (!bounds) {
            return []
        }

        const topLeft = GerberScene3dOutlineContourResolver.#findCornerContour(
            contours,
            bounds,
            'left',
            'top'
        )
        const topRight = GerberScene3dOutlineContourResolver.#findCornerContour(
            contours,
            bounds,
            'top',
            'right'
        )
        const bottomRight =
            GerberScene3dOutlineContourResolver.#findCornerContour(
                contours,
                bounds,
                'right',
                'bottom'
            )
        const bottomLeft =
            GerberScene3dOutlineContourResolver.#findCornerContour(
                contours,
                bounds,
                'bottom',
                'left'
            )

        if (!topLeft || !topRight || !bottomRight || !bottomLeft) {
            return []
        }

        return GerberScene3dOutlineContourResolver.#connectContours([
            GerberScene3dOutlineContourResolver.#orientContour(
                topLeft,
                bounds,
                'left',
                'top'
            ),
            GerberScene3dOutlineContourResolver.#orientContour(
                topRight,
                bounds,
                'top',
                'right'
            ),
            GerberScene3dOutlineContourResolver.#orientContour(
                bottomRight,
                bounds,
                'right',
                'bottom'
            ),
            GerberScene3dOutlineContourResolver.#orientContour(
                bottomLeft,
                bounds,
                'bottom',
                'left'
            )
        ])
    }

    /**
     * Finds one non-closed contour touching two adjacent boundary edges.
     * @param {object[][]} contours Source contours.
     * @param {{ minX: number, minY: number, maxX: number, maxY: number }} bounds Source bounds.
     * @param {'left' | 'right' | 'top' | 'bottom'} firstEdge First edge.
     * @param {'left' | 'right' | 'top' | 'bottom'} secondEdge Second edge.
     * @returns {object[] | null}
     */
    static #findCornerContour(contours, bounds, firstEdge, secondEdge) {
        return (
            (contours || [])
                .filter(
                    (contour) =>
                        !GerberScene3dOutlineContourResolver.#isClosedContour(
                            contour
                        )
                )
                .filter((contour) =>
                    GerberScene3dOutlineContourResolver.#contourTouchesEdges(
                        contour,
                        bounds,
                        firstEdge,
                        secondEdge
                    )
                )
                .sort(
                    (left, right) =>
                        GerberScene3dOutlineContourResolver.#boundingArea(
                            right
                        ) -
                        GerberScene3dOutlineContourResolver.#boundingArea(left)
                )[0] || null
        )
    }

    /**
     * Returns true when one contour touches both requested boundary edges.
     * @param {object[]} contour Source contour.
     * @param {{ minX: number, minY: number, maxX: number, maxY: number }} bounds Source bounds.
     * @param {'left' | 'right' | 'top' | 'bottom'} firstEdge First edge.
     * @param {'left' | 'right' | 'top' | 'bottom'} secondEdge Second edge.
     * @returns {boolean}
     */
    static #contourTouchesEdges(contour, bounds, firstEdge, secondEdge) {
        const contourBounds =
            GerberScene3dOutlineContourResolver.#segmentBounds(contour)
        return (
            GerberScene3dOutlineContourResolver.#boundsTouchEdge(
                contourBounds,
                bounds,
                firstEdge
            ) &&
            GerberScene3dOutlineContourResolver.#boundsTouchEdge(
                contourBounds,
                bounds,
                secondEdge
            ) &&
            GerberScene3dOutlineContourResolver.#boundingArea(contour) >
                CONNECT_EPSILON_MM
        )
    }

    /**
     * Returns true when contour bounds touch one board boundary edge.
     * @param {object} contourBounds Contour bounds.
     * @param {object} bounds Board bounds.
     * @param {'left' | 'right' | 'top' | 'bottom'} edge Boundary edge.
     * @returns {boolean}
     */
    static #boundsTouchEdge(contourBounds, bounds, edge) {
        if (edge === 'left') {
            return (
                Math.abs(contourBounds.minX - bounds.minX) <= CORNER_EPSILON_MM
            )
        }
        if (edge === 'right') {
            return (
                Math.abs(contourBounds.maxX - bounds.maxX) <= CORNER_EPSILON_MM
            )
        }
        if (edge === 'top') {
            return (
                Math.abs(contourBounds.minY - bounds.minY) <= CORNER_EPSILON_MM
            )
        }
        return Math.abs(contourBounds.maxY - bounds.maxY) <= CORNER_EPSILON_MM
    }

    /**
     * Orients one contour from a start boundary edge to an end boundary edge.
     * @param {object[]} contour Source contour.
     * @param {object} bounds Board bounds.
     * @param {'left' | 'right' | 'top' | 'bottom'} startEdge Start edge.
     * @param {'left' | 'right' | 'top' | 'bottom'} endEdge End edge.
     * @returns {object[]}
     */
    static #orientContour(contour, bounds, startEdge, endEdge) {
        const start = GerberScene3dOutlineContourResolver.#startPoint(
            contour[0]
        )
        const end = GerberScene3dOutlineContourResolver.#endPoint(
            contour[contour.length - 1]
        )
        const currentDistance =
            GerberScene3dOutlineContourResolver.#edgeDistance(
                start,
                bounds,
                startEdge
            ) +
            GerberScene3dOutlineContourResolver.#edgeDistance(
                end,
                bounds,
                endEdge
            )
        const reverseDistance =
            GerberScene3dOutlineContourResolver.#edgeDistance(
                end,
                bounds,
                startEdge
            ) +
            GerberScene3dOutlineContourResolver.#edgeDistance(
                start,
                bounds,
                endEdge
            )

        return reverseDistance < currentDistance
            ? GerberScene3dOutlineContourResolver.#reverseContour(contour)
            : contour
    }

    /**
     * Connects ordered contours into one closed perimeter.
     * @param {object[][]} contours Ordered contours.
     * @returns {object[]}
     */
    static #connectContours(contours) {
        const output = []
        for (const contour of contours) {
            if (output.length) {
                GerberScene3dOutlineContourResolver.#appendConnector(
                    output,
                    contour[0]
                )
            }
            output.push(...contour)
        }
        GerberScene3dOutlineContourResolver.#appendConnector(output, output[0])
        return output
    }

    /**
     * Appends a connector from the current output end to a target segment start.
     * @param {object[]} output Mutable output segments.
     * @param {object} target Target segment.
     * @returns {void}
     */
    static #appendConnector(output, target) {
        const start = GerberScene3dOutlineContourResolver.#endPoint(
            output[output.length - 1]
        )
        const end = GerberScene3dOutlineContourResolver.#startPoint(target)
        if (GerberScene3dOutlineContourResolver.#pointsNear(start, end)) {
            return
        }

        output.push({
            type: 'line',
            x1: start.x,
            y1: start.y,
            x2: end.x,
            y2: end.y
        })
    }

    /**
     * Reverses one contour's segment order and direction.
     * @param {object[]} contour Source contour.
     * @returns {object[]}
     */
    static #reverseContour(contour) {
        return [...(contour || [])]
            .reverse()
            .map((segment) =>
                GerberScene3dOutlineContourResolver.#reverseSegment(segment)
            )
    }

    /**
     * Reverses one segment's endpoints.
     * @param {object} segment Source segment.
     * @returns {object}
     */
    static #reverseSegment(segment) {
        return {
            ...segment,
            x1: segment.x2,
            y1: segment.y2,
            x2: segment.x1,
            y2: segment.y1
        }
    }

    /**
     * Resolves distance from one point to a boundary edge.
     * @param {{ x: number, y: number }} point Source point.
     * @param {object} bounds Board bounds.
     * @param {'left' | 'right' | 'top' | 'bottom'} edge Boundary edge.
     * @returns {number}
     */
    static #edgeDistance(point, bounds, edge) {
        if (edge === 'left') return Math.abs(point.x - bounds.minX)
        if (edge === 'right') return Math.abs(point.x - bounds.maxX)
        if (edge === 'top') return Math.abs(point.y - bounds.minY)
        return Math.abs(point.y - bounds.maxY)
    }

    /**
     * Resolves smaller closed contours as explicit board cutouts.
     * @param {object[][]} contours Source contours.
     * @param {object[]} selectedOuter Selected outer contour.
     * @param {{ minX: number, minY: number, maxX: number, maxY: number } | null} bounds Board bounds.
     * @returns {{ x: number, y: number }[][]}
     */
    static #closedCutoutContours(contours, selectedOuter, bounds) {
        return (contours || [])
            .filter((contour) => contour !== selectedOuter)
            .filter((contour) =>
                GerberScene3dOutlineContourResolver.#isClosedContour(contour)
            )
            .filter((contour) =>
                GerberScene3dOutlineContourResolver.#isInnerCutoutContour(
                    contour,
                    bounds
                )
            )
            .map((contour) =>
                GerberScene3dOutlineContourResolver.#contourPoints(contour)
            )
    }

    /**
     * Returns true when one closed contour is inside the board extents.
     * @param {object[]} contour Source contour.
     * @param {{ minX: number, minY: number, maxX: number, maxY: number } | null} bounds Board bounds.
     * @returns {boolean}
     */
    static #isInnerCutoutContour(contour, bounds) {
        if (!bounds) {
            return false
        }

        const cutoutBounds =
            GerberScene3dOutlineContourResolver.#segmentBounds(contour)
        const boardArea =
            Math.max(bounds.maxX - bounds.minX, 0) *
            Math.max(bounds.maxY - bounds.minY, 0)
        const cutoutArea =
            GerberScene3dOutlineContourResolver.#boundingArea(contour)

        return (
            cutoutArea > 0.000001 &&
            cutoutArea < boardArea * 0.5 &&
            cutoutBounds.minX >= bounds.minX - CONNECT_EPSILON_MM &&
            cutoutBounds.maxX <= bounds.maxX + CONNECT_EPSILON_MM &&
            cutoutBounds.minY >= bounds.minY - CONNECT_EPSILON_MM &&
            cutoutBounds.maxY <= bounds.maxY + CONNECT_EPSILON_MM
        )
    }

    /**
     * Splits source-ordered outline strokes whenever the drawing pen jumps.
     * @param {object[]} segments Source segments.
     * @returns {object[][]}
     */
    static #connectedContours(segments) {
        const contours = []
        let current = []

        for (const segment of segments || []) {
            const previous = current[current.length - 1]
            if (
                previous &&
                !GerberScene3dOutlineContourResolver.#pointsNear(
                    GerberScene3dOutlineContourResolver.#endPoint(previous),
                    GerberScene3dOutlineContourResolver.#startPoint(segment)
                )
            ) {
                contours.push(current)
                current = []
            }

            current.push(segment)
        }

        if (current.length) {
            contours.push(current)
        }

        return contours
    }

    /**
     * Returns true when one contour returns to its starting point.
     * @param {object[]} contour Source contour.
     * @returns {boolean}
     */
    static #isClosedContour(contour) {
        if (!Array.isArray(contour) || contour.length < 3) {
            return false
        }

        return GerberScene3dOutlineContourResolver.#pointsNear(
            GerberScene3dOutlineContourResolver.#startPoint(contour[0]),
            GerberScene3dOutlineContourResolver.#endPoint(
                contour[contour.length - 1]
            )
        )
    }

    /**
     * Scores one contour by its enclosed area, then its bounding area.
     * @param {object[]} contour Source contour.
     * @returns {number}
     */
    static #contourScore(contour) {
        return (
            Math.abs(GerberScene3dOutlineContourResolver.#signedArea(contour)) *
                1000000 +
            GerberScene3dOutlineContourResolver.#boundingArea(contour)
        )
    }

    /**
     * Computes one contour's bounding-box area.
     * @param {object[]} contour Source contour.
     * @returns {number}
     */
    static #boundingArea(contour) {
        if (!Array.isArray(contour) || !contour.length) {
            return 0
        }

        const bounds =
            GerberScene3dOutlineContourResolver.#segmentBounds(contour)
        return (
            Math.max(bounds.maxX - bounds.minX, 0) *
            Math.max(bounds.maxY - bounds.minY, 0)
        )
    }

    /**
     * Computes approximate signed area from ordered segment endpoints.
     * @param {object[]} contour Source contour.
     * @returns {number}
     */
    static #signedArea(contour) {
        const points =
            GerberScene3dOutlineContourResolver.#contourPoints(contour)

        let area = 0
        for (let index = 0; index < points.length - 1; index += 1) {
            const current = points[index]
            const next = points[index + 1]
            area += current.x * next.y - next.x * current.y
        }

        return area / 2
    }

    /**
     * Builds an ordered closed point loop from one contour.
     * @param {object[]} contour Source contour.
     * @returns {{ x: number, y: number }[]}
     */
    static #contourPoints(contour) {
        const points = (contour || []).map((segment) =>
            GerberScene3dOutlineContourResolver.#startPoint(segment)
        )
        if (contour?.length) {
            points.push(
                GerberScene3dOutlineContourResolver.#endPoint(
                    contour[contour.length - 1]
                )
            )
        }

        return points
    }

    /**
     * Computes source-coordinate bounds for line and arc segments.
     * @param {object[]} segments Source segments.
     * @returns {{ minX: number, minY: number, maxX: number, maxY: number }}
     */
    static #segmentBounds(segments) {
        return (segments || []).reduce((bounds, segment) => {
            const points = [
                GerberScene3dOutlineContourResolver.#startPoint(segment),
                GerberScene3dOutlineContourResolver.#endPoint(segment),
                ...GerberScene3dOutlineContourResolver.#arcBoundsPoints(segment)
            ]
            return points.reduce(
                (currentBounds, point) =>
                    GerberScene3dOutlineContourResolver.#mergePoint(
                        currentBounds,
                        point
                    ),
                bounds
            )
        }, GerberScene3dOutlineContourResolver.#emptyBounds())
    }

    /**
     * Builds cardinal bounds points for an arc segment.
     * @param {object} segment Source segment.
     * @returns {{ x: number, y: number }[]}
     */
    static #arcBoundsPoints(segment) {
        if (segment?.type !== 'arc') {
            return []
        }

        const radius = Number(segment.radius || 0)
        if (
            !Number.isFinite(Number(segment.cx) + Number(segment.cy) + radius)
        ) {
            return []
        }

        return [
            { x: segment.cx - radius, y: segment.cy - radius },
            { x: segment.cx + radius, y: segment.cy + radius }
        ]
    }

    /**
     * Returns one segment start point.
     * @param {object} segment Source segment.
     * @returns {{ x: number, y: number }}
     */
    static #startPoint(segment) {
        return { x: Number(segment?.x1 || 0), y: Number(segment?.y1 || 0) }
    }

    /**
     * Returns one segment end point.
     * @param {object} segment Source segment.
     * @returns {{ x: number, y: number }}
     */
    static #endPoint(segment) {
        return { x: Number(segment?.x2 || 0), y: Number(segment?.y2 || 0) }
    }

    /**
     * Returns true when two points are connected within tolerance.
     * @param {{ x: number, y: number }} left First point.
     * @param {{ x: number, y: number }} right Second point.
     * @returns {boolean}
     */
    static #pointsNear(left, right) {
        return (
            Math.hypot(left.x - right.x, left.y - right.y) <= CONNECT_EPSILON_MM
        )
    }

    /**
     * Returns true when one segment has finite endpoints.
     * @param {object} segment Source segment.
     * @returns {boolean}
     */
    static #hasFiniteEndpoints(segment) {
        return Number.isFinite(
            segment.x1 + segment.y1 + segment.x2 + segment.y2
        )
    }

    /**
     * Builds initial empty bounds.
     * @returns {{ minX: number, minY: number, maxX: number, maxY: number }}
     */
    static #emptyBounds() {
        return {
            minX: Infinity,
            minY: Infinity,
            maxX: -Infinity,
            maxY: -Infinity
        }
    }

    /**
     * Merges one point into existing bounds.
     * @param {object} bounds Existing bounds.
     * @param {{ x: number, y: number }} point Source point.
     * @returns {object}
     */
    static #mergePoint(bounds, point) {
        return {
            minX: Math.min(bounds.minX, point.x),
            minY: Math.min(bounds.minY, point.y),
            maxX: Math.max(bounds.maxX, point.x),
            maxY: Math.max(bounds.maxY, point.y)
        }
    }
}
