import { GerberSourceExpression } from './GerberSourceExpression.mjs'

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
        const mutationsByKey = new Map()
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
            mutationsByKey.set(node.key, {
                parameters: new Map(
                    node.parameters.map((parameter) => [
                        parameter.name,
                        new Set()
                    ])
                ),
                locals: new Map(
                    [...contract.state.variables.keys()].map((name) => [
                        name,
                        new Set()
                    ])
                )
            })
        }

        let changed = true
        let passes = 0
        const passLimit = Math.max(1, nodesByKey.size * 8)
        while (changed && passes < passLimit) {
            changed = false
            passes += 1
            for (const node of nodesByKey.values()) {
                const contract = contractsByKey.get(node.key)
                const mutations = mutationsByKey.get(node.key)
                for (const mutation of contract.mutations) {
                    const destination = node.parameters.some(
                        (parameter) => parameter.name === mutation.root
                    )
                        ? mutations.parameters.get(mutation.root)
                        : mutations.locals.get(mutation.root)
                    if (!destination) continue
                    changed =
                        GerberApiResultContractResolver.#addMaterializedShape(
                            destination,
                            mutation.shape,
                            node,
                            nodesByKey,
                            contractsByKey,
                            incomingByKey,
                            mutationsByKey
                        ) || changed
                }
                changed =
                    GerberApiResultContractResolver.#addMaterializedShape(
                        node.resultFields,
                        contract.result,
                        node,
                        nodesByKey,
                        contractsByKey,
                        incomingByKey,
                        mutationsByKey
                    ) || changed
                for (const call of contract.calls) {
                    const target = GerberApiResultContractResolver.#targetNode(
                        nodesByKey,
                        node,
                        call
                    )
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
                                contractsByKey,
                                incomingByKey,
                                mutationsByKey
                            ) || changed
                        const location = call.locations[index]
                        if (!location) continue
                        const targetEffects = mutationsByKey
                            .get(target.key)
                            .parameters.get(target.parameters[index].name)
                        const callerEffects = node.parameters.some(
                            (parameter) => parameter.name === location.root
                        )
                            ? mutations.parameters.get(location.root)
                            : mutations.locals.get(location.root)
                        for (const field of targetEffects || []) {
                            changed =
                                GerberApiResultContractResolver.#addField(
                                    callerEffects,
                                    GerberSourceExpression.path(
                                        location.path,
                                        field
                                    )
                                ) || changed
                        }
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
     * @param {Map<string, Record<string, any>>} contractsByKey Source contracts.
     * @param {Map<string, Map<string, Set<string>>>} incomingByKey Parameter shapes.
     * @param {Map<string, Record<string, Map<string, Set<string>>>>} mutationsByKey Mutation shapes.
     * @returns {boolean} Whether at least one field was added.
     */
    static #addMaterializedShape(
        destination,
        shape,
        node,
        nodesByKey,
        contractsByKey,
        incomingByKey,
        mutationsByKey
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
            if (!target) continue
            const targetFields =
                target.key === node.key
                    ? contractsByKey.get(target.key).result.fields
                    : target.resultFields
            for (const field of targetFields) {
                const path = GerberApiResultContractResolver.#mappedSourceField(
                    field,
                    reference
                )
                changed =
                    GerberApiResultContractResolver.#addField(
                        destination,
                        path
                    ) || changed
            }
        }
        const incoming = incomingByKey.get(node.key)
        const mutations = mutationsByKey.get(node.key)
        for (const parameter of shape.parameters) {
            const fields = new Set([
                ...(incoming?.get(parameter.name) || []),
                ...(mutations?.parameters.get(parameter.name) || [])
            ])
            for (const field of fields) {
                changed =
                    GerberApiResultContractResolver.#addField(
                        destination,
                        GerberApiResultContractResolver.#mappedSourceField(
                            field,
                            parameter
                        )
                    ) || changed
            }
        }
        for (const local of shape.locals) {
            for (const field of mutations?.locals.get(local.name) || []) {
                changed =
                    GerberApiResultContractResolver.#addField(
                        destination,
                        GerberApiResultContractResolver.#mappedSourceField(
                            field,
                            local
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
        if (!destination || !field || destination.has(field)) return false
        destination.add(field)
        return true
    }

    /**
     * Applies one optional member selection and output prefix.
     * @param {string} field Source field.
     * @param {{ prefix?: string, select?: string }} source Shape source.
     * @returns {string | null} Mapped field or null when outside the selection.
     */
    static #mappedSourceField(field, source) {
        let mapped = field
        if (source.select) {
            if (mapped === source.select) mapped = ''
            else if (mapped.startsWith(`${source.select}.`)) {
                mapped = mapped.slice(source.select.length + 1)
            } else return null
        }
        return GerberSourceExpression.path(source.prefix || '', mapped)
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
     * @returns {{ result: Record<string, any>, calls: Record<string, any>[], mutations: Record<string, any>[], state: Record<string, any> }} Source contract.
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
            ),
            mutations: GerberApiResultContractResolver.#mutationContracts(
                node.source,
                state
            ),
            state
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
            bindings: new Map(),
            parameters: new Set(
                node.parameters.map((parameter) => parameter.name)
            )
        }
    }

    /**
     * Creates an empty abstract result shape.
     * @returns {{ fields: Set<string>, references: Record<string, any>[], parameters: Record<string, any>[], locals: Record<string, any>[] }} Shape.
     */
    static #shape() {
        return {
            fields: new Set(),
            references: [],
            parameters: [],
            locals: []
        }
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
        let changed = true
        while (changed) {
            changed = false
            for (const [name, expression] of variables) {
                const alias = /^([A-Za-z_$][\w$]*)$/u.exec(
                    expression.trim()
                )?.[1]
                if (!alias || !types.has(alias) || types.has(name)) continue
                types.set(name, types.get(alias))
                changed = true
            }
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
        value = GerberSourceExpression.stripParentheses(value)

        const conditional = GerberSourceExpression.conditionalBranches(value)
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
        const alternatives = GerberSourceExpression.logicalAlternatives(value)
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
            GerberSourceExpression.matchingDelimiter(value, 0, '{', '}') ===
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
            GerberSourceExpression.matchingDelimiter(value, 0, '[', ']') ===
                value.length - 1
        ) {
            for (const element of GerberSourceExpression.splitTopLevel(
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
            const elements = GerberApiResultContractResolver.#shape()
            GerberApiResultContractResolver.#analyzeExpression(
                callback.source,
                '',
                state,
                elements,
                resolving
            )
            const bindings = new Map(state.bindings)
            if (callback.parameter) bindings.set(callback.parameter, elements)
            const callbackState = { ...state, bindings }
            for (const returned of callback.returns) {
                GerberApiResultContractResolver.#analyzeExpression(
                    returned,
                    prefix,
                    callbackState,
                    shape,
                    resolving
                )
            }
            return
        }
        const identifier = /^([A-Za-z_$][\w$]*)$/u.exec(value)?.[1]
        if (identifier) {
            if (state.bindings.has(identifier)) {
                GerberApiResultContractResolver.#copyShape(
                    shape,
                    state.bindings.get(identifier),
                    '',
                    prefix
                )
                return
            }
            if (state.parameters.has(identifier)) {
                shape.parameters.push({ prefix, select: '', name: identifier })
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
                    const path = GerberSourceExpression.path(
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
                shape.locals.push({
                    prefix,
                    select: '',
                    name: identifier
                })
            }
            return
        }
        const call = GerberApiResultContractResolver.#directCall(value, state)
        if (call) {
            shape.references.push({ prefix, select: '', ...call })
            return
        }
        const member = GerberSourceExpression.memberAccess(value)
        if (member) {
            const selected = GerberApiResultContractResolver.#shape()
            GerberApiResultContractResolver.#analyzeExpression(
                member.root,
                '',
                state,
                selected,
                resolving
            )
            GerberApiResultContractResolver.#copyShape(
                shape,
                selected,
                member.path,
                prefix
            )
        }
    }

    /**
     * Copies one abstract shape through a member selection and output prefix.
     * @param {Record<string, any>} destination Destination shape.
     * @param {Record<string, any>} source Source shape.
     * @param {string} select Selected member path.
     * @param {string} prefix Output prefix.
     * @returns {void}
     */
    static #copyShape(destination, source, select, prefix) {
        for (const field of source.fields) {
            const mapped = GerberApiResultContractResolver.#mappedSourceField(
                field,
                { prefix, select }
            )
            if (mapped) destination.fields.add(mapped)
        }
        for (const key of ['references', 'parameters', 'locals']) {
            for (const candidate of source[key]) {
                const mapped = GerberApiResultContractResolver.#copySource(
                    candidate,
                    select,
                    prefix
                )
                if (mapped) destination[key].push(mapped)
            }
        }
    }

    /**
     * Composes a symbolic source with one member selection and prefix.
     * @param {Record<string, any>} source Symbolic source.
     * @param {string} select Selected member path.
     * @param {string} prefix Output prefix.
     * @returns {Record<string, any> | null} Composed source.
     */
    static #copySource(source, select, prefix) {
        const sourcePrefix = source.prefix || ''
        const sourceSelect = source.select || ''
        if (!select) {
            return {
                ...source,
                prefix: GerberSourceExpression.path(prefix, sourcePrefix)
            }
        }
        if (!sourcePrefix) {
            return {
                ...source,
                prefix,
                select: GerberSourceExpression.path(sourceSelect, select)
            }
        }
        if (select === sourcePrefix) {
            return { ...source, prefix, select: sourceSelect }
        }
        if (select.startsWith(`${sourcePrefix}.`)) {
            return {
                ...source,
                prefix,
                select: GerberSourceExpression.path(
                    sourceSelect,
                    select.slice(sourcePrefix.length + 1)
                )
            }
        }
        if (sourcePrefix.startsWith(`${select}.`)) {
            return {
                ...source,
                prefix: GerberSourceExpression.path(
                    prefix,
                    sourcePrefix.slice(select.length + 1)
                ),
                select: sourceSelect
            }
        }
        return null
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
        const close = GerberSourceExpression.matchingDelimiter(
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
            const close = GerberSourceExpression.matchingDelimiter(
                source,
                open,
                '(',
                ')'
            )
            const argumentSources = GerberSourceExpression.splitTopLevel(
                source.slice(open + 1, close)
            )
            const argumentsList = argumentSources.map((argument) => {
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
                arguments: argumentsList,
                locations: argumentSources.map((argument) =>
                    GerberApiResultContractResolver.#argumentLocation(
                        argument,
                        state
                    )
                )
            })
        }
        return calls
    }

    /**
     * Extracts direct property assignments and array append effects.
     * @param {string} source Callable source.
     * @param {Record<string, any>} state Local analysis state.
     * @returns {{ root: string, shape: Record<string, any> }[]} Mutations.
     */
    static #mutationContracts(source, state) {
        const mutations = []
        for (const [root, assignments] of state.assignments) {
            if (!state.parameters.has(root)) continue
            for (const assignment of assignments) {
                const shape = GerberApiResultContractResolver.#shape()
                shape.fields.add(assignment.path)
                GerberApiResultContractResolver.#analyzeExpression(
                    assignment.expression,
                    assignment.path,
                    state,
                    shape,
                    new Set()
                )
                mutations.push({ root, shape })
            }
        }
        for (const match of source.matchAll(
            /\b([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.push\s*\(/gu
        )) {
            const open = source.indexOf('(', match.index)
            const close = GerberSourceExpression.matchingDelimiter(
                source,
                open,
                '(',
                ')'
            )
            for (const argument of GerberSourceExpression.splitTopLevel(
                source.slice(open + 1, close)
            )) {
                const shape = GerberApiResultContractResolver.#shape()
                shape.fields.add(match[2])
                GerberApiResultContractResolver.#analyzeExpression(
                    argument.trim().replace(/^\.\.\./u, ''),
                    match[2],
                    state,
                    shape,
                    new Set()
                )
                mutations.push({ root: match[1], shape })
            }
        }
        return mutations
    }

    /**
     * Resolves a call argument back to a caller parameter or local variable.
     * @param {string} expression Argument expression.
     * @param {Record<string, any>} state Local analysis state.
     * @returns {{ root: string, path: string } | null} Mutable argument location.
     */
    static #argumentLocation(expression, state) {
        const value = GerberSourceExpression.stripParentheses(
            expression.trim().replace(/^\.\.\./u, '')
        )
        const member = GerberSourceExpression.memberAccess(value)
        const root = member?.root || /^([A-Za-z_$][\w$]*)$/u.exec(value)?.[1]
        if (
            !root ||
            (!state.parameters.has(root) && !state.variables.has(root))
        ) {
            return null
        }
        return { root, path: member?.path || '' }
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
        for (const part of GerberSourceExpression.splitTopLevel(source)) {
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
            const colon = GerberSourceExpression.topLevelToken(trimmed, ':')
            const keySource = (
                colon < 0 ? trimmed : trimmed.slice(0, colon)
            ).trim()
            const name = /^([A-Za-z_$][\w$]*)\??$/u.exec(keySource)?.[1]
            if (!name) continue
            const path = GerberSourceExpression.path(prefix, name)
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
     * @returns {{ source: string, parameter: string, returns: string[] } | null} Map contract.
     */
    static #mapCallback(expression) {
        const match = /\.map\s*\(/u.exec(expression)
        if (!match) return null
        const open = expression.indexOf('(', match.index)
        const close = GerberSourceExpression.matchingDelimiter(
            expression,
            open,
            '(',
            ')'
        )
        if (expression.slice(close + 1).trim()) return null
        const callback =
            GerberSourceExpression.splitTopLevel(
                expression.slice(open + 1, close)
            )[0] || ''
        const arrow = GerberSourceExpression.topLevelToken(callback, '=>')
        if (arrow < 0) return null
        const body = callback.slice(arrow + 2).trim()
        if (body.startsWith('{')) {
            const end = GerberSourceExpression.matchingDelimiter(
                body,
                0,
                '{',
                '}'
            )
            return {
                source: expression.slice(0, match.index).trim(),
                parameter: GerberSourceExpression.arrowParameter(
                    callback.slice(0, arrow)
                ),
                returns: GerberApiResultContractResolver.#returnExpressions(
                    body.slice(1, end)
                )
            }
        }
        return {
            source: expression.slice(0, match.index).trim(),
            parameter: GerberSourceExpression.arrowParameter(
                callback.slice(0, arrow)
            ),
            returns: [body]
        }
    }
}
