/**
 * Parses fixed-point Gerber and drill coordinates.
 */
export class GerberCoordinateParser {
    /**
     * Creates a Gerber coordinate parser.
     * @param {{ xInteger?: number, xDecimal?: number, yInteger?: number, yDecimal?: number, zeroSuppression?: 'leading' | 'trailing' | 'none', unit?: 'mm' | 'inch' }} [options] Coordinate format options.
     */
    constructor(options = {}) {
        this.xInteger = Number(options.xInteger || 2)
        this.xDecimal = Number(options.xDecimal || 4)
        this.yInteger = Number(options.yInteger || 2)
        this.yDecimal = Number(options.yDecimal || 4)
        this.zeroSuppression = options.zeroSuppression || 'none'
        this.unit = options.unit || 'mm'
    }

    /**
     * Parses an X coordinate token.
     * @param {string | undefined} token Coordinate token without the `X` prefix.
     * @returns {number | null}
     */
    parseX(token) {
        return this.#parseFixed(token, this.xInteger, this.xDecimal)
    }

    /**
     * Parses a Y coordinate token.
     * @param {string | undefined} token Coordinate token without the `Y` prefix.
     * @returns {number | null}
     */
    parseY(token) {
        return this.#parseFixed(token, this.yInteger, this.yDecimal)
    }

    /**
     * Parses an I/J offset token using X-axis precision.
     * @param {string | undefined} token Coordinate token without the axis prefix.
     * @returns {number | null}
     */
    parseOffset(token) {
        return this.#parseFixed(token, this.xInteger, this.xDecimal)
    }

    /**
     * Parses a drill coordinate token with pragmatic metric defaults.
     * @param {string | undefined} token Drill coordinate token without the axis prefix.
     * @returns {number | null}
     */
    parseDrill(token) {
        if (token === undefined || token === null || token === '') {
            return null
        }

        const sign = String(token).startsWith('-') ? -1 : 1
        const unsigned = String(token).replace(/^[+-]/u, '')
        if (unsigned.includes('.')) {
            return GerberCoordinateParser.#toMillimeters(
                Number.parseFloat(String(token)),
                this.unit
            )
        }

        const scale = unsigned.length >= 6 ? 10000 : 1000
        return GerberCoordinateParser.#toMillimeters(
            (sign * Number.parseInt(unsigned, 10)) / scale,
            this.unit
        )
    }

    /**
     * Parses one fixed-point coordinate value.
     * @param {string | undefined} token Coordinate token.
     * @param {number} integerDigits Integer digit count.
     * @param {number} decimalDigits Decimal digit count.
     * @returns {number | null}
     */
    #parseFixed(token, integerDigits, decimalDigits) {
        if (token === undefined || token === null || token === '') {
            return null
        }

        const raw = String(token)
        if (raw.includes('.')) {
            return GerberCoordinateParser.#toMillimeters(
                Number.parseFloat(raw),
                this.unit
            )
        }

        const sign = raw.startsWith('-') ? -1 : 1
        const unsigned = raw.replace(/^[+-]/u, '')
        const totalDigits = integerDigits + decimalDigits
        const padded = this.#padSuppressedZeroes(unsigned, totalDigits)
        const value = sign * (Number.parseInt(padded, 10) / 10 ** decimalDigits)

        return GerberCoordinateParser.#toMillimeters(value, this.unit)
    }

    /**
     * Restores suppressed zeroes for one coordinate field.
     * @param {string} value Unsigned coordinate field.
     * @param {number} totalDigits Expected total digits.
     * @returns {string}
     */
    #padSuppressedZeroes(value, totalDigits) {
        if (this.zeroSuppression === 'leading') {
            return value.padStart(totalDigits, '0')
        }

        if (this.zeroSuppression === 'trailing') {
            return value.padEnd(totalDigits, '0')
        }

        return value.padStart(totalDigits, '0')
    }

    /**
     * Converts a value to millimeters.
     * @param {number} value Source value.
     * @param {'mm' | 'inch'} unit Source unit.
     * @returns {number}
     */
    static #toMillimeters(value, unit) {
        return unit === 'inch' ? value * 25.4 : value
    }
}
