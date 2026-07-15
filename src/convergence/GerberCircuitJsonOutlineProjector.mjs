import { GerberCircuitJsonArcSampler } from './GerberCircuitJsonArcSampler.mjs'
import { GerberCircuitJsonLayerSemantics } from './GerberCircuitJsonLayerSemantics.mjs'
import { GerberContourEdgeIndex } from './GerberContourEdgeIndex.mjs'

const ENDPOINT_SCALE = 1_000_000
const CONTOUR_EDGE_INDEXES = new WeakMap()

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
        const tree = GerberCircuitJsonOutlineProjector.#containmentTree(
            candidates,
            eligibleCutouts
        )
        const classified = GerberCircuitJsonOutlineProjector.#classifyTree(tree)
        const boardRows = classified.boards
            .sort((left, right) => left.index - right.index)
            .map((row, boardIndex) => ({ ...row, boardIndex }))
        const boardIndexes = new Map(
            boardRows.map((row) => [row.key, row.boardIndex])
        )
        const cutoutRows = classified.cutouts
            .sort((left, right) => left.node.index - right.node.index)
            .map((row) => ({
                points: row.node.points,
                boardIndex: boardIndexes.get(row.owner.key) ?? 0
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
        const deduplicatedCutouts =
            GerberCircuitJsonOutlineProjector.#deduplicateCutouts(cutoutRows)
        return {
            boards: boardRows.map((row) => ({
                outline: row.points,
                bounds: GerberCircuitJsonOutlineProjector.#bounds(row.points)
            })),
            cutouts: deduplicatedCutouts.map((row, index) => ({
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
     * Builds a deduplicated strict-containment tree for dark contours.
     * @param {{ x: number, y: number }[][]} candidates Candidate contours.
     * @param {Set<string>} eligibleCutouts Eligible contour signatures.
     * @returns {{ nodes: Record<string, any>[], roots: Record<string, any>[] }} Containment tree.
     */
    static #containmentTree(candidates, eligibleCutouts) {
        const byKey = new Map()
        for (let index = 0; index < candidates.length; index += 1) {
            const points = candidates[index]
            const area = GerberCircuitJsonOutlineProjector.#area(points)
            if (area <= 1e-12) continue
            const key = GerberCircuitJsonOutlineProjector.#contourKey(points)
            if (byKey.has(key)) continue
            byKey.set(key, {
                points,
                key,
                index,
                area,
                bounds: GerberCircuitJsonOutlineProjector.#bounds(points),
                eligible: eligibleCutouts.has(key),
                parent: null,
                children: []
            })
        }
        const nodes = [...byKey.values()]
        for (const node of nodes) {
            node.parent = GerberCircuitJsonOutlineProjector.#parentNode(
                node,
                nodes
            )
            if (node.parent) node.parent.children.push(node)
        }
        for (const node of nodes) {
            node.children.sort((left, right) => left.index - right.index)
        }
        return {
            nodes,
            roots: nodes
                .filter((node) => !node.parent)
                .sort((left, right) => left.index - right.index)
        }
    }

    /**
     * Resolves the smallest strict container for one contour node.
     * @param {Record<string, any>} node Candidate child.
     * @param {Record<string, any>[]} nodes All contour nodes.
     * @returns {Record<string, any> | null} Parent node.
     */
    static #parentNode(node, nodes) {
        let parent = null
        for (const candidate of nodes) {
            if (
                candidate === node ||
                candidate.area <= node.area ||
                !GerberCircuitJsonOutlineProjector.#boundsContain(
                    candidate.bounds,
                    node.bounds
                ) ||
                !GerberCircuitJsonOutlineProjector.#containsContour(
                    candidate.points,
                    node.points
                )
            ) {
                continue
            }
            if (!parent || candidate.area < parent.area) parent = candidate
        }
        return parent
    }

    /**
     * Classifies contour-tree material without letting ineligible artwork
     * change solid/void parity.
     * @param {{ roots: Record<string, any>[] }} tree Containment tree.
     * @returns {{ boards: Record<string, any>[], cutouts: { node: Record<string, any>, owner: Record<string, any> }[] }} Material rows.
     */
    static #classifyTree(tree) {
        const boards = []
        const cutouts = []
        for (const root of tree.roots) {
            boards.push(root)
            GerberCircuitJsonOutlineProjector.#classifyChildren(
                root,
                true,
                root,
                boards,
                cutouts
            )
        }
        return { boards, cutouts }
    }

    /**
     * Traverses descendants while eligible contours toggle material and
     * ineligible contours remain transparent.
     * @param {Record<string, any>} parent Parent contour.
     * @param {boolean} solid Current material state.
     * @param {Record<string, any>} owner Current solid board owner.
     * @param {Record<string, any>[]} boards Board rows.
     * @param {{ node: Record<string, any>, owner: Record<string, any> }[]} cutouts Cutout rows.
     * @returns {void}
     */
    static #classifyChildren(parent, solid, owner, boards, cutouts) {
        for (const child of parent.children) {
            let childSolid = solid
            let childOwner = owner
            if (child.eligible) {
                childSolid = !solid
                if (childSolid) {
                    boards.push(child)
                    childOwner = child
                } else {
                    cutouts.push({ node: child, owner })
                }
            }
            GerberCircuitJsonOutlineProjector.#classifyChildren(
                child,
                childSolid,
                childOwner,
                boards,
                cutouts
            )
        }
    }

    /**
     * Tests whether one contour bounds box encloses another.
     * @param {{ minX: number, minY: number, maxX: number, maxY: number }} outer Outer bounds.
     * @param {{ minX: number, minY: number, maxX: number, maxY: number }} inner Inner bounds.
     * @returns {boolean} Whether the inner bounds fit inside the outer bounds.
     */
    static #boundsContain(outer, inner) {
        return (
            inner.minX >= outer.minX &&
            inner.maxX <= outer.maxX &&
            inner.minY >= outer.minY &&
            inner.maxY <= outer.maxY
        )
    }

    /**
     * Removes duplicate cutouts owned by the same board.
     * @param {{ points: { x: number, y: number }[], boardIndex: number }[]} rows Candidate cutouts.
     * @returns {{ points: { x: number, y: number }[], boardIndex: number }[]} Unique cutouts.
     */
    static #deduplicateCutouts(rows) {
        const keys = new Set()
        return rows.filter((row) => {
            const key = `${row.boardIndex}:${GerberCircuitJsonOutlineProjector.#contourKey(row.points)}`
            if (keys.has(key)) return false
            keys.add(key)
            return true
        })
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
                    GerberCircuitJsonOutlineProjector.#containsContour(
                        board.points,
                        points
                    )
                )
                .sort((left, right) => left.area - right.area)[0] || null
        )
    }

    /**
     * Tests whether every part of one contour lies strictly inside another.
     * A strict interior anchor establishes the starting region. Indexed edge
     * checks reject paths that leave or touch a concave container.
     * @param {{ x: number, y: number }[]} outer Candidate container.
     * @param {{ x: number, y: number }[]} inner Candidate child contour.
     * @returns {boolean} Whether the complete inner contour is contained.
     */
    static #containsContour(outer, inner) {
        if (!GerberCircuitJsonOutlineProjector.#contains(outer, inner[0])) {
            return false
        }
        let index = CONTOUR_EDGE_INDEXES.get(outer)
        if (!index) {
            index = new GerberContourEdgeIndex(outer)
            CONTOUR_EDGE_INDEXES.set(outer, index)
        }
        for (let innerIndex = 0; innerIndex < inner.length; innerIndex += 1) {
            if (
                index.intersects(
                    inner[innerIndex],
                    inner[(innerIndex + 1) % inner.length]
                )
            ) {
                return false
            }
        }
        return true
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
            const segment =
                GerberCircuitJsonOutlineProjector.#segment(primitive)
            if (segment) (clear ? clearSegments : darkSegments).push(segment)
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
     * @returns {{ points: { x: number, y: number }[], sourcePathId: string | null } | null} Normalized segment.
     */
    static #segment(primitive) {
        let points = null
        if (primitive?.type === 'line') {
            points = GerberCircuitJsonOutlineProjector.#finitePoints([
                { x: primitive.x1, y: primitive.y1 },
                { x: primitive.x2, y: primitive.y2 }
            ])
        } else if (primitive?.type === 'arc') {
            points = GerberCircuitJsonOutlineProjector.#finitePoints(
                GerberCircuitJsonArcSampler.points(primitive)
            )
        }
        if (!points || points.length < 2) return null
        const sourcePathId = String(primitive?.sourcePathId || '').trim()
        return { points, sourcePathId: sourcePathId || null }
    }

    /**
     * Chains unordered reversible segments and retains only closed polygons.
     * @param {{ points: { x: number, y: number }[] }[]} segments Directed segments.
     * @returns {{ x: number, y: number }[][]} Closed paths.
     */
    static #closedChains(segments) {
        const endpoints = new Map()
        const unused = new Set()
        for (let index = 0; index < segments.length; index += 1) {
            const points = segments[index].points
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
            const points = segments[first].points
            const chain = {
                head: [],
                tail: [{ index: first, reversed: false }],
                startKey: GerberCircuitJsonOutlineProjector.#key(points[0]),
                endKey: GerberCircuitJsonOutlineProjector.#key(points.at(-1)),
                pointCount: points.length
            }
            GerberCircuitJsonOutlineProjector.#growChain(
                chain,
                segments,
                endpoints,
                unused,
                false
            )
            GerberCircuitJsonOutlineProjector.#growChain(
                chain,
                segments,
                endpoints,
                unused,
                true
            )
            const path = GerberCircuitJsonOutlineProjector.#chainPoints(
                chain,
                segments
            )
            const closed = GerberCircuitJsonOutlineProjector.#closedPoints(path)
            if (closed) paths.push(closed)
        }
        return paths
    }

    /**
     * Chains only same-run, forward-directed segments into closed paths.
     * Legacy segments without source provenance retain ordered endpoint
     * continuity as their fallback.
     * @param {{ points: { x: number, y: number }[], sourcePathId: string | null }[]} segments Directed segments.
     * @returns {{ x: number, y: number }[][]} Source-continuous closed paths.
     */
    static #sourceClosedChains(segments) {
        const paths = []
        const sourcePaths = new Map()
        let legacyPath = []
        for (const segment of segments) {
            if (!segment.sourcePathId) {
                legacyPath =
                    GerberCircuitJsonOutlineProjector.#appendSourceSegment(
                        paths,
                        legacyPath,
                        segment.points
                    )
                continue
            }
            const path = sourcePaths.get(segment.sourcePathId) || []
            const next = GerberCircuitJsonOutlineProjector.#appendSourceSegment(
                paths,
                path,
                segment.points
            )
            if (next.length) {
                sourcePaths.set(segment.sourcePathId, next)
            } else {
                sourcePaths.delete(segment.sourcePathId)
            }
        }
        const closed =
            GerberCircuitJsonOutlineProjector.#closedPoints(legacyPath)
        if (closed) paths.push(closed)
        for (const path of sourcePaths.values()) {
            const sourceClosed =
                GerberCircuitJsonOutlineProjector.#closedPoints(path)
            if (sourceClosed) paths.push(sourceClosed)
        }
        return paths
    }

    /**
     * Appends one directed segment to a source path without copying the
     * accumulated path on every draw.
     * @param {{ x: number, y: number }[][]} paths Completed paths.
     * @param {{ x: number, y: number }[]} path Active path.
     * @param {{ x: number, y: number }[]} segment Directed segment points.
     * @returns {{ x: number, y: number }[]} Next active path.
     */
    static #appendSourceSegment(paths, path, segment) {
        if (
            path.length &&
            GerberCircuitJsonOutlineProjector.#key(path.at(-1)) !==
                GerberCircuitJsonOutlineProjector.#key(segment[0])
        ) {
            const closed = GerberCircuitJsonOutlineProjector.#closedPoints(path)
            if (closed) paths.push(closed)
            path = []
        }
        if (!path.length) {
            for (const point of segment) path.push(point)
        } else {
            for (let index = 1; index < segment.length; index += 1) {
                path.push(segment[index])
            }
        }
        if (!GerberCircuitJsonOutlineProjector.#isClosedPath(path)) return path
        const closed = GerberCircuitJsonOutlineProjector.#closedPoints(path)
        if (closed) paths.push(closed)
        return []
    }

    /**
     * Extends one unordered chain until it closes or no segment matches.
     * @param {Record<string, any>} chain Mutable chain descriptor.
     * @param {{ points: { x: number, y: number }[] }[]} segments All segments.
     * @param {Map<string, number[]>} endpoints Endpoint index.
     * @param {Set<number>} unused Unused segment indexes.
     * @param {boolean} prepend Whether to extend the beginning.
     * @returns {void}
     */
    static #growChain(chain, segments, endpoints, unused, prepend) {
        while (
            unused.size &&
            !GerberCircuitJsonOutlineProjector.#isClosedChain(chain)
        ) {
            const targetKey = prepend ? chain.startKey : chain.endKey
            const index = (endpoints.get(targetKey) || []).find((candidate) =>
                unused.has(candidate)
            )
            if (index === undefined) break
            unused.delete(index)
            const points = segments[index].points
            const startsAtTarget =
                GerberCircuitJsonOutlineProjector.#key(points[0]) === targetKey
            const reversed = prepend ? startsAtTarget : !startsAtTarget
            const row = { index, reversed }
            if (prepend) {
                chain.head.push(row)
                chain.startKey = GerberCircuitJsonOutlineProjector.#key(
                    reversed ? points.at(-1) : points[0]
                )
            } else {
                chain.tail.push(row)
                chain.endKey = GerberCircuitJsonOutlineProjector.#key(
                    reversed ? points[0] : points.at(-1)
                )
            }
            chain.pointCount += points.length - 1
        }
    }

    /**
     * Flattens one completed segment chain with a single output allocation.
     * @param {Record<string, any>} chain Chain descriptor.
     * @param {{ points: { x: number, y: number }[] }[]} segments Source segments.
     * @returns {{ x: number, y: number }[]} Chained points.
     */
    static #chainPoints(chain, segments) {
        const rows = []
        for (let index = chain.head.length - 1; index >= 0; index -= 1) {
            rows.push(chain.head[index])
        }
        for (const row of chain.tail) rows.push(row)
        const points = []
        for (const row of rows) {
            const segment = segments[row.index].points
            if (row.reversed) {
                for (
                    let index = segment.length - 1 - (points.length ? 1 : 0);
                    index >= 0;
                    index -= 1
                ) {
                    points.push(segment[index])
                }
            } else {
                for (
                    let index = points.length ? 1 : 0;
                    index < segment.length;
                    index += 1
                ) {
                    points.push(segment[index])
                }
            }
        }
        return points
    }

    /**
     * Tests whether a segment chain has returned to its starting endpoint.
     * @param {Record<string, any>} chain Chain descriptor.
     * @returns {boolean} Whether the chain can form a polygon.
     */
    static #isClosedChain(chain) {
        return chain.pointCount >= 4 && chain.startKey === chain.endKey
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
