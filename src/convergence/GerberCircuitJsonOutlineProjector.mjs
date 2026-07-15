import { GerberCircuitJsonArcSampler } from './GerberCircuitJsonArcSampler.mjs'
import { GerberCircuitJsonLayerSemantics } from './GerberCircuitJsonLayerSemantics.mjs'

const ENDPOINT_SCALE = 1_000_000

/** Projects connected Gerber profile geometry into boards and their cutouts. */
export class GerberCircuitJsonOutlineProjector {
    /**
     * Projects closed paths from every board-outline layer.
     * @param {Record<string, any>[]} layers Native fabrication layers.
     * @returns {{ boards: { outline: { x: number, y: number }[], bounds: { minX: number, minY: number, maxX: number, maxY: number } }[], cutouts: Record<string, any>[] }} Board geometry.
     */
    static project(layers) {
        const candidates = []
        const eligibleCutouts = new Set()
        const explicitCutouts = []
        for (const layer of layers) {
            if (!GerberCircuitJsonLayerSemantics.isBoardOutline(layer)) continue
            const projected = GerberCircuitJsonOutlineProjector.#layer(layer)
            candidates.push(...projected.dark)
            for (const points of projected.eligibleDark) {
                eligibleCutouts.add(
                    GerberCircuitJsonOutlineProjector.#contourKey(points)
                )
            }
            explicitCutouts.push(...projected.clear)
        }
        const dark = candidates.filter(
            (points) => GerberCircuitJsonOutlineProjector.#area(points) > 1e-12
        )
        const classified = dark.map((points, index) => ({
            points,
            index,
            area: GerberCircuitJsonOutlineProjector.#area(points),
            depth: GerberCircuitJsonOutlineProjector.#depth(points, dark)
        }))
        const boardRows = classified
            .filter((row) => row.depth % 2 === 0)
            .sort((left, right) => left.index - right.index)
            .map((row, boardIndex) => ({ ...row, boardIndex }))
        const cutoutRows = classified
            .filter(
                (row) =>
                    row.depth % 2 === 1 &&
                    eligibleCutouts.has(
                        GerberCircuitJsonOutlineProjector.#contourKey(
                            row.points
                        )
                    )
            )
            .map((row) => ({
                points: row.points,
                boardIndex:
                    GerberCircuitJsonOutlineProjector.#owner(
                        row.points,
                        boardRows
                    )?.boardIndex ?? 0
            }))
        for (const points of explicitCutouts) {
            const owner = GerberCircuitJsonOutlineProjector.#owner(
                points,
                boardRows
            )
            if (
                GerberCircuitJsonOutlineProjector.#area(points) > 1e-12 &&
                owner
            ) {
                cutoutRows.push({
                    points,
                    boardIndex: owner.boardIndex
                })
            }
        }
        return {
            boards: boardRows.map((row) => ({
                outline: row.points,
                bounds: GerberCircuitJsonOutlineProjector.#bounds(row.points)
            })),
            cutouts: cutoutRows.map((row, index) => ({
                type: 'pcb_cutout',
                pcb_cutout_id: `gerber_board_cutout_${index}`,
                shape: 'polygon',
                points: row.points,
                pcb_board_id: `gerber_board_${row.boardIndex}`,
                layer: 'board'
            }))
        }
    }

    /**
     * Resolves the smallest containing board for one cutout contour.
     * @param {{ x: number, y: number }[]} points Cutout contour.
     * @param {{ points: { x: number, y: number }[], area: number }[]} boards Board contours.
     * @returns {Record<string, any> | null} Owning board.
     */
    static #owner(points, boards) {
        return (
            boards
                .filter((board) =>
                    GerberCircuitJsonOutlineProjector.#contains(
                        board.points,
                        points[0]
                    )
                )
                .sort((left, right) => left.area - right.area)[0] || null
        )
    }

    /**
     * Counts strictly containing dark contours to derive even/odd nesting.
     * @param {{ x: number, y: number }[]} points Candidate contour.
     * @param {{ x: number, y: number }[][]} candidates All dark contours.
     * @returns {number} Containment depth.
     */
    static #depth(points, candidates) {
        const area = GerberCircuitJsonOutlineProjector.#area(points)
        let depth = 0
        for (const candidate of candidates) {
            if (
                candidate === points ||
                GerberCircuitJsonOutlineProjector.#area(candidate) <= area
            ) {
                continue
            }
            if (
                GerberCircuitJsonOutlineProjector.#contains(
                    candidate,
                    points[0]
                )
            ) {
                depth += 1
            }
        }
        return depth
    }

    /**
     * Tests strict point containment with a deterministic ray crossing.
     * @param {{ x: number, y: number }[]} polygon Candidate container.
     * @param {{ x: number, y: number }} point Test point.
     * @returns {boolean} Whether the point is inside and not on the boundary.
     */
    static #contains(polygon, point) {
        let inside = false
        for (
            let current = 0, previous = polygon.length - 1;
            current < polygon.length;
            previous = current, current += 1
        ) {
            const left = polygon[previous]
            const right = polygon[current]
            if (
                GerberCircuitJsonOutlineProjector.#onSegment(left, right, point)
            ) {
                return false
            }
            const crosses =
                left.y > point.y !== right.y > point.y &&
                point.x <
                    ((right.x - left.x) * (point.y - left.y)) /
                        (right.y - left.y) +
                        left.x
            if (crosses) inside = !inside
        }
        return inside
    }

    /**
     * Tests whether a point lies on one finite segment.
     * @param {{ x: number, y: number }} start Segment start.
     * @param {{ x: number, y: number }} end Segment end.
     * @param {{ x: number, y: number }} point Candidate point.
     * @returns {boolean} Boundary membership.
     */
    static #onSegment(start, end, point) {
        const cross =
            (point.y - start.y) * (end.x - start.x) -
            (point.x - start.x) * (end.y - start.y)
        if (Math.abs(cross) > 1e-9) return false
        const dot =
            (point.x - start.x) * (point.x - end.x) +
            (point.y - start.y) * (point.y - end.y)
        return dot <= 1e-12
    }

    /**
     * Builds closed dark, eligible dark, and clear paths for one outline layer.
     * @param {Record<string, any>} layer Native outline layer.
     * @returns {{ dark: { x: number, y: number }[][], eligibleDark: { x: number, y: number }[][], clear: { x: number, y: number }[][] }} Closed paths.
     */
    static #layer(layer) {
        const darkSegments = []
        const clearSegments = []
        const darkRegions = []
        const clearRegions = []
        for (const primitive of layer?.primitives || []) {
            const clear = primitive?.polarity === 'clear'
            if (primitive?.type === 'region') {
                const points = GerberCircuitJsonOutlineProjector.#polygonPoints(
                    primitive.points
                )
                if (points) (clear ? clearRegions : darkRegions).push(points)
                continue
            }
            const points = GerberCircuitJsonOutlineProjector.#segment(primitive)
            if (points) (clear ? clearSegments : darkSegments).push(points)
        }
        const darkChains =
            GerberCircuitJsonOutlineProjector.#closedChains(darkSegments)
        const eligibleDark =
            GerberCircuitJsonOutlineProjector.#isExplicitProfile(layer)
                ? [...darkRegions, ...darkChains]
                : [
                      ...darkRegions,
                      ...GerberCircuitJsonOutlineProjector.#sourceClosedChains(
                          darkSegments
                      )
                  ]
        return {
            dark: [...darkRegions, ...darkChains],
            eligibleDark,
            clear: [
                ...clearRegions,
                ...GerberCircuitJsonOutlineProjector.#closedChains(
                    clearSegments
                )
            ]
        }
    }

    /**
     * Returns whether X2 metadata explicitly declares a Profile layer.
     * @param {Record<string, any>} layer Native outline layer.
     * @returns {boolean} Whether the first FileFunction token is Profile.
     */
    static #isExplicitProfile(layer) {
        const value = layer?.attributes?.file?.FileFunction
        const tokens = Array.isArray(value)
            ? value
            : typeof value === 'string'
              ? value.split(',')
              : []
        return (
            String(tokens[0] || '')
                .trim()
                .toLowerCase() === 'profile'
        )
    }

    /**
     * Converts a line or arc to one normalized directed point sequence.
     * @param {Record<string, any>} primitive Native primitive.
     * @returns {{ x: number, y: number }[] | null} Normalized segment points.
     */
    static #segment(primitive) {
        if (primitive?.type === 'line') {
            return GerberCircuitJsonOutlineProjector.#finitePoints([
                { x: primitive.x1, y: primitive.y1 },
                { x: primitive.x2, y: primitive.y2 }
            ])
        }
        if (primitive?.type === 'arc') {
            return GerberCircuitJsonOutlineProjector.#finitePoints(
                GerberCircuitJsonArcSampler.points(primitive)
            )
        }
        return null
    }

    /**
     * Chains unordered reversible segments and retains only closed polygons.
     * @param {{ x: number, y: number }[][]} segments Directed segments.
     * @returns {{ x: number, y: number }[][]} Closed paths.
     */
    static #closedChains(segments) {
        const endpoints = new Map()
        const unused = new Set()
        for (let index = 0; index < segments.length; index += 1) {
            const points = segments[index]
            if (!points || points.length < 2) continue
            unused.add(index)
            GerberCircuitJsonOutlineProjector.#indexEndpoint(
                endpoints,
                points[0],
                index
            )
            GerberCircuitJsonOutlineProjector.#indexEndpoint(
                endpoints,
                points.at(-1),
                index
            )
        }
        const paths = []
        while (unused.size) {
            const first = unused.values().next().value
            unused.delete(first)
            let path = [...segments[first]]
            path = GerberCircuitJsonOutlineProjector.#grow(
                path,
                segments,
                endpoints,
                unused,
                false
            )
            path = GerberCircuitJsonOutlineProjector.#grow(
                path,
                segments,
                endpoints,
                unused,
                true
            )
            const closed = GerberCircuitJsonOutlineProjector.#closedPoints(path)
            if (closed) paths.push(closed)
        }
        return paths
    }

    /**
     * Chains only source-ordered, forward-directed segments into closed paths.
     * @param {{ x: number, y: number }[][]} segments Directed segments.
     * @returns {{ x: number, y: number }[][]} Source-continuous closed paths.
     */
    static #sourceClosedChains(segments) {
        const paths = []
        let path = []
        for (const segment of segments) {
            const continuous =
                path.length > 0 &&
                GerberCircuitJsonOutlineProjector.#key(segment[0]) ===
                    GerberCircuitJsonOutlineProjector.#key(path.at(-1))
            if (path.length > 0 && !continuous) {
                const closed =
                    GerberCircuitJsonOutlineProjector.#closedPoints(path)
                if (closed) paths.push(closed)
                path = []
            }
            path = path.length ? [...path, ...segment.slice(1)] : [...segment]
            if (GerberCircuitJsonOutlineProjector.#isClosedPath(path)) {
                const closed =
                    GerberCircuitJsonOutlineProjector.#closedPoints(path)
                if (closed) paths.push(closed)
                path = []
            }
        }
        const closed = GerberCircuitJsonOutlineProjector.#closedPoints(path)
        if (closed) paths.push(closed)
        return paths
    }

    /**
     * Extends one path until it closes or no segment matches.
     * @param {{ x: number, y: number }[]} initial Current path.
     * @param {{ x: number, y: number }[][]} segments All segments.
     * @param {Map<string, number[]>} endpoints Endpoint index.
     * @param {Set<number>} unused Unused segment indexes.
     * @param {boolean} prepend Whether to extend the beginning.
     * @returns {{ x: number, y: number }[]} Extended path.
     */
    static #grow(initial, segments, endpoints, unused, prepend) {
        let path = initial
        while (
            unused.size &&
            !GerberCircuitJsonOutlineProjector.#isClosedPath(path)
        ) {
            const target = prepend ? path[0] : path.at(-1)
            const index = (
                endpoints.get(GerberCircuitJsonOutlineProjector.#key(target)) ||
                []
            ).find((candidate) => unused.has(candidate))
            if (index === undefined) break
            unused.delete(index)
            const segment = segments[index]
            const targetKey = GerberCircuitJsonOutlineProjector.#key(target)
            const oriented =
                GerberCircuitJsonOutlineProjector.#key(segment[0]) === targetKey
                    ? segment
                    : [...segment].reverse()
            path = prepend
                ? [...oriented.slice(1).reverse(), ...path]
                : [...path, ...oriented.slice(1)]
        }
        return path
    }

    /**
     * Adds one segment index to its quantized endpoint bucket.
     * @param {Map<string, number[]>} index Endpoint index.
     * @param {{ x: number, y: number }} point Endpoint.
     * @param {number} segment Segment index.
     * @returns {void}
     */
    static #indexEndpoint(index, point, segment) {
        const key = GerberCircuitJsonOutlineProjector.#key(point)
        const rows = index.get(key) || []
        rows.push(segment)
        index.set(key, rows)
    }

    /**
     * Tests whether an assembled path has returned to its quantized start.
     * @param {{ x: number, y: number }[]} points Assembled path points.
     * @returns {boolean} Whether the path has enough points to form a closed polygon.
     */
    static #isClosedPath(points) {
        return (
            points.length >= 4 &&
            GerberCircuitJsonOutlineProjector.#key(points[0]) ===
                GerberCircuitJsonOutlineProjector.#key(points.at(-1))
        )
    }

    /**
     * Normalizes a region or chained path and proves closure.
     * @param {unknown} value Point sequence.
     * @returns {{ x: number, y: number }[] | null} Closed polygon without duplicate endpoint.
     */
    static #closedPoints(value) {
        const points = GerberCircuitJsonOutlineProjector.#finitePoints(value)
        if (!points || points.length < 4) return null
        if (
            GerberCircuitJsonOutlineProjector.#key(points[0]) !==
            GerberCircuitJsonOutlineProjector.#key(points.at(-1))
        ) {
            return null
        }
        const polygon = points.slice(0, -1)
        return polygon.length >= 3 ? polygon : null
    }

    /**
     * Normalizes an explicitly closed Gerber region whose final source point
     * need not repeat its first point.
     * @param {unknown} value Region points.
     * @returns {{ x: number, y: number }[] | null} Polygon points.
     */
    static #polygonPoints(value) {
        const points = GerberCircuitJsonOutlineProjector.#finitePoints(value)
        if (!points || points.length < 3) return null
        if (
            GerberCircuitJsonOutlineProjector.#key(points[0]) ===
            GerberCircuitJsonOutlineProjector.#key(points.at(-1))
        ) {
            points.pop()
        }
        return points.length >= 3 ? points : null
    }

    /**
     * Copies finite points and removes consecutive duplicates.
     * @param {unknown} value Point sequence.
     * @returns {{ x: number, y: number }[] | null} Safe points.
     */
    static #finitePoints(value) {
        if (!Array.isArray(value)) return null
        const points = []
        for (const candidate of value) {
            const point = { x: Number(candidate?.x), y: Number(candidate?.y) }
            if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
                return null
            }
            if (
                points.length &&
                GerberCircuitJsonOutlineProjector.#key(points.at(-1)) ===
                    GerberCircuitJsonOutlineProjector.#key(point)
            ) {
                continue
            }
            points.push(point)
        }
        return points
    }

    /**
     * Builds a rotation- and winding-independent signature for one contour.
     * @param {{ x: number, y: number }[]} points Polygon points.
     * @returns {string} Quantized unordered-edge signature.
     */
    static #contourKey(points) {
        const edges = []
        for (let index = 0; index < points.length; index += 1) {
            const endpointKeys = [
                GerberCircuitJsonOutlineProjector.#key(points[index]),
                GerberCircuitJsonOutlineProjector.#key(
                    points[(index + 1) % points.length]
                )
            ].sort()
            edges.push(endpointKeys.join('>'))
        }
        return edges.sort().join('|')
    }

    /**
     * Computes polygon bounds.
     * @param {{ x: number, y: number }[]} points Polygon points.
     * @returns {{ minX: number, minY: number, maxX: number, maxY: number }} Bounds.
     */
    static #bounds(points) {
        const bounds = {
            minX: Infinity,
            minY: Infinity,
            maxX: -Infinity,
            maxY: -Infinity
        }
        for (const point of points) {
            bounds.minX = Math.min(bounds.minX, point.x)
            bounds.minY = Math.min(bounds.minY, point.y)
            bounds.maxX = Math.max(bounds.maxX, point.x)
            bounds.maxY = Math.max(bounds.maxY, point.y)
        }
        return bounds
    }

    /**
     * Computes absolute signed polygon area.
     * @param {{ x: number, y: number }[]} points Polygon points.
     * @returns {number} Absolute area.
     */
    static #area(points) {
        let area = 0
        for (let index = 0; index < points.length; index += 1) {
            const current = points[index]
            const next = points[(index + 1) % points.length]
            area += current.x * next.y - next.x * current.y
        }
        return Math.abs(area / 2)
    }

    /**
     * Quantizes one endpoint for deterministic tolerant connectivity.
     * @param {{ x: number, y: number }} point Endpoint.
     * @returns {string} Endpoint key.
     */
    static #key(point) {
        const x = Math.round(Number(point?.x) * ENDPOINT_SCALE) || 0
        const y = Math.round(Number(point?.y) * ENDPOINT_SCALE) || 0
        return `${x}:${y}`
    }
}

Object.freeze(GerberCircuitJsonOutlineProjector.prototype)
Object.freeze(GerberCircuitJsonOutlineProjector)
