/**
 * Builds simple PCB interaction items for Gerber render output.
 */
export class PcbInteractionIndex {
    /**
     * Builds interaction items for one Gerber document.
     * @param {object} documentModel Normalized Gerber document.
     * @param {{ renderMode?: string, layerId?: string, layerIds?: string[] }} [options] Build options.
     * @returns {object[]}
     */
    static build(documentModel, options = {}) {
        return PcbInteractionIndex.#layers(documentModel, options).flatMap(
            (layer) => [
                ...(layer.primitives || []).map((primitive, index) =>
                    PcbInteractionIndex.#primitiveItem(layer, primitive, index)
                ),
                ...(layer.drills || []).map((drill, index) =>
                    PcbInteractionIndex.#drillItem(layer, drill, index)
                )
            ]
        )
    }

    /**
     * Returns hit-test candidates for one point.
     * @param {object[]} items Interaction items.
     * @param {{ x?: unknown, y?: unknown }} point Board-space point.
     * @param {{ tolerance?: number }} [options] Hit-test options.
     * @returns {object[]}
     */
    static hitTestItems(items, point, options = {}) {
        const x = Number(point?.x)
        const y = Number(point?.y)
        const tolerance = Number(options.tolerance || 0.2)
        const visibleItems = PcbInteractionIndex.#filterVisibleItems(
            items,
            options
        )
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            return []
        }

        return visibleItems.filter((item) =>
            PcbInteractionIndex.#contains(item.bounds, x, y, tolerance)
        )
    }

    /**
     * Filters items for separated render mode.
     * @param {object[]} items Interaction items.
     * @param {{ renderMode?: string, layerId?: string, layerIds?: string[] }} options Hit-test options.
     * @returns {object[]}
     */
    static #filterVisibleItems(items, options) {
        const normalizedItems = Array.isArray(items) ? items : []
        const selectedLayerIds = PcbInteractionIndex.#selectedLayerIds(options)
        if (options.renderMode !== 'separated' || !selectedLayerIds.size) {
            return normalizedItems
        }

        return normalizedItems.filter((item) =>
            selectedLayerIds.has(String(item.layerId || ''))
        )
    }

    /**
     * Resolves renderable layers.
     * @param {object} documentModel Normalized Gerber document.
     * @param {{ renderMode?: string, layerId?: string, layerIds?: string[] }} options Build options.
     * @returns {object[]}
     */
    static #layers(documentModel, options) {
        const layers = Array.isArray(documentModel?.pcb?.fabrication?.layers)
            ? documentModel.pcb.fabrication.layers
            : []
        const selectedLayerIds = PcbInteractionIndex.#selectedLayerIds(options)
        if (options.renderMode === 'separated' && selectedLayerIds.size) {
            return layers.filter((layer) =>
                selectedLayerIds.has(String(layer?.id || ''))
            )
        }

        return layers
    }

    /**
     * Resolves selected source-layer ids from render options.
     * @param {{ layerId?: string, layerIds?: string[] }} options Render options.
     * @returns {Set<string>}
     */
    static #selectedLayerIds(options) {
        const ids = Array.isArray(options.layerIds)
            ? options.layerIds.map(String).filter(Boolean)
            : []
        const singleId = String(options.layerId || '')
        if (!ids.length && singleId) {
            ids.push(singleId)
        }
        return new Set(ids)
    }

    /**
     * Builds one primitive interaction item.
     * @param {object} layer Source layer.
     * @param {object} primitive Primitive.
     * @param {number} index Primitive index.
     * @returns {object}
     */
    static #primitiveItem(layer, primitive, index) {
        return {
            id: layer.id + '-primitive-' + index,
            sourceFormat: 'gerber',
            layerId: layer.id,
            role: layer.role,
            kind: primitive.type || 'primitive',
            bounds: PcbInteractionIndex.#primitiveBounds(primitive)
        }
    }

    /**
     * Builds one drill interaction item.
     * @param {object} layer Source layer.
     * @param {object} drill Drill hit.
     * @param {number} index Drill index.
     * @returns {object}
     */
    static #drillItem(layer, drill, index) {
        const radius = Number(drill.diameter || 0) / 2
        if (drill.type === 'slot') {
            return {
                id: layer.id + '-drill-' + index,
                sourceFormat: 'gerber',
                layerId: layer.id,
                role: layer.role,
                kind: 'slot',
                bounds: {
                    minX: Math.min(drill.x1, drill.x2) - radius,
                    minY: Math.min(drill.y1, drill.y2) - radius,
                    maxX: Math.max(drill.x1, drill.x2) + radius,
                    maxY: Math.max(drill.y1, drill.y2) + radius
                }
            }
        }

        return {
            id: layer.id + '-drill-' + index,
            sourceFormat: 'gerber',
            layerId: layer.id,
            role: layer.role,
            kind: 'drill',
            bounds: {
                minX: drill.x - radius,
                minY: drill.y - radius,
                maxX: drill.x + radius,
                maxY: drill.y + radius
            }
        }
    }

    /**
     * Resolves primitive bounds.
     * @param {object} primitive Primitive.
     * @returns {{ minX: number, minY: number, maxX: number, maxY: number }}
     */
    static #primitiveBounds(primitive) {
        if (primitive.type === 'line' || primitive.type === 'arc') {
            const radius = Number(primitive.width || 0) / 2
            return {
                minX: Math.min(primitive.x1, primitive.x2) - radius,
                minY: Math.min(primitive.y1, primitive.y2) - radius,
                maxX: Math.max(primitive.x1, primitive.x2) + radius,
                maxY: Math.max(primitive.y1, primitive.y2) + radius
            }
        }

        if (primitive.type === 'region') {
            return PcbInteractionIndex.#pointsBounds(primitive.points || [])
        }

        const radius =
            Math.max(
                Number(primitive.diameter || 0),
                Number(primitive.width || 0),
                Number(primitive.height || 0)
            ) / 2
        return {
            minX: primitive.x - radius,
            minY: primitive.y - radius,
            maxX: primitive.x + radius,
            maxY: primitive.y + radius
        }
    }

    /**
     * Resolves bounds for a point list.
     * @param {{ x: number, y: number }[]} points Region points.
     * @returns {{ minX: number, minY: number, maxX: number, maxY: number }}
     */
    static #pointsBounds(points) {
        return {
            minX: Math.min(...points.map((point) => point.x)),
            minY: Math.min(...points.map((point) => point.y)),
            maxX: Math.max(...points.map((point) => point.x)),
            maxY: Math.max(...points.map((point) => point.y))
        }
    }

    /**
     * Returns true when a point lies inside bounds.
     * @param {{ minX: number, minY: number, maxX: number, maxY: number }} bounds Item bounds.
     * @param {number} x Point X.
     * @param {number} y Point Y.
     * @param {number} tolerance Hit tolerance.
     * @returns {boolean}
     */
    static #contains(bounds, x, y, tolerance) {
        return (
            x >= bounds.minX - tolerance &&
            x <= bounds.maxX + tolerance &&
            y >= bounds.minY - tolerance &&
            y <= bounds.maxY + tolerance
        )
    }
}
