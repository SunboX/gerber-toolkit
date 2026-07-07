/**
 * Renders SVG masks for clear-polarity Gerber primitives.
 */
export class GerberPcbSvgClearMaskRenderer {
    /**
     * Renders one clear-polarity mask.
     * @param {{ maskId: string, clearPrimitives: object[], layer: object, renderContext: object, bounds: { minX: number, minY: number, width: number, height: number }, renderPrimitive: Function }} options Render options.
     * @returns {string}
     */
    static render(options) {
        const {
            maskId,
            clearPrimitives,
            layer,
            renderContext,
            bounds,
            renderPrimitive
        } = options

        return (
            '<mask id="' +
            GerberPcbSvgClearMaskRenderer.#escape(maskId) +
            '" maskUnits="userSpaceOnUse" x="' +
            bounds.minX +
            '" y="' +
            bounds.minY +
            '" width="' +
            bounds.width +
            '" height="' +
            bounds.height +
            '">' +
            '<rect x="' +
            bounds.minX +
            '" y="' +
            bounds.minY +
            '" width="' +
            bounds.width +
            '" height="' +
            bounds.height +
            '" fill="white" />' +
            '<g class="gerber-clear-mask">' +
            clearPrimitives
                .map((primitive) =>
                    renderPrimitive(primitive, layer, renderContext)
                )
                .join('') +
            '</g>' +
            '</mask>'
        )
    }

    /**
     * Escapes text for HTML attributes.
     * @param {string} text Source text.
     * @returns {string}
     */
    static #escape(text) {
        return String(text || '')
            .replace(/&/gu, '&amp;')
            .replace(/"/gu, '&quot;')
            .replace(/</gu, '&lt;')
            .replace(/>/gu, '&gt;')
    }
}
