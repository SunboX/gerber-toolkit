import { GerberApertureMacro } from './GerberApertureMacro.mjs'
import { GerberBoardOutlineBuilder } from './GerberBoardOutlineBuilder.mjs'
import { GerberBounds } from './GerberBounds.mjs'
import { GerberCoordinateParser } from './GerberCoordinateParser.mjs'
import { GerberDrillParser } from './GerberDrillParser.mjs'
import { GerberLayerRoleResolver } from './GerberLayerRoleResolver.mjs'
import { GerberPrimitiveBuilder } from './GerberPrimitiveBuilder.mjs'

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
            interpolation: 'linear',
            quadrantMode: 'multi',
            polarity: 'dark',
            apertureTransform: {
                mirror: 'none',
                rotation: 0,
                scale: 1
            },
            stepRepeat: null,
            apertureBlock: null,
            attributes: {
                file: {},
                aperture: {},
                object: {}
            },
            inRegion: false,
            regionPoints: [],
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

        if (command === 'G36') {
            state.inRegion = true
            state.regionPoints = []
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

        if (command.startsWith('AD')) {
            GerberParser.#applyApertureDefinition(command, state)
            return
        }

        if (command.startsWith('SR')) {
            GerberParser.#applyStepRepeat(command, state)
            return
        }

        if (command === 'LPD' || command === 'LPC') {
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
            bounds: blockState.bounds.toObject()
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
     * Applies a step-repeat command.
     * @param {string} command Step-repeat command.
     * @param {object} state Parser state.
     * @returns {void}
     */
    static #applyStepRepeat(command, state) {
        if (command === 'SR') {
            state.stepRepeat = null
            return
        }

        const x = /X(\d+)/u.exec(command)
        const y = /Y(\d+)/u.exec(command)
        const i = /I([+-]?[0-9.]+)/u.exec(command)
        const j = /J([+-]?[0-9.]+)/u.exec(command)
        state.stepRepeat = {
            x: Math.max(1, Number.parseInt(x?.[1] || '1', 10)),
            y: Math.max(1, Number.parseInt(y?.[1] || '1', 10)),
            i: GerberParser.#unitValue(i?.[1], state.unit),
            j: GerberParser.#unitValue(j?.[1], state.unit)
        }
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
        delete state.attributes.file[normalized]
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
        state.apertures.set(
            code,
            GerberParser.#buildAperture(template, values, state)
        )
    }

    /**
     * Builds an aperture model from a template.
     * @param {string} template Aperture template.
     * @param {number[]} values Aperture values.
     * @param {object} state Parser state.
     * @returns {object}
     */
    static #buildAperture(template, values, state) {
        const macro = state.macros.get(template)
        if (macro) {
            return {
                shape: 'macro',
                name: template,
                primitives: GerberApertureMacro.expand(macro, values).map(
                    (primitive) =>
                        GerberParser.#scaleMacroPrimitive(primitive, state.unit)
                )
            }
        }

        if (template === 'R') {
            return {
                shape: 'rect',
                width: GerberParser.#unitValue(values[0], state.unit),
                height: GerberParser.#unitValue(
                    values[1] || values[0],
                    state.unit
                )
            }
        }

        if (template === 'O') {
            return {
                shape: 'obround',
                width: GerberParser.#unitValue(values[0], state.unit),
                height: GerberParser.#unitValue(
                    values[1] || values[0],
                    state.unit
                )
            }
        }

        if (template === 'P') {
            return {
                shape: 'polygon',
                diameter: GerberParser.#unitValue(values[0], state.unit),
                vertices: Number(values[1] || 3),
                rotation: Number(values[2] || 0)
            }
        }

        return {
            shape: 'circle',
            diameter: GerberParser.#unitValue(values[0], state.unit)
        }
    }

    /**
     * Converts one expanded macro primitive from source units to millimeters.
     * @param {object} primitive Macro primitive.
     * @param {string} unit Source unit.
     * @returns {object}
     */
    static #scaleMacroPrimitive(primitive, unit) {
        const scaled = { ...primitive }
        for (const key of GerberParser.#macroLengthKeys(primitive)) {
            scaled[key] = GerberParser.#unitValue(primitive[key], unit)
        }

        if (Array.isArray(primitive.points)) {
            scaled.points = primitive.points.map((point) => ({
                x: GerberParser.#unitValue(point.x, unit),
                y: GerberParser.#unitValue(point.y, unit)
            }))
        }

        return scaled
    }

    /**
     * Returns macro primitive fields that carry source-unit lengths.
     * @param {object} primitive Macro primitive.
     * @returns {string[]}
     */
    static #macroLengthKeys(primitive) {
        const keys = ['x', 'y']
        if (primitive.type === 'circle' || primitive.type === 'polygon') {
            keys.push('diameter')
        }
        if (primitive.type === 'line') {
            keys.push('width', 'x1', 'y1', 'x2', 'y2')
        }
        if (primitive.type === 'rect') {
            keys.push('width', 'height')
        }
        if (primitive.type === 'moire') {
            keys.push(
                'outerDiameter',
                'ringThickness',
                'ringGap',
                'crosshairThickness',
                'crosshairLength'
            )
        }
        if (primitive.type === 'thermal') {
            keys.push('outerDiameter', 'innerDiameter', 'gap')
        }

        return keys.filter((key) => primitive[key] !== undefined)
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
        const code = operation?.[1] || '01'

        if (code === '02') {
            state.currentX = nextX
            state.currentY = nextY
            GerberParser.#appendRegionPoint(state, nextX, nextY)
            return
        }

        if (code === '03') {
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
     * Appends one draw primitive.
     * @param {object} state Parser state.
     * @param {number} x End X.
     * @param {number} y End Y.
     * @param {string | undefined} iToken Arc center X offset token.
     * @param {string | undefined} jToken Arc center Y offset token.
     * @returns {void}
     */
    static #draw(state, x, y, iToken, jToken) {
        if (state.inRegion) {
            GerberParser.#appendRegionPoint(state, x, y)
            return
        }

        const aperture =
            state.currentAperture || GerberParser.#defaultAperture()
        const width =
            GerberParser.#apertureStrokeWidth(aperture) *
            state.apertureTransform.scale
        const primitive =
            state.interpolation === 'linear'
                ? {
                      type: 'line',
                      x1: state.currentX,
                      y1: state.currentY,
                      x2: x,
                      y2: y,
                      width
                  }
                : {
                      type: 'arc',
                      x1: state.currentX,
                      y1: state.currentY,
                      x2: x,
                      y2: y,
                      i: state.coordinateParser.parseOffset(iToken) || 0,
                      j: state.coordinateParser.parseOffset(jToken) || 0,
                      clockwise: state.interpolation === 'clockwise',
                      width
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
        if (state.regionPoints.length >= 3) {
            GerberPrimitiveBuilder.append(state, {
                type: 'region',
                points: state.regionPoints
            })
        }
        state.inRegion = false
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
     * @returns {object}
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
                transform
            }
        }

        if (aperture.shape === 'polygon') {
            return {
                shape: 'polygon',
                diameter: GerberParser.#round(aperture.diameter * scale),
                vertices: aperture.vertices,
                rotation: aperture.rotation,
                transform
            }
        }

        return {
            shape: 'circle',
            diameter: GerberParser.#round((aperture.diameter || 0.1) * scale),
            transform
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
     * Converts a parameter value from current Gerber units to millimeters.
     * @param {string | undefined} value Numeric text.
     * @param {string} unit Unit token.
     * @returns {number}
     */
    static #unitValue(value, unit) {
        const number = Number.parseFloat(String(value || '0'))
        return GerberParser.#round(unit === 'inch' ? number * 25.4 : number)
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
