/**
 * Exposes Gerber source layers to ECAD Forge layer controls.
 */
export class PcbInteractionLayerModel {
    /**
     * Resolves physical and virtual interaction layers.
     * @param {object} documentModel Normalized Gerber document.
     * @returns {{ physicalLayers: object[], virtualLayers: object[] }}
     */
    static resolve(documentModel) {
        const layers = Array.isArray(documentModel?.pcb?.fabrication?.layers)
            ? documentModel.pcb.fabrication.layers
            : []

        return {
            physicalLayers: layers.map((layer) =>
                PcbInteractionLayerModel.#physicalLayer(layer)
            ),
            virtualLayers: [
                {
                    id: 'gerber-composite',
                    name: 'Composite',
                    type: 'mode',
                    sourceFormat: 'gerber'
                }
            ]
        }
    }

    /**
     * Builds one physical layer descriptor.
     * @param {object} layer Source layer.
     * @returns {object}
     */
    static #physicalLayer(layer) {
        return {
            id: layer.id,
            name: layer.fileName,
            role: layer.role,
            side: layer.side,
            sourceFormat: 'gerber',
            documentation: Boolean(layer.isDocumentation)
        }
    }
}
