import { GerberBoardFillPathRenderer } from './GerberBoardFillPathRenderer.mjs'
import { GerberPcbLayerViewModel } from './GerberPcbLayerViewModel.mjs'
import { GerberPcbSvgBounds } from './GerberPcbSvgBounds.mjs'
import { GerberPcbSvgStyles } from './GerberPcbSvgStyles.mjs'
import { GerberSvgArcFlags } from './GerberSvgArcFlags.mjs'

/**
 * Renders Gerber fabrication documents to deterministic SVG.
 */
export class GerberPcbSvgRenderer {
    /**
     * Renders one Gerber PCB document.
     * @param {object} documentModel Normalized Gerber document.
     * @param {{ renderMode?: 'composite' | 'separated', layerId?: string, layerIds?: string[], side?: 'top' | 'bottom' }} [options] Render options.
     * @returns {string}
     */
    static render(documentModel, options = {}) {
        const side = GerberPcbLayerViewModel.normalizeSide(options.side)
        const sourceLayers = GerberPcbSvgRenderer.#sourceLayers(documentModel)
        const renderMode =
            options.renderMode ||
            documentModel?.pcb?.fabrication?.renderMode ||
            'composite'
        const layers = GerberPcbSvgRenderer.#renderLayers(
            sourceLayers,
            { ...options, renderMode },
            side
        )
        const bounds = GerberPcbSvgBounds.resolve(documentModel, layers)
        const renderContext = GerberPcbLayerViewModel.renderContext(
            layers,
            sourceLayers
        )

        return (
            '<svg xmlns="http://www.w3.org/2000/svg" class="pcb-svg gerber-pcb-renderer" ' +
            'data-source-format="gerber" data-render-mode="' +
            GerberPcbSvgRenderer.#escape(renderMode) +
            '" data-render-side="' +
            GerberPcbSvgRenderer.#escape(side) +
            '" viewBox="' +
            [bounds.minX, bounds.minY, bounds.width, bounds.height].join(' ') +
            '">' +
            '<style>' +
            GerberPcbSvgStyles.render() +
            '</style>' +
            '<rect class="gerber-board-background" x="' +
            bounds.minX +
            '" y="' +
            bounds.minY +
            '" width="' +
            bounds.width +
            '" height="' +
            bounds.height +
            '" fill="none' +
            '" />' +
            '<g class="gerber-coordinate-space" transform="' +
            GerberPcbLayerViewModel.coordinateTransform(bounds, side) +
            '">' +
            GerberBoardFillPathRenderer.render(layers) +
            layers
                .map((layer) =>
                    GerberPcbSvgRenderer.#renderLayer(
                        layer,
                        side,
                        renderContext,
                        bounds
                    )
                )
                .join('') +
            '</g>' +
            '</svg>'
        )
    }

    /**
     * Returns the source layers that should be rendered.
     * @param {object[]} allLayers All source fabrication layers.
     * @param {{ renderMode?: string, layerId?: string, layerIds?: string[] }} options Render options.
     * @param {'top' | 'bottom'} side Active board side.
     * @returns {object[]}
     */
    static #renderLayers(allLayers, options, side) {
        const renderMode = options.renderMode || 'composite'

        const selectedLayerIds = GerberPcbSvgRenderer.#selectedLayerIds(options)
        if (renderMode === 'separated' && selectedLayerIds.size) {
            return allLayers.filter((layer) =>
                selectedLayerIds.has(String(layer?.id || ''))
            )
        }

        return [...allLayers]
            .filter((layer) =>
                GerberPcbLayerViewModel.isCompositeLayerVisible(layer, side)
            )
            .sort((a, b) => {
                return (
                    GerberPcbLayerViewModel.roleOrder(a, side) -
                    GerberPcbLayerViewModel.roleOrder(b, side)
                )
            })
    }

    /**
     * Resolves all source fabrication layers from a document.
     * @param {object} documentModel Normalized Gerber document.
     * @returns {object[]}
     */
    static #sourceLayers(documentModel) {
        return Array.isArray(documentModel?.pcb?.fabrication?.layers)
            ? documentModel.pcb.fabrication.layers
            : []
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
     * Renders one source layer.
     * @param {object} layer Source layer.
     * @param {'top' | 'bottom'} side Active board side.
     * @param {{ smallPlatedDrillCenters?: Set<string> }} renderContext Render context.
     * @param {{ minX: number, minY: number, width: number, height: number }} bounds Render bounds.
     * @returns {string}
     */
    static #renderLayer(layer, side, renderContext, bounds) {
        const className =
            'gerber-layer gerber-role-' +
            GerberPcbSvgRenderer.#classToken(layer.role) +
            GerberPcbLayerViewModel.layerAppClasses(layer, side)
        const primitiveContent = GerberPcbSvgRenderer.#renderLayerPrimitives(
            layer,
            renderContext,
            bounds
        )
        const drillContent = (layer.drills || [])
            .map((drill) => GerberPcbSvgRenderer.#renderDrill(drill, layer))
            .join('')

        return (
            '<g class="' +
            className +
            '" data-layer-id="' +
            GerberPcbSvgRenderer.#escape(layer.id) +
            '" data-file-name="' +
            GerberPcbSvgRenderer.#escape(layer.fileName) +
            '">' +
            primitiveContent +
            drillContent +
            '</g>'
        )
    }

    /**
     * Renders source primitives with Gerber dark/clear polarity composition.
     * @param {object} layer Source layer.
     * @param {{ smallPlatedDrillCenters?: Set<string> }} renderContext Render context.
     * @param {{ minX: number, minY: number, width: number, height: number }} bounds Render bounds.
     * @returns {string}
     */
    static #renderLayerPrimitives(layer, renderContext, bounds) {
        const primitives = Array.isArray(layer?.primitives)
            ? layer.primitives
            : []
        const segments = GerberPcbSvgRenderer.#polaritySegments(primitives)

        return segments
            .map((segment, index) =>
                GerberPcbSvgRenderer.#renderPolaritySegment(
                    segment,
                    index,
                    layer,
                    renderContext,
                    bounds
                )
            )
            .join('')
    }

    /**
     * Groups dark primitives with the later clear primitives that erase them.
     * @param {object[]} primitives Source primitives in file order.
     * @returns {{ primitives: object[], clearPrimitives: object[] }[]}
     */
    static #polaritySegments(primitives) {
        const segments = []
        let activeSegment = null

        for (const primitive of primitives || []) {
            if (GerberPcbSvgRenderer.#isClearPrimitive(primitive)) {
                for (const segment of segments) {
                    segment.clearPrimitives.push(primitive)
                }
                activeSegment = null
                continue
            }

            if (!activeSegment) {
                activeSegment = {
                    primitives: [],
                    clearPrimitives: []
                }
                segments.push(activeSegment)
            }
            activeSegment.primitives.push(primitive)
        }

        return segments
    }

    /**
     * Renders one polarity-composed primitive segment.
     * @param {{ primitives: object[], clearPrimitives: object[] }} segment Segment model.
     * @param {number} index Segment index.
     * @param {object} layer Source layer.
     * @param {{ smallPlatedDrillCenters?: Set<string> }} renderContext Render context.
     * @param {{ minX: number, minY: number, width: number, height: number }} bounds Render bounds.
     * @returns {string}
     */
    static #renderPolaritySegment(
        segment,
        index,
        layer,
        renderContext,
        bounds
    ) {
        const content = segment.primitives
            .map((primitive) =>
                GerberPcbSvgRenderer.#renderPrimitive(
                    primitive,
                    layer,
                    renderContext
                )
            )
            .join('')
        if (!segment.clearPrimitives.length) {
            return content
        }

        const maskId = GerberPcbSvgRenderer.#clearMaskId(layer, index)
        return (
            GerberPcbSvgRenderer.#renderClearMask(
                maskId,
                segment.clearPrimitives,
                layer,
                renderContext,
                bounds
            ) +
            '<g mask="url(#' +
            maskId +
            ')">' +
            content +
            '</g>'
        )
    }

    /**
     * Renders an SVG mask that subtracts clear-polarity primitives.
     * @param {string} maskId Stable mask id.
     * @param {object[]} clearPrimitives Clear primitives.
     * @param {object} layer Source layer.
     * @param {{ smallPlatedDrillCenters?: Set<string> }} renderContext Render context.
     * @param {{ minX: number, minY: number, width: number, height: number }} bounds Render bounds.
     * @returns {string}
     */
    static #renderClearMask(
        maskId,
        clearPrimitives,
        layer,
        renderContext,
        bounds
    ) {
        return (
            '<mask id="' +
            GerberPcbSvgRenderer.#escape(maskId) +
            '" maskUnits="userSpaceOnUse">' +
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
                    GerberPcbSvgRenderer.#renderPrimitive(
                        primitive,
                        layer,
                        renderContext
                    )
                )
                .join('') +
            '</g>' +
            '</mask>'
        )
    }

    /**
     * Returns a stable mask id for one layer segment.
     * @param {object} layer Source layer.
     * @param {number} index Segment index.
     * @returns {string}
     */
    static #clearMaskId(layer, index) {
        const suffix = index > 0 ? '-' + index : ''
        return (
            'gerber-clear-mask-' +
            GerberPcbSvgRenderer.#classToken(layer?.id || layer?.fileName) +
            suffix
        )
    }

    /**
     * Returns true when a primitive subtracts from the current layer image.
     * @param {object} primitive Source primitive.
     * @returns {boolean}
     */
    static #isClearPrimitive(primitive) {
        return String(primitive?.polarity || 'dark') === 'clear'
    }

    /**
     * Renders one primitive.
     * @param {object} primitive Primitive model.
     * @param {object} layer Source layer.
     * @param {{ smallPlatedDrillCenters?: Set<string> }} renderContext Render context.
     * @returns {string}
     */
    static #renderPrimitive(primitive, layer, renderContext) {
        if (primitive.shape === 'macro') {
            return GerberPcbSvgRenderer.#renderMacroFlash(
                primitive,
                layer,
                renderContext
            )
        }

        if (primitive.shape === 'block') {
            return GerberPcbSvgRenderer.#renderBlockFlash(
                primitive,
                layer,
                renderContext
            )
        }

        if (primitive.type === 'line') {
            return (
                '<line class="' +
                GerberPcbSvgRenderer.#primitiveClass(
                    primitive,
                    'gerber-line',
                    layer,
                    renderContext
                ) +
                '"' +
                GerberPcbSvgRenderer.#primitiveAttributes(primitive) +
                ' x1="' +
                primitive.x1 +
                '" y1="' +
                primitive.y1 +
                '" x2="' +
                primitive.x2 +
                '" y2="' +
                primitive.y2 +
                '" stroke-width="' +
                primitive.width +
                '" />'
            )
        }

        if (primitive.type === 'arc') {
            return GerberPcbSvgRenderer.#renderArc(
                primitive,
                layer,
                renderContext
            )
        }

        if (primitive.type === 'region') {
            return GerberPcbSvgRenderer.#renderRegion(
                primitive,
                layer,
                renderContext
            )
        }

        if (primitive.shape === 'rect') {
            return GerberPcbSvgRenderer.#renderRectFlash(
                primitive,
                layer,
                renderContext
            )
        }

        if (primitive.shape === 'polygon') {
            return GerberPcbSvgRenderer.#renderPolygonFlash(
                primitive,
                layer,
                renderContext
            )
        }

        if (primitive.shape === 'obround') {
            return GerberPcbSvgRenderer.#renderObroundFlash(
                primitive,
                layer,
                renderContext
            )
        }

        return (
            '<circle class="' +
            GerberPcbSvgRenderer.#primitiveClass(
                primitive,
                'gerber-flash gerber-flash-circle',
                layer,
                renderContext
            ) +
            '"' +
            GerberPcbSvgRenderer.#primitiveAttributes(primitive) +
            ' cx="' +
            primitive.x +
            '" cy="' +
            primitive.y +
            '" r="' +
            primitive.diameter / 2 +
            '" />'
        )
    }

    /**
     * Renders one arc primitive.
     * @param {object} primitive Arc primitive.
     * @param {object} layer Source layer.
     * @param {{ smallPlatedDrillCenters?: Set<string> }} renderContext Render context.
     * @returns {string}
     */
    static #renderArc(primitive, layer, renderContext) {
        const arcFlags = GerberSvgArcFlags.resolve(primitive)
        return (
            '<path class="' +
            GerberPcbSvgRenderer.#primitiveClass(
                primitive,
                'gerber-arc',
                layer,
                renderContext
            ) +
            '"' +
            GerberPcbSvgRenderer.#primitiveAttributes(primitive) +
            ' d="M ' +
            primitive.x1 +
            ' ' +
            primitive.y1 +
            ' A ' +
            arcFlags.radius +
            ' ' +
            arcFlags.radius +
            ' 0 ' +
            arcFlags.largeArc +
            ' ' +
            arcFlags.sweep +
            ' ' +
            primitive.x2 +
            ' ' +
            primitive.y2 +
            '" stroke-width="' +
            primitive.width +
            '" />'
        )
    }

    /**
     * Renders a region primitive.
     * @param {object} primitive Region primitive.
     * @param {object} layer Source layer.
     * @param {{ smallPlatedDrillCenters?: Set<string> }} renderContext Render context.
     * @returns {string}
     */
    static #renderRegion(primitive, layer, renderContext) {
        const points = (primitive.points || [])
            .map((point) => point.x + ',' + point.y)
            .join(' ')
        return (
            '<polygon class="' +
            GerberPcbSvgRenderer.#primitiveClass(
                primitive,
                'gerber-region',
                layer,
                renderContext
            ) +
            '"' +
            GerberPcbSvgRenderer.#primitiveAttributes(primitive) +
            ' points="' +
            points +
            '" />'
        )
    }

    /**
     * Renders a rectangular flash.
     * @param {object} primitive Flash primitive.
     * @param {object} layer Source layer.
     * @param {{ smallPlatedDrillCenters?: Set<string> }} renderContext Render context.
     * @returns {string}
     */
    static #renderRectFlash(primitive, layer, renderContext) {
        return (
            '<rect class="' +
            GerberPcbSvgRenderer.#primitiveClass(
                primitive,
                'gerber-flash gerber-flash-rect',
                layer,
                renderContext
            ) +
            '"' +
            GerberPcbSvgRenderer.#primitiveAttributes(primitive) +
            GerberPcbSvgRenderer.#transformAttribute(primitive, true) +
            ' x="' +
            (primitive.x - primitive.width / 2) +
            '" y="' +
            (primitive.y - primitive.height / 2) +
            '" width="' +
            primitive.width +
            '" height="' +
            primitive.height +
            '" />'
        )
    }

    /**
     * Renders a polygon flash.
     * @param {object} primitive Flash primitive.
     * @param {object} layer Source layer.
     * @param {{ smallPlatedDrillCenters?: Set<string> }} renderContext Render context.
     * @returns {string}
     */
    static #renderPolygonFlash(primitive, layer, renderContext) {
        const radius = primitive.diameter / 2
        const points = []
        for (let index = 0; index < primitive.vertices; index += 1) {
            const angle =
                (Math.PI * 2 * index) / primitive.vertices +
                ((primitive.rotation || 0) * Math.PI) / 180
            points.push(
                GerberPcbSvgRenderer.#round(
                    primitive.x + Math.cos(angle) * radius
                ) +
                    ',' +
                    GerberPcbSvgRenderer.#round(
                        primitive.y + Math.sin(angle) * radius
                    )
            )
        }
        return (
            '<polygon class="' +
            GerberPcbSvgRenderer.#primitiveClass(
                primitive,
                'gerber-flash gerber-flash-polygon',
                layer,
                renderContext
            ) +
            '"' +
            GerberPcbSvgRenderer.#primitiveAttributes(primitive) +
            GerberPcbSvgRenderer.#transformAttribute(primitive, true) +
            ' points="' +
            points.join(' ') +
            '" />'
        )
    }

    /**
     * Renders an obround flash.
     * @param {object} primitive Flash primitive.
     * @param {object} layer Source layer.
     * @param {{ smallPlatedDrillCenters?: Set<string> }} renderContext Render context.
     * @returns {string}
     */
    static #renderObroundFlash(primitive, layer, renderContext) {
        const radius = Math.min(primitive.width, primitive.height) / 2
        return (
            '<rect class="' +
            GerberPcbSvgRenderer.#primitiveClass(
                primitive,
                'gerber-flash gerber-flash-obround',
                layer,
                renderContext
            ) +
            '"' +
            GerberPcbSvgRenderer.#primitiveAttributes(primitive) +
            GerberPcbSvgRenderer.#transformAttribute(primitive, true) +
            ' x="' +
            (primitive.x - primitive.width / 2) +
            '" y="' +
            (primitive.y - primitive.height / 2) +
            '" width="' +
            primitive.width +
            '" height="' +
            primitive.height +
            '" rx="' +
            radius +
            '" ry="' +
            radius +
            '" />'
        )
    }

    /**
     * Renders an aperture macro flash.
     * @param {object} primitive Macro flash primitive.
     * @param {object} layer Source layer.
     * @param {{ smallPlatedDrillCenters?: Set<string> }} renderContext Render context.
     * @returns {string}
     */
    static #renderMacroFlash(primitive, layer, renderContext) {
        const content = (primitive.primitives || [])
            .map((child) => GerberPcbSvgRenderer.#renderMacroPrimitive(child))
            .join('')
        return (
            '<g class="' +
            GerberPcbSvgRenderer.#primitiveClass(
                primitive,
                'gerber-flash gerber-flash-macro',
                layer,
                renderContext
            ) +
            '" data-macro-name="' +
            GerberPcbSvgRenderer.#escape(primitive.name || '') +
            '"' +
            GerberPcbSvgRenderer.#primitiveAttributes(primitive) +
            GerberPcbSvgRenderer.#transformAttribute(primitive) +
            '>' +
            content +
            '</g>'
        )
    }

    /**
     * Renders an aperture block flash.
     * @param {object} primitive Block flash primitive.
     * @param {object} layer Source layer.
     * @param {{ smallPlatedDrillCenters?: Set<string> }} renderContext Render context.
     * @returns {string}
     */
    static #renderBlockFlash(primitive, layer, renderContext) {
        const content = (primitive.primitives || [])
            .map((child) =>
                GerberPcbSvgRenderer.#renderPrimitive(
                    child,
                    layer,
                    renderContext
                )
            )
            .join('')
        return (
            '<g class="' +
            GerberPcbSvgRenderer.#primitiveClass(
                primitive,
                'gerber-flash gerber-flash-block',
                layer,
                renderContext
            ) +
            '"' +
            GerberPcbSvgRenderer.#primitiveAttributes(primitive) +
            '>' +
            content +
            '</g>'
        )
    }

    /**
     * Renders one macro child primitive.
     * @param {object} primitive Macro child primitive.
     * @returns {string}
     */
    static #renderMacroPrimitive(primitive) {
        const className =
            'gerber-macro-primitive gerber-macro-' +
            GerberPcbSvgRenderer.#classToken(primitive.type) +
            ' gerber-exposure-' +
            GerberPcbSvgRenderer.#classToken(primitive.exposure || 'dark')
        const exposure =
            ' data-exposure="' +
            GerberPcbSvgRenderer.#escape(primitive.exposure || 'dark') +
            '"'

        if (primitive.type === 'line') {
            return (
                '<line class="' +
                className +
                '"' +
                exposure +
                GerberPcbSvgRenderer.#macroRotationAttribute(primitive) +
                ' x1="' +
                primitive.x1 +
                '" y1="' +
                primitive.y1 +
                '" x2="' +
                primitive.x2 +
                '" y2="' +
                primitive.y2 +
                '" stroke-width="' +
                primitive.width +
                '" />'
            )
        }

        if (primitive.type === 'rect') {
            return GerberPcbSvgRenderer.#renderMacroRect(
                primitive,
                className,
                exposure
            )
        }

        if (primitive.type === 'polygon') {
            return GerberPcbSvgRenderer.#renderMacroPolygon(
                primitive,
                className,
                exposure
            )
        }

        if (primitive.type === 'region') {
            const points = (primitive.points || [])
                .map((point) => point.x + ',' + point.y)
                .join(' ')
            return (
                '<polygon class="' +
                className +
                '"' +
                exposure +
                GerberPcbSvgRenderer.#macroRotationAttribute(primitive) +
                ' points="' +
                points +
                '" />'
            )
        }

        if (primitive.type === 'thermal' || primitive.type === 'moire') {
            return (
                '<circle class="' +
                className +
                '"' +
                exposure +
                GerberPcbSvgRenderer.#macroRotationAttribute(primitive) +
                ' cx="' +
                primitive.x +
                '" cy="' +
                primitive.y +
                '" r="' +
                Number(primitive.outerDiameter || 0) / 2 +
                '" />'
            )
        }

        return (
            '<circle class="' +
            className +
            '"' +
            exposure +
            ' cx="' +
            primitive.x +
            '" cy="' +
            primitive.y +
            '" r="' +
            primitive.diameter / 2 +
            '" />'
        )
    }

    /**
     * Renders a rectangular macro child.
     * @param {object} primitive Macro child primitive.
     * @param {string} className Class attribute value.
     * @param {string} exposure Exposure attributes.
     * @returns {string}
     */
    static #renderMacroRect(primitive, className, exposure) {
        return (
            '<rect class="' +
            className +
            '"' +
            exposure +
            GerberPcbSvgRenderer.#macroRotationAttribute(primitive, true) +
            ' x="' +
            (primitive.x - primitive.width / 2) +
            '" y="' +
            (primitive.y - primitive.height / 2) +
            '" width="' +
            primitive.width +
            '" height="' +
            primitive.height +
            '" />'
        )
    }

    /**
     * Renders a polygonal macro child.
     * @param {object} primitive Macro child primitive.
     * @param {string} className Class attribute value.
     * @param {string} exposure Exposure attributes.
     * @returns {string}
     */
    static #renderMacroPolygon(primitive, className, exposure) {
        const radius = primitive.diameter / 2
        const points = []
        for (let index = 0; index < primitive.vertices; index += 1) {
            const angle =
                (Math.PI * 2 * index) / primitive.vertices +
                ((primitive.rotation || 0) * Math.PI) / 180
            points.push(
                GerberPcbSvgRenderer.#round(
                    primitive.x + Math.cos(angle) * radius
                ) +
                    ',' +
                    GerberPcbSvgRenderer.#round(
                        primitive.y + Math.sin(angle) * radius
                    )
            )
        }
        return (
            '<polygon class="' +
            className +
            '"' +
            exposure +
            ' points="' +
            points.join(' ') +
            '" />'
        )
    }

    /**
     * Renders one drill hit.
     * @param {object} drill Drill hit.
     * @param {object} layer Source layer.
     * @returns {string}
     */
    static #renderDrill(drill, layer) {
        const className =
            (drill.plated
                ? 'gerber-drill gerber-drill-plated'
                : 'gerber-drill gerber-drill-nonplated') +
            ' pcb-via-drill pcb-pad-drill'
        if (drill.type === 'slot') {
            return (
                '<line class="' +
                className +
                ' gerber-slot" data-layer-id="' +
                GerberPcbSvgRenderer.#escape(layer.id) +
                '" x1="' +
                drill.x1 +
                '" y1="' +
                drill.y1 +
                '" x2="' +
                drill.x2 +
                '" y2="' +
                drill.y2 +
                '" stroke-width="' +
                drill.diameter +
                '" />'
            )
        }
        return (
            '<circle class="' +
            className +
            '" data-layer-id="' +
            GerberPcbSvgRenderer.#escape(layer.id) +
            '" cx="' +
            drill.x +
            '" cy="' +
            drill.y +
            '" r="' +
            drill.diameter / 2 +
            '" />'
        )
    }

    /**
     * Builds a primitive class list with polarity.
     * @param {object} primitive Primitive model.
     * @param {string} extra Extra class names.
     * @param {object} layer Source layer.
     * @param {{ smallPlatedDrillCenters?: Set<string> }} renderContext Render context.
     * @returns {string}
     */
    static #primitiveClass(primitive, extra, layer, renderContext) {
        const polarity = primitive.polarity || 'dark'
        return (
            'gerber-primitive ' +
            extra +
            GerberPcbLayerViewModel.primitiveAppClasses(
                primitive,
                layer,
                renderContext
            ) +
            ' gerber-polarity-' +
            GerberPcbSvgRenderer.#classToken(polarity)
        )
    }

    /**
     * Builds data attributes shared by primitives.
     * @param {object} primitive Primitive model.
     * @returns {string}
     */
    static #primitiveAttributes(primitive) {
        const polarity = primitive.polarity || 'dark'
        return ' data-polarity="' + GerberPcbSvgRenderer.#escape(polarity) + '"'
    }

    /**
     * Builds an SVG rotation attribute for a macro child primitive.
     * @param {object} primitive Macro child primitive.
     * @param {boolean} [centered] Whether the rotation pivots on primitive x/y.
     * @returns {string}
     */
    static #macroRotationAttribute(primitive, centered = false) {
        const rotation = GerberPcbSvgRenderer.#round(primitive.rotation || 0)
        if (!rotation) return ''

        if (!centered) {
            return ' transform="rotate(' + rotation + ')"'
        }

        return (
            ' transform="rotate(' +
            rotation +
            ' ' +
            GerberPcbSvgRenderer.#round(primitive.x || 0) +
            ' ' +
            GerberPcbSvgRenderer.#round(primitive.y || 0) +
            ')"'
        )
    }

    /**
     * Builds an SVG transform attribute from aperture transform metadata.
     * @param {object} primitive Primitive model.
     * @param {boolean} [centered] Whether the transform should pivot on x/y.
     * @returns {string}
     */
    static #transformAttribute(primitive, centered = false) {
        const transform = primitive.transform || {}
        const scale = Number(transform.scale || 1)
        const mirror = transform.mirror || 'none'
        const rotation = Number(transform.rotation || 0)
        const scaleX = (mirror === 'x' || mirror === 'xy' ? -1 : 1) * scale
        const scaleY = (mirror === 'y' || mirror === 'xy' ? -1 : 1) * scale
        const parts = []

        if (!centered && (primitive.x || primitive.y)) {
            parts.push('translate(' + primitive.x + ' ' + primitive.y + ')')
        }

        if (rotation) {
            parts.push(
                centered
                    ? 'rotate(' +
                          rotation +
                          ' ' +
                          primitive.x +
                          ' ' +
                          primitive.y +
                          ')'
                    : 'rotate(' + rotation + ')'
            )
        }

        if (scaleX !== 1 || scaleY !== 1) {
            parts.push('scale(' + scaleX + ' ' + scaleY + ')')
        }

        return parts.length ? ' transform="' + parts.join(' ') + '"' : ''
    }

    /**
     * Converts text into a class-name token.
     * @param {string} text Source text.
     * @returns {string}
     */
    static #classToken(text) {
        return String(text || 'layer')
            .toLowerCase()
            .replace(/[^a-z0-9]+/gu, '-')
            .replace(/^-|-$/gu, '')
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

    /**
     * Rounds an SVG coordinate.
     * @param {number} value Coordinate value.
     * @returns {number}
     */
    static #round(value) {
        return Number(Number(value || 0).toFixed(6))
    }
}
