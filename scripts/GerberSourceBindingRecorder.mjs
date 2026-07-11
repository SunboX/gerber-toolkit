import { GerberSourceAstSupport } from './GerberSourceAstSupport.mjs'

/**
 * Records lexical source bindings and their callable/collection metadata.
 */
export class GerberSourceBindingRecorder {
    /**
     * Adds one binding to its scope and the flattened fact list.
     * @param {{ name: string, expression: string, initializer: Record<string, any> | null, scope: Record<string, any>, start: number, kind: string, collectionDepth?: number, bindings: Record<string, any>[] }} options Binding inputs.
     * @returns {void}
     */
    static record(options) {
        const objectMethods = new Map()
        if (options.initializer?.type === 'ObjectExpression') {
            for (const property of options.initializer.properties) {
                if (property.type === 'ObjectMethod') {
                    objectMethods.set(
                        GerberSourceAstSupport.staticName(property),
                        property
                    )
                }
            }
        }
        options.scope.declarations.set(options.name, {
            callable: GerberSourceAstSupport.isFunction(options.initializer)
                ? options.initializer
                : null,
            initializer: options.initializer,
            collectionDepth: options.collectionDepth || 0,
            collectionPaths: new Map(),
            objectMethods,
            scope: options.scope
        })
        options.bindings.push({
            name: options.name,
            expression: options.expression,
            start: options.start,
            scopeStart: options.scope.start,
            scopeEnd: options.scope.end,
            kind: options.kind,
            collectionDepth: options.collectionDepth || 0
        })
    }
}
