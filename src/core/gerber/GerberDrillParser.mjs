import { GerberBounds } from './GerberBounds.mjs'
import { GerberCoordinateParser } from './GerberCoordinateParser.mjs'

/**
 * Parses Excellon drill and routed-slot files into normalized drill hits.
 */
export class GerberDrillParser {
    /**
     * Parses one Excellon drill source.
     * @param {string} text Source text.
     * @param {{ plated: boolean }} role Role metadata.
     * @returns {{ unit: string, drills: object[], diagnostics: object[], bounds: object }}
     */
    static parse(text, role) {
        const state = GerberDrillParser.#initialState(role)

        for (const rawLine of String(text || '').split(/\r?\n/u)) {
            GerberDrillParser.#applyLine(rawLine.trim(), state)
        }

        return {
            unit: state.unit,
            drills: state.drills,
            diagnostics: state.diagnostics,
            bounds: state.bounds.toObject()
        }
    }

    /**
     * Builds initial parser state.
     * @param {{ plated: boolean }} role Role metadata.
     * @returns {object}
     */
    static #initialState(role) {
        const plated = role?.plated !== false
        return {
            unit: 'mm',
            coordinateParser: new GerberCoordinateParser(),
            tools: new Map(),
            currentTool: '',
            currentPlated: plated,
            defaultPlated: plated,
            currentX: null,
            currentY: null,
            routing: false,
            drills: [],
            diagnostics: [],
            bounds: new GerberBounds()
        }
    }

    /**
     * Applies one Excellon source line.
     * @param {string} line Source line.
     * @param {object} state Parser state.
     * @returns {void}
     */
    static #applyLine(line, state) {
        if (!line) return

        if (line.startsWith(';')) {
            GerberDrillParser.#applyComment(line, state)
            return
        }

        if (/^(?:INCH|METRIC)\b/iu.test(line)) {
            GerberDrillParser.#applyUnitLine(line, state)
            return
        }

        if (GerberDrillParser.#applyToolDefinition(line, state)) return
        if (GerberDrillParser.#applyToolSelection(line, state)) return
        if (GerberDrillParser.#applyRoutingControl(line, state)) return
        if (GerberDrillParser.#applySlotCommand(line, state)) return

        GerberDrillParser.#applyCoordinateLine(line, state)
    }

    /**
     * Applies a semicolon-prefixed Excellon comment.
     * @param {string} line Source line.
     * @param {object} state Parser state.
     * @returns {void}
     */
    static #applyComment(line, state) {
        const type = /^;\s*TYPE\s*=\s*(.+)$/iu.exec(line)
        if (type) {
            state.currentPlated = !/NON[\s_-]*PLATED/iu.test(type[1])
            return
        }

        const fileFormat = /^;\s*FILE_FORMAT\s*=\s*(\d+)\s*:\s*(\d+)/iu.exec(
            line
        )
        if (!fileFormat) return

        GerberDrillParser.#setCoordinateFormat(
            state,
            Number(fileFormat[1]),
            Number(fileFormat[2])
        )
    }

    /**
     * Applies an Excellon unit and zero-retention line.
     * @param {string} line Unit line.
     * @param {object} state Parser state.
     * @returns {void}
     */
    static #applyUnitLine(line, state) {
        const unit = /^INCH\b/iu.test(line) ? 'inch' : 'mm'
        GerberDrillParser.#setUnit(state, unit)

        // Excellon LZ/TZ names identify retained zeroes, not suppressed zeroes.
        if (/,LZ\b/iu.test(line)) {
            GerberDrillParser.#setZeroSuppression(state, 'trailing')
        }

        if (/,TZ\b/iu.test(line)) {
            GerberDrillParser.#setZeroSuppression(state, 'leading')
        }
    }

    /**
     * Updates parser unit.
     * @param {object} state Parser state.
     * @param {'inch' | 'mm'} unit Coordinate unit.
     * @returns {void}
     */
    static #setUnit(state, unit) {
        state.unit = unit
        state.coordinateParser.unit = unit
    }

    /**
     * Updates the parser coordinate precision.
     * @param {object} state Parser state.
     * @param {number} integerDigits Integer digit count.
     * @param {number} decimalDigits Decimal digit count.
     * @returns {void}
     */
    static #setCoordinateFormat(state, integerDigits, decimalDigits) {
        if (
            !Number.isFinite(integerDigits) ||
            !Number.isFinite(decimalDigits)
        ) {
            return
        }

        state.coordinateParser.xInteger = integerDigits
        state.coordinateParser.yInteger = integerDigits
        state.coordinateParser.xDecimal = decimalDigits
        state.coordinateParser.yDecimal = decimalDigits
    }

    /**
     * Updates parser zero suppression semantics.
     * @param {object} state Parser state.
     * @param {'leading' | 'trailing'} zeroSuppression Suppressed-zero mode.
     * @returns {void}
     */
    static #setZeroSuppression(state, zeroSuppression) {
        state.coordinateParser.zeroSuppression = zeroSuppression
    }

    /**
     * Applies one drill tool definition.
     * @param {string} line Source line.
     * @param {object} state Parser state.
     * @returns {boolean}
     */
    static #applyToolDefinition(line, state) {
        const match = /^T(\d+).*?C([0-9.]+)/iu.exec(line)
        if (!match) return false

        const tool = GerberDrillParser.#toolCode(match[1])
        state.tools.set(tool, {
            diameter: Number.parseFloat(match[2]),
            plated: state.currentPlated
        })
        return true
    }

    /**
     * Applies one drill tool selection.
     * @param {string} line Source line.
     * @param {object} state Parser state.
     * @returns {boolean}
     */
    static #applyToolSelection(line, state) {
        const match = /^T(\d+)$/iu.exec(line)
        if (!match) return false

        state.currentTool = GerberDrillParser.#toolCode(match[1])
        return true
    }

    /**
     * Applies routed-slot start/end controls.
     * @param {string} line Source line.
     * @param {object} state Parser state.
     * @returns {boolean}
     */
    static #applyRoutingControl(line, state) {
        if (/^M15$/iu.test(line)) {
            state.routing = true
            return true
        }

        if (/^M16$/iu.test(line)) {
            state.routing = false
            return true
        }

        return false
    }

    /**
     * Applies one G85 slot command when present.
     * @param {string} line Source line.
     * @param {object} state Parser state.
     * @returns {boolean}
     */
    static #applySlotCommand(line, state) {
        const match = /G85X([+-]?[0-9.]+)Y([+-]?[0-9.]+)/iu.exec(line)
        if (
            !match ||
            !Number.isFinite(state.currentX) ||
            !Number.isFinite(state.currentY)
        ) {
            return false
        }

        const x = state.coordinateParser.parseX(match[1])
        const y = state.coordinateParser.parseY(match[2])
        GerberDrillParser.#appendSlot(state, x, y)
        GerberDrillParser.#setCurrentPoint(state, x, y)
        return true
    }

    /**
     * Applies one coordinate-bearing drill line.
     * @param {string} line Source line.
     * @param {object} state Parser state.
     * @returns {void}
     */
    static #applyCoordinateLine(line, state) {
        const point = GerberDrillParser.#parsePoint(line, state)
        if (!point) return

        if (GerberDrillParser.#isMoveCommand(line)) {
            GerberDrillParser.#setCurrentPoint(state, point.x, point.y)
            return
        }

        if (state.routing || GerberDrillParser.#isLinearRouteCommand(line)) {
            GerberDrillParser.#appendSlot(state, point.x, point.y)
            GerberDrillParser.#setCurrentPoint(state, point.x, point.y)
            return
        }

        GerberDrillParser.#appendDrill(state, point.x, point.y)
        GerberDrillParser.#setCurrentPoint(state, point.x, point.y)
    }

    /**
     * Parses a possibly omitted-axis coordinate line.
     * @param {string} line Source line.
     * @param {object} state Parser state.
     * @returns {{ x: number, y: number } | null}
     */
    static #parsePoint(line, state) {
        const xMatch = /X([+-]?[0-9.]+)/iu.exec(line)
        const yMatch = /Y([+-]?[0-9.]+)/iu.exec(line)
        if (!xMatch && !yMatch) return null

        const x = xMatch
            ? state.coordinateParser.parseX(xMatch[1])
            : state.currentX
        const y = yMatch
            ? state.coordinateParser.parseY(yMatch[1])
            : state.currentY

        return Number.isFinite(x) && Number.isFinite(y)
            ? {
                  x: GerberDrillParser.#round(x),
                  y: GerberDrillParser.#round(y)
              }
            : null
    }

    /**
     * Appends one round drill hit.
     * @param {object} state Parser state.
     * @param {number} x Drill X.
     * @param {number} y Drill Y.
     * @returns {void}
     */
    static #appendDrill(state, x, y) {
        const tool = GerberDrillParser.#currentTool(state)
        const diameter = GerberDrillParser.#diameterMillimeters(
            tool.diameter,
            state.unit
        )
        state.drills.push({
            x,
            y,
            diameter,
            plated: tool.plated,
            tool: state.currentTool || 'T00'
        })
        state.bounds.includePoint(x, y, diameter / 2)
    }

    /**
     * Appends one routed slot.
     * @param {object} state Parser state.
     * @param {number} x End X.
     * @param {number} y End Y.
     * @returns {void}
     */
    static #appendSlot(state, x, y) {
        if (
            !Number.isFinite(state.currentX) ||
            !Number.isFinite(state.currentY)
        ) {
            return
        }

        const tool = GerberDrillParser.#currentTool(state)
        const diameter = GerberDrillParser.#diameterMillimeters(
            tool.diameter,
            state.unit
        )
        state.drills.push({
            type: 'slot',
            x1: state.currentX,
            y1: state.currentY,
            x2: x,
            y2: y,
            diameter,
            plated: tool.plated,
            tool: state.currentTool || 'T00'
        })
        state.bounds.includeSegment(
            state.currentX,
            state.currentY,
            x,
            y,
            diameter / 2
        )
    }

    /**
     * Updates the current drill position.
     * @param {object} state Parser state.
     * @param {number} x Current X.
     * @param {number} y Current Y.
     * @returns {void}
     */
    static #setCurrentPoint(state, x, y) {
        state.currentX = x
        state.currentY = y
    }

    /**
     * Returns the active tool metadata.
     * @param {object} state Parser state.
     * @returns {{ diameter: number, plated: boolean }}
     */
    static #currentTool(state) {
        return (
            state.tools.get(state.currentTool) || {
                diameter: 0,
                plated: state.defaultPlated
            }
        )
    }

    /**
     * Returns true when a line starts with an Excellon rapid move command.
     * @param {string} line Source line.
     * @returns {boolean}
     */
    static #isMoveCommand(line) {
        return /^G0{1,2}(?![0-9])/iu.test(line)
    }

    /**
     * Returns true when a line starts with a linear routed-slot command.
     * @param {string} line Source line.
     * @returns {boolean}
     */
    static #isLinearRouteCommand(line) {
        return /^G0?1(?![0-9])/iu.test(line)
    }

    /**
     * Converts a tool diameter to millimeters.
     * @param {number} diameter Tool diameter in source units.
     * @param {'inch' | 'mm'} unit Source unit.
     * @returns {number}
     */
    static #diameterMillimeters(diameter, unit) {
        const normalized =
            unit === 'inch'
                ? Number(diameter || 0) * 25.4
                : Number(diameter || 0)
        return GerberDrillParser.#round(normalized)
    }

    /**
     * Normalizes one tool id.
     * @param {string} value Raw tool id digits.
     * @returns {string}
     */
    static #toolCode(value) {
        return 'T' + String(value || '').padStart(2, '0')
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
