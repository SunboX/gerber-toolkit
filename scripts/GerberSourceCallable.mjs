import { GerberSourceExpression } from './GerberSourceExpression.mjs'

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
        for (const match of source.matchAll(
            /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gu
        )) {
            const start = match.index + match[0].length
            variables.set(
                match[1],
                GerberSourceCallable.expressionAt(source, start)
            )
        }
        return variables
    }

    /**
     * Parses property assignments made after local object initialization.
     * @param {string} source Callable source.
     * @returns {Map<string, { path: string, expression: string }[]>} Assignments by root.
     */
    static propertyAssignments(source) {
        const assignments = new Map()
        for (const match of source.matchAll(
            /\b([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*=(?!=)/gu
        )) {
            const values = assignments.get(match[1]) || []
            values.push({
                path: match[2],
                expression: GerberSourceCallable.expressionAt(
                    source,
                    match.index + match[0].length
                )
            })
            assignments.set(match[1], values)
        }
        return assignments
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
            const className = GerberSourceCallable.#constructedClass(expression)
            if (className) types.set(name, className)
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
     * @returns {string[]} Return expressions.
     */
    static returnExpressions(source) {
        const expressions = []
        for (const match of source.matchAll(/\breturn\b/gu)) {
            expressions.push(
                GerberSourceCallable.expressionAt(
                    source,
                    match.index + match[0].length
                ).replace(/^await\s+/u, '')
            )
        }
        return expressions.filter(Boolean)
    }

    /**
     * Extracts one map, flatMap, or shape-preserving filter callback.
     * @param {string} expression Expression source.
     * @returns {{ method: string, source: string, parameter: string, returns: string[] } | null} Array callback contract.
     */
    static arrayCallback(expression) {
        const match = /\.(map|flatMap|filter)\s*\(/u.exec(expression)
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
        return {
            method: match[1],
            source: expression.slice(0, match.index).trim(),
            parameter: GerberSourceExpression.arrowParameter(
                callback.slice(0, arrow)
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
                      )
                  )
                : [body]
        }
    }

    /**
     * Resolves a call argument back to canonical mutable locations.
     * @param {string} expression Argument expression.
     * @param {Record<string, any>} state Callable analysis state.
     * @returns {{ root: string, path: string }[]} Mutable argument locations.
     */
    static argumentLocations(expression, state) {
        const value = GerberSourceExpression.stripParentheses(
            expression.trim().replace(/^\.\.\./u, '')
        )
        const member = GerberSourceExpression.memberAccess(value)
        const root = member?.root || /^([A-Za-z_$][\w$]*)$/u.exec(value)?.[1]
        if (!root) return []
        return GerberSourceCallable.mutableLocations(
            root,
            member?.path || '',
            state
        )
    }

    /**
     * Reads one expression until its first complete statement boundary.
     * @param {string} source Source text.
     * @param {number} start Expression start index.
     * @returns {string} Expression source.
     */
    static expressionAt(source, start) {
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
     * Parses `for...of` element bindings and their collection expressions.
     * @param {string} source Callable source.
     * @returns {Map<string, string>} Collection expressions by element binding.
     */
    static iterationBindings(source) {
        const bindings = new Map()
        for (const match of source.matchAll(
            /\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+of\s+/gu
        )) {
            const open = source.indexOf('(', match.index)
            const close = GerberSourceExpression.matchingDelimiter(
                source,
                open,
                '(',
                ')'
            )
            bindings.set(
                match[1],
                source.slice(match.index + match[0].length, close).trim()
            )
        }
        return bindings
    }

    /**
     * Resolves a mutable local, alias, member alias, or iteration element.
     * @param {string} root Mutation root identifier.
     * @param {string} path Mutation path below the root.
     * @param {Record<string, any>} state Callable analysis state.
     * @returns {{ root: string, path: string }[]} Canonical mutable locations.
     */
    static mutableLocations(root, path, state) {
        const locations = GerberSourceCallable.#rootLocations(
            root,
            state,
            new Set()
        )
        return GerberSourceCallable.#uniqueLocations(
            locations.map((location) => ({
                root: location.root,
                path: GerberSourceExpression.path(location.path, path)
            }))
        )
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
     * @returns {{ root: string, path: string }[]} Canonical locations.
     */
    static #rootLocations(root, state, resolving) {
        if (state.parameters.has(root)) return [{ root, path: '' }]
        if (resolving.has(root)) return []
        const nextResolving = new Set(resolving).add(root)
        if (state.iterations.has(root)) {
            return GerberSourceCallable.#expressionLocations(
                state.iterations.get(root),
                state,
                nextResolving
            )
        }
        if (state.variables.has(root)) {
            const aliases = GerberSourceCallable.#expressionLocations(
                state.variables.get(root),
                state,
                nextResolving
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
     * @returns {{ root: string, path: string }[]} Canonical locations.
     */
    static #expressionLocations(expression, state, resolving) {
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
                        resolving
                    )
                )
            )
        }
        const member = GerberSourceExpression.memberAccess(value)
        const identifier = /^([A-Za-z_$][\w$]*)$/u.exec(value)?.[1]
        const root = member?.root || identifier
        if (!root) return []
        return GerberSourceCallable.#rootLocations(root, state, resolving).map(
            (location) => ({
                root: location.root,
                path: GerberSourceExpression.path(
                    location.path,
                    member?.path || ''
                )
            })
        )
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
