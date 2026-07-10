/**
 * Parses balanced source-expression fragments used by the API inspector.
 */
export class GerberSourceExpression {
    /**
     * Parses a simple dot, optional-dot, or indexed member access.
     * @param {string} expression Expression source.
     * @returns {{ root: string, path: string } | null} Member access.
     */
    static memberAccess(expression) {
        const match =
            /^([A-Za-z_$][\w$]*)((?:(?:\?\.|\.)\s*[A-Za-z_$][\w$]*|\[\s*(?:\d+|'[^']+'|"[^"]+")\s*\])+)$/u.exec(
                expression.trim()
            )
        if (!match) return null
        const fields = []
        for (const part of match[2].matchAll(
            /(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)|\[\s*(['"])([^'"]+)\2\s*\]/gu
        )) {
            fields.push(part[1] || part[3])
        }
        return { root: match[1], path: fields.join('.') }
    }

    /**
     * Returns the first simple arrow callback parameter.
     * @param {string} source Arrow parameter source.
     * @returns {string} Parameter name or empty string.
     */
    static arrowParameter(source) {
        return /^\(?\s*([A-Za-z_$][\w$]*)/u.exec(source.trim())?.[1] || ''
    }

    /**
     * Splits a top-level conditional into its true and false branches.
     * @param {string} source Expression source.
     * @returns {string[] | null} Conditional branches.
     */
    static conditionalBranches(source) {
        let question = -1
        let nested = 0
        let depth = 0
        let quote = ''
        for (let index = 0; index < source.length; index += 1) {
            const character = source[index]
            if (quote) {
                if (character === quote && source[index - 1] !== '\\') {
                    quote = ''
                }
                continue
            }
            if (["'", '"', '`'].includes(character)) quote = character
            else if ('([{'.includes(character)) depth += 1
            else if (')]}'.includes(character)) depth -= 1
            else if (
                character === '?' &&
                depth === 0 &&
                source[index + 1] !== '.' &&
                source[index + 1] !== '?'
            ) {
                if (question < 0) question = index
                else nested += 1
            } else if (character === ':' && depth === 0 && question >= 0) {
                if (nested > 0) nested -= 1
                else {
                    return [
                        source.slice(question + 1, index),
                        source.slice(index + 1)
                    ]
                }
            }
        }
        return null
    }

    /**
     * Splits top-level logical fallback expressions.
     * @param {string} source Expression source.
     * @returns {string[]} Logical alternatives.
     */
    static logicalAlternatives(source) {
        const parts = []
        let start = 0
        let depth = 0
        let quote = ''
        for (let index = 0; index < source.length - 1; index += 1) {
            const character = source[index]
            if (quote) {
                if (character === quote && source[index - 1] !== '\\') {
                    quote = ''
                }
                continue
            }
            if (["'", '"', '`'].includes(character)) quote = character
            else if ('([{'.includes(character)) depth += 1
            else if (')]}'.includes(character)) depth -= 1
            else if (
                depth === 0 &&
                ['||', '??'].includes(source.slice(index, index + 2))
            ) {
                parts.push(source.slice(start, index))
                start = index + 2
                index += 1
            }
        }
        if (!parts.length) return [source]
        parts.push(source.slice(start))
        return parts
    }

    /**
     * Removes complete outer parenthesis pairs.
     * @param {string} source Expression source.
     * @returns {string} Unwrapped expression.
     */
    static stripParentheses(source) {
        let value = source.trim()
        while (
            value.startsWith('(') &&
            GerberSourceExpression.matchingDelimiter(value, 0, '(', ')') ===
                value.length - 1
        ) {
            value = value.slice(1, -1).trim()
        }
        return value
    }

    /**
     * Joins two non-empty field path parts.
     * @param {string} prefix Parent field path.
     * @param {string} field Child field path.
     * @returns {string} Joined path.
     */
    static path(prefix, field) {
        return prefix && field ? `${prefix}.${field}` : prefix || field
    }

    /**
     * Splits comma-delimited source at top-level nesting depth.
     * @param {string} source Source expression.
     * @returns {string[]} Top-level parts.
     */
    static splitTopLevel(source) {
        const parts = []
        let start = 0
        let depth = 0
        let quote = ''
        for (let index = 0; index < source.length; index += 1) {
            const character = source[index]
            if (quote) {
                if (character === quote && source[index - 1] !== '\\') {
                    quote = ''
                }
                continue
            }
            if (["'", '"', '`'].includes(character)) quote = character
            else if ('([{'.includes(character)) depth += 1
            else if (')]}'.includes(character)) depth -= 1
            else if (character === ',' && depth === 0) {
                parts.push(source.slice(start, index))
                start = index + 1
            }
        }
        const final = source.slice(start).trim()
        if (final) parts.push(final)
        return parts
    }

    /**
     * Finds one token at top-level nesting depth.
     * @param {string} source Source expression.
     * @param {string} target Target token.
     * @returns {number} Token index or -1.
     */
    static topLevelToken(source, target) {
        let depth = 0
        let quote = ''
        for (let index = 0; index < source.length; index += 1) {
            const character = source[index]
            if (quote) {
                if (character === quote && source[index - 1] !== '\\') {
                    quote = ''
                }
                continue
            }
            if (["'", '"', '`'].includes(character)) quote = character
            else if ('([{'.includes(character)) depth += 1
            else if (')]}'.includes(character)) depth -= 1
            else if (depth === 0 && source.startsWith(target, index)) {
                return index
            }
        }
        return -1
    }

    /**
     * Finds a matching delimiter while respecting strings and nesting.
     * @param {string} source Source text.
     * @param {number} openIndex Opening delimiter index.
     * @param {string} open Opening delimiter.
     * @param {string} close Closing delimiter.
     * @returns {number} Closing delimiter index.
     */
    static matchingDelimiter(source, openIndex, open, close) {
        let depth = 0
        let quote = ''
        for (let index = openIndex; index < source.length; index += 1) {
            const character = source[index]
            if (quote) {
                if (character === quote && source[index - 1] !== '\\') {
                    quote = ''
                }
                continue
            }
            if (["'", '"', '`'].includes(character)) quote = character
            else if (character === open) depth += 1
            else if (character === close) {
                depth -= 1
                if (depth === 0) return index
            }
        }
        return source.length - 1
    }
}
