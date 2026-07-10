import { createHash } from 'node:crypto'

/**
 * Projects legacy Gerber output into a generic benchmark-only CircuitJSON model.
 */
export class GerberLegacyProjectionBenchmarkAdapter {
    /**
     * Projects the first legacy project document into representable board data.
     * @param {Record<string, any>} projectResult Legacy loader result.
     * @returns {Record<string, any>[]} Benchmark CircuitJSON model.
     */
    static project(projectResult) {
        const document = Array.isArray(projectResult?.documents)
            ? projectResult.documents[0]
            : projectResult
        const layers = [...(document?.pcb?.fabrication?.layers || [])].sort(
            (left, right) =>
                String(left?.fileName || '').localeCompare(
                    String(right?.fileName || '')
                )
        )
        return [
            GerberLegacyProjectionBenchmarkAdapter.#board(document),
            ...GerberLegacyProjectionBenchmarkAdapter.#features(layers)
        ]
    }

    /**
     * Computes the frozen structural checksum used by the production adapter gate.
     * @param {Record<string, any>[]} model Benchmark model.
     * @returns {string} SHA-256 checksum.
     */
    static structuralChecksum(model) {
        return createHash('sha256').update(JSON.stringify(model)).digest('hex')
    }

    /**
     * Builds one standards-shaped PCB board row from source bounds.
     * @param {Record<string, any>} document Legacy document.
     * @returns {Record<string, any>} PCB board row.
     */
    static #board(document) {
        const bounds = document?.pcb?.bounds || {}
        const minX = GerberLegacyProjectionBenchmarkAdapter.#number(bounds.minX)
        const minY = GerberLegacyProjectionBenchmarkAdapter.#number(bounds.minY)
        const maxX = GerberLegacyProjectionBenchmarkAdapter.#number(
            bounds.maxX,
            minX + 1
        )
        const maxY = GerberLegacyProjectionBenchmarkAdapter.#number(
            bounds.maxY,
            minY + 1
        )
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
     * Projects supported line and drill geometry without fabricating semantics.
     * @param {Record<string, any>[]} layers Sorted fabrication layers.
     * @returns {Record<string, any>[]} Projected feature rows.
     */
    static #features(layers) {
        const rows = []
        for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
            const layer = layers[layerIndex]
            const circuitLayer =
                String(layer?.side || '').toLowerCase() === 'bottom'
                    ? 'bottom'
                    : 'top'
            for (
                let primitiveIndex = 0;
                primitiveIndex < (layer?.primitives || []).length;
                primitiveIndex += 1
            ) {
                const primitive = layer.primitives[primitiveIndex]
                if (
                    primitive?.type !== 'line' ||
                    primitive?.polarity === 'clear'
                ) {
                    continue
                }
                rows.push({
                    type: 'pcb_trace',
                    pcb_trace_id: `gerber_trace_${layerIndex}_${primitiveIndex}`,
                    route: [
                        {
                            route_type: 'wire',
                            x: GerberLegacyProjectionBenchmarkAdapter.#number(
                                primitive.x1
                            ),
                            y: GerberLegacyProjectionBenchmarkAdapter.#number(
                                primitive.y1
                            ),
                            width: Math.max(
                                GerberLegacyProjectionBenchmarkAdapter.#number(
                                    primitive.width,
                                    0.001
                                ),
                                0.001
                            ),
                            layer: circuitLayer
                        },
                        {
                            route_type: 'wire',
                            x: GerberLegacyProjectionBenchmarkAdapter.#number(
                                primitive.x2
                            ),
                            y: GerberLegacyProjectionBenchmarkAdapter.#number(
                                primitive.y2
                            ),
                            width: Math.max(
                                GerberLegacyProjectionBenchmarkAdapter.#number(
                                    primitive.width,
                                    0.001
                                ),
                                0.001
                            ),
                            layer: circuitLayer
                        }
                    ]
                })
            }
            for (
                let drillIndex = 0;
                drillIndex < (layer?.drills || []).length;
                drillIndex += 1
            ) {
                rows.push(
                    GerberLegacyProjectionBenchmarkAdapter.#hole(
                        layer.drills[drillIndex],
                        layerIndex,
                        drillIndex
                    )
                )
            }
        }
        return rows
    }

    /**
     * Projects one round or routed drill as a non-semantic board hole.
     * @param {Record<string, any>} drill Drill record.
     * @param {number} layerIndex Layer index.
     * @param {number} drillIndex Drill index.
     * @returns {Record<string, any>} CircuitJSON hole row.
     */
    static #hole(drill, layerIndex, drillIndex) {
        const id = `gerber_hole_${layerIndex}_${drillIndex}`
        if (drill?.type === 'slot') {
            const x1 = GerberLegacyProjectionBenchmarkAdapter.#number(drill.x1)
            const y1 = GerberLegacyProjectionBenchmarkAdapter.#number(drill.y1)
            const x2 = GerberLegacyProjectionBenchmarkAdapter.#number(drill.x2)
            const y2 = GerberLegacyProjectionBenchmarkAdapter.#number(drill.y2)
            const diameter = Math.max(
                GerberLegacyProjectionBenchmarkAdapter.#number(
                    drill.diameter,
                    0.001
                ),
                0.001
            )
            return {
                type: 'pcb_hole',
                pcb_hole_id: id,
                hole_shape: 'pill',
                x: (x1 + x2) / 2,
                y: (y1 + y2) / 2,
                width: Math.hypot(x2 - x1, y2 - y1) + diameter,
                height: diameter,
                ccw_rotation: (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI,
                layer: 'board'
            }
        }
        return {
            type: 'pcb_hole',
            pcb_hole_id: id,
            hole_shape: 'round',
            x: GerberLegacyProjectionBenchmarkAdapter.#number(drill?.x),
            y: GerberLegacyProjectionBenchmarkAdapter.#number(drill?.y),
            diameter: Math.max(
                GerberLegacyProjectionBenchmarkAdapter.#number(
                    drill?.diameter,
                    0.001
                ),
                0.001
            ),
            layer: 'board'
        }
    }

    /**
     * Returns one finite numeric value.
     * @param {unknown} value Numeric candidate.
     * @param {number} [fallback] Fallback value.
     * @returns {number} Finite number.
     */
    static #number(value, fallback = 0) {
        const number = Number(value)
        return Number.isFinite(number) ? number : fallback
    }
}
