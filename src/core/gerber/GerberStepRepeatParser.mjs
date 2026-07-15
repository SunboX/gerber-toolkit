/** Parses Gerber step-repeat state without expanding primitive geometry. */
export class GerberStepRepeatParser {
    /**
     * Applies one step-repeat command to parser state.
     * @param {string} command Step-repeat command.
     * @param {object} state Parser state.
     * @returns {void}
     */
    static apply(command, state) {
        if (command === 'SR') {
            state.stepRepeat = null
            return
        }

        const x = /X(\d+)/u.exec(command)
        const y = /Y(\d+)/u.exec(command)
        const i = /I([+-]?[0-9.]+)/u.exec(command)
        const j = /J([+-]?[0-9.]+)/u.exec(command)
        state.stepRepeatSequence += 1
        state.stepRepeat = {
            sourceInstanceId: state.stepRepeatSequence,
            x: Math.max(1, Number.parseInt(x?.[1] || '1', 10)),
            y: Math.max(1, Number.parseInt(y?.[1] || '1', 10)),
            i: GerberStepRepeatParser.#unitValue(i?.[1], state.unit),
            j: GerberStepRepeatParser.#unitValue(j?.[1], state.unit)
        }
    }

    /**
     * Converts a step offset from current Gerber units to millimeters.
     * @param {string | undefined} value Numeric text.
     * @param {string} unit Unit token.
     * @returns {number} Millimeter offset.
     */
    static #unitValue(value, unit) {
        const number = Number.parseFloat(String(value || '0'))
        const millimeters = unit === 'inch' ? number * 25.4 : number
        return Number(Number(millimeters || 0).toFixed(6))
    }
}

Object.freeze(GerberStepRepeatParser.prototype)
Object.freeze(GerberStepRepeatParser)
