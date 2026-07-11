import { parsers } from 'prettier/plugins/babel'

const FLOW_OPEN = 'open'
const FLOW_RETURN = 'return'
const FLOW_THROW = 'throw'
const FLOW_ABRUPT = 'abrupt'
const FLOW_HALT = 'halt'

/**
 * Shared parsing and structural helpers for reachable source analysis.
 */
export class GerberSourceAstSupport {
    /**
     * Parses class-member or standalone-function source into one callable AST.
     * @param {string} source Callable source.
     * @param {boolean} bodyOnly Whether source is only a body fragment.
     * @returns {{ callable: Record<string, any>, offset: number }} Parsed callable.
     */
    static parseCallable(source, bodyOnly) {
        if (bodyOnly) {
            const prefix = 'function __gerber__(){\n'
            const ast = parsers.babel.parse(`${prefix}${source}\n}`, {
                filepath: 'gerber-callable.mjs'
            })
            return { callable: ast.program.body[0], offset: prefix.length }
        }
        const classPrefix = 'class __GerberCallable {\n'
        try {
            const ast = parsers.babel.parse(`${classPrefix}${source}\n}`, {
                filepath: 'gerber-callable.mjs'
            })
            return {
                callable: ast.program.body[0].body.body[0],
                offset: classPrefix.length
            }
        } catch {
            const expressionPrefix = '('
            const ast = parsers.babel.parse(`${expressionPrefix}${source})`, {
                filepath: 'gerber-callable.mjs'
            })
            return {
                callable: ast.program.body[0].expression,
                offset: expressionPrefix.length
            }
        }
    }

    /**
     * Reads a simple identifier/member target from an AST node.
     * @param {Record<string, any> | null} node Target node.
     * @returns {{ root: string, path: string } | null} Normalized target.
     */
    static memberTarget(node) {
        if (!node) return null
        if (node.type === 'Identifier') return { root: node.name, path: '' }
        if (!GerberSourceAstSupport.isMember(node)) return null
        const parent = GerberSourceAstSupport.memberTarget(node.object)
        const name = GerberSourceAstSupport.staticName(node)
        if (!parent || !name || /^\d+$/u.test(name)) return parent
        return {
            root: parent.root,
            path: [parent.path, name].filter(Boolean).join('.')
        }
    }

    /**
     * Resolves static member paths selected by an object binding pattern.
     * @param {Record<string, any>} pattern Binding pattern.
     * @param {Record<string, any> | null} initializer Pattern initializer.
     * @returns {{ root: string, path: string }[]} Selected member paths.
     */
    static patternTargets(pattern, initializer) {
        const target = GerberSourceAstSupport.memberTarget(initializer)
        if (!target || pattern?.type !== 'ObjectPattern') return []
        const paths = []
        GerberSourceAstSupport.#visitPattern(pattern, [], (segments) => {
            paths.push({
                root: target.root,
                path: [target.path, ...segments].filter(Boolean).join('.')
            })
        })
        return paths
    }

    /**
     * Visits statically named object-pattern properties recursively.
     * @param {Record<string, any>} pattern Binding pattern.
     * @param {string[]} prefix Selected parent path.
     * @param {(segments: string[]) => void} visitor Path visitor.
     * @returns {void}
     */
    static #visitPattern(pattern, prefix, visitor) {
        const value =
            pattern?.type === 'AssignmentPattern' ? pattern.left : pattern
        if (value?.type !== 'ObjectPattern') return
        for (const property of value.properties || []) {
            if (property.type === 'RestElement') continue
            const name = GerberSourceAstSupport.staticName(property)
            if (!name || /^\d+$/u.test(name)) continue
            const path = [...prefix, name]
            visitor(path)
            GerberSourceAstSupport.#visitPattern(property.value, path, visitor)
        }
    }

    /**
     * Lists direct expression child nodes without entering function bodies.
     * @param {Record<string, any>} node Expression node.
     * @returns {Record<string, any>[]} Child expressions.
     */
    static expressionChildren(node) {
        const children = []
        for (const [key, value] of Object.entries(node || {})) {
            if (
                ['loc', 'start', 'end', 'type', 'comments', 'errors'].includes(
                    key
                )
            ) {
                continue
            }
            for (const candidate of Array.isArray(value) ? value : [value]) {
                if (
                    candidate &&
                    typeof candidate === 'object' &&
                    typeof candidate.type === 'string' &&
                    !GerberSourceAstSupport.isFunction(candidate) &&
                    !candidate.type.endsWith('Statement')
                ) {
                    children.push(candidate)
                }
            }
        }
        return children
    }

    /**
     * Merges two alternative statement flows conservatively.
     * @param {string} left Consequent flow.
     * @param {string} right Alternate or handler flow.
     * @param {boolean} complete Whether both alternatives exist.
     * @returns {string} Shared abrupt flow or `open`.
     */
    static mergeFlows(left, right, complete) {
        if (!complete || left === FLOW_OPEN || right === FLOW_OPEN) {
            return FLOW_OPEN
        }
        if (left === right) return left
        const functionAbrupt = new Set([
            FLOW_RETURN,
            FLOW_THROW,
            FLOW_ABRUPT,
            FLOW_HALT
        ])
        return functionAbrupt.has(left) && functionAbrupt.has(right)
            ? FLOW_ABRUPT
            : FLOW_OPEN
    }

    /**
     * Checks call-expression variants.
     * @param {Record<string, any> | null} node AST node.
     * @returns {boolean} Whether this is a call.
     */
    static isCall(node) {
        return ['CallExpression', 'OptionalCallExpression'].includes(node?.type)
    }

    /**
     * Checks member-expression variants.
     * @param {Record<string, any> | null} node AST node.
     * @returns {boolean} Whether this is a member.
     */
    static isMember(node) {
        return ['MemberExpression', 'OptionalMemberExpression'].includes(
            node?.type
        )
    }

    /**
     * Checks function-expression variants used as reachable callbacks.
     * @param {Record<string, any> | null} node AST node.
     * @returns {boolean} Whether this is a function.
     */
    static isFunction(node) {
        return [
            'ArrowFunctionExpression',
            'FunctionDeclaration',
            'FunctionExpression',
            'ObjectMethod'
        ].includes(node?.type)
    }

    /**
     * Reads a static member/property name.
     * @param {Record<string, any> | null} node Member or property node.
     * @returns {string} Static name or empty string.
     */
    static staticName(node) {
        const property = node?.property || node?.key
        if (!property) return ''
        if (
            !node.computed &&
            ['Identifier', 'PrivateName'].includes(property.type)
        ) {
            return property.type === 'PrivateName'
                ? `#${property.id.name}`
                : property.name
        }
        if (['StringLiteral', 'NumericLiteral'].includes(property.type)) {
            return String(property.value)
        }
        return ''
    }
}
