import { GerberExpressionEvaluator } from './GerberExpressionEvaluator.mjs'

/**
 * Parses and expands aperture macro definitions into renderable primitives.
 */
export class GerberApertureMacro {
    /**
     * Parses an `AM` parameter command.
     * @param {string} command Parameter command without the surrounding percent signs.
     * @returns {{ name: string, statements: string[] }}
     */
    static parse(command) {
        const body = String(command || '').replace(/^AM/u, '')
        const parts = body
            .split('*')
            .map((part) => part.trim())
            .filter(Boolean)
        const name = parts.shift() || ''
        return {
            name,
            statements: parts.filter((part) => !part.startsWith('0 '))
        }
    }

    /**
     * Expands one macro with aperture parameters.
     * @param {{ name: string, statements: string[] }} macro Macro definition.
     * @param {number[]} values Aperture parameter values.
     * @returns {object[]}
     */
    static expand(macro, values) {
        const variables = new Map()
        values.forEach((value, index) => {
            variables.set(String(index + 1), Number(value || 0))
        })

        const primitives = []
        for (const statement of macro.statements || []) {
            const assignment = /^\$(\d+)=(.+)$/u.exec(statement)
            if (assignment) {
                variables.set(
                    assignment[1],
                    GerberExpressionEvaluator.evaluate(assignment[2], variables)
                )
                continue
            }

            const primitive = GerberApertureMacro.#primitive(
                statement,
                variables
            )
            if (primitive) {
                primitives.push(primitive)
            }
        }

        return primitives
    }

    /**
     * Parses one macro primitive statement.
     * @param {string} statement Primitive statement.
     * @param {Map<string, number>} variables Macro variables.
     * @returns {object | null}
     */
    static #primitive(statement, variables) {
        const values = statement
            .split(',')
            .map((value) =>
                GerberExpressionEvaluator.evaluate(value, variables)
            )
        const code = Number(values[0] || 0)

        if (code === 1) {
            return GerberApertureMacro.#circle(values)
        }

        if (code === 20) {
            return GerberApertureMacro.#vectorLine(values)
        }

        if (code === 21) {
            return GerberApertureMacro.#centerLine(values)
        }

        if (code === 4) {
            return GerberApertureMacro.#outline(values)
        }

        if (code === 5) {
            return GerberApertureMacro.#polygon(values)
        }

        if (code === 6) {
            return GerberApertureMacro.#moire(values)
        }

        if (code === 7) {
            return GerberApertureMacro.#thermal(values)
        }

        return null
    }

    /**
     * Builds a circle macro primitive.
     * @param {number[]} values Primitive values.
     * @returns {object}
     */
    static #circle(values) {
        return {
            type: 'circle',
            exposure: GerberApertureMacro.#exposure(values[1]),
            diameter: GerberApertureMacro.#round(values[2]),
            x: GerberApertureMacro.#round(values[3]),
            y: GerberApertureMacro.#round(values[4]),
            rotation: GerberApertureMacro.#round(values[5])
        }
    }

    /**
     * Builds a vector-line macro primitive.
     * @param {number[]} values Primitive values.
     * @returns {object}
     */
    static #vectorLine(values) {
        return {
            type: 'line',
            exposure: GerberApertureMacro.#exposure(values[1]),
            width: GerberApertureMacro.#round(values[2]),
            x1: GerberApertureMacro.#round(values[3]),
            y1: GerberApertureMacro.#round(values[4]),
            x2: GerberApertureMacro.#round(values[5]),
            y2: GerberApertureMacro.#round(values[6]),
            rotation: GerberApertureMacro.#round(values[7])
        }
    }

    /**
     * Builds a center-line macro primitive.
     * @param {number[]} values Primitive values.
     * @returns {object}
     */
    static #centerLine(values) {
        return {
            type: 'rect',
            exposure: GerberApertureMacro.#exposure(values[1]),
            width: GerberApertureMacro.#round(values[2]),
            height: GerberApertureMacro.#round(values[3]),
            x: GerberApertureMacro.#round(values[4]),
            y: GerberApertureMacro.#round(values[5]),
            rotation: GerberApertureMacro.#round(values[6])
        }
    }

    /**
     * Builds an outline macro primitive.
     * @param {number[]} values Primitive values.
     * @returns {object}
     */
    static #outline(values) {
        const pointCount = Number(values[2] || 0)
        const points = []
        for (let index = 0; index <= pointCount; index += 1) {
            const offset = 3 + index * 2
            points.push({
                x: GerberApertureMacro.#round(values[offset]),
                y: GerberApertureMacro.#round(values[offset + 1])
            })
        }
        return {
            type: 'region',
            exposure: GerberApertureMacro.#exposure(values[1]),
            points,
            rotation: GerberApertureMacro.#round(
                values[3 + (pointCount + 1) * 2]
            )
        }
    }

    /**
     * Builds a regular polygon macro primitive.
     * @param {number[]} values Primitive values.
     * @returns {object}
     */
    static #polygon(values) {
        return {
            type: 'polygon',
            exposure: GerberApertureMacro.#exposure(values[1]),
            vertices: Number(values[2] || 3),
            x: GerberApertureMacro.#round(values[3]),
            y: GerberApertureMacro.#round(values[4]),
            diameter: GerberApertureMacro.#round(values[5]),
            rotation: GerberApertureMacro.#round(values[6])
        }
    }

    /**
     * Builds an approximate moire macro primitive.
     * @param {number[]} values Primitive values.
     * @returns {object}
     */
    static #moire(values) {
        return {
            type: 'moire',
            exposure: 'dark',
            x: GerberApertureMacro.#round(values[1]),
            y: GerberApertureMacro.#round(values[2]),
            outerDiameter: GerberApertureMacro.#round(values[3]),
            ringThickness: GerberApertureMacro.#round(values[4]),
            ringGap: GerberApertureMacro.#round(values[5]),
            ringCount: Number(values[6] || 0),
            crosshairThickness: GerberApertureMacro.#round(values[7]),
            crosshairLength: GerberApertureMacro.#round(values[8]),
            rotation: GerberApertureMacro.#round(values[9])
        }
    }

    /**
     * Builds an approximate thermal macro primitive.
     * @param {number[]} values Primitive values.
     * @returns {object}
     */
    static #thermal(values) {
        return {
            type: 'thermal',
            exposure: 'dark',
            x: GerberApertureMacro.#round(values[1]),
            y: GerberApertureMacro.#round(values[2]),
            outerDiameter: GerberApertureMacro.#round(values[3]),
            innerDiameter: GerberApertureMacro.#round(values[4]),
            gap: GerberApertureMacro.#round(values[5]),
            rotation: GerberApertureMacro.#round(values[6])
        }
    }

    /**
     * Resolves exposure as a stable token.
     * @param {number} value Exposure flag.
     * @returns {'dark' | 'clear'}
     */
    static #exposure(value) {
        return Number(value || 0) === 0 ? 'clear' : 'dark'
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
