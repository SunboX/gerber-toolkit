const CONTROL_HEADER_KEYWORDS = new Set(['for', 'if', 'while', 'with'])
const REGEX_PREFIX_KEYWORDS = new Set([
    'case',
    'delete',
    'do',
    'else',
    'in',
    'instanceof',
    'new',
    'return',
    'throw',
    'typeof',
    'void',
    'yield'
])

/**
 * Parses balanced source-expression fragments used by the API inspector.
 */
export class GerberSourceExpression {
    /**
     * Replaces comments and string literal contents with spaces while
     * preserving source length and newlines for position-aware parsing.
     * @param {string} source JavaScript source.
     * @returns {string} Code-only positional mask.
     */
    static codeMask(source) {
        const characters = source.split('')
        const stack = [{ mode: 'code', braces: 0, templateExpression: false }]
        let escaped = false
        let regexCharacterClass = false
        const controlParentheses = []
        const controlHeaderClosures = new Set()
        const mask = (index) => {
            if (!['\n', '\r'].includes(characters[index])) {
                characters[index] = ' '
            }
        }
        for (let index = 0; index < characters.length; index += 1) {
            const character = source[index]
            const next = source[index + 1] || ''
            const frame = stack.at(-1)
            if (frame.mode === 'line-comment') {
                if (character === '\n' || character === '\r') stack.pop()
                else mask(index)
                continue
            }
            if (frame.mode === 'block-comment') {
                mask(index)
                if (character === '*' && next === '/') {
                    mask(index + 1)
                    index += 1
                    stack.pop()
                }
                continue
            }
            if (frame.mode === 'regex') {
                mask(index)
                if (escaped) escaped = false
                else if (character === '\\') escaped = true
                else if (character === '[') regexCharacterClass = true
                else if (character === ']') regexCharacterClass = false
                else if (character === '/' && !regexCharacterClass) stack.pop()
                else if (character === '\n' || character === '\r') stack.pop()
                continue
            }
            if (['single-quote', 'double-quote'].includes(frame.mode)) {
                mask(index)
                if (escaped) escaped = false
                else if (character === '\\') escaped = true
                else if (
                    (frame.mode === 'single-quote' && character === "'") ||
                    (frame.mode === 'double-quote' && character === '"')
                ) {
                    stack.pop()
                }
                continue
            }
            if (frame.mode === 'template') {
                mask(index)
                if (escaped) escaped = false
                else if (character === '\\') escaped = true
                else if (character === '`') stack.pop()
                else if (character === '$' && next === '{') {
                    characters[index + 1] = '{'
                    index += 1
                    stack.push({
                        mode: 'code',
                        braces: 0,
                        templateExpression: true
                    })
                }
                continue
            }
            if (frame.templateExpression && character === '}') {
                if (frame.braces === 0) {
                    stack.pop()
                    continue
                }
                frame.braces -= 1
            } else if (character === '{') {
                frame.braces += 1
            }
            if (character === '(') {
                controlParentheses.push(
                    GerberSourceExpression.#followsControlKeyword(
                        characters,
                        index
                    )
                )
            } else if (character === ')') {
                if (controlParentheses.pop()) {
                    controlHeaderClosures.add(index)
                }
            }
            if (character === '/' && next === '/') {
                mask(index)
                mask(index + 1)
                index += 1
                stack.push({ mode: 'line-comment' })
            } else if (character === '/' && next === '*') {
                mask(index)
                mask(index + 1)
                index += 1
                stack.push({ mode: 'block-comment' })
            } else if (
                character === '/' &&
                GerberSourceExpression.#startsRegex(
                    characters,
                    index,
                    controlHeaderClosures
                )
            ) {
                mask(index)
                escaped = false
                regexCharacterClass = false
                stack.push({ mode: 'regex' })
            } else if (character === "'") {
                mask(index)
                escaped = false
                stack.push({ mode: 'single-quote' })
            } else if (character === '"') {
                mask(index)
                escaped = false
                stack.push({ mode: 'double-quote' })
            } else if (character === '`') {
                mask(index)
                escaped = false
                stack.push({ mode: 'template' })
            }
        }
        return characters.join('')
    }

    /**
     * Distinguishes a regex literal from division using its preceding token.
     * @param {string[]} characters Position-preserving code characters.
     * @param {number} index Slash index.
     * @param {Set<number>} controlHeaderClosures Control-header close indices.
     * @returns {boolean} Whether the slash begins a regex literal.
     */
    static #startsRegex(characters, index, controlHeaderClosures) {
        let previous = index - 1
        while (previous >= 0 && /\s/u.test(characters[previous])) previous -= 1
        if (previous < 0) return true
        if ('([{=,:;!?&|+\-*%^~<>'.includes(characters[previous])) return true
        if (
            characters[previous] === ')' &&
            controlHeaderClosures.has(previous)
        ) {
            return true
        }
        const identifier = GerberSourceExpression.#identifierBefore(
            characters,
            index
        )
        return REGEX_PREFIX_KEYWORDS.has(identifier.value)
    }

    /**
     * Checks whether an opening parenthesis follows a control keyword.
     * @param {string[]} characters Position-preserving code characters.
     * @param {number} index Opening-parenthesis index.
     * @returns {boolean} Whether this parenthesis begins a control header.
     */
    static #followsControlKeyword(characters, index) {
        let identifier = GerberSourceExpression.#identifierBefore(
            characters,
            index
        )
        if (identifier.value === 'await') {
            identifier = GerberSourceExpression.#identifierBefore(
                characters,
                identifier.start
            )
        }
        return CONTROL_HEADER_KEYWORDS.has(identifier.value)
    }

    /**
     * Reads the nearest identifier before an exclusive source position.
     * @param {string[]} characters Position-preserving code characters.
     * @param {number} index Exclusive source position.
     * @returns {{ value: string, start: number }} Identifier and start index.
     */
    static #identifierBefore(characters, index) {
        let end = index - 1
        while (end >= 0 && /\s/u.test(characters[end])) end -= 1
        let start = end
        while (start >= 0 && /[\w$]/u.test(characters[start])) start -= 1
        return {
            value: characters.slice(start + 1, end + 1).join(''),
            start: start + 1
        }
    }

    /**
     * Unwraps standard shape-preserving clone expressions.
     * @param {string} expression Expression source.
     * @returns {string | null} Cloned value expression or null.
     */
    static clonedValue(expression) {
        const value = expression.trim()
        const structured = GerberSourceExpression.#callArgument(
            value,
            'structuredClone'
        )
        if (structured !== null) return structured
        const parsed = GerberSourceExpression.#callArgument(value, 'JSON.parse')
        if (parsed === null) return null
        return GerberSourceExpression.#callArgument(
            GerberSourceExpression.stripParentheses(parsed),
            'JSON.stringify'
        )
    }

    /**
     * Resolves the receiver of a complete collection method call.
     * @param {string} expression Expression source.
     * @param {string} method Exact collection method name.
     * @returns {string | null} Receiver expression or null.
     */
    static collectionReceiver(expression, method) {
        const value = expression.trim()
        const match = new RegExp(
            `^([A-Za-z_$][\\w$]*(?:(?:\\?\\.|\\.)[A-Za-z_$][\\w$]*)*)\\.${method}\\s*\\(`,
            'u'
        ).exec(value)
        if (!match) return null
        const open = value.indexOf('(', match.index)
        const close = GerberSourceExpression.matchingDelimiter(
            value,
            open,
            '(',
            ')'
        )
        return value.slice(close + 1).trim()
            ? null
            : match[1].replace(/\?\./gu, '.')
    }

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

    /**
     * Reads the sole argument of one complete named call expression.
     * @param {string} expression Expression source.
     * @param {string} callee Exact callee source.
     * @returns {string | null} Sole argument or null.
     */
    static #callArgument(expression, callee) {
        const prefix = `${callee}(`
        if (!expression.startsWith(prefix)) return null
        const open = callee.length
        const close = GerberSourceExpression.matchingDelimiter(
            expression,
            open,
            '(',
            ')'
        )
        if (expression.slice(close + 1).trim()) return null
        const argumentsList = GerberSourceExpression.splitTopLevel(
            expression.slice(open + 1, close)
        )
        return argumentsList.length === 1 ? argumentsList[0].trim() : null
    }
}
