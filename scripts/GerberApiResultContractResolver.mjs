/**
 * Resolves nested public result fields through local values and static calls.
 */
export class GerberApiResultContractResolver {
    /**
     * Adds recursively delegated result paths to callable graph nodes.
     * @param {Map<string, Record<string, any>>} nodesByKey Callable graph.
     * @returns {void}
     */
    static resolve(nodesByKey) {
        const referencesByKey = new Map()
        for (const node of nodesByKey.values()) {
            const contract = GerberApiResultContractResolver.#sourceContract(
                node.source
            )
            for (const field of contract.fields) node.resultFields.add(field)
            referencesByKey.set(node.key, contract.references)
        }

        let changed = true
        let passes = 0
        while (changed && passes <= nodesByKey.size) {
            changed = false
            passes += 1
            for (const node of nodesByKey.values()) {
                for (const reference of referencesByKey.get(node.key) || []) {
                    const target = GerberApiResultContractResolver.#targetNode(
                        nodesByKey,
                        node,
                        reference
                    )
                    if (!target) continue
                    for (const field of target.resultFields) {
                        const path = reference.prefix
                            ? `${reference.prefix}.${field}`
                            : field
                        if (node.resultFields.has(path)) continue
                        node.resultFields.add(path)
                        changed = true
                    }
                }
            }
        }
    }

    /**
     * Resolves a same-entrypoint node before a wildcard supporting node.
     * @param {Map<string, Record<string, any>>} nodesByKey Callable graph.
     * @param {Record<string, any>} node Calling node.
     * @param {Record<string, string>} reference Static call reference.
     * @returns {Record<string, any> | undefined} Target node.
     */
    static #targetNode(nodesByKey, node, reference) {
        const methodType = reference.methodName.startsWith('#')
            ? 'static-private'
            : 'static'
        const suffix = `${reference.exportName}:${methodType}:${reference.methodName}`
        return (
            nodesByKey.get(`${node.entrypoint}:${suffix}`) ||
            nodesByKey.get(`*:${suffix}`)
        )
    }

    /**
     * Extracts direct fields and delegated result references from source.
     * @param {string} source Callable source.
     * @returns {{ fields: Set<string>, references: Record<string, string>[] }} Result contract.
     */
    static #sourceContract(source) {
        const fields = new Set()
        const references = []
        const variables =
            GerberApiResultContractResolver.#variableInitializers(source)
        for (const expression of GerberApiResultContractResolver.#returnExpressions(
            source
        )) {
            GerberApiResultContractResolver.#analyzeExpression(
                expression,
                '',
                variables,
                fields,
                references,
                new Set()
            )
        }
        return { fields, references }
    }

    /**
     * Parses local variable initializer expressions.
     * @param {string} source Callable source.
     * @returns {Map<string, string>} Initializers by variable name.
     */
    static #variableInitializers(source) {
        const variables = new Map()
        for (const match of source.matchAll(
            /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gu
        )) {
            const start = match.index + match[0].length
            variables.set(
                match[1],
                GerberApiResultContractResolver.#expressionAt(source, start)
            )
        }
        return variables
    }

    /**
     * Parses every returned expression from one callable.
     * @param {string} source Callable source.
     * @returns {string[]} Return expressions.
     */
    static #returnExpressions(source) {
        const expressions = []
        for (const match of source.matchAll(/\breturn\b/gu)) {
            expressions.push(
                GerberApiResultContractResolver.#expressionAt(
                    source,
                    match.index + match[0].length
                ).replace(/^await\s+/u, '')
            )
        }
        return expressions.filter(Boolean)
    }

    /**
     * Reads one expression until its first top-level line or statement end.
     * @param {string} source Source text.
     * @param {number} start Expression start index.
     * @returns {string} Expression source.
     */
    static #expressionAt(source, start) {
        let index = start
        while (/\s/u.test(source[index] || '')) index += 1
        const expressionStart = index
        let depth = 0
        let quote = ''
        for (; index < source.length; index += 1) {
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
            else if ((character === '\n' || character === ';') && depth === 0) {
                break
            }
        }
        return source.slice(expressionStart, index).trim()
    }

    /**
     * Adds fields and static-call references for one result expression.
     * @param {string} expression Result expression.
     * @param {string} prefix Nested result prefix.
     * @param {Map<string, string>} variables Local initializers.
     * @param {Set<string>} fields Result fields.
     * @param {Record<string, string>[]} references Delegated results.
     * @param {Set<string>} resolving Variables already resolving.
     * @returns {void}
     */
    static #analyzeExpression(
        expression,
        prefix,
        variables,
        fields,
        references,
        resolving
    ) {
        const value = expression.trim().replace(/^await\s+/u, '')
        if (!value) return
        if (value.startsWith('{')) {
            const close = GerberApiResultContractResolver.#matchingDelimiter(
                value,
                0,
                '{',
                '}'
            )
            GerberApiResultContractResolver.#analyzeObject(
                value.slice(1, close),
                prefix,
                variables,
                fields,
                references,
                resolving
            )
            return
        }
        const identifier = /^([A-Za-z_$][\w$]*)$/u.exec(value)?.[1]
        if (
            identifier &&
            variables.has(identifier) &&
            !resolving.has(identifier)
        ) {
            const nextResolving = new Set(resolving).add(identifier)
            GerberApiResultContractResolver.#analyzeExpression(
                variables.get(identifier),
                prefix,
                variables,
                fields,
                references,
                nextResolving
            )
            return
        }
        const call = GerberApiResultContractResolver.#directStaticCall(value)
        if (call) {
            references.push({
                prefix,
                exportName: call.exportName,
                methodName: call.methodName
            })
        }
    }

    /**
     * Parses a static call only when it occupies the complete expression.
     * @param {string} expression Expression source.
     * @returns {{ exportName: string, methodName: string } | null} Static call.
     */
    static #directStaticCall(expression) {
        const match = /^([A-Za-z_$][\w$]*)\.(#?[A-Za-z_$][\w$]*)\s*\(/u.exec(
            expression
        )
        if (!match) return null
        const open = expression.indexOf('(', match.index)
        const close = GerberApiResultContractResolver.#matchingDelimiter(
            expression,
            open,
            '(',
            ')'
        )
        if (expression.slice(close + 1).trim()) return null
        return { exportName: match[1], methodName: match[2] }
    }

    /**
     * Recursively analyzes one object result body.
     * @param {string} source Object body.
     * @param {string} prefix Nested result prefix.
     * @param {Map<string, string>} variables Local initializers.
     * @param {Set<string>} fields Result fields.
     * @param {Record<string, string>[]} references Delegated results.
     * @param {Set<string>} resolving Variables already resolving.
     * @returns {void}
     */
    static #analyzeObject(
        source,
        prefix,
        variables,
        fields,
        references,
        resolving
    ) {
        for (const part of GerberApiResultContractResolver.#splitTopLevel(
            source
        )) {
            const trimmed = part.trim()
            if (trimmed.startsWith('...')) {
                GerberApiResultContractResolver.#analyzeExpression(
                    trimmed.slice(3),
                    prefix,
                    variables,
                    fields,
                    references,
                    resolving
                )
                continue
            }
            const colon = GerberApiResultContractResolver.#topLevelIndex(
                trimmed,
                ':'
            )
            const keySource = (
                colon < 0 ? trimmed : trimmed.slice(0, colon)
            ).trim()
            const name = /^([A-Za-z_$][\w$]*)\??$/u.exec(keySource)?.[1]
            if (!name) continue
            const path = prefix ? `${prefix}.${name}` : name
            fields.add(path)
            GerberApiResultContractResolver.#analyzeExpression(
                colon < 0 ? name : trimmed.slice(colon + 1),
                path,
                variables,
                fields,
                references,
                resolving
            )
        }
    }

    /**
     * Splits comma-delimited source at top-level nesting depth.
     * @param {string} source Source expression.
     * @returns {string[]} Top-level parts.
     */
    static #splitTopLevel(source) {
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
     * Finds one character at top-level nesting depth.
     * @param {string} source Source expression.
     * @param {string} target Target character.
     * @returns {number} Character index or -1.
     */
    static #topLevelIndex(source, target) {
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
            else if (character === target && depth === 0) return index
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
    static #matchingDelimiter(source, openIndex, open, close) {
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
