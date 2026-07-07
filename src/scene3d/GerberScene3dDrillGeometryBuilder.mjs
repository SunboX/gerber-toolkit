const DEFAULT_BARREL_WALL_MIL = 2.4
const BARREL_WALL_FRACTION = 0.09
const MIN_SEGMENT_LENGTH_MIL = 0.001

/**
 * Normalizes drill-driven copper geometry for Gerber 3D scenes.
 */
export class GerberScene3dDrillGeometryBuilder {
    /**
     * Applies drill cutouts and plated-hole barrels to scene detail.
     * @param {{ tracks?: object[], pads?: object[], vias?: object[] }} detail
     * Scene detail accumulator.
     * @returns {void}
     */
    static apply(detail) {
        const drillSpecs =
            GerberScene3dDrillGeometryBuilder.#buildDrillSpecs(detail)
        detail.tracks = GerberScene3dDrillGeometryBuilder.#splitTracks(
            detail.tracks,
            drillSpecs
        )
        detail.vias = GerberScene3dDrillGeometryBuilder.#appendPlatedBarrels(
            detail.vias,
            detail.pads
        )
    }

    /**
     * Builds deduped physical drill apertures from pads and vias.
     * @param {{ pads?: object[], vias?: object[] }} detail Scene detail.
     * @returns {{ x: number, y: number, diameter: number, slotLength: number | null, hasCopperAnnulus: boolean }[]}
     */
    static #buildDrillSpecs(detail) {
        const drillSpecsByKey = new Map()

        for (const primitive of [
            ...(detail?.pads || []),
            ...(detail?.vias || [])
        ]) {
            const drillSpec =
                GerberScene3dDrillGeometryBuilder.#primitiveDrillSpec(primitive)
            if (!drillSpec) {
                continue
            }

            const key = GerberScene3dDrillGeometryBuilder.#drillKey(drillSpec)
            const existingSpec = drillSpecsByKey.get(key)
            if (existingSpec) {
                existingSpec.hasCopperAnnulus =
                    existingSpec.hasCopperAnnulus || drillSpec.hasCopperAnnulus
                continue
            }

            drillSpecsByKey.set(key, drillSpec)
        }

        return [...drillSpecsByKey.values()]
    }

    /**
     * Resolves one primitive's physical drill aperture.
     * @param {object} primitive Pad or via primitive.
     * @returns {{ x: number, y: number, diameter: number, slotLength: number | null, hasCopperAnnulus: boolean } | null}
     */
    static #primitiveDrillSpec(primitive) {
        const diameter = Number(primitive?.holeDiameter || 0)
        const x = Number(primitive?.x || 0)
        const y = Number(primitive?.y || 0)

        if (diameter <= 0 || !Number.isFinite(x + y)) {
            return null
        }

        const slotLength =
            Number(primitive?.holeSlotLength || 0) > diameter
                ? Number(primitive.holeSlotLength)
                : null

        const radius = Math.max(diameter, Number(slotLength || 0)) / 2

        return {
            x,
            y,
            diameter,
            slotLength,
            hasCopperAnnulus:
                GerberScene3dDrillGeometryBuilder.#copperAnnulusRadius(
                    primitive
                ) >
                radius + MIN_SEGMENT_LENGTH_MIL
        }
    }

    /**
     * Splits copper tracks where physical drill apertures remove copper.
     * @param {object[] | undefined} tracks Copper tracks.
     * @param {{ x: number, y: number, diameter: number, slotLength: number | null, hasCopperAnnulus: boolean }[]} drillSpecs
     * Drill apertures.
     * @returns {object[]}
     */
    static #splitTracks(tracks, drillSpecs) {
        return (tracks || []).flatMap((track) =>
            GerberScene3dDrillGeometryBuilder.#splitTrack(track, drillSpecs)
        )
    }

    /**
     * Splits one copper track around every intersecting drill aperture.
     * @param {object} track Copper track.
     * @param {{ x: number, y: number, diameter: number, slotLength: number | null, hasCopperAnnulus: boolean }[]} drillSpecs
     * Drill apertures.
     * @returns {object[]}
     */
    static #splitTrack(track, drillSpecs) {
        const intervals = drillSpecs
            .map((drillSpec) =>
                GerberScene3dDrillGeometryBuilder.#trackDrillInterval(
                    track,
                    drillSpec
                )
            )
            .filter(Boolean)
            .sort((a, b) => a.start - b.start)

        if (!intervals.length) {
            return [track]
        }

        const mergedIntervals =
            GerberScene3dDrillGeometryBuilder.#mergeIntervals(intervals)
        const segments = []
        let cursor = 0

        for (const interval of mergedIntervals) {
            GerberScene3dDrillGeometryBuilder.#appendTrackSegment(
                segments,
                track,
                cursor,
                interval.start
            )
            cursor = Math.max(cursor, interval.end)
        }

        GerberScene3dDrillGeometryBuilder.#appendTrackSegment(
            segments,
            track,
            cursor,
            1
        )

        return segments
    }

    /**
     * Resolves the normalized segment interval removed by a drill.
     * @param {object} track Copper track.
     * @param {{ x: number, y: number, diameter: number, slotLength: number | null, hasCopperAnnulus: boolean }} drillSpec
     * Drill aperture.
     * @returns {{ start: number, end: number } | null}
     */
    static #trackDrillInterval(track, drillSpec) {
        const start = {
            x: Number(track?.x1 || 0),
            y: Number(track?.y1 || 0)
        }
        const end = {
            x: Number(track?.x2 || 0),
            y: Number(track?.y2 || 0)
        }
        const dx = end.x - start.x
        const dy = end.y - start.y
        const length = Math.hypot(dx, dy)
        if (length <= MIN_SEGMENT_LENGTH_MIL) {
            return null
        }

        const projection =
            ((Number(drillSpec.x) - start.x) * dx +
                (Number(drillSpec.y) - start.y) * dy) /
            (length * length)
        const projectionPoint = {
            x: start.x + dx * projection,
            y: start.y + dy * projection
        }
        const perpendicularDistance = Math.hypot(
            Number(drillSpec.x) - projectionPoint.x,
            Number(drillSpec.y) - projectionPoint.y
        )
        const cutRadius =
            GerberScene3dDrillGeometryBuilder.#trackDrillCutRadius(
                track,
                drillSpec
            )

        if (perpendicularDistance > cutRadius) {
            return null
        }

        const halfLength =
            Math.sqrt(
                Math.max(
                    cutRadius * cutRadius -
                        perpendicularDistance * perpendicularDistance,
                    0
                )
            ) / length
        const intervalStart = Math.max(0, projection - halfLength)
        const intervalEnd = Math.min(1, projection + halfLength)

        if (intervalEnd - intervalStart <= MIN_SEGMENT_LENGTH_MIL) {
            return null
        }

        return {
            start: intervalStart,
            end: intervalEnd
        }
    }

    /**
     * Resolves the route interval radius for one drill aperture.
     * @param {object} track Copper track.
     * @param {{ diameter: number, slotLength: number | null, hasCopperAnnulus: boolean }} drillSpec
     * Drill aperture.
     * @returns {number}
     */
    static #trackDrillCutRadius(track, drillSpec) {
        const radius =
            GerberScene3dDrillGeometryBuilder.#drillCutRadius(drillSpec)
        if (drillSpec?.hasCopperAnnulus) {
            return radius
        }

        return radius + Math.max(Number(track?.width || 0), 1) / 2
    }

    /**
     * Resolves the conservative cut radius for circular or slotted drills.
     * @param {{ diameter: number, slotLength: number | null }} drillSpec Drill aperture.
     * @returns {number}
     */
    static #drillCutRadius(drillSpec) {
        return (
            Math.max(
                Number(drillSpec?.diameter || 0),
                Number(drillSpec?.slotLength || 0)
            ) / 2
        )
    }

    /**
     * Resolves the largest copper radius around a drilled primitive.
     * @param {object} primitive Pad or via primitive.
     * @returns {number}
     */
    static #copperAnnulusRadius(primitive) {
        return (
            Math.max(
                Number(primitive?.diameter || 0),
                Number(primitive?.sizeTopX || 0),
                Number(primitive?.sizeTopY || 0),
                Number(primitive?.sizeMidX || 0),
                Number(primitive?.sizeMidY || 0),
                Number(primitive?.sizeBottomX || 0),
                Number(primitive?.sizeBottomY || 0)
            ) / 2
        )
    }

    /**
     * Merges overlapping normalized cut intervals.
     * @param {{ start: number, end: number }[]} intervals Sorted intervals.
     * @returns {{ start: number, end: number }[]}
     */
    static #mergeIntervals(intervals) {
        const merged = []

        for (const interval of intervals) {
            const last = merged.at(-1)
            if (last && interval.start <= last.end) {
                last.end = Math.max(last.end, interval.end)
                continue
            }

            merged.push({ ...interval })
        }

        return merged
    }

    /**
     * Appends a retained track segment when it has non-zero length.
     * @param {object[]} segments Output track segments.
     * @param {object} track Source track.
     * @param {number} startT Normalized start.
     * @param {number} endT Normalized end.
     * @returns {void}
     */
    static #appendTrackSegment(segments, track, startT, endT) {
        if (endT - startT <= MIN_SEGMENT_LENGTH_MIL) {
            return
        }

        segments.push(
            GerberScene3dDrillGeometryBuilder.#interpolateTrack(
                track,
                startT,
                endT
            )
        )
    }

    /**
     * Interpolates one retained copper track segment.
     * @param {object} track Source track.
     * @param {number} startT Normalized start.
     * @param {number} endT Normalized end.
     * @returns {object}
     */
    static #interpolateTrack(track, startT, endT) {
        const segment = {
            ...track,
            x1: GerberScene3dDrillGeometryBuilder.#lerp(
                Number(track?.x1 || 0),
                Number(track?.x2 || 0),
                startT
            ),
            y1: GerberScene3dDrillGeometryBuilder.#lerp(
                Number(track?.y1 || 0),
                Number(track?.y2 || 0),
                startT
            ),
            x2: GerberScene3dDrillGeometryBuilder.#lerp(
                Number(track?.x1 || 0),
                Number(track?.x2 || 0),
                endT
            ),
            y2: GerberScene3dDrillGeometryBuilder.#lerp(
                Number(track?.y1 || 0),
                Number(track?.y2 || 0),
                endT
            )
        }

        if (startT > MIN_SEGMENT_LENGTH_MIL) {
            segment.capStartRound = false
            segment.capStartSideWall = false
        }
        if (endT < 1 - MIN_SEGMENT_LENGTH_MIL) {
            segment.capEndRound = false
            segment.capEndSideWall = false
        }

        return segment
    }

    /**
     * Appends explicit copper barrels for plated drilled holes.
     * @param {object[] | undefined} vias Existing via list.
     * @param {object[] | undefined} pads Pad list.
     * @returns {object[]}
     */
    static #appendPlatedBarrels(vias, pads) {
        const output = [...(vias || [])]
        const seen = new Set(
            output.map((via) =>
                GerberScene3dDrillGeometryBuilder.#drillKey({
                    x: via?.x,
                    y: via?.y,
                    diameter: via?.holeDiameter,
                    slotLength: via?.holeSlotLength
                })
            )
        )

        for (const pad of pads || []) {
            if (
                pad?.isPlated !== true ||
                Number(pad?.holeDiameter || 0) <= 0 ||
                Number(pad?.holeSlotLength || 0) >
                    Number(pad?.holeDiameter || 0) + 0.001
            ) {
                continue
            }

            const key = GerberScene3dDrillGeometryBuilder.#drillKey({
                x: pad.x,
                y: pad.y,
                diameter: pad.holeDiameter,
                slotLength: null
            })
            if (seen.has(key)) {
                continue
            }

            seen.add(key)
            output.push(
                GerberScene3dDrillGeometryBuilder.#barrelViaFromPad(pad)
            )
        }

        return output
    }

    /**
     * Builds one barrel-only via spec from a plated pad drill.
     * @param {object} pad Plated pad.
     * @returns {object}
     */
    static #barrelViaFromPad(pad) {
        const holeDiameter = Number(pad?.holeDiameter || 0)
        const wall = Math.max(
            holeDiameter * BARREL_WALL_FRACTION,
            DEFAULT_BARREL_WALL_MIL
        )

        return {
            x: Number(pad?.x || 0),
            y: Number(pad?.y || 0),
            diameter: GerberScene3dDrillGeometryBuilder.#roundMil(
                holeDiameter + wall * 2
            ),
            holeDiameter,
            isPlated: true,
            barrelOnly: true,
            isTentingTop: false,
            isTentingBottom: false
        }
    }

    /**
     * Builds a stable physical-drill lookup key.
     * @param {{ x?: number, y?: number, diameter?: number, slotLength?: number | null }} drillSpec
     * Drill aperture.
     * @returns {string}
     */
    static #drillKey(drillSpec) {
        return [
            Number(drillSpec?.x || 0).toFixed(4),
            Number(drillSpec?.y || 0).toFixed(4),
            Number(drillSpec?.diameter || 0).toFixed(4),
            Number(drillSpec?.slotLength || 0).toFixed(4)
        ].join(':')
    }

    /**
     * Interpolates and rounds one scene-unit value.
     * @param {number} start Start value.
     * @param {number} end End value.
     * @param {number} ratio Interpolation ratio.
     * @returns {number}
     */
    static #lerp(start, end, ratio) {
        return GerberScene3dDrillGeometryBuilder.#roundMil(
            start + (end - start) * ratio
        )
    }

    /**
     * Rounds a scene-unit number.
     * @param {number} value Numeric value.
     * @returns {number}
     */
    static #roundMil(value) {
        return Number(Number(value || 0).toFixed(6))
    }
}
