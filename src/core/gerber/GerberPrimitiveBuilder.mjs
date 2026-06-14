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
                    GerberPrimitiveBuilder.translate(
                        decorated,
                        xIndex * repeat.i,
                        yIndex * repeat.j
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
            attributes: GerberPrimitiveBuilder.attributeSnapshot(state)
        }

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
        if (Array.isArray(translated.primitives)) {
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
        if (primitive.type === 'line' || primitive.type === 'arc') {
            bounds.includeSegment(
                primitive.x1,
                primitive.y1,
                primitive.x2,
                primitive.y2,
                Number(primitive.width || 0) / 2
            )
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
                GerberPrimitiveBuilder.#includeBounds(bounds, child)
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
                bounds.includeSegment(
                    primitive.x + child.x1,
                    primitive.y + child.y1,
                    primitive.x + child.x2,
                    primitive.y + child.y2,
                    (Number(child.width || 0) * scale) / 2
                )
                continue
            }

            if (child.type === 'region') {
                for (const point of child.points || []) {
                    bounds.includePoint(
                        primitive.x + point.x,
                        primitive.y + point.y
                    )
                }
                continue
            }

            const diameter = Math.max(
                Number(child.diameter || 0),
                Number(child.outerDiameter || 0),
                Number(child.width || 0),
                Number(child.height || 0)
            )
            bounds.includePoint(
                primitive.x + Number(child.x || 0),
                primitive.y + Number(child.y || 0),
                (diameter * scale) / 2
            )
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
