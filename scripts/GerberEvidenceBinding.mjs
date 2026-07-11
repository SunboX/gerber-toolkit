import { GerberEvidenceProvenance } from './GerberEvidenceProvenance.mjs'

/**
 * Creates lexical evidence bindings from AST initializers.
 */
export class GerberEvidenceBinding {
    /**
     * Builds one binding with symbolic values and callable/object metadata.
     * @param {Record<string, any> | null} node Initializer AST.
     * @param {Set<string>} values Symbolic values.
     * @param {Record<string, any>} closure Captured environment.
     * @returns {Record<string, any>} Binding record.
     */
    static create(node, values, closure) {
        const methods = new Map()
        if (node?.type === 'ObjectExpression') {
            for (const property of node.properties) {
                if (property.type === 'ObjectMethod') {
                    methods.set(staticName(property), property)
                }
            }
        }
        const collection = GerberEvidenceProvenance.isCollection(node, closure)
        const sourceBinding =
            node?.type === 'Identifier' ? closure.get(node.name) : null
        return {
            values: new Set(values),
            callable: isFunction(node) ? node : null,
            methods,
            closure,
            initializer: node,
            collection,
            collectionIdentity:
                sourceBinding?.collectionIdentity ||
                (collection ? Object.freeze({}) : null)
        }
    }
}

/** @param {Record<string, any> | null} node AST node. @returns {boolean} Function-like status. */
function isFunction(node) {
    return [
        'ArrowFunctionExpression',
        'FunctionDeclaration',
        'FunctionExpression',
        'ObjectMethod'
    ].includes(node?.type)
}

/** @param {Record<string, any>} node Property node. @returns {string} Static name. */
function staticName(node) {
    const property = node?.property || node?.key
    if (!property) return ''
    if (!node.computed && property.type === 'Identifier') return property.name
    return ['StringLiteral', 'NumericLiteral'].includes(property.type)
        ? String(property.value)
        : ''
}
