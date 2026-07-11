/** Projects standards-representable fabrication geometry into CircuitJSON. */
export class GerberCircuitJsonProjector {
    /**
     * Projects one native composite Gerber document.
     * @param {Record<string, any>} document Native document.
     * @returns {Record<string, any>[]} Canonical CircuitJSON elements.
     */
    static project(document) {
        const layers = Array.isArray(document?.pcb?.fabrication?.layers)
            ? document.pcb.fabrication.layers
            : []
        const model = [GerberCircuitJsonProjector.#board(document)]
        for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
            GerberCircuitJsonProjector.#layer(
                layers[layerIndex],
                layerIndex,
                model
            )
        }
        return model
    }

    /**
     * Builds one canonical board from the aggregate fabrication bounds.
     * @param {Record<string, any>} document Native document.
     * @returns {Record<string, any>} Board element.
     */
    static #board(document) {
        const bounds = document?.pcb?.bounds || {}
        const minX = GerberCircuitJsonProjector.#number(bounds.minX)
        const minY = GerberCircuitJsonProjector.#number(bounds.minY)
        const maxX = GerberCircuitJsonProjector.#number(bounds.maxX, minX + 1)
        const maxY = GerberCircuitJsonProjector.#number(bounds.maxY, minY + 1)
        return {
            type: 'pcb_board',
            pcb_board_id: 'gerber_board_0',
            center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
            width: Math.max(maxX - minX, 0.000001),
            height: Math.max(maxY - minY, 0.000001),
            num_layers: 2
        }
    }

    /**
     * Projects one fabrication layer without inventing unsupported semantics.
     * @param {Record<string, any>} layer Native layer.
     * @param {number} layerIndex Stable layer index.
     * @param {Record<string, any>[]} model Destination.
     * @returns {void}
     */
    static #layer(layer, layerIndex, model) {
        const circuitLayer =
            String(layer?.side || '').toLowerCase() === 'bottom'
                ? 'bottom'
                : 'top'
        const role = String(layer?.role || '')
        const copper = role.endsWith('-copper')
        const documentation =
            role.includes('silkscreen') ||
            role === 'drill-map' ||
            role === 'fabrication-layer'
        const primitives = Array.isArray(layer?.primitives)
            ? layer.primitives
            : []
        for (let index = 0; index < primitives.length; index += 1) {
            const primitive = primitives[index]
            if (primitive?.polarity === 'clear') continue
            const id = `${layerIndex}_${index}`
            if (copper) {
                const rows = GerberCircuitJsonProjector.#copper(
                    primitive,
                    circuitLayer,
                    id
                )
                model.push(...rows)
            } else if (documentation) {
                const row = GerberCircuitJsonProjector.#note(
                    primitive,
                    circuitLayer,
                    id
                )
                if (row) model.push(row)
            }
        }
        const drills = Array.isArray(layer?.drills) ? layer.drills : []
        for (let index = 0; index < drills.length; index += 1) {
            model.push(
                GerberCircuitJsonProjector.#hole(
                    drills[index],
                    layerIndex,
                    index
                )
            )
        }
    }

    /**
     * Projects one copper primitive.
     * @param {Record<string, any>} primitive Native primitive.
     * @param {'top' | 'bottom'} layer Circuit layer.
     * @param {string} id Stable suffix.
     * @returns {Record<string, any>[]} Zero or more rows.
     */
    static #copper(primitive, layer, id) {
        if (primitive?.type === 'line' || primitive?.type === 'arc') {
            return [
                {
                    type: 'pcb_trace',
                    pcb_trace_id: `gerber_trace_${id}`,
                    route: GerberCircuitJsonProjector.#route(primitive, layer)
                }
            ]
        }
        if (primitive?.type === 'region') {
            const points = GerberCircuitJsonProjector.#points(primitive.points)
            return points.length >= 3
                ? [
                      {
                          type: 'pcb_copper_pour',
                          pcb_copper_pour_id: `gerber_pour_${id}`,
                          shape: 'polygon',
                          points,
                          layer
                      }
                  ]
                : []
        }
        if (primitive?.type !== 'flash') return []
        const pad = GerberCircuitJsonProjector.#pad(primitive, layer, id)
        return pad ? [pad] : []
    }

    /**
     * Projects one supported aperture flash as non-semantic copper artwork.
     * @param {Record<string, any>} primitive Native flash.
     * @param {'top' | 'bottom'} layer Circuit layer.
     * @param {string} id Stable suffix.
     * @returns {Record<string, any> | null} Pad or null.
     */
    static #pad(primitive, layer, id) {
        const common = {
            type: 'pcb_smtpad',
            pcb_smtpad_id: `gerber_pad_${id}`,
            x: GerberCircuitJsonProjector.#number(primitive.x),
            y: GerberCircuitJsonProjector.#number(primitive.y),
            layer
        }
        if (primitive.shape === 'circle') {
            return {
                ...common,
                shape: 'circle',
                radius: Math.max(
                    GerberCircuitJsonProjector.#number(primitive.diameter) / 2,
                    0.000001
                )
            }
        }
        if (primitive.shape === 'rect') {
            return {
                ...common,
                shape: 'rotated_rect',
                width: GerberCircuitJsonProjector.#positive(primitive.width),
                height: GerberCircuitJsonProjector.#positive(primitive.height),
                ccw_rotation: GerberCircuitJsonProjector.#number(
                    primitive.rotation
                )
            }
        }
        if (primitive.shape === 'obround') {
            const width = GerberCircuitJsonProjector.#positive(primitive.width)
            const height = GerberCircuitJsonProjector.#positive(
                primitive.height
            )
            return {
                ...common,
                shape: 'pill',
                width,
                height,
                radius: Math.min(width, height) / 2,
                ccw_rotation: GerberCircuitJsonProjector.#number(
                    primitive.rotation
                )
            }
        }
        return null
    }

    /**
     * Projects component-free documentation into generic PCB notes.
     * @param {Record<string, any>} primitive Native primitive.
     * @param {'top' | 'bottom'} layer Circuit layer.
     * @param {string} id Stable suffix.
     * @returns {Record<string, any> | null} Note row.
     */
    static #note(primitive, layer, id) {
        if (primitive?.type === 'line') {
            return {
                type: 'pcb_note_line',
                pcb_note_line_id: `gerber_note_${id}`,
                x1: GerberCircuitJsonProjector.#number(primitive.x1),
                y1: GerberCircuitJsonProjector.#number(primitive.y1),
                x2: GerberCircuitJsonProjector.#number(primitive.x2),
                y2: GerberCircuitJsonProjector.#number(primitive.y2),
                stroke_width: GerberCircuitJsonProjector.#positive(
                    primitive.width
                ),
                layer
            }
        }
        if (primitive?.type === 'arc') {
            return {
                type: 'pcb_note_path',
                pcb_note_path_id: `gerber_note_${id}`,
                route: GerberCircuitJsonProjector.#route(primitive, layer).map(
                    ({ x, y }) => ({ x, y })
                ),
                stroke_width: GerberCircuitJsonProjector.#positive(
                    primitive.width
                ),
                layer
            }
        }
        return null
    }

    /**
     * Builds a trace route, approximating native arcs at bounded resolution.
     * @param {Record<string, any>} primitive Native stroke.
     * @param {'top' | 'bottom'} layer Circuit layer.
     * @returns {Record<string, any>[]} Route points.
     */
    static #route(primitive, layer) {
        const width = GerberCircuitJsonProjector.#positive(primitive.width)
        const points =
            primitive.type === 'arc'
                ? GerberCircuitJsonProjector.#arcPoints(primitive)
                : [
                      { x: primitive.x1, y: primitive.y1 },
                      { x: primitive.x2, y: primitive.y2 }
                  ]
        return points.map((point) => ({
            route_type: 'wire',
            x: GerberCircuitJsonProjector.#number(point.x),
            y: GerberCircuitJsonProjector.#number(point.y),
            width,
            layer
        }))
    }

    /**
     * Samples one Gerber arc with at most five-degree segments.
     * @param {Record<string, any>} arc Native arc.
     * @returns {{ x: number, y: number }[]} Sampled points.
     */
    static #arcPoints(arc) {
        const x1 = GerberCircuitJsonProjector.#number(arc.x1)
        const y1 = GerberCircuitJsonProjector.#number(arc.y1)
        const x2 = GerberCircuitJsonProjector.#number(arc.x2)
        const y2 = GerberCircuitJsonProjector.#number(arc.y2)
        const centerX = x1 + GerberCircuitJsonProjector.#number(arc.i)
        const centerY = y1 + GerberCircuitJsonProjector.#number(arc.j)
        const radius = Math.hypot(x1 - centerX, y1 - centerY)
        if (!(radius > 0))
            return [
                { x: x1, y: y1 },
                { x: x2, y: y2 }
            ]
        const start = Math.atan2(y1 - centerY, x1 - centerX)
        const end = Math.atan2(y2 - centerY, x2 - centerX)
        let sweep = end - start
        if (arc.clockwise && sweep >= 0) sweep -= Math.PI * 2
        if (!arc.clockwise && sweep <= 0) sweep += Math.PI * 2
        const steps = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 36)))
        return Array.from({ length: steps + 1 }, (_, index) => {
            if (index === steps) return { x: x2, y: y2 }
            const angle = start + (sweep * index) / steps
            return {
                x: centerX + Math.cos(angle) * radius,
                y: centerY + Math.sin(angle) * radius
            }
        })
    }

    /**
     * Projects one native drill.
     * @param {Record<string, any>} drill Native drill.
     * @param {number} layerIndex Layer index.
     * @param {number} drillIndex Drill index.
     * @returns {Record<string, any>} Canonical hole.
     */
    static #hole(drill, layerIndex, drillIndex) {
        const id = `gerber_hole_${layerIndex}_${drillIndex}`
        if (drill?.type === 'slot') {
            const x1 = GerberCircuitJsonProjector.#number(drill.x1)
            const y1 = GerberCircuitJsonProjector.#number(drill.y1)
            const x2 = GerberCircuitJsonProjector.#number(drill.x2)
            const y2 = GerberCircuitJsonProjector.#number(drill.y2)
            const diameter = GerberCircuitJsonProjector.#positive(
                drill.diameter
            )
            return {
                type: 'pcb_hole',
                pcb_hole_id: id,
                hole_shape: 'pill',
                x: (x1 + x2) / 2,
                y: (y1 + y2) / 2,
                hole_width: Math.hypot(x2 - x1, y2 - y1) + diameter,
                hole_height: diameter,
                ccw_rotation: (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI,
                layer: 'board'
            }
        }
        return {
            type: 'pcb_hole',
            pcb_hole_id: id,
            hole_shape: 'circle',
            x: GerberCircuitJsonProjector.#number(drill?.x),
            y: GerberCircuitJsonProjector.#number(drill?.y),
            hole_diameter: GerberCircuitJsonProjector.#positive(
                drill?.diameter
            ),
            layer: 'board'
        }
    }

    /** @param {unknown} value Points. @returns {object[]} Finite points. */
    static #points(value) {
        if (!Array.isArray(value)) return []
        return value
            .map((point) => ({ x: Number(point?.x), y: Number(point?.y) }))
            .filter(
                (point) => Number.isFinite(point.x) && Number.isFinite(point.y)
            )
    }

    /** @param {unknown} value Candidate. @param {number} [fallback] Fallback. @returns {number} Finite value. */
    static #number(value, fallback = 0) {
        const number = Number(value)
        return Number.isFinite(number) ? number : fallback
    }

    /** @param {unknown} value Candidate. @returns {number} Positive value. */
    static #positive(value) {
        return Math.max(GerberCircuitJsonProjector.#number(value), 0.000001)
    }
}

Object.freeze(GerberCircuitJsonProjector.prototype)
Object.freeze(GerberCircuitJsonProjector)
