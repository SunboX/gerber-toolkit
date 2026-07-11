import { GerberCircuitJsonCopperImageProjector } from './GerberCircuitJsonCopperImageProjector.mjs'

/** Projects ordered non-copper artwork after applying dark/clear composition. */
export class GerberCircuitJsonArtworkImageProjector {
    /**
     * Returns whether primitive-by-primitive canonical mapping loses fidelity.
     * @param {Record<string, any>[]} primitives Native primitives.
     * @returns {boolean} Whether ordered image projection is required.
     */
    static requiresComposition(primitives) {
        return primitives.some(
            (primitive) =>
                primitive?.polarity === 'clear' ||
                ['block', 'macro', 'polygon'].includes(primitive?.shape)
        )
    }

    /**
     * Emits composed X2 Legend artwork as silkscreen BREP graphics.
     * @param {Record<string, any>[]} primitives Native primitives.
     * @param {'top' | 'bottom'} layer Board side.
     * @param {number} layerIndex Stable layer index.
     * @param {string} [pcbComponentId] Common component owner.
     * @returns {Record<string, any>[]} Silkscreen rows.
     */
    static silkscreen(primitives, layer, layerIndex, pcbComponentId = '') {
        return GerberCircuitJsonArtworkImageProjector.silkscreenImage(
            GerberCircuitJsonCopperImageProjector.compose(primitives),
            layer,
            layerIndex,
            pcbComponentId
        )
    }

    /**
     * Emits an interpreted physical image as silkscreen BREP graphics.
     * @param {number[][][][]} image Physical MultiPolygon image.
     * @param {'top' | 'bottom'} layer Board side.
     * @param {number} layerIndex Stable layer index.
     * @param {string} [pcbComponentId] Common component owner.
     * @returns {Record<string, any>[]} Silkscreen rows.
     */
    static silkscreenImage(image, layer, layerIndex, pcbComponentId = '') {
        return GerberCircuitJsonArtworkImageProjector.#polygons(image).map(
            (polygon, index) => ({
                type: 'pcb_silkscreen_graphic',
                pcb_silkscreen_graphic_id: `gerber_silkscreen_image_${layerIndex}_${index}`,
                pcb_component_id: pcbComponentId,
                shape: 'brep',
                brep_shape: {
                    outer_ring: { vertices: polygon[0] },
                    inner_rings: polygon
                        .slice(1)
                        .map((vertices) => ({ vertices }))
                },
                layer
            })
        )
    }

    /**
     * Emits composed unsupported artwork as neutral final-image boundaries.
     * @param {Record<string, any>[]} primitives Native primitives.
     * @param {'top' | 'bottom'} layer Board side.
     * @param {number} layerIndex Stable layer index.
     * @param {string} semantic Source semantic.
     * @returns {Record<string, any>[]} Note paths.
     */
    static notes(primitives, layer, layerIndex, semantic) {
        return GerberCircuitJsonArtworkImageProjector.notesImage(
            GerberCircuitJsonCopperImageProjector.compose(primitives),
            layer,
            layerIndex,
            semantic
        )
    }

    /**
     * Emits an interpreted physical image as neutral boundary paths.
     * @param {number[][][][]} image Physical MultiPolygon image.
     * @param {'top' | 'bottom'} layer Board side.
     * @param {number} layerIndex Stable layer index.
     * @param {string} semantic Source semantic.
     * @returns {Record<string, any>[]} Note paths.
     */
    static notesImage(image, layer, layerIndex, semantic) {
        const rows = []
        const polygons = GerberCircuitJsonArtworkImageProjector.#polygons(image)
        for (
            let polygonIndex = 0;
            polygonIndex < polygons.length;
            polygonIndex += 1
        ) {
            for (
                let ringIndex = 0;
                ringIndex < polygons[polygonIndex].length;
                ringIndex += 1
            ) {
                const ring = polygons[polygonIndex][ringIndex]
                rows.push({
                    type: 'pcb_note_path',
                    pcb_note_path_id: `gerber_${semantic}_image_${layerIndex}_${polygonIndex}_${ringIndex}`,
                    route: [...ring, { ...ring[0] }],
                    stroke_width: 0.000001,
                    layer,
                    name: `Gerber ${semantic} artwork`
                })
            }
        }
        return rows
    }

    /**
     * Converts composed clipping polygons to open CircuitJSON point rings.
     * @param {number[][][][]} image Composed MultiPolygon image.
     * @returns {{ x: number, y: number }[][][]} Polygon rings.
     */
    static #polygons(image) {
        return image
            .map((polygon) =>
                polygon
                    .map((ring) => {
                        const points = ring.map(([x, y]) => ({ x, y }))
                        if (
                            points.length > 1 &&
                            points[0].x === points.at(-1).x &&
                            points[0].y === points.at(-1).y
                        ) {
                            points.pop()
                        }
                        return points
                    })
                    .filter((ring) => ring.length >= 3)
            )
            .filter((polygon) => polygon.length)
    }
}

Object.freeze(GerberCircuitJsonArtworkImageProjector.prototype)
Object.freeze(GerberCircuitJsonArtworkImageProjector)
