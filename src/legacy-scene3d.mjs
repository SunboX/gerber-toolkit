import { GerberScene3dLayerClassifier } from './scene3d/GerberScene3dLayerClassifier.mjs'
import { GerberScene3dCoordinateMapper } from './scene3d/GerberScene3dCoordinateMapper.mjs'
import { GerberScene3dArcGeometry } from './scene3d/GerberScene3dArcGeometry.mjs'
import { GerberScene3dSilkscreenCutoutBuilder } from './scene3d/GerberScene3dSilkscreenCutoutBuilder.mjs'
import { GerberScene3dDrillGeometryBuilder } from './scene3d/GerberScene3dDrillGeometryBuilder.mjs'
import { GerberScene3dMaskOpeningBuilder } from './scene3d/GerberScene3dMaskOpeningBuilder.mjs'
import { GerberScene3dOutlineContourResolver } from './scene3d/GerberScene3dOutlineContourResolver.mjs'
import { GerberScene3dFlashGeometry } from './scene3d/GerberScene3dFlashGeometry.mjs'
import { GerberScene3dRegionCutoutResolver } from './scene3d/GerberScene3dRegionCutoutResolver.mjs'
export { PcbScene3dModelRegistry } from './scene3d/PcbScene3dModelRegistry.mjs'

const MILS_PER_MM = 1000 / 25.4
const DEFAULT_BOARD_THICKNESS_MIL = 63
const PAD_SHAPE_CIRCLE = 1
const PAD_SHAPE_RECT = 2
const PAD_HOLE_SHAPE_SLOT = 2
const DRILL_KEY_PRECISION = 4

/**
 * Builds data-only 3D scene descriptions for Gerber fabrication documents.
 */
export class PcbScene3dBuilder {
    /**
     * Builds a deterministic bare-board scene description.
     * @param {object} documentModel Normalized Gerber PCB document.
     * @param {{ boardThicknessMil?: number }} [options] Scene build options.
     * @returns {object}
     */
    static build(documentModel, options = {}) {
        const layers = PcbScene3dBuilder.#fabricationLayers(documentModel)
        const outline = GerberScene3dOutlineContourResolver.resolve(layers)
        const bounds =
            outline.bounds ||
            PcbScene3dBuilder.#resolveBounds(documentModel, layers)
        const board = PcbScene3dBuilder.#buildBoard(
            bounds,
            outline.segments,
            outline.cutouts,
            Number(options.boardThicknessMil || DEFAULT_BOARD_THICKNESS_MIL)
        )
        const detail = PcbScene3dBuilder.#buildDetail(layers, board)

        return {
            sourceFormat: 'gerber',
            coordinateSystem: 'gerber-3d-y-up',
            board,
            layers: GerberScene3dLayerClassifier.buildLayerSummary(layers),
            components: [],
            pads: detail.pads,
            tracks: detail.tracks,
            vias: detail.vias,
            zones: detail.polygons,
            texts: [],
            externalPlacements: [],
            boardAssemblyModel: null,
            detail,
            externalModels: []
        }
    }

    /**
     * Resolves source fabrication layers from a document.
     * @param {object} documentModel Normalized Gerber PCB document.
     * @returns {object[]}
     */
    static #fabricationLayers(documentModel) {
        return Array.isArray(documentModel?.pcb?.fabrication?.layers)
            ? documentModel.pcb.fabrication.layers
            : []
    }

    /**
     * Builds board metadata in viewer scene units.
     * @param {{ minX: number, minY: number, maxX: number, maxY: number }} bounds Board bounds in mm.
     * @param {object[]} outlineSegments Board outline source segments.
     * @param {{ x: number, y: number }[][]} outlineCutouts Board cutout source contours.
     * @param {number} thicknessMil Board thickness in mils.
     * @returns {object}
     */
    static #buildBoard(bounds, outlineSegments, outlineCutouts, thicknessMil) {
        const minX = PcbScene3dBuilder.#mmToMil(bounds.minX)
        const minY = PcbScene3dBuilder.#mmToMil(bounds.minY)
        const maxX = PcbScene3dBuilder.#mmToMil(bounds.maxX)
        const maxY = PcbScene3dBuilder.#mmToMil(bounds.maxY)
        const widthMil = Math.max(maxX - minX, 1)
        const heightMil = Math.max(maxY - minY, 1)

        const board = {
            widthMil: PcbScene3dBuilder.#roundMil(widthMil),
            heightMil: PcbScene3dBuilder.#roundMil(heightMil),
            thicknessMil: Number.isFinite(thicknessMil)
                ? thicknessMil
                : DEFAULT_BOARD_THICKNESS_MIL,
            minX: PcbScene3dBuilder.#roundMil(minX),
            minY: PcbScene3dBuilder.#roundMil(minY),
            centerX: PcbScene3dBuilder.#roundMil(minX + widthMil / 2),
            centerY: PcbScene3dBuilder.#roundMil(minY + heightMil / 2),
            segments: [],
            cutouts: []
        }

        board.segments = PcbScene3dBuilder.#mapBoardSegments(
            outlineSegments,
            board
        )
        board.cutouts = PcbScene3dBuilder.#mapBoardCutouts(
            outlineCutouts,
            board
        )
        return board
    }

    /**
     * Resolves board bounds from outline layers or document fallback bounds.
     * @param {object} documentModel Normalized Gerber PCB document.
     * @param {object[]} layers Fabrication layers.
     * @returns {{ minX: number, minY: number, maxX: number, maxY: number }}
     */
    static #resolveBounds(documentModel, layers) {
        const outlineBounds = PcbScene3dBuilder.#layerBounds(
            layers.filter((layer) =>
                GerberScene3dLayerClassifier.isBoardOutline(layer)
            )
        )
        if (outlineBounds) {
            return outlineBounds
        }

        const sourceBounds = documentModel?.pcb?.bounds || {}
        return {
            minX: Number(sourceBounds.minX || 0),
            minY: Number(sourceBounds.minY || 0),
            maxX: Number(sourceBounds.maxX || sourceBounds.minX || 1),
            maxY: Number(sourceBounds.maxY || sourceBounds.minY || 1)
        }
    }

    /**
     * Resolves aggregate bounds for source layers.
     * @param {object[]} layers Fabrication layers.
     * @returns {{ minX: number, minY: number, maxX: number, maxY: number } | null}
     */
    static #layerBounds(layers) {
        return (layers || []).reduce((bounds, layer) => {
            if (!PcbScene3dBuilder.#hasLayerGeometry(layer)) {
                return bounds
            }

            const candidate = layer?.bounds
            if (!candidate) {
                return bounds
            }

            return PcbScene3dBuilder.#mergeBounds(bounds, {
                minX: Number(candidate.minX),
                minY: Number(candidate.minY),
                maxX: Number(candidate.maxX),
                maxY: Number(candidate.maxY)
            })
        }, null)
    }

    /**
     * Returns true when a layer contains geometry that can justify its bounds.
     * @param {object} layer Source layer.
     * @returns {boolean}
     */
    static #hasLayerGeometry(layer) {
        return Boolean(
            (Array.isArray(layer?.primitives) && layer.primitives.length) ||
            (Array.isArray(layer?.drills) && layer.drills.length)
        )
    }

    /**
     * Merges two bounds objects.
     * @param {object | null} bounds Existing bounds.
     * @param {object} candidate Candidate bounds.
     * @returns {object | null}
     */
    static #mergeBounds(bounds, candidate) {
        if (
            !Number.isFinite(candidate.minX) ||
            !Number.isFinite(candidate.minY) ||
            !Number.isFinite(candidate.maxX) ||
            !Number.isFinite(candidate.maxY)
        ) {
            return bounds
        }

        if (!bounds) {
            return { ...candidate }
        }

        return {
            minX: Math.min(bounds.minX, candidate.minX),
            minY: Math.min(bounds.minY, candidate.minY),
            maxX: Math.max(bounds.maxX, candidate.maxX),
            maxY: Math.max(bounds.maxY, candidate.maxY)
        }
    }

    /**
     * Maps source outline segments into scene board coordinates.
     * @param {object[]} outlineSegments Board outline source segments.
     * @param {object} board Board metadata.
     * @returns {object[]}
     */
    static #mapBoardSegments(outlineSegments, board) {
        return (outlineSegments || []).map((segment) =>
            segment?.type === 'arc'
                ? PcbScene3dBuilder.#mapOutlineArc(segment, board)
                : PcbScene3dBuilder.#mapLine(segment, board)
        )
    }

    /**
     * Maps source cutout contours into scene board coordinates.
     * @param {{ x: number, y: number }[][]} outlineCutouts Source cutouts.
     * @param {object} board Board metadata.
     * @returns {{ points: { x?: number, y?: number }[] }[]}
     */
    static #mapBoardCutouts(outlineCutouts, board) {
        return (outlineCutouts || []).map((points) => ({
            points: GerberScene3dCoordinateMapper.points(
                points.map((point) => ({
                    x: PcbScene3dBuilder.#mmToMil(point.x),
                    y: PcbScene3dBuilder.#mmToMil(point.y)
                })),
                board
            )
        }))
    }

    /**
     * Builds scene detail from fabrication layers.
     * @param {object[]} layers Fabrication layers.
     * @param {object} board Board metadata.
     * @returns {object}
     */
    static #buildDetail(layers, board) {
        const drillIndex = PcbScene3dBuilder.#buildDrillIndex(layers)
        const detail = {
            pads: [],
            tracks: [],
            arcs: [],
            fills: [],
            vias: [],
            polygons: [],
            copperTexts: [],
            silkscreen: {
                top: GerberScene3dSilkscreenCutoutBuilder.emptySide(),
                bottom: GerberScene3dSilkscreenCutoutBuilder.emptySide()
            }
        }

        for (const layer of layers || []) {
            if (GerberScene3dLayerClassifier.isCopperLayer(layer)) {
                PcbScene3dBuilder.#appendCopperLayer(
                    detail,
                    layer,
                    drillIndex,
                    board
                )
                continue
            }

            if (GerberScene3dLayerClassifier.isSilkscreenLayer(layer)) {
                PcbScene3dBuilder.#appendSilkscreenLayer(detail, layer, board)
            }
        }

        detail.pads.push(
            ...PcbScene3dBuilder.#buildUnmatchedDrillPads(drillIndex, board)
        )
        GerberScene3dDrillGeometryBuilder.apply(detail)
        GerberScene3dMaskOpeningBuilder.apply(detail, layers, board)
        GerberScene3dSilkscreenCutoutBuilder.apply(detail)
        return detail
    }

    /**
     * Appends copper primitives from one layer.
     * @param {object} detail Scene detail accumulator.
     * @param {object} layer Source layer.
     * @param {Map<string, object[]>} drillIndex Drills keyed by position.
     * @param {object} board Board metadata.
     * @returns {void}
     */
    static #appendCopperLayer(detail, layer, drillIndex, board) {
        const regionArtwork = GerberScene3dRegionCutoutResolver.createArtwork()

        for (const primitive of layer.primitives || []) {
            PcbScene3dBuilder.#appendCopperPrimitive(
                detail,
                primitive,
                layer,
                drillIndex,
                board,
                regionArtwork
            )
        }

        detail.polygons.push(
            ...GerberScene3dRegionCutoutResolver.apply(regionArtwork)
        )
    }

    /**
     * Appends one copper primitive to the matching detail collection.
     * @param {object} detail Scene detail accumulator.
     * @param {object} primitive Source primitive.
     * @param {object} layer Source layer.
     * @param {Map<string, object[]>} drillIndex Drills keyed by position.
     * @param {object} board Board metadata.
     * @param {{ polygons: object[], cutouts: { x: number, y: number }[][] } | null} [regionArtwork] Region accumulator.
     * @returns {void}
     */
    static #appendCopperPrimitive(
        detail,
        primitive,
        layer,
        drillIndex,
        board,
        regionArtwork = null
    ) {
        if (primitive?.shape === 'block') {
            for (const child of primitive.primitives || []) {
                PcbScene3dBuilder.#appendCopperPrimitive(
                    detail,
                    child,
                    layer,
                    drillIndex,
                    board,
                    regionArtwork
                )
            }
            return
        }

        if (primitive?.type === 'line') {
            detail.tracks.push(
                PcbScene3dBuilder.#mapTrack(primitive, layer, board)
            )
            return
        }

        if (primitive?.type === 'arc') {
            detail.arcs.push(
                PcbScene3dBuilder.#mapCopperArc(primitive, layer, board)
            )
            return
        }

        if (primitive?.type === 'region') {
            const region = PcbScene3dBuilder.#mapRegion(primitive, layer, board)
            if (PcbScene3dBuilder.#isClearPrimitive(primitive)) {
                GerberScene3dRegionCutoutResolver.appendClearRegion(
                    regionArtwork,
                    region.points
                )
                return
            }

            if (regionArtwork) {
                GerberScene3dRegionCutoutResolver.appendDarkRegion(
                    regionArtwork,
                    region
                )
            } else {
                detail.polygons.push(region)
            }
            return
        }

        const pad = PcbScene3dBuilder.#mapFlashPad(
            primitive,
            layer,
            drillIndex,
            board
        )
        if (pad) {
            detail.pads.push(pad)
        }
    }

    /**
     * Appends silkscreen primitives from one layer.
     * @param {object} detail Scene detail accumulator.
     * @param {object} layer Source layer.
     * @param {object} board Board metadata.
     * @returns {void}
     */
    static #appendSilkscreenLayer(detail, layer, board) {
        const side = GerberScene3dLayerClassifier.layerSide(layer)
        const targets =
            side === 'bottom'
                ? [detail.silkscreen.bottom]
                : side === 'top'
                  ? [detail.silkscreen.top]
                  : [detail.silkscreen.top, detail.silkscreen.bottom]

        for (const primitive of layer.primitives || []) {
            for (const target of targets) {
                PcbScene3dBuilder.#appendSilkscreenPrimitive(
                    target,
                    primitive,
                    board
                )
            }
        }
    }

    /**
     * Appends one silkscreen primitive to one side.
     * @param {object} sideDetail Silkscreen side accumulator.
     * @param {object} primitive Source primitive.
     * @param {object} board Board metadata.
     * @returns {void}
     */
    static #appendSilkscreenPrimitive(sideDetail, primitive, board) {
        if (primitive?.shape === 'block') {
            for (const child of primitive.primitives || []) {
                PcbScene3dBuilder.#appendSilkscreenPrimitive(
                    sideDetail,
                    child,
                    board
                )
            }
            return
        }

        if (PcbScene3dBuilder.#isClearPrimitive(primitive)) {
            PcbScene3dBuilder.#appendSilkscreenCutout(
                sideDetail,
                primitive,
                board
            )
            return
        }

        if (primitive?.type === 'line') {
            sideDetail.tracks.push(PcbScene3dBuilder.#mapLine(primitive, board))
            return
        }

        if (primitive?.type === 'arc') {
            sideDetail.arcs.push(
                PcbScene3dBuilder.#mapCopperArc(primitive, null, board)
            )
            return
        }

        if (primitive?.type === 'region') {
            sideDetail.fills.push(
                PcbScene3dBuilder.#mapRegion(primitive, null, board)
            )
        }
    }

    /**
     * Appends a clear-polarity silkscreen primitive as a surface cutout.
     * @param {object} sideDetail Silkscreen side accumulator.
     * @param {object} primitive Source primitive.
     * @param {object} board Board metadata.
     * @returns {void}
     */
    static #appendSilkscreenCutout(sideDetail, primitive, board) {
        if (primitive?.type !== 'region') {
            return
        }

        const cutout = PcbScene3dBuilder.#mapRegion(
            primitive,
            null,
            board
        ).points
        if (cutout.length >= 3) {
            sideDetail.drillCutouts.push(cutout)
        }
    }

    /**
     * Returns true when a source primitive subtracts from the layer image.
     * @param {object} primitive Source primitive.
     * @returns {boolean}
     */
    static #isClearPrimitive(primitive) {
        return String(primitive?.polarity || 'dark') === 'clear'
    }

    /**
     * Builds a drill lookup keyed by rounded source position.
     * @param {object[]} layers Fabrication layers.
     * @returns {Map<string, object[]>}
     */
    static #buildDrillIndex(layers) {
        const index = new Map()
        for (const layer of layers || []) {
            if (!GerberScene3dLayerClassifier.isDrillLayer(layer)) {
                continue
            }

            for (const drill of layer.drills || []) {
                const normalizedDrill = PcbScene3dBuilder.#normalizeDrill(drill)
                if (!normalizedDrill) {
                    continue
                }

                const key = PcbScene3dBuilder.#drillKey(
                    normalizedDrill.x,
                    normalizedDrill.y
                )
                if (!index.has(key)) {
                    index.set(key, [])
                }
                index.get(key).push(normalizedDrill)
            }
        }

        return index
    }

    /**
     * Normalizes one drill hit or slot.
     * @param {object} drill Source drill.
     * @returns {object | null}
     */
    static #normalizeDrill(drill) {
        const diameter = Number(drill?.diameter || 0)
        if (diameter <= 0) {
            return null
        }

        if (drill?.type === 'slot') {
            const x1 = Number(drill.x1)
            const y1 = Number(drill.y1)
            const x2 = Number(drill.x2)
            const y2 = Number(drill.y2)
            if (!Number.isFinite(x1 + y1 + x2 + y2)) {
                return null
            }

            return {
                x: (x1 + x2) / 2,
                y: (y1 + y2) / 2,
                diameter,
                plated: drill.plated !== false,
                slotLength: Math.hypot(x2 - x1, y2 - y1) + diameter,
                rotationDeg: (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI
            }
        }

        const x = Number(drill?.x)
        const y = Number(drill?.y)
        if (!Number.isFinite(x + y)) {
            return null
        }

        return {
            x,
            y,
            diameter,
            plated: drill.plated !== false,
            slotLength: null,
            rotationDeg: 0
        }
    }

    /**
     * Builds drill-only pads for holes not matched to copper flashes.
     * @param {Map<string, object[]>} drillIndex Drills keyed by position.
     * @param {object} board Board metadata.
     * @returns {object[]}
     */
    static #buildUnmatchedDrillPads(drillIndex, board) {
        return Array.from(drillIndex.values())
            .flat()
            .filter((drill) => !drill.matched)
            .map((drill) => PcbScene3dBuilder.#mapDrillOnlyPad(drill, board))
    }

    /**
     * Maps one line-like primitive to a scene line.
     * @param {object} primitive Source primitive.
     * @param {object} board Board metadata.
     * @returns {object}
     */
    static #mapLine(primitive, board) {
        return GerberScene3dCoordinateMapper.line(
            {
                type: 'line',
                x1: PcbScene3dBuilder.#mmToMil(primitive.x1),
                y1: PcbScene3dBuilder.#mmToMil(primitive.y1),
                x2: PcbScene3dBuilder.#mmToMil(primitive.x2),
                y2: PcbScene3dBuilder.#mmToMil(primitive.y2),
                width: PcbScene3dBuilder.#mmToMil(primitive.width || 0)
            },
            board
        )
    }

    /**
     * Maps one copper track primitive.
     * @param {object} primitive Source primitive.
     * @param {object} layer Source layer.
     * @param {object} board Board metadata.
     * @returns {object}
     */
    static #mapTrack(primitive, layer, board) {
        return {
            ...PcbScene3dBuilder.#mapLine(primitive, board),
            layerId: GerberScene3dLayerClassifier.layerId(layer),
            hasSolderMask: true
        }
    }

    /**
     * Maps an outline arc primitive.
     * @param {object} primitive Source primitive.
     * @param {object} board Board metadata.
     * @returns {object}
     */
    static #mapOutlineArc(primitive, board) {
        const center = PcbScene3dBuilder.#outlineArcCenter(primitive)
        return GerberScene3dCoordinateMapper.line(
            {
                type: 'arc',
                x1: PcbScene3dBuilder.#mmToMil(primitive.x1),
                y1: PcbScene3dBuilder.#mmToMil(primitive.y1),
                x2: PcbScene3dBuilder.#mmToMil(primitive.x2),
                y2: PcbScene3dBuilder.#mmToMil(primitive.y2),
                cx: PcbScene3dBuilder.#mmToMil(center.x),
                cy: PcbScene3dBuilder.#mmToMil(center.y),
                radius: PcbScene3dBuilder.#mmToMil(center.radius)
            },
            board
        )
    }

    /**
     * Resolves an outline arc center from precomputed or primitive fields.
     * @param {object} primitive Source primitive.
     * @returns {{ x: number, y: number, radius: number }}
     */
    static #outlineArcCenter(primitive) {
        const center = {
            x: Number(primitive?.cx),
            y: Number(primitive?.cy),
            radius: Number(primitive?.radius)
        }
        return Number.isFinite(center.x + center.y + center.radius)
            ? center
            : GerberScene3dArcGeometry.center(primitive)
    }

    /**
     * Maps a copper or silkscreen arc primitive.
     * @param {object} primitive Source primitive.
     * @param {object} [layer] Source layer.
     * @param {object} board Board metadata.
     * @returns {object}
     */
    static #mapCopperArc(primitive, layer = null, board) {
        const center = GerberScene3dArcGeometry.center(primitive)
        const startAngle = GerberScene3dArcGeometry.angleDeg(
            Number(primitive.x1 || 0) - center.x,
            Number(primitive.y1 || 0) - center.y
        )
        const endAngle = GerberScene3dArcGeometry.angleDeg(
            Number(primitive.x2 || 0) - center.x,
            Number(primitive.y2 || 0) - center.y
        )
        const angles = GerberScene3dCoordinateMapper.arcAngles(
            startAngle,
            endAngle,
            primitive.clockwise === true
        )

        return GerberScene3dCoordinateMapper.line(
            {
                type: 'arc',
                x: PcbScene3dBuilder.#mmToMil(center.x),
                y: PcbScene3dBuilder.#mmToMil(center.y),
                radius: PcbScene3dBuilder.#mmToMil(center.radius),
                startAngle: angles.startAngle,
                endAngle: angles.endAngle,
                sweepAngle: angles.sweepAngle,
                width: PcbScene3dBuilder.#mmToMil(primitive.width || 0),
                ...(layer
                    ? {
                          layerId: GerberScene3dLayerClassifier.layerId(layer),
                          hasSolderMask: true
                      }
                    : {})
            },
            board
        )
    }

    /**
     * Maps one region primitive to a polygon detail record.
     * @param {object} primitive Source primitive.
     * @param {object} [layer] Source layer.
     * @param {object} board Board metadata.
     * @returns {object}
     */
    static #mapRegion(primitive, layer = null, board) {
        return {
            type: 'polygon',
            points: GerberScene3dCoordinateMapper.points(
                (primitive.points || []).map((point) => ({
                    x: PcbScene3dBuilder.#mmToMil(point.x),
                    y: PcbScene3dBuilder.#mmToMil(point.y)
                })),
                board
            ),
            ...(layer
                ? {
                      layerId: GerberScene3dLayerClassifier.layerId(layer),
                      hasSolderMask: true
                  }
                : {})
        }
    }

    /**
     * Maps one flashed aperture to a scene pad.
     * @param {object} primitive Source primitive.
     * @param {object} layer Source layer.
     * @param {Map<string, object[]>} drillIndex Drills keyed by position.
     * @param {object} board Board metadata.
     * @returns {object | null}
     */
    static #mapFlashPad(primitive, layer, drillIndex, board) {
        const dimensions = GerberScene3dFlashGeometry.dimensions(primitive)
        if (!dimensions) {
            return null
        }

        const side = GerberScene3dLayerClassifier.layerSide(layer)
        const drill = PcbScene3dBuilder.#claimDrill(
            drillIndex,
            primitive.x,
            primitive.y
        )
        const pad = {
            x: PcbScene3dBuilder.#mmToMil(primitive.x),
            y: GerberScene3dCoordinateMapper.y(
                PcbScene3dBuilder.#mmToMil(primitive.y),
                board
            ),
            rotation: GerberScene3dCoordinateMapper.rotation(
                primitive.rotation
            ),
            shapeTop: dimensions.shapeCode,
            shapeBottom: dimensions.shapeCode,
            hasSolderMask: true,
            isPlated: drill?.plated === true,
            ...PcbScene3dBuilder.#padSurfaceSizes(dimensions, side)
        }

        if (dimensions.cornerRadiusRatio > 0) {
            pad.hasRoundedRect = true
            pad.cornerRadiusTop = dimensions.cornerRadiusRatio * 100
            pad.cornerRadiusBottom = dimensions.cornerRadiusRatio * 100
        }

        if (drill) {
            Object.assign(
                pad,
                PcbScene3dBuilder.#padDrillFields(drill, pad.rotation)
            )
        }

        return pad
    }

    /**
     * Maps a drill without matching copper artwork to a hidden drill pad.
     * @param {object} drill Normalized drill.
     * @param {object} board Board metadata.
     * @returns {object}
     */
    static #mapDrillOnlyPad(drill, board) {
        const rotation = GerberScene3dCoordinateMapper.rotation(
            drill.rotationDeg
        )

        return {
            x: PcbScene3dBuilder.#mmToMil(drill.x),
            y: GerberScene3dCoordinateMapper.y(
                PcbScene3dBuilder.#mmToMil(drill.y),
                board
            ),
            rotation,
            shapeTop: PAD_SHAPE_CIRCLE,
            shapeBottom: PAD_SHAPE_CIRCLE,
            hasTopSolderMaskOpening: false,
            hasBottomSolderMaskOpening: false,
            isPlated: drill.plated === true,
            ...PcbScene3dBuilder.#padDrillFields(drill, rotation)
        }
    }

    /**
     * Resolves pad drill fields in scene units.
     * @param {object} drill Normalized drill.
     * @param {number} padRotationDeg Scene pad rotation in degrees.
     * @returns {object}
     */
    static #padDrillFields(drill, padRotationDeg = 0) {
        const drillRotation = GerberScene3dCoordinateMapper.rotation(
            drill.rotationDeg
        )

        return {
            holeDiameter: PcbScene3dBuilder.#mmToMil(drill.diameter),
            holeShape:
                Number(drill.slotLength || 0) > Number(drill.diameter || 0)
                    ? PAD_HOLE_SHAPE_SLOT
                    : null,
            holeSlotLength: drill.slotLength
                ? PcbScene3dBuilder.#mmToMil(drill.slotLength)
                : null,
            holeRotation: PcbScene3dBuilder.#relativeRotation(
                drillRotation,
                padRotationDeg
            )
        }
    }

    /**
     * Resolves a hole rotation relative to its already-rotated pad body.
     * @param {number} absoluteRotationDeg Absolute scene rotation in degrees.
     * @param {number} padRotationDeg Scene pad rotation in degrees.
     * @returns {number}
     */
    static #relativeRotation(absoluteRotationDeg, padRotationDeg) {
        const relative =
            Number(absoluteRotationDeg || 0) - Number(padRotationDeg || 0)
        return ((relative % 360) + 360) % 360
    }

    /**
     * Builds side-specific pad surface dimensions.
     * @param {{ width: number, height: number }} dimensions Pad dimensions in mm.
     * @param {'top' | 'bottom' | 'both'} side Layer side.
     * @returns {object}
     */
    static #padSurfaceSizes(dimensions, side) {
        const width = PcbScene3dBuilder.#mmToMil(dimensions.width)
        const height = PcbScene3dBuilder.#mmToMil(dimensions.height)
        const topSizes =
            side === 'top' || side === 'both'
                ? { sizeTopX: width, sizeTopY: height }
                : {}
        const bottomSizes =
            side === 'bottom' || side === 'both'
                ? { sizeBottomX: width, sizeBottomY: height }
                : {}

        return { ...topSizes, ...bottomSizes }
    }

    /**
     * Claims the nearest drill at one flash position.
     * @param {Map<string, object[]>} drillIndex Drills keyed by position.
     * @param {number} x X in mm.
     * @param {number} y Y in mm.
     * @returns {object | null}
     */
    static #claimDrill(drillIndex, x, y) {
        const drills = drillIndex.get(PcbScene3dBuilder.#drillKey(x, y)) || []
        const drill = drills.find((candidate) => !candidate.matched)
        if (!drill) {
            return null
        }

        drill.matched = true
        return drill
    }

    /**
     * Builds a stable drill position key.
     * @param {number} x X in mm.
     * @param {number} y Y in mm.
     * @returns {string}
     */
    static #drillKey(x, y) {
        return (
            Number(x || 0).toFixed(DRILL_KEY_PRECISION) +
            ':' +
            Number(y || 0).toFixed(DRILL_KEY_PRECISION)
        )
    }

    /**
     * Converts millimeters to mils with deterministic rounding.
     * @param {number} value Value in mm.
     * @returns {number}
     */
    static #mmToMil(value) {
        return PcbScene3dBuilder.#roundMil(Number(value || 0) * MILS_PER_MM)
    }

    /**
     * Rounds a scene-unit number.
     * @param {number} value Numeric value.
     * @returns {number}
     */
    static #roundMil(value) {
        return Number(Number(value || 0).toFixed(6))
    }
}

/**
 * Async preparation facade matching the existing toolkit scene3d contract.
 */
export class PcbScene3dScenePreparator {
    /**
     * Prepares a scene description.
     * @param {object} documentModel Normalized Gerber PCB document.
     * @param {object} [options] Preparation options.
     * @returns {Promise<object>}
     */
    static async prepare(documentModel, options = {}) {
        return PcbScene3dBuilder.build(documentModel, options)
    }
}
