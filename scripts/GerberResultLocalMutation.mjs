import { parsers } from 'prettier/plugins/babel'

/**
 * Applies deterministic local delete and splice mutations before a return.
 */
export class GerberResultLocalMutation {
    /**
     * Resolves exact mutation effects for one local initializer.
     * @param {string} name Local binding name.
     * @param {string[]} initializers Reachable initializer sources.
     * @param {Record<string, any>} state Callable state.
     * @param {number} position Return position.
     * @returns {{ elements: string[] | null, deleted: Set<string> }} Effects.
     */
    static resolve(name, initializers, state, position) {
        const effects = (state.facts?.mutations || [])
            .filter((effect) => effect.root === name && effect.index < position)
            .sort((left, right) => left.index - right.index)
        const deleted = new Set()
        for (const effect of effects) {
            if (effect.type === 'delete' && effect.path) {
                deleted.add(effect.path)
            }
            if (effect.type === 'assignment') {
                for (const path of [...deleted]) {
                    if (
                        path === effect.path ||
                        path.startsWith(`${effect.path}.`) ||
                        effect.path.startsWith(`${path}.`)
                    ) {
                        deleted.delete(path)
                    }
                }
            }
        }
        if (initializers.length !== 1) return { elements: null, deleted }
        const parsed = parseExpression(initializers[0])
        const splices = effects.filter(
            (effect) => effect.type === 'splice' && !effect.path
        )
        if (!splices.length || parsed?.node.type !== 'ArrayExpression') {
            return { elements: null, deleted }
        }
        const elements = parsed.node.elements
            .filter(Boolean)
            .map((node) => text(parsed, node.expression || node))
        for (const effect of splices) {
            const start = staticInteger(effect.arguments[0])
            const count = staticInteger(effect.arguments[1])
            if (start === null || (effect.arguments[1] && count === null)) {
                return { elements: null, deleted }
            }
            elements.splice(
                start,
                effect.arguments[1] ? count : elements.length,
                ...effect.arguments.slice(2)
            )
        }
        return { elements, deleted }
    }

    /**
     * Removes deleted fields and nested sources from one isolated shape.
     * @param {Record<string, any>} shape Abstract local shape.
     * @param {Set<string>} deleted Deleted local paths.
     * @returns {void}
     */
    static applyDeleted(shape, deleted) {
        const removed = (path) =>
            [...deleted].some(
                (candidate) =>
                    path === candidate || path.startsWith(`${candidate}.`)
            )
        for (const field of [...shape.fields]) {
            if (removed(field)) shape.fields.delete(field)
        }
        for (const field of [...shape.types.keys()]) {
            if (removed(field)) shape.types.delete(field)
        }
        for (const key of ['references', 'parameters', 'locals']) {
            shape[key] = shape[key].filter((source) => {
                const prefix = source.prefix || ''
                return !prefix || !removed(prefix)
            })
        }
    }
}

/**
 * Parses an isolated initializer expression.
 * @param {string} source Expression source.
 * @returns {{ source: string, offset: number, node: Record<string, any> } | null} Parsed expression.
 */
function parseExpression(source) {
    const value = String(source || '').trim()
    const prefix = 'const __gerber_local__ = ('
    try {
        const ast = parsers.babel.parse(`${prefix}${value})`, {
            filepath: 'gerber-result-local.mjs'
        })
        return {
            source: value,
            offset: prefix.length,
            node: ast.program.body[0].declarations[0].init
        }
    } catch {
        return null
    }
}

/**
 * Resolves a static integer from recorded source.
 * @param {string | undefined} source Argument source.
 * @returns {number | null} Integer or null.
 */
function staticInteger(source) {
    if (source === undefined) return null
    const value = Number(String(source).trim())
    return Number.isInteger(value) ? value : null
}

/**
 * Reads one AST node from its isolated source.
 * @param {Record<string, any>} parsed Parsed source.
 * @param {Record<string, any>} node AST node.
 * @returns {string} Node source.
 */
function text(parsed, node) {
    return parsed.source.slice(
        node.start - parsed.offset,
        node.end - parsed.offset
    )
}
