/**
 * Resolves Gerber clear-polarity region loops into polygon holes.
 */
export class GerberScene3dRegionCutoutResolver {
    /**
     * Creates an ordered region artwork accumulator.
     * @returns {{ segments: { polygons: object[], cutouts: { x: number, y: number }[][] }[], activeSegment: object | null }}
     */
    static createArtwork() {
        return {
            segments: [],
            activeSegment: null
        }
    }

    /**
     * Appends a dark-polarity region to the active ordered segment.
     * @param {{ segments?: object[], activeSegment?: object | null } | null} regionArtwork Ordered artwork accumulator.
     * @param {object} polygon Dark region polygon.
     * @returns {void}
     */
    static appendDarkRegion(regionArtwork, polygon) {
        if (!regionArtwork || !polygon) {
            return
        }

        const segment =
            regionArtwork.activeSegment ||
            GerberScene3dRegionCutoutResolver.#createSegment(regionArtwork)
        segment.polygons.push(polygon)
    }

    /**
     * Appends a clear-polarity region to all earlier ordered segments.
     * @param {{ segments?: object[], activeSegment?: object | null } | null} regionArtwork Ordered artwork accumulator.
     * @param {{ x: number, y: number }[]} cutout Clear region points.
     * @returns {void}
     */
    static appendClearRegion(regionArtwork, cutout) {
        if (!regionArtwork) {
            return
        }

        for (const segment of regionArtwork.segments || []) {
            segment.cutouts.push(cutout)
        }
        regionArtwork.activeSegment = null
    }

    /**
     * Applies clear-polarity regions as holes in containing dark regions.
     * @param {{ polygons?: object[], cutouts?: { x: number, y: number }[][] }} regionArtwork Region artwork accumulator.
     * @returns {object[]}
     */
    static apply(regionArtwork) {
        if (Array.isArray(regionArtwork?.segments)) {
            return regionArtwork.segments.flatMap((segment) =>
                GerberScene3dRegionCutoutResolver.#applySegment(segment)
            )
        }

        return GerberScene3dRegionCutoutResolver.#applySegment(regionArtwork)
    }

    /**
     * Creates and activates an ordered polarity segment.
     * @param {{ segments?: object[], activeSegment?: object | null }} regionArtwork Ordered artwork accumulator.
     * @returns {{ polygons: object[], cutouts: { x: number, y: number }[][] }}
     */
    static #createSegment(regionArtwork) {
        const segment = {
            polygons: [],
            cutouts: []
        }
        if (!Array.isArray(regionArtwork.segments)) {
            regionArtwork.segments = []
        }
        regionArtwork.segments.push(segment)
        regionArtwork.activeSegment = segment
        return segment
    }

    /**
     * Applies one segment's clear regions as holes in containing dark regions.
     * @param {{ polygons?: object[], cutouts?: { x: number, y: number }[][] } | null | undefined} regionArtwork Region artwork segment.
     * @returns {object[]}
     */
    static #applySegment(regionArtwork) {
        const cutouts = (regionArtwork?.cutouts || []).filter(
            (cutout) => cutout.length >= 3
        )
        if (!cutouts.length) {
            return regionArtwork?.polygons || []
        }

        return (regionArtwork?.polygons || []).map((polygon) => {
            const holes = cutouts.filter((cutout) =>
                GerberScene3dRegionCutoutResolver.#containsCutout(
                    polygon.points,
                    cutout
                )
            )
            return holes.length ? { ...polygon, holes } : polygon
        })
    }

    /**
     * Checks whether one polygon contains a candidate cutout loop.
     * @param {{ x: number, y: number }[]} polygon Outer polygon points.
     * @param {{ x: number, y: number }[]} cutout Candidate cutout points.
     * @returns {boolean}
     */
    static #containsCutout(polygon, cutout) {
        const polygonBounds =
            GerberScene3dRegionCutoutResolver.#pointBounds(polygon)
        const cutoutBounds =
            GerberScene3dRegionCutoutResolver.#pointBounds(cutout)
        const point =
            GerberScene3dRegionCutoutResolver.#representativePoint(cutout)

        return (
            GerberScene3dRegionCutoutResolver.#boundsContainBounds(
                polygonBounds,
                cutoutBounds
            ) &&
            GerberScene3dRegionCutoutResolver.#pointInPolygon(point, polygon)
        )
    }

    /**
     * Computes point bounds for one loop.
     * @param {{ x: number, y: number }[]} points Loop points.
     * @returns {{ minX: number, minY: number, maxX: number, maxY: number }}
     */
    static #pointBounds(points) {
        return (points || []).reduce(
            (bounds, point) => ({
                minX: Math.min(bounds.minX, Number(point?.x)),
                minY: Math.min(bounds.minY, Number(point?.y)),
                maxX: Math.max(bounds.maxX, Number(point?.x)),
                maxY: Math.max(bounds.maxY, Number(point?.y))
            }),
            {
                minX: Infinity,
                minY: Infinity,
                maxX: -Infinity,
                maxY: -Infinity
            }
        )
    }

    /**
     * Checks whether an outer bounds fully contains an inner bounds.
     * @param {{ minX: number, minY: number, maxX: number, maxY: number }} outer Outer bounds.
     * @param {{ minX: number, minY: number, maxX: number, maxY: number }} inner Inner bounds.
     * @returns {boolean}
     */
    static #boundsContainBounds(outer, inner) {
        return (
            Number.isFinite(
                outer.minX +
                    outer.minY +
                    outer.maxX +
                    outer.maxY +
                    inner.minX +
                    inner.minY +
                    inner.maxX +
                    inner.maxY
            ) &&
            inner.minX >= outer.minX - 0.001 &&
            inner.maxX <= outer.maxX + 0.001 &&
            inner.minY >= outer.minY - 0.001 &&
            inner.maxY <= outer.maxY + 0.001
        )
    }

    /**
     * Resolves an interior representative point for one loop.
     * @param {{ x: number, y: number }[]} points Loop points.
     * @returns {{ x: number, y: number }}
     */
    static #representativePoint(points) {
        const loop =
            GerberScene3dRegionCutoutResolver.#withoutClosingPoint(points)
        const total = loop.reduce(
            (sum, point) => ({
                x: sum.x + Number(point?.x || 0),
                y: sum.y + Number(point?.y || 0)
            }),
            { x: 0, y: 0 }
        )
        const count = Math.max(loop.length, 1)

        return {
            x: total.x / count,
            y: total.y / count
        }
    }

    /**
     * Removes a duplicate closing point from a loop.
     * @param {{ x: number, y: number }[]} points Loop points.
     * @returns {{ x: number, y: number }[]}
     */
    static #withoutClosingPoint(points) {
        const loop = [...(points || [])]
        const first = loop[0]
        const last = loop[loop.length - 1]

        if (
            first &&
            last &&
            Math.abs(Number(first.x) - Number(last.x)) <= 0.001 &&
            Math.abs(Number(first.y) - Number(last.y)) <= 0.001
        ) {
            loop.pop()
        }

        return loop
    }

    /**
     * Checks whether a point is inside a polygon loop.
     * @param {{ x: number, y: number }} point Candidate point.
     * @param {{ x: number, y: number }[]} polygon Polygon loop.
     * @returns {boolean}
     */
    static #pointInPolygon(point, polygon) {
        const loop =
            GerberScene3dRegionCutoutResolver.#withoutClosingPoint(polygon)
        let inside = false

        for (
            let index = 0, previousIndex = loop.length - 1;
            index < loop.length;
            previousIndex = index, index += 1
        ) {
            const current = loop[index]
            const previous = loop[previousIndex]
            const currentY = Number(current?.y)
            const previousY = Number(previous?.y)
            const intersects =
                currentY > point.y !== previousY > point.y &&
                point.x <
                    ((Number(previous?.x) - Number(current?.x)) *
                        (point.y - currentY)) /
                        (previousY - currentY) +
                        Number(current?.x)

            if (intersects) inside = !inside
        }

        return inside
    }
}
