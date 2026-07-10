/**
 * Resolves nested public result fields through local values and call graphs.
 */
export class GerberApiResultContractResolver {
    /**
     * Adds recursively delegated result paths to callable graph nodes.
     * @param {Map<string, Record<string, any>>} nodesByKey Callable graph.
     * @returns {void}
     */
    static resolve(nodesByKey) {
        const contractsByKey = new Map()
        const incomingByKey = new Map()
        for (const node of nodesByKey.values()) {
            const contract =
                GerberApiResultContractResolver.#sourceContract(node)
            for (const field of contract.result.fields) {
                node.resultFields.add(field)
            }
            contractsByKey.set(node.key, contract)
            incomingByKey.set(
                node.key,
                new Map(
                    node.parameters.map((parameter) => [
                        parameter.name,
                        new Set()
                    ])
                )
            )
        }

        let changed = true
        let passes = 0
        const passLimit = Math.max(1, nodesByKey.size * 4)
        while (changed && passes < passLimit) {
            changed = false
            passes += 1
            for (const node of nodesByKey.values()) {
                const contract = contractsByKey.get(node.key)
                changed =
                    GerberApiResultContractResolver.#addMaterializedShape(
                        node.resultFields,
                        contract.result,
                        node,
                        nodesByKey,
                        incomingByKey
                    ) || changed
                for (const call of contract.calls) {
                    const target = GerberApiResultContractResolver.#targetNode(
                        nodesByKey,
                        node,
                        call
                    )
                    // A recursive call reuses the same contract; feeding its
                    // argument back would manufacture unbounded field paths.
                    if (!target || target.key === node.key) continue
                    const incoming = incomingByKey.get(target.key)
                    for (
                        let index = 0;
                        index < target.parameters.length;
                        index += 1
                    ) {
                        const argument = call.arguments[index]
                        if (!argument) continue
                        changed =
                            GerberApiResultContractResolver.#addMaterializedShape(
                                incoming.get(target.parameters[index].name),
                                argument,
                                node,
                                nodesByKey,
                                incomingByKey
                            ) || changed
                    }
                }
            }
        }
        if (changed) {
            throw new Error('Result contract graph did not converge.')
        }
    }

    /**
     * Adds one abstract shape after resolving its calls and parameters.
     * @param {Set<string>} destination Destination field set.
     * @param {{ fields: Set<string>, references: Record<string, string>[], parameters: Record<string, string>[] }} shape Abstract shape.
     * @param {Record<string, any>} node Shape-owning callable.
     * @param {Map<string, Record<string, any>>} nodesByKey Callable graph.
     * @param {Map<string, Map<string, Set<string>>>} incomingByKey Parameter shapes.
     * @returns {boolean} Whether at least one field was added.
     */
    static #addMaterializedShape(
        destination,
        shape,
        node,
        nodesByKey,
        incomingByKey
    ) {
        let changed = false
        for (const field of shape.fields) {
            changed =
                GerberApiResultContractResolver.#addField(destination, field) ||
                changed
        }
        for (const reference of shape.references) {
            const target = GerberApiResultContractResolver.#targetNode(
                nodesByKey,
                node,
                reference
            )
            // Self-delegation represents a recursive value, not another
            // statically enumerable nesting level.
            if (!target || target.key === node.key) continue
            for (const field of target.resultFields) {
                const path = GerberApiResultContractResolver.#path(
                    reference.prefix,
                    field
                )
                changed =
                    GerberApiResultContractResolver.#addField(
                        destination,
                        path
                    ) || changed
            }
        }
        const incoming = incomingByKey.get(node.key)
        for (const parameter of shape.parameters) {
            for (const field of incoming?.get(parameter.name) || []) {
                changed =
                    GerberApiResultContractResolver.#addField(
                        destination,
                        GerberApiResultContractResolver.#path(
                            parameter.prefix,
                            field
                        )
                    ) || changed
            }
        }
        return changed
    }

    /**
     * Adds one non-empty field to a set.
     * @param {Set<string>} destination Destination field set.
     * @param {string} field Field path.
     * @returns {boolean} Whether the field was added.
     */
    static #addField(destination, field) {
        if (!field || destination.has(field)) return false
        destination.add(field)
        return true
    }

    /**
     * Resolves a same-entrypoint node before a wildcard supporting node.
     * @param {Map<string, Record<string, any>>} nodesByKey Callable graph.
     * @param {Record<string, any>} node Calling node.
     * @param {{ exportName: string, methodName: string, methodType: string }} reference Call reference.
     * @returns {Record<string, any> | undefined} Target node.
     */
    static #targetNode(nodesByKey, node, reference) {
        const suffix = `${reference.exportName}:${reference.methodType}:${reference.methodName}`
        return (
            nodesByKey.get(`${node.entrypoint}:${suffix}`) ||
            nodesByKey.get(`*:${suffix}`)
        )
    }

    /**
     * Extracts one callable's result and argument-flow contracts.
     * @param {Record<string, any>} node Callable node.
     * @returns {{ result: { fields: Set<string>, references: Record<string, string>[], parameters: Record<string, string>[] }, calls: Record<string, any>[] }} Source contract.
     */
    static #sourceContract(node) {
        const state = GerberApiResultContractResolver.#analysisState(node)
        const result = GerberApiResultContractResolver.#shape()
        for (const expression of GerberApiResultContractResolver.#returnExpressions(
            node.source
        )) {
            GerberApiResultContractResolver.#analyzeExpression(
                expression,
                '',
                state,
                result,
                new Set()
            )
        }
        return {
            result,
            calls: GerberApiResultContractResolver.#callContracts(
                node.source,
                state
            )
        }
    }

    /**
     * Builds local-variable and parameter analysis state.
     * @param {Record<string, any>} node Callable node.
     * @returns {Record<string, any>} Analysis state.
     */
    static #analysisState(node) {
        const variables = GerberApiResultContractResolver.#variableInitializers(
            node.source
        )
        return {
            variables,
            assignments: GerberApiResultContractResolver.#variableAssignments(
                node.source
            ),
            variableTypes:
                GerberApiResultContractResolver.#variableTypes(variables),
            parameters: new Set(
                node.parameters.map((parameter) => parameter.name)
            )
        }
    }

    /**
     * Creates an empty abstract result shape.
     * @returns {{ fields: Set<string>, references: Record<string, string>[], parameters: Record<string, string>[] }} Shape.
     */
    static #shape() {
        return { fields: new Set(), references: [], parameters: [] }
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
     * Parses property assignments made after local object initialization.
     * @param {string} source Callable source.
     * @returns {Map<string, { path: string, expression: string }[]>} Assignments by variable.
     */
    static #variableAssignments(source) {
        const assignments = new Map()
        for (const match of source.matchAll(
            /\b([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*=(?!=)/gu
        )) {
            const values = assignments.get(match[1]) || []
            values.push({
                path: match[2],
                expression: GerberApiResultContractResolver.#expressionAt(
                    source,
                    match.index + match[0].length
                )
            })
            assignments.set(match[1], values)
        }
        return assignments
    }

    /**
     * Infers directly constructed class names for local variables.
     * @param {Map<string, string>} variables Variable initializers.
     * @returns {Map<string, string>} Constructed class names by variable.
     */
    static #variableTypes(variables) {
        const types = new Map()
        for (const [name, expression] of variables) {
            const className = /^new\s+([A-Z][A-Za-z0-9_$]*)\s*\(/u.exec(
                expression.trim()
            )?.[1]
            if (className) types.set(name, className)
        }
        return types
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
     * Reads one expression until its first complete statement boundary.
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
            else if (character === ';' && depth === 0) break
            else if (character === '\n' && depth === 0) {
                const current = source.slice(expressionStart, index).trimEnd()
                const next = source.slice(index + 1).trimStart()[0] || ''
                if (
                    !/[?:.,+\-*/&|=<>!]$/u.test(current) &&
                    !['?', ':', '.'].includes(next)
                ) {
                    break
                }
            }
        }
        return source.slice(expressionStart, index).trim()
    }

    /**
     * Adds fields, call references, and parameter aliases for an expression.
     * @param {string} expression Result expression.
     * @param {string} prefix Nested result prefix.
     * @param {Record<string, any>} state Local analysis state.
     * @param {{ fields: Set<string>, references: Record<string, string>[], parameters: Record<string, string>[] }} shape Destination shape.
     * @param {Set<string>} resolving Variables already resolving.
     * @returns {void}
     */
    static #analyzeExpression(expression, prefix, state, shape, resolving) {
        let value = expression.trim().replace(/^await\s+/u, '')
        if (!value) return
        value = GerberApiResultContractResolver.#stripParentheses(value)

        const conditional =
            GerberApiResultContractResolver.#conditionalBranches(value)
        if (conditional) {
            for (const branch of conditional) {
                GerberApiResultContractResolver.#analyzeExpression(
                    branch,
                    prefix,
                    state,
                    shape,
                    resolving
                )
            }
            return
        }
        const alternatives =
            GerberApiResultContractResolver.#logicalAlternatives(value)
        if (alternatives.length > 1) {
            for (const alternative of alternatives) {
                GerberApiResultContractResolver.#analyzeExpression(
                    alternative,
                    prefix,
                    state,
                    shape,
                    resolving
                )
            }
            return
        }
        if (
            value.startsWith('{') &&
            GerberApiResultContractResolver.#matchingDelimiter(
                value,
                0,
                '{',
                '}'
            ) ===
                value.length - 1
        ) {
            GerberApiResultContractResolver.#analyzeObject(
                value.slice(1, -1),
                prefix,
                state,
                shape,
                resolving
            )
            return
        }
        if (
            value.startsWith('[') &&
            GerberApiResultContractResolver.#matchingDelimiter(
                value,
                0,
                '[',
                ']'
            ) ===
                value.length - 1
        ) {
            for (const element of GerberApiResultContractResolver.#splitTopLevel(
                value.slice(1, -1)
            )) {
                GerberApiResultContractResolver.#analyzeExpression(
                    element.trim().replace(/^\.\.\./u, ''),
                    prefix,
                    state,
                    shape,
                    resolving
                )
            }
            return
        }
        const callback = GerberApiResultContractResolver.#mapCallback(value)
        if (callback) {
            for (const returned of callback) {
                GerberApiResultContractResolver.#analyzeExpression(
                    returned,
                    prefix,
                    state,
                    shape,
                    resolving
                )
            }
            return
        }
        const identifier = /^([A-Za-z_$][\w$]*)$/u.exec(value)?.[1]
        if (identifier) {
            if (state.parameters.has(identifier)) {
                shape.parameters.push({ prefix, name: identifier })
            }
            if (state.variables.has(identifier) && !resolving.has(identifier)) {
                const nextResolving = new Set(resolving).add(identifier)
                GerberApiResultContractResolver.#analyzeExpression(
                    state.variables.get(identifier),
                    prefix,
                    state,
                    shape,
                    nextResolving
                )
                for (const assignment of state.assignments.get(identifier) ||
                    []) {
                    const path = GerberApiResultContractResolver.#path(
                        prefix,
                        assignment.path
                    )
                    shape.fields.add(path)
                    GerberApiResultContractResolver.#analyzeExpression(
                        assignment.expression,
                        path,
                        state,
                        shape,
                        nextResolving
                    )
                }
            }
            return
        }
        const call = GerberApiResultContractResolver.#directCall(value, state)
        if (call) shape.references.push({ prefix, ...call })
    }

    /**
     * Parses a complete static or inferred-instance method call.
     * @param {string} expression Expression source.
     * @param {Record<string, any>} state Local analysis state.
     * @returns {{ exportName: string, methodName: string, methodType: string } | null} Call target.
     */
    static #directCall(expression, state) {
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
        return GerberApiResultContractResolver.#callTarget(
            match[1],
            match[2],
            state
        )
    }

    /**
     * Converts a call receiver into one graph target.
     * @param {string} receiver Call receiver.
     * @param {string} methodName Method name.
     * @param {Record<string, any>} state Local analysis state.
     * @returns {{ exportName: string, methodName: string, methodType: string }} Call target.
     */
    static #callTarget(receiver, methodName, state) {
        const instanceClass = state.variableTypes.get(receiver)
        return {
            exportName: instanceClass || receiver,
            methodName,
            methodType: instanceClass
                ? 'instance'
                : methodName.startsWith('#')
                  ? 'static-private'
                  : 'static'
        }
    }

    /**
     * Parses call targets and abstract argument shapes from a callable.
     * @param {string} source Callable source.
     * @param {Record<string, any>} state Local analysis state.
     * @returns {Record<string, any>[]} Call contracts.
     */
    static #callContracts(source, state) {
        const calls = []
        for (const match of source.matchAll(
            /\b([A-Za-z_$][\w$]*)\.(#?[A-Za-z_$][\w$]*)\s*\(/gu
        )) {
            const open = source.indexOf('(', match.index)
            const close = GerberApiResultContractResolver.#matchingDelimiter(
                source,
                open,
                '(',
                ')'
            )
            const argumentsList =
                GerberApiResultContractResolver.#splitTopLevel(
                    source.slice(open + 1, close)
                ).map((argument) => {
                    const shape = GerberApiResultContractResolver.#shape()
                    GerberApiResultContractResolver.#analyzeExpression(
                        argument,
                        '',
                        state,
                        shape,
                        new Set()
                    )
                    return shape
                })
            calls.push({
                ...GerberApiResultContractResolver.#callTarget(
                    match[1],
                    match[2],
                    state
                ),
                arguments: argumentsList
            })
        }
        return calls
    }

    /**
     * Recursively analyzes one object result body.
     * @param {string} source Object body.
     * @param {string} prefix Nested result prefix.
     * @param {Record<string, any>} state Local analysis state.
     * @param {{ fields: Set<string>, references: Record<string, string>[], parameters: Record<string, string>[] }} shape Destination shape.
     * @param {Set<string>} resolving Variables already resolving.
     * @returns {void}
     */
    static #analyzeObject(source, prefix, state, shape, resolving) {
        for (const part of GerberApiResultContractResolver.#splitTopLevel(
            source
        )) {
            const trimmed = part.trim()
            if (trimmed.startsWith('...')) {
                GerberApiResultContractResolver.#analyzeExpression(
                    trimmed.slice(3),
                    prefix,
                    state,
                    shape,
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
            const path = GerberApiResultContractResolver.#path(prefix, name)
            shape.fields.add(path)
            GerberApiResultContractResolver.#analyzeExpression(
                colon < 0 ? name : trimmed.slice(colon + 1),
                path,
                state,
                shape,
                resolving
            )
        }
    }

    /**
     * Extracts returned expressions from one Array.map callback.
     * @param {string} expression Expression source.
     * @returns {string[] | null} Callback return expressions.
     */
    static #mapCallback(expression) {
        const match = /\.map\s*\(/u.exec(expression)
        if (!match) return null
        const open = expression.indexOf('(', match.index)
        const close = GerberApiResultContractResolver.#matchingDelimiter(
            expression,
            open,
            '(',
            ')'
        )
        if (expression.slice(close + 1).trim()) return null
        const callback =
            GerberApiResultContractResolver.#splitTopLevel(
                expression.slice(open + 1, close)
            )[0] || ''
        const arrow = GerberApiResultContractResolver.#topLevelToken(
            callback,
            '=>'
        )
        if (arrow < 0) return null
        const body = callback.slice(arrow + 2).trim()
        if (body.startsWith('{')) {
            const end = GerberApiResultContractResolver.#matchingDelimiter(
                body,
                0,
                '{',
                '}'
            )
            return GerberApiResultContractResolver.#returnExpressions(
                body.slice(1, end)
            )
        }
        return [body]
    }

    /**
     * Splits a top-level conditional into its true and false branches.
     * @param {string} source Expression source.
     * @returns {string[] | null} Conditional branches.
     */
    static #conditionalBranches(source) {
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
    static #logicalAlternatives(source) {
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
    static #stripParentheses(source) {
        let value = source.trim()
        while (
            value.startsWith('(') &&
            GerberApiResultContractResolver.#matchingDelimiter(
                value,
                0,
                '(',
                ')'
            ) ===
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
    static #path(prefix, field) {
        return prefix && field ? `${prefix}.${field}` : prefix || field
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
        return GerberApiResultContractResolver.#topLevelToken(source, target)
    }

    /**
     * Finds one token at top-level nesting depth.
     * @param {string} source Source expression.
     * @param {string} target Target token.
     * @returns {number} Token index or -1.
     */
    static #topLevelToken(source, target) {
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
