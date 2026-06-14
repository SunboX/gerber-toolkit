/**
 * Evaluates the small arithmetic expression language used by aperture macros.
 */
export class GerberExpressionEvaluator {
    /**
     * Evaluates one expression against macro variables.
     * @param {string | number | undefined} expression Expression text.
     * @param {Map<string, number>} variables Macro variable values.
     * @returns {number}
     */
    static evaluate(expression, variables = new Map()) {
        if (typeof expression === 'number') {
            return Number.isFinite(expression) ? expression : 0
        }

        const parser = new GerberExpressionEvaluator(
            String(expression || '0'),
            variables
        )
        return parser.#round(parser.#parseExpression())
    }

    /**
     * Creates an expression parser.
     * @param {string} expression Expression text.
     * @param {Map<string, number>} variables Macro variable values.
     */
    constructor(expression, variables) {
        this.expression = expression.replace(/\s+/gu, '')
        this.variables = variables
        this.index = 0
    }

    /**
     * Parses addition and subtraction.
     * @returns {number}
     */
    #parseExpression() {
        let value = this.#parseTerm()
        while (this.#peek() === '+' || this.#peek() === '-') {
            const operator = this.#next()
            const right = this.#parseTerm()
            value = operator === '+' ? value + right : value - right
        }
        return value
    }

    /**
     * Parses multiplication and division.
     * @returns {number}
     */
    #parseTerm() {
        let value = this.#parseFactor()
        while (/[xX*/]/u.test(this.#peek())) {
            const operator = this.#next()
            const right = this.#parseFactor()
            if (operator === '/') {
                value = right === 0 ? 0 : value / right
            } else {
                value *= right
            }
        }
        return value
    }

    /**
     * Parses one factor.
     * @returns {number}
     */
    #parseFactor() {
        if (this.#peek() === '+') {
            this.#next()
            return this.#parseFactor()
        }

        if (this.#peek() === '-') {
            this.#next()
            return -this.#parseFactor()
        }

        if (this.#peek() === '(') {
            this.#next()
            const value = this.#parseExpression()
            if (this.#peek() === ')') {
                this.#next()
            }
            return value
        }

        if (this.#peek() === '$') {
            return this.#parseVariable()
        }

        return this.#parseNumber()
    }

    /**
     * Parses a `$n` variable reference.
     * @returns {number}
     */
    #parseVariable() {
        this.#next()
        const start = this.index
        while (/\d/u.test(this.#peek())) {
            this.#next()
        }
        return Number(
            this.variables.get(this.expression.slice(start, this.index)) || 0
        )
    }

    /**
     * Parses one decimal number.
     * @returns {number}
     */
    #parseNumber() {
        const start = this.index
        while (/[0-9.]/u.test(this.#peek())) {
            this.#next()
        }
        const value = Number.parseFloat(
            this.expression.slice(start, this.index)
        )
        return Number.isFinite(value) ? value : 0
    }

    /**
     * Returns the current character.
     * @returns {string}
     */
    #peek() {
        return this.expression[this.index] || ''
    }

    /**
     * Consumes one character.
     * @returns {string}
     */
    #next() {
        const char = this.#peek()
        this.index += 1
        return char
    }

    /**
     * Rounds macro arithmetic output.
     * @param {number} value Numeric value.
     * @returns {number}
     */
    #round(value) {
        return Number(Number(value || 0).toFixed(6))
    }
}
