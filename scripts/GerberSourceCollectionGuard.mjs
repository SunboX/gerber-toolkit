/**
 * Extracts exact intrinsic `Array.isArray` member proofs from source ASTs.
 */
export class GerberSourceCollectionGuard {
    /**
     * Resolves the guarded value of an `Array.isArray(value)` expression.
     * @param {Record<string, any> | null} node Candidate test expression.
     * @returns {{ root: string, path: string } | null} Guarded target.
     */
    static target(node) {
        return memberTarget(GerberSourceCollectionGuard.expression(node))
    }

    /**
     * Returns the exact value guarded by an intrinsic `Array.isArray` call.
     * @param {Record<string, any> | null} node Candidate test expression.
     * @returns {Record<string, any> | null} Guarded expression.
     */
    static expression(node) {
        const value = unwrap(node)
        if (
            !['CallExpression', 'OptionalCallExpression'].includes(
                value?.type
            ) ||
            !['MemberExpression', 'OptionalMemberExpression'].includes(
                value.callee?.type
            ) ||
            value.callee.object?.type !== 'Identifier' ||
            value.callee.object.name !== 'Array' ||
            staticName(value.callee) !== 'isArray'
        ) {
            return null
        }
        return value.arguments[0]?.expression || value.arguments[0] || null
    }

    /**
     * Checks whether an expression selects one exact guarded target.
     * @param {Record<string, any> | null} node Candidate expression.
     * @param {{ root: string, path: string } | null} target Guarded target.
     * @returns {boolean} Whether both expressions identify the same value.
     */
    static matches(node, target) {
        const candidate = memberTarget(unwrap(node))
        return Boolean(
            candidate &&
            target &&
            candidate.root === target.root &&
            candidate.path === target.path
        )
    }
}

/**
 * Removes syntax-only expression wrappers.
 * @param {Record<string, any> | null} node Expression node.
 * @returns {Record<string, any> | null} Unwrapped expression.
 */
function unwrap(node) {
    let value = node
    while (
        [
            'ParenthesizedExpression',
            'TSAsExpression',
            'TSTypeAssertion',
            'TypeCastExpression',
            'ChainExpression'
        ].includes(value?.type)
    ) {
        value = value.expression || value.argument
    }
    return value || null
}

/**
 * Resolves a static identifier/member target.
 * @param {Record<string, any> | null} node Expression node.
 * @returns {{ root: string, path: string } | null} Static target.
 */
function memberTarget(node) {
    if (!node) return null
    if (node.type === 'Identifier') return { root: node.name, path: '' }
    if (!['MemberExpression', 'OptionalMemberExpression'].includes(node.type)) {
        return null
    }
    const parent = memberTarget(node.object)
    const name = staticName(node)
    if (!parent || !name || /^\d+$/u.test(name)) return null
    return {
        root: parent.root,
        path: [parent.path, name].filter(Boolean).join('.')
    }
}

/**
 * Reads one static member name.
 * @param {Record<string, any>} node Member node.
 * @returns {string} Static member name.
 */
function staticName(node) {
    const property = node?.property
    if (!property) return ''
    if (!node.computed && property.type === 'Identifier') return property.name
    return ['StringLiteral', 'NumericLiteral'].includes(property.type)
        ? String(property.value)
        : ''
}
