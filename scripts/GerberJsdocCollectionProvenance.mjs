/**
 * Extracts explicit Array nesting contracts from callable JSDoc.
 */
export class GerberJsdocCollectionProvenance {
    /**
     * Maps each parameter to its root and member Array depths.
     * @param {string} jsdoc Callable JSDoc.
     * @returns {Map<string, Map<string, number>>} Collection depths by parameter and path.
     */
    static parameters(jsdoc) {
        const parameters = new Map()
        for (const match of String(jsdoc || '').matchAll(/@param\s+\{/gu)) {
            const open = match.index + match[0].lastIndexOf('{')
            const close = matchingDelimiter(jsdoc, open, '{', '}')
            if (close < 0) continue
            const suffix = jsdoc
                .slice(close + 1)
                .match(/^\s+(\[[^\]]+\]|[^\s*]+)/u)
            const name = String(suffix?.[1] || '')
                .replace(/^\[/u, '')
                .replace(/\]$/u, '')
                .replace(/^\.\.\./u, '')
                .split('=')[0]
            if (!name) continue
            const type = jsdoc.slice(open + 1, close).trim()
            const paths = new Map()
            const rootDepth = arrayDepth(type)
            if (rootDepth) paths.set('', rootDepth)
            collectObjectCollections(type, '', paths)
            parameters.set(name, paths)
        }
        return parameters
    }

    /**
     * Resolves the explicit Array depth of a callable return type.
     * @param {string} jsdoc Callable JSDoc.
     * @returns {number} Declared Array depth, or zero.
     */
    static returnDepth(jsdoc) {
        const source = String(jsdoc || '')
        const match = /@returns?\s+\{/u.exec(source)
        if (!match) return 0
        const open = match.index + match[0].lastIndexOf('{')
        const close = matchingDelimiter(source, open, '{', '}')
        return close < 0 ? 0 : arrayDepth(source.slice(open + 1, close))
    }
}

/**
 * Collects Array-valued fields from one object type recursively.
 * @param {string} type Type expression.
 * @param {string} prefix Parent path.
 * @param {Map<string, number>} paths Destination depths.
 * @returns {void}
 */
function collectObjectCollections(type, prefix, paths) {
    const open = type.indexOf('{')
    if (open < 0) return
    const close = matchingDelimiter(type, open, '{', '}')
    if (close < 0) return
    const body = type.slice(open + 1, close)
    for (const part of splitTopLevel(body)) {
        const match = part.trim().match(/^([A-Za-z_$][\w$]*)\??\s*:/u)
        if (!match) continue
        const path = [prefix, match[1]].filter(Boolean).join('.')
        const value = part.slice(part.indexOf(':') + 1).trim()
        const depth = arrayDepth(value)
        if (depth) paths.set(path, depth)
        collectObjectCollections(value, path, paths)
    }
}

/**
 * Returns the greatest explicit trailing Array depth in a type expression.
 * @param {string} type Type expression.
 * @returns {number} Array nesting depth.
 */
function arrayDepth(type) {
    let structuralDepth = 0
    let current = 0
    let greatest = 0
    const source = String(type)
    let generic = source.trim()
    let genericDepth = 0
    while (/^Array\s*</u.test(generic)) {
        const open = generic.indexOf('<')
        const close = matchingDelimiter(generic, open, '<', '>')
        if (close < 0) break
        genericDepth += 1
        generic = generic.slice(open + 1, close).trim()
    }
    for (let index = 0; index < source.length; index += 1) {
        const character = source[index]
        if ('{(<'.includes(character)) structuralDepth += 1
        else if ('})>'.includes(character)) structuralDepth -= 1
        else if (
            character === '[' &&
            source[index + 1] === ']' &&
            structuralDepth === 0
        ) {
            current += 1
            greatest = Math.max(greatest, current)
            index += 1
        } else if (structuralDepth === 0 && !/\s/u.test(character)) {
            current = 0
        }
    }
    return Math.max(greatest, genericDepth)
}

/**
 * Splits a type body at top-level commas.
 * @param {string} source Type body.
 * @returns {string[]} Top-level fields.
 */
function splitTopLevel(source) {
    const values = []
    let start = 0
    const stack = []
    const pairs = { '{': '}', '[': ']', '(': ')', '<': '>' }
    for (let index = 0; index < source.length; index += 1) {
        const character = source[index]
        if (pairs[character]) stack.push(pairs[character])
        else if (stack.at(-1) === character) stack.pop()
        else if (character === ',' && !stack.length) {
            values.push(source.slice(start, index))
            start = index + 1
        }
    }
    values.push(source.slice(start))
    return values
}

/**
 * Finds one balanced delimiter close.
 * @param {string} source Source text.
 * @param {number} openIndex Opening index.
 * @param {string} open Opening character.
 * @param {string} close Closing character.
 * @returns {number} Closing index or -1.
 */
function matchingDelimiter(source, openIndex, open, close) {
    let depth = 0
    for (let index = openIndex; index < source.length; index += 1) {
        if (source[index] === open) depth += 1
        else if (source[index] === close && --depth === 0) return index
    }
    return -1
}
