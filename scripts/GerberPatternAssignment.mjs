/**
 * Maps literal destructuring assignment targets to their selected values.
 */
export class GerberPatternAssignment {
    /**
     * Resolves identifier targets from Array/Object literal assignments.
     * @param {Record<string, any>} pattern Assignment pattern.
     * @param {Record<string, any> | null} value Assigned value.
     * @returns {{ name: string, value: Record<string, any> | null }[]} Target values.
     */
    static entries(pattern, value) {
        if (!pattern) return []
        if (pattern.type === 'Identifier') {
            return [{ name: pattern.name, value }]
        }
        if (pattern.type === 'AssignmentPattern') {
            return GerberPatternAssignment.entries(
                pattern.left,
                value || pattern.right
            )
        }
        if (pattern.type === 'RestElement') {
            return GerberPatternAssignment.entries(pattern.argument, value)
        }
        if (
            pattern.type === 'ArrayPattern' &&
            value?.type === 'ArrayExpression'
        ) {
            return pattern.elements.flatMap((element, index) =>
                GerberPatternAssignment.entries(
                    element,
                    value.elements[index]?.argument || value.elements[index]
                )
            )
        }
        if (
            pattern.type === 'ObjectPattern' &&
            value?.type === 'ObjectExpression'
        ) {
            return pattern.properties.flatMap((property) => {
                if (property.type === 'RestElement') return []
                const name = staticName(property)
                const selected = value.properties.find(
                    (candidate) =>
                        candidate.type !== 'SpreadElement' &&
                        staticName(candidate) === name
                )
                return GerberPatternAssignment.entries(
                    property.value,
                    selected?.value || null
                )
            })
        }
        return []
    }
}

/** @param {Record<string, any>} node Property node. @returns {string} Static name. */
function staticName(node) {
    const key = node?.key
    if (!key) return ''
    if (!node.computed && key.type === 'Identifier') return key.name
    return ['StringLiteral', 'NumericLiteral'].includes(key.type)
        ? String(key.value)
        : ''
}
