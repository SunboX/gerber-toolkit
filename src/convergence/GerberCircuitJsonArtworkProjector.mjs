import { GerberCircuitJsonArcSampler } from './GerberCircuitJsonArcSampler.mjs'

const CIRCLE_SEGMENTS = 32

/** Projects non-copper Gerber artwork without inventing conductive semantics. */
export class GerberCircuitJsonArtworkProjector {
    /**
     * Projects one artwork primitive under its resolved layer semantics.
     * @param {Record<string, any>} primitive Native Gerber primitive.
     * @param {{ kind: string, circuitLayer: string }} semantics Resolved layer.
     * @param {string} id Stable source suffix.
     * @param {Record<string, any>} [ownership] Canonical ownership facts.
     * @returns {Record<string, any>[]} Canonical rows.
     */
    static project(primitive, semantics, id, ownership = {}) {
        if (primitive?.polarity === 'clear') {
            return GerberCircuitJsonArtworkProjector.#neutral(
                primitive,
                semantics.circuitLayer,
                id,
                `${semantics.kind} clear`
            )
        }
        if (semantics.kind === 'silkscreen') {
            return GerberCircuitJsonArtworkProjector.#silkscreen(
                primitive,
                semantics.circuitLayer,
                id,
                ownership
            )
        }
        if (semantics.kind === 'paste') {
            return GerberCircuitJsonArtworkProjector.#paste(
                primitive,
                semantics.circuitLayer,
                id
            )
        }
        return GerberCircuitJsonArtworkProjector.#neutral(
            primitive,
            semantics.circuitLayer,
            id,
            semantics.kind
        )
    }

    /**
     * Projects legend artwork into dedicated CircuitJSON silkscreen elements.
     * @param {Record<string, any>} primitive Native primitive.
     * @param {'top' | 'bottom'} layer Board side.
     * @param {string} id Stable source suffix.
     * @param {Record<string, any>} ownership Canonical ownership facts.
     * @returns {Record<string, any>[]} Canonical rows.
     */
    static #silkscreen(primitive, layer, id, ownership) {
        const common = {
            pcb_component_id: ownership.pcbComponentId || '',
            layer
        }
        if (primitive?.type === 'line') {
            return [
                {
                    ...common,
                    type: 'pcb_silkscreen_line',
                    pcb_silkscreen_line_id: `gerber_silkscreen_${id}`,
                    x1: GerberCircuitJsonArtworkProjector.#number(primitive.x1),
                    y1: GerberCircuitJsonArtworkProjector.#number(primitive.y1),
                    x2: GerberCircuitJsonArtworkProjector.#number(primitive.x2),
                    y2: GerberCircuitJsonArtworkProjector.#number(primitive.y2),
                    stroke_width: GerberCircuitJsonArtworkProjector.#positive(
                        primitive.width
                    )
                }
            ]
        }
        if (primitive?.type === 'arc') {
            return [
                {
                    ...common,
                    type: 'pcb_silkscreen_path',
                    pcb_silkscreen_path_id: `gerber_silkscreen_${id}`,
                    route: GerberCircuitJsonArcSampler.points(primitive),
                    stroke_width: GerberCircuitJsonArtworkProjector.#positive(
                        primitive.width
                    )
                }
            ]
        }
        if (primitive?.type === 'region') {
            const vertices = GerberCircuitJsonArtworkProjector.#points(
                primitive.points
            )
            if (vertices.length < 3) return []
            return [
                {
                    ...common,
                    type: 'pcb_silkscreen_graphic',
                    pcb_silkscreen_graphic_id: `gerber_silkscreen_${id}`,
                    shape: 'brep',
                    brep_shape: { outer_ring: { vertices } }
                }
            ]
        }
        if (primitive?.type !== 'flash') return []
        const center = {
            x: GerberCircuitJsonArtworkProjector.#number(primitive.x),
            y: GerberCircuitJsonArtworkProjector.#number(primitive.y)
        }
        if (primitive.shape === 'circle') {
            return [
                {
                    ...common,
                    type: 'pcb_silkscreen_circle',
                    pcb_silkscreen_circle_id: `gerber_silkscreen_${id}`,
                    center,
                    radius:
                        GerberCircuitJsonArtworkProjector.#positive(
                            primitive.diameter
                        ) / 2,
                    is_filled: true
                }
            ]
        }
        if (primitive.shape === 'rect') {
            return [
                {
                    ...common,
                    type: 'pcb_silkscreen_rect',
                    pcb_silkscreen_rect_id: `gerber_silkscreen_${id}`,
                    center,
                    width: GerberCircuitJsonArtworkProjector.#positive(
                        primitive.width
                    ),
                    height: GerberCircuitJsonArtworkProjector.#positive(
                        primitive.height
                    ),
                    ccw_rotation:
                        GerberCircuitJsonArtworkProjector.#rotation(primitive),
                    is_filled: true,
                    has_stroke: false
                }
            ]
        }
        if (primitive.shape === 'obround') {
            return [
                {
                    ...common,
                    type: 'pcb_silkscreen_pill',
                    pcb_silkscreen_pill_id: `gerber_silkscreen_${id}`,
                    center,
                    width: GerberCircuitJsonArtworkProjector.#positive(
                        primitive.width
                    ),
                    height: GerberCircuitJsonArtworkProjector.#positive(
                        primitive.height
                    ),
                    ccw_rotation:
                        GerberCircuitJsonArtworkProjector.#rotation(primitive)
                }
            ]
        }
        return GerberCircuitJsonArtworkProjector.#neutral(
            primitive,
            layer,
            id,
            'silkscreen'
        )
    }

    /**
     * Projects aperture flashes into dedicated solder-paste elements.
     * @param {Record<string, any>} primitive Native primitive.
     * @param {'top' | 'bottom'} layer Board side.
     * @param {string} id Stable source suffix.
     * @returns {Record<string, any>[]} Canonical rows.
     */
    static #paste(primitive, layer, id) {
        if (primitive?.type !== 'flash') {
            return GerberCircuitJsonArtworkProjector.#neutral(
                primitive,
                layer,
                id,
                'paste'
            )
        }
        const common = {
            type: 'pcb_solder_paste',
            pcb_solder_paste_id: `gerber_paste_${id}`,
            x: GerberCircuitJsonArtworkProjector.#number(primitive.x),
            y: GerberCircuitJsonArtworkProjector.#number(primitive.y),
            layer
        }
        if (primitive.shape === 'circle') {
            return [
                {
                    ...common,
                    shape: 'circle',
                    radius:
                        GerberCircuitJsonArtworkProjector.#positive(
                            primitive.diameter
                        ) / 2
                }
            ]
        }
        const width = GerberCircuitJsonArtworkProjector.#positive(
            primitive.width
        )
        const height = GerberCircuitJsonArtworkProjector.#positive(
            primitive.height
        )
        if (primitive.shape === 'rect') {
            const rotation =
                GerberCircuitJsonArtworkProjector.#rotation(primitive)
            return [
                rotation === 0
                    ? { ...common, shape: 'rect', width, height }
                    : {
                          ...common,
                          shape: 'rotated_rect',
                          width,
                          height,
                          ccw_rotation: rotation
                      }
            ]
        }
        if (primitive.shape === 'obround') {
            if (GerberCircuitJsonArtworkProjector.#rotation(primitive) !== 0) {
                return GerberCircuitJsonArtworkProjector.#neutral(
                    primitive,
                    layer,
                    id,
                    'paste'
                )
            }
            return [
                {
                    ...common,
                    shape: 'pill',
                    width,
                    height,
                    radius: Math.min(width, height) / 2
                }
            ]
        }
        return GerberCircuitJsonArtworkProjector.#neutral(
            primitive,
            layer,
            id,
            'paste'
        )
    }

    /**
     * Projects nonrepresentable or semantically ambiguous artwork as notes.
     * @param {Record<string, any>} primitive Native primitive.
     * @param {'top' | 'bottom'} layer Board side.
     * @param {string} id Stable source suffix.
     * @param {string} semantic Source semantic label.
     * @returns {Record<string, any>[]} Canonical rows.
     */
    static #neutral(primitive, layer, id, semantic) {
        const name = `Gerber ${semantic} artwork`
        if (primitive?.type === 'line') {
            return [
                {
                    type: 'pcb_note_line',
                    pcb_note_line_id: `gerber_note_${id}`,
                    x1: GerberCircuitJsonArtworkProjector.#number(primitive.x1),
                    y1: GerberCircuitJsonArtworkProjector.#number(primitive.y1),
                    x2: GerberCircuitJsonArtworkProjector.#number(primitive.x2),
                    y2: GerberCircuitJsonArtworkProjector.#number(primitive.y2),
                    stroke_width: GerberCircuitJsonArtworkProjector.#positive(
                        primitive.width
                    ),
                    layer,
                    name
                }
            ]
        }
        if (primitive?.type === 'arc') {
            return [
                GerberCircuitJsonArtworkProjector.#notePath(
                    GerberCircuitJsonArcSampler.points(primitive),
                    primitive.width,
                    layer,
                    id,
                    name
                )
            ]
        }
        if (primitive?.type === 'region') {
            const points = GerberCircuitJsonArtworkProjector.#closed(
                GerberCircuitJsonArtworkProjector.#points(primitive.points)
            )
            return points.length >= 4
                ? [
                      GerberCircuitJsonArtworkProjector.#notePath(
                          points,
                          0.000001,
                          layer,
                          id,
                          name
                      )
                  ]
                : []
        }
        if (primitive?.type !== 'flash') return []
        const x = GerberCircuitJsonArtworkProjector.#number(primitive.x)
        const y = GerberCircuitJsonArtworkProjector.#number(primitive.y)
        const rotation = GerberCircuitJsonArtworkProjector.#rotation(primitive)
        if (primitive.shape === 'rect' && rotation === 0) {
            return [
                {
                    type: 'pcb_note_rect',
                    pcb_note_rect_id: `gerber_note_${id}`,
                    center: { x, y },
                    width: GerberCircuitJsonArtworkProjector.#positive(
                        primitive.width
                    ),
                    height: GerberCircuitJsonArtworkProjector.#positive(
                        primitive.height
                    ),
                    is_filled: true,
                    has_stroke: false,
                    layer,
                    name
                }
            ]
        }
        let points = []
        if (primitive.shape === 'circle') {
            points = GerberCircuitJsonArtworkProjector.#ellipse(
                x,
                y,
                GerberCircuitJsonArtworkProjector.#positive(
                    primitive.diameter
                ) / 2,
                GerberCircuitJsonArtworkProjector.#positive(
                    primitive.diameter
                ) / 2,
                rotation
            )
        } else if (primitive.shape === 'rect') {
            points = GerberCircuitJsonArtworkProjector.#rectangle(
                x,
                y,
                GerberCircuitJsonArtworkProjector.#positive(primitive.width),
                GerberCircuitJsonArtworkProjector.#positive(primitive.height),
                rotation
            )
        } else if (primitive.shape === 'obround') {
            points = GerberCircuitJsonArtworkProjector.#capsule(
                x,
                y,
                GerberCircuitJsonArtworkProjector.#positive(primitive.width),
                GerberCircuitJsonArtworkProjector.#positive(primitive.height),
                rotation
            )
        }
        return points.length
            ? [
                  GerberCircuitJsonArtworkProjector.#notePath(
                      GerberCircuitJsonArtworkProjector.#closed(points),
                      0.000001,
                      layer,
                      id,
                      name
                  )
              ]
            : []
    }

    /**
     * Builds one generic note path.
     * @param {{ x: number, y: number }[]} route Path points.
     * @param {unknown} width Native width.
     * @param {'top' | 'bottom'} layer Board side.
     * @param {string} id Stable source suffix.
     * @param {string} name Semantic label.
     * @returns {Record<string, any>} Note path.
     */
    static #notePath(route, width, layer, id, name) {
        return {
            type: 'pcb_note_path',
            pcb_note_path_id: `gerber_note_${id}`,
            route,
            stroke_width: GerberCircuitJsonArtworkProjector.#positive(width),
            layer,
            name
        }
    }

    /**
     * Samples one rotated ellipse.
     * @param {number} x Center X.
     * @param {number} y Center Y.
     * @param {number} radiusX X radius.
     * @param {number} radiusY Y radius.
     * @param {number} rotation Rotation in degrees.
     * @returns {{ x: number, y: number }[]} Sampled points.
     */
    static #ellipse(x, y, radiusX, radiusY, rotation) {
        const radians = (rotation * Math.PI) / 180
        const cosRotation = Math.cos(radians)
        const sinRotation = Math.sin(radians)
        return Array.from({ length: CIRCLE_SEGMENTS }, (_, index) => {
            const angle = (index / CIRCLE_SEGMENTS) * Math.PI * 2
            const localX = Math.cos(angle) * radiusX
            const localY = Math.sin(angle) * radiusY
            return {
                x: x + localX * cosRotation - localY * sinRotation,
                y: y + localX * sinRotation + localY * cosRotation
            }
        })
    }

    /**
     * Builds a true rotated capsule outline for obround artwork.
     * @param {number} x Center X.
     * @param {number} y Center Y.
     * @param {number} width Width.
     * @param {number} height Height.
     * @param {number} rotation Rotation in degrees.
     * @returns {{ x: number, y: number }[]} Capsule points.
     */
    static #capsule(x, y, width, height, rotation) {
        const radius = Math.min(width, height) / 2
        const span = (Math.max(width, height) - radius * 2) / 2
        const horizontal = width >= height
        const radians = (rotation * Math.PI) / 180
        const cosRotation = Math.cos(radians)
        const sinRotation = Math.sin(radians)
        return Array.from({ length: CIRCLE_SEGMENTS }, (_, index) => {
            const angle = (index / CIRCLE_SEGMENTS) * Math.PI * 2
            const cosine = Math.cos(angle)
            const sine = Math.sin(angle)
            const localX =
                cosine * radius +
                (horizontal ? (cosine >= 0 ? span : -span) : 0)
            const localY =
                sine * radius + (horizontal ? 0 : sine >= 0 ? span : -span)
            return {
                x: x + localX * cosRotation - localY * sinRotation,
                y: y + localX * sinRotation + localY * cosRotation
            }
        })
    }

    /**
     * Builds four rotated rectangle vertices.
     * @param {number} x Center X.
     * @param {number} y Center Y.
     * @param {number} width Width.
     * @param {number} height Height.
     * @param {number} rotation Rotation in degrees.
     * @returns {{ x: number, y: number }[]} Rectangle points.
     */
    static #rectangle(x, y, width, height, rotation) {
        const radians = (rotation * Math.PI) / 180
        const cosRotation = Math.cos(radians)
        const sinRotation = Math.sin(radians)
        return [
            [-width / 2, -height / 2],
            [width / 2, -height / 2],
            [width / 2, height / 2],
            [-width / 2, height / 2]
        ].map(([localX, localY]) => ({
            x: x + localX * cosRotation - localY * sinRotation,
            y: y + localX * sinRotation + localY * cosRotation
        }))
    }

    /** @param {unknown} value Points. @returns {{ x: number, y: number }[]} Finite points. */
    static #points(value) {
        if (!Array.isArray(value)) return []
        return value
            .map((point) => ({ x: Number(point?.x), y: Number(point?.y) }))
            .filter(
                (point) => Number.isFinite(point.x) && Number.isFinite(point.y)
            )
    }

    /** @param {{ x: number, y: number }[]} points Points. @returns {{ x: number, y: number }[]} Closed points. */
    static #closed(points) {
        if (!points.length) return []
        const first = points[0]
        const last = points.at(-1)
        return first.x === last.x && first.y === last.y
            ? points
            : [...points, { ...first }]
    }

    /** @param {Record<string, any>} primitive Primitive. @returns {number} Rotation. */
    static #rotation(primitive) {
        return GerberCircuitJsonArtworkProjector.#number(
            primitive?.rotation ?? primitive?.transform?.rotation
        )
    }

    /** @param {unknown} value Candidate. @returns {number} Finite number. */
    static #number(value) {
        const number = Number(value)
        return Number.isFinite(number) ? number : 0
    }

    /** @param {unknown} value Candidate. @returns {number} Positive number. */
    static #positive(value) {
        return Math.max(
            GerberCircuitJsonArtworkProjector.#number(value),
            0.000001
        )
    }
}

Object.freeze(GerberCircuitJsonArtworkProjector.prototype)
Object.freeze(GerberCircuitJsonArtworkProjector)
