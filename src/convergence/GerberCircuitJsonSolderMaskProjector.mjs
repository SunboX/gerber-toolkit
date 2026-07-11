import polygonClipping from 'polygon-clipping'

import { GerberCircuitJsonCopperImageProjector } from './GerberCircuitJsonCopperImageProjector.mjs'

/** Splits canonical copper into mask-covered and exposed BREP geometry. */
export class GerberCircuitJsonSolderMaskProjector {
    /**
     * Projects source copper against same-side composed mask openings.
     * @param {Record<string, any>[]} copper Native copper primitives.
     * @param {number[][][][]} openings Composed solder-mask openings.
     * @param {string} layer Canonical copper layer.
     * @param {number} layerIndex Stable layer index.
     * @param {(primitive: Record<string, any>, id: string) => Record<string, any>[]} projectPrimitive Canonical primitive projector.
     * @returns {Record<string, any>[]} Covered/exposed copper rows.
     */
    static project(copper, openings, layer, layerIndex, projectPrimitive) {
        const composed =
            GerberCircuitJsonCopperImageProjector.requiresComposition(copper)
        const entries = composed
            ? [{ image: GerberCircuitJsonCopperImageProjector.compose(copper) }]
            : copper.map((primitive) => ({
                  primitive,
                  image: GerberCircuitJsonCopperImageProjector.primitiveGeometry(
                      primitive
                  )
              }))
        const rows = []
        for (let index = 0; index < entries.length; index += 1) {
            const { image, primitive } = entries[index]
            if (!image.length) continue
            const exposed = openings.length
                ? polygonClipping.intersection(image, openings)
                : []
            const covered = openings.length
                ? polygonClipping.difference(image, openings)
                : image
            if (!composed && (!exposed.length || !covered.length)) {
                const canonical = projectPrimitive(
                    primitive,
                    `${layerIndex}_${index}`
                )
                if (canonical.length) {
                    const coveredWithMask = !exposed.length
                    rows.push(
                        ...canonical.map((row) =>
                            row.type === 'pcb_smtpad'
                                ? {
                                      ...row,
                                      is_covered_with_solder_mask:
                                          coveredWithMask
                                  }
                                : row
                        )
                    )
                    continue
                }
            }
            rows.push(
                ...GerberCircuitJsonCopperImageProjector.rows(
                    covered,
                    layer,
                    `gerber_masked_${layerIndex}_${index}`,
                    true
                ),
                ...GerberCircuitJsonCopperImageProjector.rows(
                    exposed,
                    layer,
                    `gerber_open_${layerIndex}_${index}`,
                    false
                )
            )
        }
        return rows
    }

    /**
     * Splits an already composed physical copper image by mask openings.
     * @param {number[][][][]} image Physical copper image.
     * @param {number[][][][]} openings Physical mask openings.
     * @param {string} layer Canonical copper layer.
     * @param {number} layerIndex Stable layer index.
     * @returns {Record<string, any>[]} Covered/exposed BREP rows.
     */
    static projectImage(image, openings, layer, layerIndex) {
        if (!image.length) return []
        const exposed = openings.length
            ? polygonClipping.intersection(image, openings)
            : []
        const covered = openings.length
            ? polygonClipping.difference(image, openings)
            : image
        return [
            ...GerberCircuitJsonCopperImageProjector.rows(
                covered,
                layer,
                `gerber_masked_${layerIndex}`,
                true
            ),
            ...GerberCircuitJsonCopperImageProjector.rows(
                exposed,
                layer,
                `gerber_open_${layerIndex}`,
                false
            )
        ]
    }
}

Object.freeze(GerberCircuitJsonSolderMaskProjector.prototype)
Object.freeze(GerberCircuitJsonSolderMaskProjector)
