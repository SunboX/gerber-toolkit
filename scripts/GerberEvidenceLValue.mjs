/**
 * Resolves symbolic assignment targets without recording positive reads.
 */
export class GerberEvidenceLValue {
    /**
     * Resolves an identifier/member lvalue.
     * @param {Record<string, any>} node Assignment target.
     * @param {Record<string, any>} environment Lexical environment.
     * @param {(node: Record<string, any>, environment: Record<string, any>) => Set<string>} evaluate Expression evaluator.
     * @returns {Set<string>} Symbolic target pairs.
     */
    static values(node, environment, evaluate) {
        if (node?.type === 'Identifier') {
            return new Set(environment.get(node.name)?.values || [])
        }
        if (!isMember(node)) return new Set()
        const values = evaluate(node.object, environment)
        const property = staticName(node)
        return property ? mapValues(values, property) : values
    }
}

/** @param {Record<string, any>} node AST node. @returns {boolean} Member status. */
function isMember(node) {
    return ['MemberExpression', 'OptionalMemberExpression'].includes(node?.type)
}

/** @param {Record<string, any>} node Member node. @returns {string} Static name. */
function staticName(node) {
    const property = node?.property
    if (!property) return ''
    if (!node.computed && property.type === 'Identifier') return property.name
    return ['StringLiteral', 'NumericLiteral'].includes(property.type)
        ? String(property.value)
        : ''
}

/** @param {Set<string>} values Pairs. @param {string} child Child path. @returns {Set<string>} Mapped pairs. */
function mapValues(values, child) {
    return new Set(
        [...values].map((value) => {
            const separator = value.indexOf('\u0000')
            const origin = value.slice(0, separator)
            const path = value.slice(separator + 1)
            return `${origin}\u0000${[path, child].filter(Boolean).join('.')}`
        })
    )
}
