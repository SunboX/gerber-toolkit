import { GerberArcSampler } from './GerberArcSampler.mjs'
import { GerberBounds } from './GerberBounds.mjs'

/**
 * Appends Gerber primitives while applying repeat, metadata, and bounds.
 */
export class GerberPrimitiveBuilder {
    /**
     * Appends a primitive, expanding active step-repeat output.
     * @param {object} state Parser state.
     * @param {object} primitive Primitive.
     * @returns {void}
     */
    static append(state, primitive) {
        const decorated = GerberPrimitiveBuilder.decorate(state, primitive)
        const repeat = state.stepRepeat
        if (!repeat) {
            GerberPrimitiveBuilder.#appendInstance(state, decorated)
            return
        }

        for (let yIndex = 0; yIndex < repeat.y; yIndex += 1) {
            for (let xIndex = 0; xIndex < repeat.x; xIndex += 1) {
                GerberPrimitiveBuilder.#appendInstance(
                    state,
                    GerberPrimitiveBuilder.#repeatInstance(
                        GerberPrimitiveBuilder.translate(
                            decorated,
                            xIndex * repeat.i,
                            yIndex * repeat.j
                        ),
                        repeat,
                        xIndex,
                        yIndex
                    )
                )
            }
        }
    }

    /**
     * Adds parser metadata to one primitive.
     * @param {object} state Parser state.
     * @param {object} primitive Primitive.
     * @returns {object}
     */
    static decorate(state, primitive) {
        const decorated = {
            ...primitive,
            polarity: primitive.polarity || state.polarity,
            attributes: GerberPrimitiveBuilder.cloneAttributes({
                file: state.attributes.file,
                aperture:
                    primitive.apertureAttributes ?? state.attributes.aperture,
                object: state.attributes.object
            })
        }
        delete decorated.apertureAttributes

        if (decorated.shape === 'block') {
            decorated.primitives = (decorated.primitives || []).map((child) =>
                GerberPrimitiveBuilder.translate(
                    child,
                    decorated.x || 0,
                    decorated.y || 0
                )
            )
        }

        return decorated
    }

    /**
     * Translates one primitive by a vector.
     * @param {object} primitive Primitive.
     * @param {number} dx X offset.
     * @param {number} dy Y offset.
     * @returns {object}
     */
    static translate(primitive, dx, dy) {
        const translated = GerberPrimitiveBuilder.clone(primitive)
        if (translated.x !== undefined) {
            translated.x = GerberPrimitiveBuilder.#round(translated.x + dx)
        }
        if (translated.y !== undefined) {
            translated.y = GerberPrimitiveBuilder.#round(translated.y + dy)
        }
        if (translated.x1 !== undefined) {
            translated.x1 = GerberPrimitiveBuilder.#round(translated.x1 + dx)
        }
        if (translated.y1 !== undefined) {
            translated.y1 = GerberPrimitiveBuilder.#round(translated.y1 + dy)
        }
        if (translated.x2 !== undefined) {
            translated.x2 = GerberPrimitiveBuilder.#round(translated.x2 + dx)
        }
        if (translated.y2 !== undefined) {
            translated.y2 = GerberPrimitiveBuilder.#round(translated.y2 + dy)
        }
        if (Array.isArray(translated.points)) {
            translated.points = translated.points.map((point) => ({
                x: GerberPrimitiveBuilder.#round(point.x + dx),
                y: GerberPrimitiveBuilder.#round(point.y + dy)
            }))
        }
        if (
            Array.isArray(translated.primitives) &&
            translated.shape !== 'macro'
        ) {
            translated.primitives = translated.primitives.map((child) =>
                GerberPrimitiveBuilder.translate(child, dx, dy)
            )
        }
        return translated
    }

    /**
     * Returns a snapshot of primitive-scoped attributes.
     * @param {object} state Parser state.
     * @returns {object}
     */
    static attributeSnapshot(state) {
        return GerberPrimitiveBuilder.cloneAttributes({
            file: state.attributes.file,
            aperture: state.attributes.aperture,
            object: state.attributes.object
        })
    }

    /**
     * Clones an attribute map.
     * @param {object} attributes Attribute map.
     * @returns {object}
     */
    static cloneAttributes(attributes) {
        return {
            file: { ...(attributes.file || {}) },
            aperture: { ...(attributes.aperture || {}) },
            object: { ...(attributes.object || {}) }
        }
    }

    /**
     * Returns a normalized aperture transformation snapshot.
     * @param {object} state Parser state.
     * @returns {{ mirror: string, rotation: number, scale: number }}
     */
    static transformSnapshot(state) {
        return {
            mirror: state.apertureTransform.mirror,
            rotation: GerberPrimitiveBuilder.#round(
                state.apertureTransform.rotation
            ),
            scale: Number(state.apertureTransform.scale || 1)
        }
    }

    /**
     * Clones a simple data object.
     * @param {object} value Object value.
     * @returns {object}
     */
    static clone(value) {
        return JSON.parse(JSON.stringify(value || {}))
    }

    /**
     * Assigns a distinct source-path identity to one step-repeat instance.
     * @param {object} primitive Expanded primitive.
     * @param {object} repeat Active step-repeat definition.
     * @param {number} xIndex Horizontal repeat index.
     * @param {number} yIndex Vertical repeat index.
     * @returns {object} Instance primitive.
     */
    static #repeatInstance(primitive, repeat, xIndex, yIndex) {
        if (!primitive.sourcePathId) return primitive
        return {
            ...primitive,
            sourcePathId: `${primitive.sourcePathId}:repeat_${repeat.sourceInstanceId}_${xIndex}_${yIndex}`
        }
    }

    /**
     * Appends one already-expanded primitive.
     * @param {object} state Parser state.
     * @param {object} primitive Primitive.
     * @returns {void}
     */
    static #appendInstance(state, primitive) {
        state.primitives.push(primitive)
        GerberPrimitiveBuilder.#includeBounds(state.bounds, primitive)
    }

    /**
     * Includes one primitive in layer bounds.
     * @param {object} bounds Bounds accumulator.
     * @param {object} primitive Primitive.
     * @returns {void}
     */
    static #includeBounds(bounds, primitive) {
        if (primitive.type === 'line') {
            bounds.includeSegment(
                primitive.x1,
                primitive.y1,
                primitive.x2,
                primitive.y2,
                Number(primitive.width || 0) / 2
            )
            return
        }

        if (primitive.type === 'arc') {
            const radius = Number(primitive.width || 0) / 2
            for (const point of GerberArcSampler.extrema(primitive)) {
                bounds.includePoint(point.x, point.y, radius)
            }
            return
        }

        if (primitive.type === 'region') {
            for (const point of primitive.points || []) {
                bounds.includePoint(point.x, point.y)
            }
            return
        }

        if (primitive.shape === 'block') {
            for (const child of primitive.primitives || []) {
                GerberPrimitiveBuilder.#includeTransformedBounds(
                    bounds,
                    child,
                    primitive.transform,
                    primitive.x,
                    primitive.y
                )
            }
            return
        }

        if (primitive.shape === 'macro') {
            GerberPrimitiveBuilder.#includeMacroBounds(bounds, primitive)
            return
        }

        GerberPrimitiveBuilder.#includeFlashBounds(bounds, primitive)
    }

    /**
     * Includes a macro flash in bounds.
     * @param {object} bounds Bounds accumulator.
     * @param {object} primitive Macro flash primitive.
     * @returns {void}
     */
    static #includeMacroBounds(bounds, primitive) {
        const scale = Number(primitive.transform?.scale || 1)
        for (const child of primitive.primitives || []) {
            if (child.type === 'line') {
                const childStart = GerberPrimitiveBuilder.#rotatePoint(
                    { x: child.x1, y: child.y1 },
                    child.rotation
                )
                const childEnd = GerberPrimitiveBuilder.#rotatePoint(
                    { x: child.x2, y: child.y2 },
                    child.rotation
                )
                const start = GerberPrimitiveBuilder.#transformPoint(
                    childStart,
                    primitive.transform,
                    primitive.x,
                    primitive.y
                )
                const end = GerberPrimitiveBuilder.#transformPoint(
                    childEnd,
                    primitive.transform,
                    primitive.x,
                    primitive.y
                )
                bounds.includeSegment(
                    start.x,
                    start.y,
                    end.x,
                    end.y,
                    (Number(child.width || 0) * scale) / 2
                )
                continue
            }

            if (child.type === 'region') {
                for (const point of child.points || []) {
                    const transformed = GerberPrimitiveBuilder.#transformPoint(
                        GerberPrimitiveBuilder.#rotatePoint(
                            point,
                            child.rotation
                        ),
                        primitive.transform,
                        primitive.x,
                        primitive.y
                    )
                    bounds.includePoint(transformed.x, transformed.y)
                }
                continue
            }

            const diameter = Math.max(
                Number(child.diameter || 0),
                Number(child.outerDiameter || 0),
                Number(child.width || 0),
                Number(child.height || 0)
            )
            const center = GerberPrimitiveBuilder.#transformPoint(
                GerberPrimitiveBuilder.#rotatePoint(
                    { x: child.x, y: child.y },
                    child.rotation
                ),
                primitive.transform,
                primitive.x,
                primitive.y
            )
            bounds.includePoint(center.x, center.y, (diameter * scale) / 2)
        }
    }

    /**
     * Includes a block child after applying the outer block transform.
     * @param {object} bounds Bounds accumulator.
     * @param {object} primitive Child primitive in positioned coordinates.
     * @param {object} transform Outer aperture transform.
     * @param {number} pivotX Block flash X.
     * @param {number} pivotY Block flash Y.
     * @returns {void}
     */
    static #includeTransformedBounds(
        bounds,
        primitive,
        transform,
        pivotX,
        pivotY
    ) {
        if (primitive.shape === 'macro' || primitive.shape === 'block') {
            const localBounds = new GerberBounds()
            GerberPrimitiveBuilder.#includeBounds(localBounds, primitive)
            const box = localBounds.toObject()
            for (const point of [
                { x: box.minX, y: box.minY },
                { x: box.maxX, y: box.minY },
                { x: box.maxX, y: box.maxY },
                { x: box.minX, y: box.maxY }
            ]) {
                const transformed = GerberPrimitiveBuilder.#transformPoint(
                    {
                        x: point.x - Number(pivotX),
                        y: point.y - Number(pivotY)
                    },
                    transform,
                    pivotX,
                    pivotY
                )
                bounds.includePoint(transformed.x, transformed.y)
            }
            return
        }
        const scale = Math.abs(Number(transform?.scale || 1))
        const transformPosition = (point) =>
            GerberPrimitiveBuilder.#transformPoint(
                {
                    x: Number(point.x) - Number(pivotX),
                    y: Number(point.y) - Number(pivotY)
                },
                transform,
                pivotX,
                pivotY
            )
        if (primitive.type === 'line' || primitive.type === 'arc') {
            const points =
                primitive.type === 'arc'
                    ? GerberArcSampler.extrema(primitive)
                    : [
                          { x: primitive.x1, y: primitive.y1 },
                          { x: primitive.x2, y: primitive.y2 }
                      ]
            const radius = (Number(primitive.width || 0) * scale) / 2
            for (const point of points) {
                const transformed = transformPosition(point)
                bounds.includePoint(transformed.x, transformed.y, radius)
            }
            return
        }
        if (primitive.type === 'region') {
            for (const point of primitive.points || []) {
                const transformed = transformPosition(point)
                bounds.includePoint(transformed.x, transformed.y)
            }
            return
        }
        const center = transformPosition({
            x: primitive.x ?? pivotX,
            y: primitive.y ?? pivotY
        })
        const diameter = Math.max(
            Number(primitive.diameter || 0),
            Number(primitive.width || 0),
            Number(primitive.height || 0)
        )
        bounds.includePoint(center.x, center.y, (diameter * scale) / 2)
    }

    /**
     * Applies LM/LS/LR to a local point and translates it to an origin.
     * @param {{ x?: number, y?: number }} point Local point.
     * @param {object} transform Aperture transform.
     * @param {number} originX Output origin X.
     * @param {number} originY Output origin Y.
     * @returns {{ x: number, y: number }} Transformed point.
     */
    static #transformPoint(point, transform, originX, originY) {
        const mirror = String(transform?.mirror || 'none')
        const scale = Number(transform?.scale || 1)
        const x =
            Number(point.x || 0) *
            (mirror === 'x' || mirror === 'xy' ? -scale : scale)
        const y =
            Number(point.y || 0) *
            (mirror === 'y' || mirror === 'xy' ? -scale : scale)
        const radians = (Number(transform?.rotation || 0) * Math.PI) / 180
        return {
            x:
                Number(originX || 0) +
                x * Math.cos(radians) -
                y * Math.sin(radians),
            y:
                Number(originY || 0) +
                x * Math.sin(radians) +
                y * Math.cos(radians)
        }
    }

    /**
     * Rotates one macro-child point around the macro origin.
     * @param {{ x?: number, y?: number }} point Local point.
     * @param {unknown} rotation Rotation degrees.
     * @returns {{ x: number, y: number }} Rotated point.
     */
    static #rotatePoint(point, rotation) {
        const radians = (Number(rotation || 0) * Math.PI) / 180
        const x = Number(point.x || 0)
        const y = Number(point.y || 0)
        return {
            x: x * Math.cos(radians) - y * Math.sin(radians),
            y: x * Math.sin(radians) + y * Math.cos(radians)
        }
    }

    /**
     * Expands bounds around one flash primitive.
     * @param {object} bounds Bounds accumulator.
     * @param {object} primitive Flash primitive.
     * @returns {void}
     */
    static #includeFlashBounds(bounds, primitive) {
        if (primitive.shape === 'rect' || primitive.shape === 'obround') {
            bounds.includePoint(
                primitive.x,
                primitive.y,
                Math.max(primitive.width, primitive.height) / 2
            )
            return
        }

        bounds.includePoint(primitive.x, primitive.y, primitive.diameter / 2)
    }

    /**
     * Rounds one numeric value.
     * @param {number} value Numeric value.
     * @returns {number}
     */
    static #round(value) {
        return Number(Number(value || 0).toFixed(6))
    }
}
