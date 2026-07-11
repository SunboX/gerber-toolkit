import { GerberSourceExpression } from './GerberSourceExpression.mjs'
import { GerberSourceAst } from './GerberSourceAst.mjs'
import { GerberSourceAstSupport } from './GerberSourceAstSupport.mjs'

/**
 * Parses callable-level source facts used by the Gerber API inspector.
 */
export class GerberSourceCallable {
    /**
     * Parses local variable initializer expressions.
     * @param {string} source Callable source.
     * @returns {Map<string, string>} Initializers by variable name.
     */
    static variableInitializers(source) {
        const variables = new Map()
        for (const binding of GerberSourceAst.facts(source).bindings) {
            if (!binding.expression) continue
            variables.set(binding.name, binding.expression)
        }
        return variables
    }

    /**
     * Parses property assignments made after local object initialization.
     * @param {string} source Callable source.
     * @returns {Map<string, { path: string, expression: string }[]>} Assignments by root.
     */
    static propertyAssignments(source) {
        return GerberSourceAst.facts(source).assignments
    }

    /**
     * Infers directly constructed types for local variables and member paths.
     * @param {Map<string, string>} variables Variable initializers.
     * @param {Map<string, { path: string, expression: string }[]>} assignments Property assignments.
     * @returns {Map<string, string>} Constructed class names by local path.
     */
    static variableTypes(variables, assignments) {
        const types = new Map()
        for (const [name, expression] of variables) {
            GerberSourceCallable.#collectConstructedTypes(
                expression,
                name,
                types
            )
        }
        for (const [root, values] of assignments) {
            for (const assignment of values) {
                const className = GerberSourceCallable.#constructedClass(
                    assignment.expression
                )
                if (className) {
                    types.set(
                        GerberSourceExpression.path(root, assignment.path),
                        className
                    )
                }
            }
        }
        GerberSourceCallable.propagateVariableTypes(types, variables)
        return types
    }

    /**
     * Propagates newly discovered member types through local aliases.
     * @param {Map<string, string>} types Known local types.
     * @param {Map<string, string>} variables Variable initializers.
     * @returns {boolean} Whether at least one type was added.
     */
    static propagateVariableTypes(types, variables) {
        let anyChanged = false
        let changed = true
        while (changed) {
            changed = false
            for (const [name, expression] of variables) {
                changed =
                    GerberSourceCallable.#copyAliasTypes(
                        types,
                        name,
                        expression
                    ) || changed
            }
            anyChanged = anyChanged || changed
        }
        return anyChanged
    }

    /**
     * Parses every returned expression from one callable.
     * @param {string} source Callable source.
     * @param {boolean} [bodyOnly] Whether source is already a callable body.
     * @returns {string[]} Return expressions.
     */
    static returnExpressions(source, bodyOnly = false) {
        return GerberSourceAst.facts(source, bodyOnly).returns.map(
            (record) => record.expression
        )
    }

    /**
     * Parses reachable returned expressions with their source positions.
     * @param {string} source Callable source.
     * @returns {{ expression: string, index: number }[]} Return records.
     */
    static returnRecords(source) {
        return GerberSourceAst.facts(source).returns
    }

    /**
     * Lists reachable static property paths read or written on a parameter.
     * @param {string} source Callable source.
     * @param {string} parameter Parameter name.
     * @returns {string[]} Reachable property paths.
     */
    static parameterProperties(source, parameter) {
        const fields = new Set()
        for (const access of GerberSourceAst.facts(source).accesses || []) {
            if (access.root !== parameter) continue
            const names = String(access.path).split('.').filter(Boolean)
            for (let length = 1; length <= names.length; length += 1) {
                fields.add(names.slice(0, length).join('.'))
            }
        }
        return [...fields].sort()
    }

    /**
     * Extracts one map, flatMap, or shape-preserving filter callback.
     * @param {string} expression Expression source.
     * @param {(name: string) => string} [resolveCallback] Lexical callback resolver.
     * @returns {{ method: string, source: string, parameter: string, returns: string[] } | null} Array callback contract.
     */
    static arrayCallback(expression, resolveCallback = () => '') {
        const value = GerberSourceExpression.stripParentheses(expression.trim())
        const arrayFrom = GerberSourceCallable.arrayFrom(value, resolveCallback)
        if (arrayFrom?.mapper) {
            return {
                method: 'map',
                source: arrayFrom.source,
                parameter: arrayFrom.mapper.parameter,
                returns: arrayFrom.mapper.returns
            }
        }
        const mask = GerberSourceExpression.codeMask(value)
        let terminal = null
        for (const match of mask.matchAll(
            /\.(map|flatMap|filter|flat)\s*\(/gu
        )) {
            if (!GerberSourceCallable.#isTopLevel(mask, match.index)) continue
            const open = mask.indexOf('(', match.index)
            const close = GerberSourceExpression.matchingDelimiter(
                mask,
                open,
                '(',
                ')'
            )
            if (!mask.slice(close + 1).trim()) {
                terminal = { match, open, close }
            }
        }
        if (!terminal) return null
        const { match, open, close } = terminal
        if (match[1] === 'flat') {
            return {
                method: match[1],
                source: value.slice(0, match.index).trim(),
                parameter: '',
                returns: []
            }
        }
        const callback =
            GerberSourceExpression.splitTopLevel(
                value.slice(open + 1, close)
            )[0] || ''
        const parsed = GerberSourceCallable.#callbackContract(
            callback,
            resolveCallback
        )
        if (!parsed) return null
        return {
            method: match[1],
            source: value.slice(0, match.index).trim(),
            ...parsed
        }
    }

    /**
     * Unwraps a complete `Array.from(source)` collection expression.
     * @param {string} expression Candidate expression.
     * @returns {string | null} Source collection or null.
     */
    static arrayFromSource(expression) {
        return GerberSourceCallable.arrayFrom(expression)?.source || null
    }

    /**
     * Parses a complete `Array.from(source[, mapper])` expression.
     * @param {string} expression Candidate expression.
     * @param {(name: string) => string} [resolveCallback] Lexical callback resolver.
     * @returns {{ source: string, mapper: { parameter: string, returns: string[] } | null } | null} Array conversion.
     */
    static arrayFrom(expression, resolveCallback = () => '') {
        const value = GerberSourceExpression.stripParentheses(expression.trim())
        if (!value.startsWith('Array.from')) return null
        const open = value.indexOf('(', 'Array.from'.length)
        if (open < 0) return null
        const close = GerberSourceExpression.matchingDelimiter(
            value,
            open,
            '(',
            ')'
        )
        if (value.slice(close + 1).trim()) return null
        const argumentsList = GerberSourceExpression.splitTopLevel(
            value.slice(open + 1, close)
        )
        const source = argumentsList[0]?.trim()
        if (!source) return null
        const callback = String(argumentsList[1] || '').trim()
        if (!callback) return { source, mapper: null }
        return {
            source,
            mapper: GerberSourceCallable.#callbackContract(
                callback,
                resolveCallback
            )
        }
    }

    /**
     * Parses an inline callback or one unambiguous lexical callback binding.
     * @param {string} callback Callback expression.
     * @param {(name: string) => string} resolveCallback Lexical resolver.
     * @returns {{ parameter: string, returns: string[] } | null} Callback shape.
     */
    static #callbackContract(callback, resolveCallback) {
        let source = String(callback || '').trim()
        if (/^[A-Za-z_$][\w$]*$/u.test(source)) {
            source = String(resolveCallback(source) || '').trim()
        }
        if (!source) return null
        const arrow = GerberSourceExpression.topLevelToken(source, '=>')
        if (arrow >= 0) {
            const body = source.slice(arrow + 2).trim()
            return {
                parameter: GerberSourceExpression.arrowParameter(
                    source.slice(0, arrow)
                ),
                returns: body.startsWith('{')
                    ? GerberSourceCallable.returnExpressions(
                          body.slice(
                              1,
                              GerberSourceExpression.matchingDelimiter(
                                  body,
                                  0,
                                  '{',
                                  '}'
                              )
                          ),
                          true
                      )
                    : [body]
            }
        }
        const expression =
            /^(?:async\s+)?function(?:\s+[A-Za-z_$][\w$]*)?\s*\(([^)]*)\)/u.exec(
                source
            )
        if (!expression) return null
        const parameter =
            GerberSourceExpression.splitTopLevel(expression[1])[0]?.trim() || ''
        return {
            parameter: /^[A-Za-z_$][\w$]*$/u.test(parameter) ? parameter : '',
            returns: GerberSourceCallable.returnExpressions(source)
        }
    }

    /**
     * Extracts target and sources from a complete `Object.assign()` call.
     * @param {string} expression Candidate expression.
     * @returns {string[] | null} Argument expressions or null.
     */
    static objectAssignSources(expression) {
        if (!expression.startsWith('Object.assign')) return null
        const open = expression.indexOf('(', 'Object.assign'.length)
        if (open < 0) return null
        const close = GerberSourceExpression.matchingDelimiter(
            expression,
            open,
            '(',
            ')'
        )
        if (expression.slice(close + 1).trim()) return null
        const values = GerberSourceExpression.splitTopLevel(
            expression.slice(open + 1, close)
        ).map((value) => value.trim())
        return values.length ? values : null
    }

    /**
     * Resolves a call argument back to canonical mutable locations.
     * @param {string} expression Argument expression.
     * @param {Record<string, any>} state Callable analysis state.
     * @returns {{ root: string, path: string }[]} Mutable argument locations.
     */
    static argumentLocations(expression, state, position = Number.MAX_VALUE) {
        const value = GerberSourceExpression.stripParentheses(
            expression.trim().replace(/^\.\.\./u, '')
        )
        const member = GerberSourceExpression.memberAccess(value)
        const root = member?.root || /^([A-Za-z_$][\w$]*)$/u.exec(value)?.[1]
        if (!root) return []
        return GerberSourceCallable.mutableLocations(
            root,
            member?.path || '',
            state,
            position
        )
    }

    /**
     * Reads one expression until its first complete statement boundary.
     * @param {string} source Source text.
     * @param {number} start Expression start index.
     * @returns {string} Expression source.
     */
    static expressionAt(source, start, end = source.length) {
        let index = start
        while (/\s/u.test(source[index] || '')) index += 1
        const expressionStart = index
        let depth = 0
        let quote = ''
        for (; index < end; index += 1) {
            const character = source[index]
            if (quote) {
                if (character === quote && source[index - 1] !== '\\') {
                    quote = ''
                }
                continue
            }
            if (["'", '"', '`'].includes(character)) quote = character
            else if ('([{'.includes(character)) depth += 1
            else if (character === '}' && depth === 0) break
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
     * Parses `for...of` element bindings and their collection expressions.
     * @param {string} source Callable source.
     * @returns {Map<string, { expression: string, start: number, end: number }[]>} Lexically scoped bindings by element name.
     */
    static iterationBindings(source) {
        const bindings = new Map()
        for (const binding of GerberSourceAst.facts(source).bindings.filter(
            (candidate) => candidate.kind === 'iteration'
        )) {
            const values = bindings.get(binding.name) || []
            values.push({
                expression: binding.expression,
                start: binding.scopeStart,
                end: binding.scopeEnd
            })
            bindings.set(binding.name, values)
        }
        return bindings
    }

    /**
     * Returns active lexical initializer expressions at one position.
     * @param {string} name Binding name.
     * @param {Record<string, any>} state Callable state.
     * @param {number} position Source position.
     * @returns {string[]} Active expressions.
     */
    static bindingExpressions(name, state, position) {
        return GerberSourceAst.activeBindings(
            state.lexicalBindings || [],
            name,
            position
        )
            .map((binding) => binding.expression)
            .filter(Boolean)
    }

    /**
     * Resolves an exact call through one unambiguous lexical function binding.
     * @param {string} expression Candidate call expression.
     * @param {Record<string, any>} state Callable analysis state.
     * @param {number} position Call source position.
     * @returns {{ source: string, argumentSources: string[] } | null} Local call.
     */
    static localCall(expression, state, position) {
        const value = GerberSourceExpression.stripParentheses(expression.trim())
        const match = /^([A-Za-z_$][\w$]*)\s*\(/u.exec(value)
        if (!match) return null
        const open = value.indexOf('(', match[1].length)
        const close = GerberSourceExpression.matchingDelimiter(
            value,
            open,
            '(',
            ')'
        )
        if (value.slice(close + 1).trim()) return null
        const sources = new Set(
            GerberSourceCallable.bindingExpressions(match[1], state, position)
        )
        if (sources.size !== 1) return null
        const source = [...sources][0]
        if (
            !/^(?:(?:async\s+)?function\b|(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/u.test(
                source.trim()
            )
        ) {
            return null
        }
        return {
            source,
            argumentSources: GerberSourceExpression.splitTopLevel(
                value.slice(open + 1, close)
            ).filter((argument) => argument.trim())
        }
    }

    /**
     * Reads simple identifier parameters and their default expressions.
     * @param {string} source Callable source.
     * @returns {{ name: string, defaultExpression: string }[]} Parameters.
     */
    static callableParameters(source) {
        const parsed = GerberSourceAstSupport.parseCallable(source, false)
        return (parsed.callable.params || []).map((parameter) => {
            const target =
                parameter.type === 'AssignmentPattern'
                    ? parameter.left
                    : parameter
            return {
                name: target.type === 'Identifier' ? target.name : '',
                defaultExpression:
                    parameter.type === 'AssignmentPattern'
                        ? source.slice(
                              parameter.right.start - parsed.offset,
                              parameter.right.end - parsed.offset
                          )
                        : ''
            }
        })
    }

    /**
     * Resolves a mutable local, alias, member alias, or iteration element.
     * @param {string} root Mutation root identifier.
     * @param {string} path Mutation path below the root.
     * @param {Record<string, any>} state Callable analysis state.
     * @param {number} [position] Mutation source position.
     * @returns {{ root: string, path: string }[]} Canonical mutable locations.
     */
    static mutableLocations(root, path, state, position = Number.MAX_VALUE) {
        const locations = GerberSourceCallable.#rootLocations(
            root,
            state,
            new Set(),
            position
        )
        return GerberSourceCallable.#uniqueLocations(
            locations.map((location) => ({
                root: location.root,
                path: GerberSourceExpression.path(location.path, path)
            }))
        )
    }

    /**
     * Collects constructed types nested inside one literal expression.
     * @param {string} expression Candidate expression.
     * @param {string} prefix Local destination path.
     * @param {Map<string, string>} types Constructed types by path.
     * @returns {void}
     */
    static #collectConstructedTypes(expression, prefix, types) {
        const value = GerberSourceExpression.stripParentheses(expression.trim())
        const className = GerberSourceCallable.#constructedClass(value)
        if (className) {
            types.set(prefix, className)
            return
        }
        const conditional = GerberSourceExpression.conditionalBranches(value)
        const alternatives =
            conditional || GerberSourceExpression.logicalAlternatives(value)
        if (alternatives.length > 1) {
            for (const alternative of alternatives) {
                GerberSourceCallable.#collectConstructedTypes(
                    alternative,
                    prefix,
                    types
                )
            }
            return
        }
        if (
            value.startsWith('{') &&
            GerberSourceExpression.matchingDelimiter(value, 0, '{', '}') ===
                value.length - 1
        ) {
            for (const part of GerberSourceExpression.splitTopLevel(
                value.slice(1, -1)
            )) {
                const trimmed = part.trim()
                if (trimmed.startsWith('...')) {
                    GerberSourceCallable.#collectConstructedTypes(
                        trimmed.slice(3),
                        prefix,
                        types
                    )
                    continue
                }
                const colon = GerberSourceExpression.topLevelToken(trimmed, ':')
                if (colon < 0) continue
                const name = /^([A-Za-z_$][\w$]*)\??$/u.exec(
                    trimmed.slice(0, colon).trim()
                )?.[1]
                if (!name) continue
                GerberSourceCallable.#collectConstructedTypes(
                    trimmed.slice(colon + 1),
                    GerberSourceExpression.path(prefix, name),
                    types
                )
            }
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
                GerberSourceCallable.#collectConstructedTypes(
                    element.replace(/^\.\.\./u, ''),
                    prefix,
                    types
                )
            }
        }
    }

    /**
     * Finds the outer callable body without treating nested block statements
     * as separate functions.
     * @param {string} mask Code-only source mask.
     * @returns {{ start: number, end: number }} Callable body range.
     */
    static #callableBodyRange(mask) {
        const openParameters = mask.indexOf('(')
        if (openParameters < 0) return { start: 0, end: mask.length }
        const closeParameters = GerberSourceExpression.matchingDelimiter(
            mask,
            openParameters,
            '(',
            ')'
        )
        const openBody = mask.indexOf('{', closeParameters + 1)
        if (openBody < 0) return { start: 0, end: mask.length }
        return {
            start: openBody + 1,
            end: GerberSourceExpression.matchingDelimiter(
                mask,
                openBody,
                '{',
                '}'
            )
        }
    }

    /**
     * Finds nested arrow and function bodies inside one callable body.
     * @param {string} mask Code-only source mask.
     * @param {{ start: number, end: number }} range Outer body range.
     * @returns {{ start: number, end: number }[]} Nested function ranges.
     */
    static #nestedFunctionRanges(mask, range) {
        const ranges = []
        for (const match of mask.matchAll(/=>\s*\{/gu)) {
            const open = mask.indexOf('{', match.index)
            if (open < range.start || open >= range.end) continue
            ranges.push({
                start: open,
                end:
                    GerberSourceExpression.matchingDelimiter(
                        mask,
                        open,
                        '{',
                        '}'
                    ) + 1
            })
        }
        for (const match of mask.matchAll(/\bfunction\b/gu)) {
            if (match.index < range.start || match.index >= range.end) continue
            const openParameters = mask.indexOf('(', match.index)
            if (openParameters < 0 || openParameters >= range.end) continue
            const closeParameters = GerberSourceExpression.matchingDelimiter(
                mask,
                openParameters,
                '(',
                ')'
            )
            const open = mask.indexOf('{', closeParameters + 1)
            if (open < 0 || open >= range.end) continue
            ranges.push({
                start: open,
                end:
                    GerberSourceExpression.matchingDelimiter(
                        mask,
                        open,
                        '{',
                        '}'
                    ) + 1
            })
        }
        return ranges
    }

    /**
     * Checks whether one expression index is outside nested delimiters.
     * @param {string} mask Code-only expression mask.
     * @param {number} target Target source index.
     * @returns {boolean} Whether the target is at top level.
     */
    static #isTopLevel(mask, target) {
        let depth = 0
        for (let index = 0; index < target; index += 1) {
            if ('([{'.includes(mask[index])) depth += 1
            else if (')]}'.includes(mask[index])) depth -= 1
        }
        return depth === 0
    }

    /**
     * Finds the end of an unbraced loop statement.
     * @param {string} mask Code-only source mask.
     * @param {number} start Statement start.
     * @returns {number} Exclusive statement end.
     */
    static #statementEnd(mask, start) {
        let depth = 0
        for (let index = start; index < mask.length; index += 1) {
            const character = mask[index]
            if ('([{'.includes(character)) depth += 1
            else if (')]}'.includes(character)) depth -= 1
            else if (character === ';' && depth === 0) return index
            else if (
                (character === '\n' || character === '\r') &&
                depth === 0 &&
                mask.slice(start, index).trim()
            ) {
                return index
            }
        }
        return mask.length
    }

    /**
     * Reads a direct construction expression.
     * @param {string} expression Candidate expression.
     * @returns {string} Constructed class name or empty string.
     */
    static #constructedClass(expression) {
        return (
            /^new\s+([A-Z][A-Za-z0-9_$]*)\s*\(/u.exec(
                GerberSourceExpression.stripParentheses(expression.trim())
            )?.[1] || ''
        )
    }

    /**
     * Copies every known type below one identifier or member alias.
     * @param {Map<string, string>} types Known local types.
     * @param {string} destination Alias variable.
     * @param {string} expression Alias initializer.
     * @returns {boolean} Whether a type was added.
     */
    static #copyAliasTypes(types, destination, expression) {
        const value = GerberSourceExpression.stripParentheses(expression.trim())
        const member = GerberSourceExpression.memberAccess(value)
        const identifier = /^([A-Za-z_$][\w$]*)$/u.exec(value)?.[1]
        const root = member?.root || identifier
        if (!root) return false
        const selected = member?.path || ''
        let changed = false
        for (const [path, className] of [...types]) {
            if (path === root && !selected) {
                changed =
                    GerberSourceCallable.#setType(
                        types,
                        destination,
                        className
                    ) || changed
                continue
            }
            const rootPrefix = `${root}.`
            if (!path.startsWith(rootPrefix)) continue
            const relative = path.slice(rootPrefix.length)
            if (
                selected &&
                relative !== selected &&
                !relative.startsWith(`${selected}.`)
            ) {
                continue
            }
            const suffix = selected
                ? relative === selected
                    ? ''
                    : relative.slice(selected.length + 1)
                : relative
            changed =
                GerberSourceCallable.#setType(
                    types,
                    GerberSourceExpression.path(destination, suffix),
                    className
                ) || changed
        }
        return changed
    }

    /**
     * Adds one local type when it is not already known.
     * @param {Map<string, string>} types Known types.
     * @param {string} path Local path.
     * @param {string} className Constructed class.
     * @returns {boolean} Whether the type was added.
     */
    static #setType(types, path, className) {
        if (!path || !className || types.has(path)) return false
        types.set(path, className)
        return true
    }

    /**
     * Resolves one root identifier through parameters, aliases, and loops.
     * @param {string} root Root identifier.
     * @param {Record<string, any>} state Callable analysis state.
     * @param {Set<string>} resolving Bindings already resolving.
     * @param {number} position Source position being resolved.
     * @returns {{ root: string, path: string }[]} Canonical locations.
     */
    static #rootLocations(root, state, resolving, position) {
        if (state.parameters.has(root)) return [{ root, path: '' }]
        if (resolving.has(root)) return []
        const nextResolving = new Set(resolving).add(root)
        const iterations = (state.iterations.get(root) || [])
            .filter(
                (binding) =>
                    position >= binding.start && position <= binding.end
            )
            .sort(
                (left, right) =>
                    left.end - left.start - (right.end - right.start)
            )
        if (iterations.length) {
            return GerberSourceCallable.#expressionLocations(
                iterations[0].expression,
                state,
                nextResolving,
                position
            )
        }
        const expressions = GerberSourceCallable.bindingExpressions(
            root,
            state,
            position
        )
        if (expressions.length || state.variables.has(root)) {
            const aliases = (
                expressions.length ? expressions : [state.variables.get(root)]
            ).flatMap((expression) =>
                GerberSourceCallable.#expressionLocations(
                    expression,
                    state,
                    nextResolving,
                    position
                )
            )
            return aliases.length ? aliases : [{ root, path: '' }]
        }
        return []
    }

    /**
     * Resolves direct lvalue alternatives from one expression.
     * @param {string} expression Source expression.
     * @param {Record<string, any>} state Callable analysis state.
     * @param {Set<string>} resolving Bindings already resolving.
     * @param {number} position Source position being resolved.
     * @returns {{ root: string, path: string }[]} Canonical locations.
     */
    static #expressionLocations(expression, state, resolving, position) {
        const value = GerberSourceExpression.stripParentheses(expression.trim())
        const conditional = GerberSourceExpression.conditionalBranches(value)
        const alternatives =
            conditional || GerberSourceExpression.logicalAlternatives(value)
        if (alternatives.length > 1) {
            return GerberSourceCallable.#uniqueLocations(
                alternatives.flatMap((alternative) =>
                    GerberSourceCallable.#expressionLocations(
                        alternative,
                        state,
                        resolving,
                        position
                    )
                )
            )
        }
        const member = GerberSourceExpression.memberAccess(value)
        const identifier = /^([A-Za-z_$][\w$]*)$/u.exec(value)?.[1]
        const root = member?.root || identifier
        if (!root) return []
        return GerberSourceCallable.#rootLocations(
            root,
            state,
            resolving,
            position
        ).map((location) => ({
            root: location.root,
            path: GerberSourceExpression.path(location.path, member?.path || '')
        }))
    }

    /**
     * Removes duplicate mutable locations.
     * @param {{ root: string, path: string }[]} locations Mutable locations.
     * @returns {{ root: string, path: string }[]} Unique locations.
     */
    static #uniqueLocations(locations) {
        const unique = new Map()
        for (const location of locations) {
            unique.set(`${location.root}:${location.path}`, location)
        }
        return [...unique.values()]
    }
}
