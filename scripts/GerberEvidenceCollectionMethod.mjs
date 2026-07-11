import { GerberEvidenceLValue } from './GerberEvidenceLValue.mjs'

/**
 * Tracks flow-sensitive overrides of intrinsic collection methods.
 */
export class GerberEvidenceCollectionMethod {
    /**
     * Records a member assignment that replaces a collection method.
     * @param {Record<string, any>} member Assignment member.
     * @param {Record<string, any>} environment Evidence environment.
     * @param {(node: Record<string, any>, environment: Record<string, any>) => Set<string>} evaluate Evaluator.
     * @returns {void}
     */
    static recordOverride(member, environment, evaluate) {
        if (!isMember(member)) return
        const method = staticName(member)
        if (!method) return
        const receiver = member.object
        if (receiver?.type === 'Identifier') {
            environment.overrideCollectionMethod(
                environment.get(receiver.name)?.collectionIdentity,
                method
            )
        }
        for (const value of GerberEvidenceLValue.values(
            receiver,
            environment,
            evaluate
        )) {
            environment.overrideCollectionMethod(value, method)
        }
    }

    /**
     * Checks a receiver against local and public-result override identities.
     * @param {Record<string, any>} receiver Receiver expression.
     * @param {Set<string>} values Symbolic receiver values.
     * @param {string} method Method name.
     * @param {Record<string, any>} environment Evidence environment.
     * @returns {boolean} Whether intrinsic semantics are unavailable.
     */
    static isOverridden(receiver, values, method, environment) {
        const localIdentity =
            receiver?.type === 'Identifier'
                ? environment.get(receiver.name)?.collectionIdentity
                : null
        return (
            environment.collectionMethodOverridden(localIdentity, method) ||
            [...values].some((value) =>
                environment.collectionMethodOverridden(value, method)
            )
        )
    }
}

/** @param {Record<string, any> | null} node AST node. @returns {boolean} Member status. */
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
