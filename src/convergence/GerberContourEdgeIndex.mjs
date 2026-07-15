/** Indexes one polygon boundary for efficient segment intersection queries. */
export class GerberContourEdgeIndex {
    #root

    /**
     * Builds an interval tree over the contour's edge bounds.
     * @param {{ x: number, y: number }[]} points Polygon points.
     */
    constructor(points) {
        this.#root = GerberContourEdgeIndex.#build(
            GerberContourEdgeIndex.#edges(points)
        )
    }

    /**
     * Tests whether one segment crosses or touches the indexed boundary.
     * @param {{ x: number, y: number }} start Segment start.
     * @param {{ x: number, y: number }} end Segment end.
     * @returns {boolean} Whether the segment intersects any contour edge.
     */
    intersects(start, end) {
        const bounds = {
            minX: Math.min(start.x, end.x),
            minY: Math.min(start.y, end.y),
            maxX: Math.max(start.x, end.x),
            maxY: Math.max(start.y, end.y)
        }
        return GerberContourEdgeIndex.#query(this.#root, bounds, start, end)
    }

    /**
     * Creates indexed edge records for one polygon.
     * @param {{ x: number, y: number }[]} points Polygon points.
     * @returns {Record<string, any>[]} Edge records.
     */
    static #edges(points) {
        const edges = []
        for (let index = 0; index < points.length; index += 1) {
            const start = points[index]
            const end = points[(index + 1) % points.length]
            edges.push({
                start,
                end,
                minX: Math.min(start.x, end.x),
                minY: Math.min(start.y, end.y),
                maxX: Math.max(start.x, end.x),
                maxY: Math.max(start.y, end.y)
            })
        }
        return edges
    }

    /**
     * Builds a balanced interval tree from edge x-ranges.
     * @param {Record<string, any>[]} edges Edge records.
     * @returns {Record<string, any> | null} Interval-tree node.
     */
    static #build(edges) {
        if (!edges.length) return null
        const midpoints = edges
            .map((edge) => (edge.minX + edge.maxX) / 2)
            .sort((left, right) => left - right)
        const center = midpoints[Math.floor(midpoints.length / 2)]
        const left = []
        const right = []
        const overlapping = []
        for (const edge of edges) {
            if (edge.maxX < center) {
                left.push(edge)
            } else if (edge.minX > center) {
                right.push(edge)
            } else {
                overlapping.push(edge)
            }
        }
        return {
            center,
            byMinX: [...overlapping].sort(
                (first, second) => first.minX - second.minX
            ),
            byMaxX: [...overlapping].sort(
                (first, second) => second.maxX - first.maxX
            ),
            left: GerberContourEdgeIndex.#build(left),
            right: GerberContourEdgeIndex.#build(right)
        }
    }

    /**
     * Searches interval-tree branches that overlap one segment x-range.
     * @param {Record<string, any> | null} node Interval-tree node.
     * @param {{ minX: number, minY: number, maxX: number, maxY: number }} bounds Query bounds.
     * @param {{ x: number, y: number }} start Query segment start.
     * @param {{ x: number, y: number }} end Query segment end.
     * @returns {boolean} Whether an indexed edge intersects the query.
     */
    static #query(node, bounds, start, end) {
        if (!node) return false
        if (bounds.maxX < node.center) {
            for (const edge of node.byMinX) {
                if (edge.minX > bounds.maxX) break
                if (
                    GerberContourEdgeIndex.#candidateIntersects(
                        edge,
                        bounds,
                        start,
                        end
                    )
                ) {
                    return true
                }
            }
            return GerberContourEdgeIndex.#query(node.left, bounds, start, end)
        }
        if (bounds.minX > node.center) {
            for (const edge of node.byMaxX) {
                if (edge.maxX < bounds.minX) break
                if (
                    GerberContourEdgeIndex.#candidateIntersects(
                        edge,
                        bounds,
                        start,
                        end
                    )
                ) {
                    return true
                }
            }
            return GerberContourEdgeIndex.#query(node.right, bounds, start, end)
        }
        for (const edge of node.byMinX) {
            if (
                GerberContourEdgeIndex.#candidateIntersects(
                    edge,
                    bounds,
                    start,
                    end
                )
            ) {
                return true
            }
        }
        return (
            GerberContourEdgeIndex.#query(node.left, bounds, start, end) ||
            GerberContourEdgeIndex.#query(node.right, bounds, start, end)
        )
    }

    /**
     * Applies y-range and exact intersection checks to one indexed edge.
     * @param {Record<string, any>} edge Indexed edge.
     * @param {{ minX: number, minY: number, maxX: number, maxY: number }} bounds Query bounds.
     * @param {{ x: number, y: number }} start Query segment start.
     * @param {{ x: number, y: number }} end Query segment end.
     * @returns {boolean} Whether the candidate intersects the query.
     */
    static #candidateIntersects(edge, bounds, start, end) {
        if (edge.maxY < bounds.minY || edge.minY > bounds.maxY) return false
        return GerberContourEdgeIndex.#segmentsIntersect(
            start,
            end,
            edge.start,
            edge.end
        )
    }

    /**
     * Tests whether two finite line segments cross or touch.
     * @param {{ x: number, y: number }} leftStart First segment start.
     * @param {{ x: number, y: number }} leftEnd First segment end.
     * @param {{ x: number, y: number }} rightStart Second segment start.
     * @param {{ x: number, y: number }} rightEnd Second segment end.
     * @returns {boolean} Whether the segment boundaries intersect.
     */
    static #segmentsIntersect(leftStart, leftEnd, rightStart, rightEnd) {
        const leftToRightStart = GerberContourEdgeIndex.#orientation(
            leftStart,
            leftEnd,
            rightStart
        )
        const leftToRightEnd = GerberContourEdgeIndex.#orientation(
            leftStart,
            leftEnd,
            rightEnd
        )
        const rightToLeftStart = GerberContourEdgeIndex.#orientation(
            rightStart,
            rightEnd,
            leftStart
        )
        const rightToLeftEnd = GerberContourEdgeIndex.#orientation(
            rightStart,
            rightEnd,
            leftEnd
        )
        if (
            leftToRightStart * leftToRightEnd < 0 &&
            rightToLeftStart * rightToLeftEnd < 0
        ) {
            return true
        }
        return (
            (Math.abs(leftToRightStart) <= 1e-9 &&
                GerberContourEdgeIndex.#onSegment(
                    leftStart,
                    leftEnd,
                    rightStart
                )) ||
            (Math.abs(leftToRightEnd) <= 1e-9 &&
                GerberContourEdgeIndex.#onSegment(
                    leftStart,
                    leftEnd,
                    rightEnd
                )) ||
            (Math.abs(rightToLeftStart) <= 1e-9 &&
                GerberContourEdgeIndex.#onSegment(
                    rightStart,
                    rightEnd,
                    leftStart
                )) ||
            (Math.abs(rightToLeftEnd) <= 1e-9 &&
                GerberContourEdgeIndex.#onSegment(
                    rightStart,
                    rightEnd,
                    leftEnd
                ))
        )
    }

    /**
     * Computes the signed orientation of three points.
     * @param {{ x: number, y: number }} start Segment start.
     * @param {{ x: number, y: number }} end Segment end.
     * @param {{ x: number, y: number }} point Candidate point.
     * @returns {number} Signed cross product.
     */
    static #orientation(start, end, point) {
        return (
            (end.x - start.x) * (point.y - start.y) -
            (end.y - start.y) * (point.x - start.x)
        )
    }

    /**
     * Tests whether a point lies on one finite segment.
     * @param {{ x: number, y: number }} start Segment start.
     * @param {{ x: number, y: number }} end Segment end.
     * @param {{ x: number, y: number }} point Candidate point.
     * @returns {boolean} Boundary membership.
     */
    static #onSegment(start, end, point) {
        const cross = GerberContourEdgeIndex.#orientation(start, end, point)
        if (Math.abs(cross) > 1e-9) return false
        const dot =
            (point.x - start.x) * (point.x - end.x) +
            (point.y - start.y) * (point.y - end.y)
        return dot <= 1e-12
    }
}

Object.freeze(GerberContourEdgeIndex.prototype)
Object.freeze(GerberContourEdgeIndex)
