const PAD_SHAPE_CIRCLE = 1
const PAD_HOLE_SHAPE_SLOT = 2
const CIRCLE_SEGMENTS = 24
const SLOT_CAP_SEGMENTS = 12
const CUTOUT_CLEARANCE_MIL = 2
const EPSILON = 0.001
const SILKSCREEN_STROKE_COLOR = 0xf8f6ef
const SILKSCREEN_FILL_COLOR = 0xf8f6ef

/**
 * Builds Gerber 3D silkscreen cutout contours from rendered copper features.
 */
export class GerberScene3dSilkscreenCutoutBuilder {
    /**
     * Creates an empty side-specific silkscreen detail object.
     * @returns {object}
     */
    static emptySide() {
        return {
            tracks: [],
            arcs: [],
            fills: [],
            texts: [],
            drillCutouts: [],
            strokeColor: SILKSCREEN_STROKE_COLOR,
            fillColor: SILKSCREEN_FILL_COLOR
        }
    }

    /**
     * Applies pad, via, and drill cutouts to both silkscreen sides.
     * @param {{ pads?: object[], vias?: object[], silkscreen?: { top?: object, bottom?: object } }} detail Scene detail.
     * @returns {void}
     */
    static apply(detail) {
        if (!detail?.silkscreen) {
            return
        }

        detail.silkscreen.top.drillCutouts =
            GerberScene3dSilkscreenCutoutBuilder.#buildSideCutouts(
                detail,
                'top'
            )
        detail.silkscreen.bottom.drillCutouts =
            GerberScene3dSilkscreenCutoutBuilder.#buildSideCutouts(
                detail,
                'bottom'
            )
    }

    /**
     * Builds all cutout point lists for one board side.
     * @param {{ pads?: object[], vias?: object[] }} detail Scene detail.
     * @param {'top' | 'bottom'} side Board side.
     * @returns {{ x: number, y: number }[][]}
     */
    static #buildSideCutouts(detail, side) {
        return GerberScene3dSilkscreenCutoutBuilder.#dedupeCutouts([
            ...(detail.pads || []).flatMap((pad) =>
                GerberScene3dSilkscreenCutoutBuilder.#padCutouts(pad, side)
            ),
            ...(detail.vias || []).flatMap((via) =>
                GerberScene3dSilkscreenCutoutBuilder.#viaCutouts(via)
            )
        ]).map((cutout) => cutout.points)
    }

    /**
     * Builds the cutout contours for one pad on one side.
     * @param {object} pad Scene pad.
     * @param {'top' | 'bottom'} side Board side.
     * @returns {object[]}
     */
    static #padCutouts(pad, side) {
        const surfaceCutout =
            GerberScene3dSilkscreenCutoutBuilder.#buildPadSurfaceCutout(
                pad,
                side
            )
        if (surfaceCutout) {
            return [surfaceCutout]
        }

        const drillCutout =
            GerberScene3dSilkscreenCutoutBuilder.#buildPadDrillCutout(pad)
        return drillCutout ? [drillCutout] : []
    }

    /**
     * Builds a pad-surface cutout for the selected side.
     * @param {object} pad Scene pad.
     * @param {'top' | 'bottom'} side Board side.
     * @returns {object | null}
     */
    static #buildPadSurfaceCutout(pad, side) {
        const x = Number(pad?.x)
        const y = Number(pad?.y)
        const width = GerberScene3dSilkscreenCutoutBuilder.#sideSize(
            pad,
            side,
            'X'
        )
        const height = GerberScene3dSilkscreenCutoutBuilder.#sideSize(
            pad,
            side,
            'Y'
        )

        if (
            !Number.isFinite(x) ||
            !Number.isFinite(y) ||
            width <= EPSILON ||
            height <= EPSILON
        ) {
            return null
        }

        const rotation = Number(pad?.rotation || 0)
        const shape = Number(side === 'bottom' ? pad.shapeBottom : pad.shapeTop)
        if (shape === PAD_SHAPE_CIRCLE || Math.abs(width - height) <= EPSILON) {
            return GerberScene3dSilkscreenCutoutBuilder.#circleCutout(
                x,
                y,
                Math.max(width, height) + CUTOUT_CLEARANCE_MIL * 2
            )
        }

        if (pad?.hasRoundedRect) {
            return GerberScene3dSilkscreenCutoutBuilder.#slotCutout(
                x,
                y,
                Math.min(width, height) + CUTOUT_CLEARANCE_MIL * 2,
                Math.max(width, height) + CUTOUT_CLEARANCE_MIL * 2,
                width >= height ? rotation : rotation + 90
            )
        }

        return GerberScene3dSilkscreenCutoutBuilder.#rectangleCutout(
            x,
            y,
            width + CUTOUT_CLEARANCE_MIL * 2,
            height + CUTOUT_CLEARANCE_MIL * 2,
            rotation
        )
    }

    /**
     * Builds a drill-only cutout for one pad.
     * @param {object} pad Scene pad.
     * @returns {object | null}
     */
    static #buildPadDrillCutout(pad) {
        const x = Number(pad?.x)
        const y = Number(pad?.y)
        const diameter = Number(pad?.holeDiameter || 0)
        const slotLength = Number(pad?.holeSlotLength || 0)
        const rotation =
            Number(pad?.rotation || 0) + Number(pad?.holeRotation || 0)

        if (Number(pad?.holeShape) === PAD_HOLE_SHAPE_SLOT) {
            return GerberScene3dSilkscreenCutoutBuilder.#slotCutout(
                x,
                y,
                diameter + CUTOUT_CLEARANCE_MIL * 2,
                slotLength + CUTOUT_CLEARANCE_MIL * 2,
                rotation
            )
        }

        return GerberScene3dSilkscreenCutoutBuilder.#circleCutout(
            x,
            y,
            diameter + CUTOUT_CLEARANCE_MIL * 2
        )
    }

    /**
     * Builds cutouts for one via.
     * @param {object} via Scene via.
     * @returns {object[]}
     */
    static #viaCutouts(via) {
        const x = Number(via?.x)
        const y = Number(via?.y)
        const diameter = Math.max(
            Number(via?.diameter || 0),
            Number(via?.holeDiameter || 0)
        )
        const cutout = GerberScene3dSilkscreenCutoutBuilder.#circleCutout(
            x,
            y,
            diameter + CUTOUT_CLEARANCE_MIL * 2
        )

        return cutout ? [cutout] : []
    }

    /**
     * Resolves one side-specific pad size.
     * @param {object} pad Scene pad.
     * @param {'top' | 'bottom'} side Board side.
     * @param {'X' | 'Y'} axis Size axis.
     * @returns {number}
     */
    static #sideSize(pad, side, axis) {
        return Number(
            side === 'bottom'
                ? pad?.['sizeBottom' + axis]
                : pad?.['sizeTop' + axis]
        )
    }

    /**
     * Builds a circular cutout.
     * @param {number} x Center X.
     * @param {number} y Center Y.
     * @param {number} diameter Diameter.
     * @returns {object | null}
     */
    static #circleCutout(x, y, diameter) {
        if (
            !Number.isFinite(x) ||
            !Number.isFinite(y) ||
            !Number.isFinite(diameter) ||
            diameter <= EPSILON
        ) {
            return null
        }

        const radius = diameter / 2
        return GerberScene3dSilkscreenCutoutBuilder.#fromPoints(
            Array.from({ length: CIRCLE_SEGMENTS }, (_, index) => {
                const angle = (Math.PI * 2 * index) / CIRCLE_SEGMENTS
                return {
                    x: x + Math.cos(angle) * radius,
                    y: y + Math.sin(angle) * radius
                }
            })
        )
    }

    /**
     * Builds a rectangular cutout.
     * @param {number} x Center X.
     * @param {number} y Center Y.
     * @param {number} width Width.
     * @param {number} height Height.
     * @param {number} rotationDeg Rotation in degrees.
     * @returns {object | null}
     */
    static #rectangleCutout(x, y, width, height, rotationDeg) {
        if (
            !Number.isFinite(x) ||
            !Number.isFinite(y) ||
            width <= EPSILON ||
            height <= EPSILON
        ) {
            return null
        }

        const halfWidth = width / 2
        const halfHeight = height / 2
        const rotation =
            GerberScene3dSilkscreenCutoutBuilder.#radians(rotationDeg)

        return GerberScene3dSilkscreenCutoutBuilder.#fromPoints(
            [
                { x: -halfWidth, y: -halfHeight },
                { x: halfWidth, y: -halfHeight },
                { x: halfWidth, y: halfHeight },
                { x: -halfWidth, y: halfHeight }
            ].map((point) =>
                GerberScene3dSilkscreenCutoutBuilder.#rotatePoint(
                    x,
                    y,
                    point.x,
                    point.y,
                    rotation
                )
            )
        )
    }

    /**
     * Builds an obround slot cutout.
     * @param {number} x Center X.
     * @param {number} y Center Y.
     * @param {number} diameter Slot cap diameter.
     * @param {number} slotLength Overall slot length.
     * @param {number} rotationDeg Rotation in degrees.
     * @returns {object | null}
     */
    static #slotCutout(x, y, diameter, slotLength, rotationDeg) {
        if (
            !Number.isFinite(x) ||
            !Number.isFinite(y) ||
            !Number.isFinite(diameter) ||
            diameter <= EPSILON
        ) {
            return null
        }

        if (!Number.isFinite(slotLength) || slotLength <= diameter + EPSILON) {
            return GerberScene3dSilkscreenCutoutBuilder.#circleCutout(
                x,
                y,
                diameter
            )
        }

        const radius = diameter / 2
        const halfStraight = Math.max((slotLength - diameter) / 2, 0)
        const rotation =
            GerberScene3dSilkscreenCutoutBuilder.#radians(rotationDeg)
        const points = []

        for (let index = 0; index <= SLOT_CAP_SEGMENTS; index += 1) {
            const angle = -Math.PI / 2 + (Math.PI * index) / SLOT_CAP_SEGMENTS
            points.push(
                GerberScene3dSilkscreenCutoutBuilder.#rotatePoint(
                    x,
                    y,
                    halfStraight + Math.cos(angle) * radius,
                    Math.sin(angle) * radius,
                    rotation
                )
            )
        }

        for (let index = 0; index <= SLOT_CAP_SEGMENTS; index += 1) {
            const angle = Math.PI / 2 + (Math.PI * index) / SLOT_CAP_SEGMENTS
            points.push(
                GerberScene3dSilkscreenCutoutBuilder.#rotatePoint(
                    x,
                    y,
                    -halfStraight + Math.cos(angle) * radius,
                    Math.sin(angle) * radius,
                    rotation
                )
            )
        }

        return GerberScene3dSilkscreenCutoutBuilder.#fromPoints(points)
    }

    /**
     * Rotates a local point around a center.
     * @param {number} centerX Center X.
     * @param {number} centerY Center Y.
     * @param {number} localX Local X.
     * @param {number} localY Local Y.
     * @param {number} rotation Rotation in radians.
     * @returns {{ x: number, y: number }}
     */
    static #rotatePoint(centerX, centerY, localX, localY, rotation) {
        const cos = Math.cos(rotation)
        const sin = Math.sin(rotation)

        return {
            x: centerX + localX * cos - localY * sin,
            y: centerY + localX * sin + localY * cos
        }
    }

    /**
     * Creates a cutout record from point geometry.
     * @param {{ x: number, y: number }[]} points Source points.
     * @returns {object | null}
     */
    static #fromPoints(points) {
        const normalizedPoints = points
            .map((point) => ({
                x: GerberScene3dSilkscreenCutoutBuilder.#roundMil(point.x),
                y: GerberScene3dSilkscreenCutoutBuilder.#roundMil(point.y)
            }))
            .filter(
                (point) => Number.isFinite(point.x) && Number.isFinite(point.y)
            )
        if (normalizedPoints.length < 3) {
            return null
        }

        return {
            points: normalizedPoints,
            bounds: GerberScene3dSilkscreenCutoutBuilder.#bounds(
                normalizedPoints
            )
        }
    }

    /**
     * Removes duplicate cutouts.
     * @param {(object | null)[]} cutouts Candidate cutouts.
     * @returns {object[]}
     */
    static #dedupeCutouts(cutouts) {
        const seen = new Set()
        const deduped = []

        for (const cutout of cutouts || []) {
            if (!cutout?.points?.length) {
                continue
            }

            const key = cutout.points
                .map((point) => point.x.toFixed(3) + ':' + point.y.toFixed(3))
                .join('|')
            if (seen.has(key)) {
                continue
            }

            seen.add(key)
            deduped.push(cutout)
        }

        return deduped
    }

    /**
     * Resolves point-list bounds.
     * @param {{ x: number, y: number }[]} points Points.
     * @returns {{ minX: number, minY: number, maxX: number, maxY: number }}
     */
    static #bounds(points) {
        return points.reduce(
            (bounds, point) => ({
                minX: Math.min(bounds.minX, point.x),
                minY: Math.min(bounds.minY, point.y),
                maxX: Math.max(bounds.maxX, point.x),
                maxY: Math.max(bounds.maxY, point.y)
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
     * Converts degrees to radians.
     * @param {number} degrees Degrees.
     * @returns {number}
     */
    static #radians(degrees) {
        return (Number(degrees || 0) * Math.PI) / 180
    }

    /**
     * Rounds one mil value.
     * @param {number} value Numeric value.
     * @returns {number}
     */
    static #roundMil(value) {
        return Number(Number(value || 0).toFixed(6))
    }
}
