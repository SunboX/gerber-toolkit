import { GerberApertureBuilder } from './GerberApertureBuilder.mjs'
import { GerberApertureMacro } from './GerberApertureMacro.mjs'
import { GerberArcCenterResolver } from './GerberArcCenterResolver.mjs'
import { GerberArcSampler } from './GerberArcSampler.mjs'
import { GerberBoardOutlineBuilder } from './GerberBoardOutlineBuilder.mjs'
import { GerberBounds } from './GerberBounds.mjs'
import { GerberCoordinateParser } from './GerberCoordinateParser.mjs'
import { GerberDrillParser } from './GerberDrillParser.mjs'
import { GerberLayerRoleResolver } from './GerberLayerRoleResolver.mjs'
import { GerberPrimitiveBuilder } from './GerberPrimitiveBuilder.mjs'
import { GerberStepRepeatParser } from './GerberStepRepeatParser.mjs'

/**
 * Parses one Gerber or Excellon source file into a PCB document.
 */
export class GerberParser {
    /**
     * Parses a file buffer into a normalized Gerber PCB document.
     * @param {string} fileName Source file name.
     * @param {ArrayBuffer | Uint8Array} buffer Source bytes.
     * @param {object} [options] Parser options.
     * @returns {object}
     */
    static parseArrayBuffer(fileName, buffer, options = {}) {
        const bytes = GerberParser.#toUint8Array(buffer)
        const text = new TextDecoder('utf-8').decode(bytes)
        const role = GerberLayerRoleResolver.resolve(fileName, text)
        const layer = role.isDrill
            ? GerberParser.#parseDrillLayer(fileName, text, role, options)
            : GerberParser.#parseGerberLayer(fileName, text, role, options)

        return GerberParser.fromLayers(fileName, [layer], options)
    }

    /**
     * Builds one normalized document from already parsed layers.
     * @param {string} fileName Document source label.
     * @param {object[]} layers Parsed fabrication layers.
     * @param {object} [options] Document options.
     * @returns {object}
     */
    static fromLayers(fileName, layers, options = {}) {
        const bounds = new GerberBounds()
        for (const layer of layers) {
            bounds.includeBounds(layer.bounds)
        }
        const normalizedBounds = bounds.toObject()

        return {
            sourceFormat: 'gerber',
            kind: 'pcb',
            fileName,
            pcb: {
                bounds: normalizedBounds,
                boardOutline:
                    GerberBoardOutlineBuilder.fromBounds(normalizedBounds),
                components: [],
                fabrication: {
                    renderMode: options.renderMode || 'composite',
                    layers
                }
            },
            bom: [],
            diagnostics: GerberParser.#collectDiagnostics(layers)
        }
    }

    /**
     * Parses one RS-274X layer.
     * @param {string} fileName Source file name.
     * @param {string} text Source text.
     * @param {{ role: string, side: string, isDocumentation: boolean }} role Role metadata.
     * @param {object} options Parser options.
     * @returns {object}
     */
    static #parseGerberLayer(fileName, text, role, options) {
        const state = GerberParser.#initialGerberState()
        const commands = GerberParser.#tokenizeGerber(text)

        for (const command of commands) {
            GerberParser.#applyGerberCommand(command, state)
        }

        return GerberParser.#buildLayer(fileName, role, {
            unit: state.unit,
            primitives: state.primitives,
            drills: [],
            diagnostics: state.diagnostics,
            bounds: state.bounds.toObject(),
            attributes: state.attributes,
            imagePolarity: state.imagePolarity,
            options
        })
    }

    /**
     * Parses one Excellon drill layer.
     * @param {string} fileName Source file name.
     * @param {string} text Source text.
     * @param {{ role: string, side: string, plated: boolean }} role Role metadata.
     * @param {object} options Parser options.
     * @returns {object}
     */
    static #parseDrillLayer(fileName, text, role, options) {
        const parsed = GerberDrillParser.parse(text, role)

        return GerberParser.#buildLayer(fileName, role, {
            unit: parsed.unit,
            primitives: [],
            drills: parsed.drills,
            diagnostics: parsed.diagnostics,
            bounds: parsed.bounds,
            attributes: {},
            options
        })
    }

    /**
     * Builds the initial parser state.
     * @returns {object}
     */
    static #initialGerberState() {
        return {
            unit: 'mm',
            coordinateParser: new GerberCoordinateParser(),
            apertures: new Map(),
            macros: new Map(),
            currentAperture: null,
            currentX: 0,
            currentY: 0,
            currentOperation: '01',
            interpolation: 'linear',
            quadrantMode: 'multi',
            polarity: 'dark',
            apertureTransform: {
                mirror: 'none',
                rotation: 0,
                scale: 1
            },
            sourcePathSequence: 0,
            activeSourcePathId: null,
            stepRepeatSequence: 0,
            stepRepeat: null,
            apertureBlock: null,
            imagePolarity: 'positive',
            attributes: {
                file: {},
                aperture: {},
                object: {}
            },
            inRegion: false,
            regionPoints: [],
            regionApertureAttributes: {},
            primitives: [],
            diagnostics: [],
            bounds: new GerberBounds()
        }
    }

    /**
     * Tokenizes Gerber source into commands.
     * @param {string} text Source text.
     * @returns {string[]}
     */
    static #tokenizeGerber(text) {
        const commands = []
        const source = String(text || '').replace(/\r/gu, '')
        let index = 0

        while (index < source.length) {
            while (/\s/u.test(source[index] || '')) {
                index += 1
            }

            if (source[index] === '%') {
                const end = source.indexOf('%', index + 1)
                if (end === -1) {
                    break
                }
                const block = source.slice(index + 1, end)
                if (block.trim().startsWith('AM')) {
                    commands.push('%' + block.trim())
                    index = end + 1
                    continue
                }
                for (const part of block.split('*')) {
                    const trimmed = part.trim()
                    if (trimmed) {
                        commands.push('%' + trimmed)
                    }
                }
                index = end + 1
                continue
            }

            const end = source.indexOf('*', index)
            if (end === -1) {
                break
            }
            const command = source.slice(index, end).trim()
            if (command) {
                commands.push(command)
            }
            index = end + 1
        }

        return commands
    }

    /**
     * Applies one Gerber command to parser state.
     * @param {string} command Gerber command.
     * @param {object} state Parser state.
     * @returns {void}
     */
    static #applyGerberCommand(command, state) {
        if (command.startsWith('G04')) {
            return
        }

        if (command.startsWith('%')) {
            GerberParser.#applyParameterCommand(command.slice(1), state)
            return
        }

        if (state.apertureBlock) {
            GerberParser.#applyGerberCommand(command, state.apertureBlock.state)
            return
        }

        if (GerberParser.#applyCombinedModalCoordinate(command, state)) {
            return
        }

        if (command === 'G36') {
            GerberParser.#breakSourcePath(state)
            state.inRegion = true
            state.regionPoints = []
            state.regionApertureAttributes = {
                ...state.attributes.aperture
            }
            return
        }

        if (command === 'G37') {
            GerberParser.#closeRegion(state)
            return
        }

        if (command === 'G01') {
            state.interpolation = 'linear'
            return
        }

        if (command === 'G02') {
            state.interpolation = 'clockwise'
            return
        }

        if (command === 'G03') {
            state.interpolation = 'counterclockwise'
            return
        }

        if (command === 'G74') {
            state.quadrantMode = 'single'
            return
        }

        if (command === 'G75') {
            state.quadrantMode = 'multi'
            return
        }

        if (command === 'G70') {
            state.unit = 'inch'
            state.coordinateParser.unit = 'inch'
            return
        }

        if (command === 'G71') {
            state.unit = 'mm'
            state.coordinateParser.unit = 'mm'
            return
        }

        const apertureSelection = /^(?:G54)?D(\d+)$/u.exec(command)
        if (apertureSelection && Number(apertureSelection[1]) >= 10) {
            state.currentAperture = state.apertures.get(apertureSelection[1])
            return
        }

        if (/M0?2/u.test(command)) {
            return
        }

        GerberParser.#applyCoordinateCommand(command, state)
    }

    /**
     * Applies one parameter command.
     * @param {string} command Parameter command.
     * @param {object} state Parser state.
     * @returns {void}
     */
    static #applyParameterCommand(command, state) {
        if (command.startsWith('AM')) {
            const macro = GerberApertureMacro.parse(command)
            state.macros.set(macro.name, macro)
            return
        }

        if (command.startsWith('ABD')) {
            GerberParser.#openApertureBlock(command, state)
            return
        }

        if (command === 'AB') {
            GerberParser.#closeApertureBlock(state)
            return
        }

        if (state.apertureBlock) {
            GerberParser.#applyParameterCommand(
                command,
                state.apertureBlock.state
            )
            return
        }

        if (command.startsWith('FS')) {
            GerberParser.#applyFormatCommand(command, state)
            return
        }

        if (command === 'MOMM') {
            state.unit = 'mm'
            state.coordinateParser.unit = 'mm'
            return
        }

        if (command === 'MOIN') {
            state.unit = 'inch'
            state.coordinateParser.unit = 'inch'
            return
        }

        if (command === 'IPPOS' || command === 'IPNEG') {
            GerberParser.#breakSourcePath(state)
            state.imagePolarity = command === 'IPNEG' ? 'negative' : 'positive'
            state.diagnostics.push({
                severity: 'warning',
                message: `Deprecated ${command} image-polarity command was applied.`
            })
            return
        }

        if (command.startsWith('AD')) {
            GerberParser.#applyApertureDefinition(command, state)
            return
        }

        if (command.startsWith('SR')) {
            GerberStepRepeatParser.apply(command, state)
            return
        }

        if (command === 'LPD' || command === 'LPC') {
            GerberParser.#breakSourcePath(state)
            state.polarity = command === 'LPC' ? 'clear' : 'dark'
            return
        }

        if (command.startsWith('LM')) {
            GerberParser.#applyApertureMirror(command, state)
            return
        }

        if (command.startsWith('LR')) {
            state.apertureTransform.rotation = GerberParser.#round(
                Number.parseFloat(command.slice(2)) || 0
            )
            return
        }

        if (command.startsWith('LS')) {
            state.apertureTransform.scale =
                Number.parseFloat(command.slice(2)) || 1
            return
        }

        if (/^T[FAO]\./u.test(command) || command.startsWith('TD')) {
            GerberParser.#applyAttributeCommand(command, state)
        }
    }

    /**
     * Opens an aperture block definition.
     * @param {string} command Aperture block command.
     * @param {object} state Parser state.
     * @returns {void}
     */
    static #openApertureBlock(command, state) {
        const match = /^ABD(\d+)$/u.exec(command)
        if (!match) {
            state.diagnostics.push({
                severity: 'warning',
                message: 'Unsupported aperture block command: ' + command
            })
            return
        }

        state.apertureBlock = {
            code: match[1],
            apertureAttributes: { ...state.attributes.aperture },
            state: GerberParser.#childGerberState(state)
        }
    }

    /**
     * Closes the active aperture block definition.
     * @param {object} state Parser state.
     * @returns {void}
     */
    static #closeApertureBlock(state) {
        if (!state.apertureBlock) {
            return
        }

        const blockState = state.apertureBlock.state
        state.apertures.set(state.apertureBlock.code, {
            shape: 'block',
            primitives: blockState.primitives.map((primitive) =>
                GerberPrimitiveBuilder.clone(primitive)
            ),
            bounds: blockState.bounds.toObject(),
            apertureAttributes: {
                ...state.apertureBlock.apertureAttributes
            }
        })
        state.diagnostics.push(...blockState.diagnostics)
        state.apertureBlock = null
    }

    /**
     * Builds parser state for aperture-block contents.
     * @param {object} parent Parent parser state.
     * @returns {object}
     */
    static #childGerberState(parent) {
        const child = GerberParser.#initialGerberState()
        child.unit = parent.unit
        child.coordinateParser = parent.coordinateParser
        child.apertures = parent.apertures
        child.macros = parent.macros
        child.apertureTransform = { ...parent.apertureTransform }
        child.attributes = GerberPrimitiveBuilder.cloneAttributes(
            parent.attributes
        )
        child.polarity = parent.polarity
        return child
    }

    /**
     * Applies an aperture mirror command.
     * @param {string} command Mirror command.
     * @param {object} state Parser state.
     * @returns {void}
     */
    static #applyApertureMirror(command, state) {
        const value = command.slice(2).toLowerCase()
        state.apertureTransform.mirror =
            value === 'x' || value === 'y' || value === 'xy' ? value : 'none'
    }

    /**
     * Applies one Gerber attribute command.
     * @param {string} command Attribute command.
     * @param {object} state Parser state.
     * @returns {void}
     */
    static #applyAttributeCommand(command, state) {
        if (command.startsWith('TD')) {
            GerberParser.#deleteAttribute(command.slice(2), state)
            return
        }

        const scopeToken = command.slice(1, 2)
        const parts = command.slice(3).split(',')
        const key = parts.shift()
        if (!key) {
            return
        }

        const scope =
            scopeToken === 'F'
                ? state.attributes.file
                : scopeToken === 'A'
                  ? state.attributes.aperture
                  : state.attributes.object
        if (scopeToken === 'F' && Object.hasOwn(scope, key)) {
            state.diagnostics.push({
                severity: 'warning',
                message: `Ignored immutable X2 file-attribute redefinition: ${key}`
            })
            return
        }
        scope[key] = parts
    }

    /**
     * Deletes attributes from the active state.
     * @param {string} key Attribute key.
     * @param {object} state Parser state.
     * @returns {void}
     */
    static #deleteAttribute(key, state) {
        if (!key) {
            state.attributes.aperture = {}
            state.attributes.object = {}
            return
        }

        const normalized = key.replace(/^\./u, '')
        delete state.attributes.aperture[normalized]
        delete state.attributes.object[normalized]
    }

    /**
     * Applies a coordinate format command.
     * @param {string} command Format command.
     * @param {object} state Parser state.
     * @returns {void}
     */
    static #applyFormatCommand(command, state) {
        const match = /^FS([LT])?A?X(\d)(\d)Y(\d)(\d)$/u.exec(command)
        if (!match) {
            state.diagnostics.push({
                severity: 'warning',
                message: 'Unsupported coordinate format command: ' + command
            })
            return
        }

        state.coordinateParser = new GerberCoordinateParser({
            zeroSuppression: match[1] === 'L' ? 'leading' : 'trailing',
            xInteger: Number(match[2]),
            xDecimal: Number(match[3]),
            yInteger: Number(match[4]),
            yDecimal: Number(match[5]),
            unit: state.unit
        })
    }

    /**
     * Stores one aperture definition.
     * @param {string} command Aperture command.
     * @param {object} state Parser state.
     * @returns {void}
     */
    static #applyApertureDefinition(command, state) {
        const match = /^ADD(\d+)([A-Za-z_$][A-Za-z0-9_$]*)(?:,(.*))?$/u.exec(
            command
        )
        if (!match) {
            state.diagnostics.push({
                severity: 'warning',
                message: 'Unsupported aperture definition: ' + command
            })
            return
        }

        const code = match[1]
        const template = match[2]
        const values = String(match[3] || '')
            .split('X')
            .map((value) => Number.parseFloat(value))
        state.apertures.set(code, {
            ...GerberApertureBuilder.build(
                template,
                values,
                state.macros,
                state.unit
            ),
            apertureAttributes: { ...state.attributes.aperture }
        })
    }

    /**
     * Applies one coordinate operation.
     * @param {string} command Coordinate command.
     * @param {object} state Parser state.
     * @returns {void}
     */
    static #applyCoordinateCommand(command, state) {
        const operation = /D(0?[123])$/u.exec(command)
        const xMatch = /X([+-]?[0-9.]+)/u.exec(command)
        const yMatch = /Y([+-]?[0-9.]+)/u.exec(command)
        const iMatch = /I([+-]?[0-9.]+)/u.exec(command)
        const jMatch = /J([+-]?[0-9.]+)/u.exec(command)
        if (!operation && !xMatch && !yMatch && !iMatch && !jMatch) {
            return
        }

        const nextX = xMatch
            ? state.coordinateParser.parseX(xMatch[1])
            : state.currentX
        const nextY = yMatch
            ? state.coordinateParser.parseY(yMatch[1])
            : state.currentY
        const code = operation?.[1] || state.currentOperation
        if (operation) state.currentOperation = code

        if (code === '02') {
            GerberParser.#breakSourcePath(state)
            if (state.inRegion && state.regionPoints.length) {
                GerberParser.#flushRegionContour(state)
            }
            state.currentX = nextX
            state.currentY = nextY
            GerberParser.#appendRegionPoint(state, nextX, nextY)
            return
        }

        if (code === '03') {
            GerberParser.#breakSourcePath(state)
            GerberParser.#flash(state, nextX, nextY)
            state.currentX = nextX
            state.currentY = nextY
            return
        }

        GerberParser.#draw(state, nextX, nextY, iMatch?.[1], jMatch?.[1])
        state.currentX = nextX
        state.currentY = nextY
    }

    /**
     * Applies leading modal interpolation/quadrant codes that share a command
     * with coordinate words.
     * @param {string} command Gerber command.
     * @param {object} state Parser state.
     * @returns {boolean} Whether a combined modal command was consumed.
     */
    static #applyCombinedModalCoordinate(command, state) {
        let remaining = command
        let changed = false
        while (remaining) {
            const match = /^(G0?[123]|G7[45])(?=G|[XYIJ])/u.exec(remaining)
            if (!match) break
            changed = true
            remaining = remaining.slice(match[0].length)
            if (match[1] === 'G74' || match[1] === 'G75') {
                state.quadrantMode = match[1] === 'G74' ? 'single' : 'multi'
            } else {
                const code = Number(match[1].slice(1))
                state.interpolation =
                    code === 1
                        ? 'linear'
                        : code === 2
                          ? 'clockwise'
                          : 'counterclockwise'
            }
        }
        if (!changed || !remaining) return false
        GerberParser.#applyCoordinateCommand(remaining, state)
        return true
    }

    /**
     * Appends one draw primitive.
     * @param {object} state Parser state.
     * @param {number} x End X.
     * @param {number} y End Y.
     * @param {string | undefined} iToken Arc center X offset token.
     * @param {string | undefined} jToken Arc center Y offset token.
     * @returns {void}
     */
    static #draw(state, x, y, iToken, jToken) {
        const arc =
            state.interpolation === 'linear'
                ? null
                : GerberArcCenterResolver.resolve(
                      {
                          x1: state.currentX,
                          y1: state.currentY,
                          x2: x,
                          y2: y,
                          i: state.coordinateParser.parseOffset(iToken) || 0,
                          j: state.coordinateParser.parseOffset(jToken) || 0,
                          clockwise: state.interpolation === 'clockwise'
                      },
                      state.quadrantMode
                  )
        if (state.inRegion) {
            if (state.interpolation === 'linear') {
                GerberParser.#appendRegionPoint(state, x, y)
            } else {
                const points = GerberArcSampler.points(arc)
                for (const point of points.slice(1)) {
                    GerberParser.#appendRegionPoint(state, point.x, point.y)
                }
            }
            return
        }

        const aperture =
            state.currentAperture || GerberParser.#defaultAperture()
        const width =
            GerberParser.#apertureStrokeWidth(aperture) *
            state.apertureTransform.scale
        const sourcePathId = GerberParser.#sourcePathId(state)
        const primitive =
            state.interpolation === 'linear'
                ? {
                      type: 'line',
                      x1: state.currentX,
                      y1: state.currentY,
                      x2: x,
                      y2: y,
                      width,
                      sourcePathId,
                      apertureAttributes: aperture.apertureAttributes
                  }
                : {
                      type: 'arc',
                      ...arc,
                      width,
                      sourcePathId,
                      apertureAttributes: aperture.apertureAttributes
                  }

        GerberPrimitiveBuilder.append(state, primitive)
    }

    /**
     * Appends one flash primitive.
     * @param {object} state Parser state.
     * @param {number} x Flash X.
     * @param {number} y Flash Y.
     * @returns {void}
     */
    static #flash(state, x, y) {
        const aperture =
            state.currentAperture || GerberParser.#defaultAperture()
        const primitive = {
            type: 'flash',
            ...GerberParser.#flashShape(aperture, state),
            apertureAttributes: aperture.apertureAttributes,
            x,
            y
        }
        GerberPrimitiveBuilder.append(state, primitive)
    }

    /**
     * Appends a region point when region mode is active.
     * @param {object} state Parser state.
     * @param {number} x Point X.
     * @param {number} y Point Y.
     * @returns {void}
     */
    static #appendRegionPoint(state, x, y) {
        if (!state.inRegion) {
            return
        }

        state.regionPoints.push({ x, y })
        state.bounds.includePoint(x, y)
    }

    /**
     * Closes the current region into one polygon primitive.
     * @param {object} state Parser state.
     * @returns {void}
     */
    static #closeRegion(state) {
        GerberParser.#flushRegionContour(state)
        state.inRegion = false
        state.regionPoints = []
        state.regionApertureAttributes = {}
        GerberParser.#breakSourcePath(state)
    }

    /**
     * Resolves the stable identity for the active source draw run.
     * @param {object} state Parser state.
     * @returns {string} Source path identity.
     */
    static #sourcePathId(state) {
        if (!state.activeSourcePathId) {
            state.sourcePathSequence += 1
            state.activeSourcePathId = `gerber_source_path_${state.sourcePathSequence}`
        }
        return state.activeSourcePathId
    }

    /**
     * Ends the active source draw run before a non-drawing boundary.
     * @param {object} state Parser state.
     * @returns {void}
     */
    static #breakSourcePath(state) {
        state.activeSourcePathId = null
    }

    /**
     * Appends one completed region contour while leaving region mode active.
     * @param {object} state Parser state.
     * @returns {void}
     */
    static #flushRegionContour(state) {
        if (state.regionPoints.length >= 3) {
            GerberPrimitiveBuilder.append(state, {
                type: 'region',
                points: state.regionPoints,
                apertureAttributes: state.regionApertureAttributes
            })
        }
        state.regionPoints = []
    }

    /**
     * Returns a default aperture for malformed input.
     * @returns {object}
     */
    static #defaultAperture() {
        return { shape: 'circle', diameter: 0.1 }
    }

    /**
     * Resolves an aperture stroke width.
     * @param {object} aperture Aperture model.
     * @returns {number}
     */
    static #apertureStrokeWidth(aperture) {
        return Number(aperture?.diameter || aperture?.width || 0.1)
    }

    /**
     * Converts an aperture into a flash shape.
     * @param {object} aperture Aperture model.
     * @param {object} state Parser state.
     * @returns {{ shape: string, name?: string, primitives?: { type: string, exposure: number, diameter?: number, width?: number }[], transform?: object, width?: number, height?: number, diameter?: number, vertices?: number, rotation?: number, hole?: object }} Canonical flash shape.
     */
    static #flashShape(aperture, state) {
        const scale = state.apertureTransform.scale
        const transform = GerberPrimitiveBuilder.transformSnapshot(state)
        if (aperture.shape === 'macro') {
            return {
                shape: 'macro',
                name: aperture.name,
                primitives: aperture.primitives.map((primitive) =>
                    GerberPrimitiveBuilder.clone(primitive)
                ),
                transform
            }
        }

        if (aperture.shape === 'block') {
            return {
                shape: 'block',
                primitives: aperture.primitives.map((primitive) =>
                    GerberPrimitiveBuilder.clone(primitive)
                ),
                transform
            }
        }

        if (aperture.shape === 'rect' || aperture.shape === 'obround') {
            return {
                shape: aperture.shape,
                width: GerberParser.#round(aperture.width * scale),
                height: GerberParser.#round(aperture.height * scale),
                transform,
                hole: GerberParser.#scaledApertureHole(aperture.hole, scale)
            }
        }

        if (aperture.shape === 'polygon') {
            return {
                shape: 'polygon',
                diameter: GerberParser.#round(aperture.diameter * scale),
                vertices: aperture.vertices,
                rotation: aperture.rotation,
                transform,
                hole: GerberParser.#scaledApertureHole(aperture.hole, scale)
            }
        }

        return {
            shape: 'circle',
            diameter: GerberParser.#round((aperture.diameter || 0.1) * scale),
            transform,
            hole: GerberParser.#scaledApertureHole(aperture.hole, scale)
        }
    }

    /**
     * Applies the active aperture scale to an optional standard hole.
     * @param {Record<string, any> | undefined} hole Aperture hole.
     * @param {number} scale Active LS scale.
     * @returns {Record<string, any> | undefined} Scaled hole.
     */
    static #scaledApertureHole(hole, scale) {
        if (!hole) return undefined
        if (hole.shape === 'rect') {
            return {
                shape: 'rect',
                width: GerberParser.#round(hole.width * scale),
                height: GerberParser.#round(hole.height * scale)
            }
        }
        return {
            shape: 'circle',
            diameter: GerberParser.#round(hole.diameter * scale)
        }
    }

    /**
     * Builds one layer model.
     * @param {string} fileName Source file name.
     * @param {{ role: string, side: string, isDocumentation?: boolean }} role Role metadata.
     * @param {{ unit: string, primitives: object[], drills: object[], diagnostics: object[], bounds: object, attributes?: object, options: object }} payload Parsed payload.
     * @returns {object}
     */
    static #buildLayer(fileName, role, payload) {
        return {
            id: GerberParser.#layerId(fileName),
            fileName,
            role: role.role,
            side: role.side,
            unit: payload.unit,
            isDocumentation: Boolean(role.isDocumentation),
            primitives: payload.primitives,
            drills: payload.drills,
            attributes: GerberPrimitiveBuilder.cloneAttributes(
                payload.attributes || {}
            ),
            ...(payload.imagePolarity === 'negative'
                ? { imagePolarity: 'negative' }
                : {}),
            diagnostics: payload.diagnostics.map((diagnostic) => ({
                ...diagnostic,
                fileName
            })),
            bounds: payload.bounds
        }
    }

    /**
     * Creates a stable layer id from one file name.
     * @param {string} fileName Source file name.
     * @returns {string}
     */
    static #layerId(fileName) {
        return (
            'gerber-' +
            String(fileName || 'layer')
                .toLowerCase()
                .replace(/[^a-z0-9]+/gu, '-')
                .replace(/^-|-$/gu, '')
        )
    }

    /**
     * Collects layer diagnostics.
     * @param {object[]} layers Parsed layers.
     * @returns {object[]}
     */
    static #collectDiagnostics(layers) {
        return layers.flatMap((layer) => layer.diagnostics || [])
    }

    /**
     * Converts a byte source into Uint8Array.
     * @param {ArrayBuffer | Uint8Array} buffer Source bytes.
     * @returns {Uint8Array}
     */
    static #toUint8Array(buffer) {
        if (buffer instanceof Uint8Array) {
            return buffer
        }

        return new Uint8Array(buffer)
    }

    /**
     * Rounds one numeric value.
     * @param {number} value Numeric value.
     * @returns {number}
     */
    static #round(value) {
        return Number(Number(value || 0).toFixed(6))
    }
}
