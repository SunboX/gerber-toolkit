import { GerberSourceAstSupport } from './GerberSourceAstSupport.mjs'
import { GerberSourceBindingRecorder } from './GerberSourceBindingRecorder.mjs'
import { GerberSourceCollectionProvenance } from './GerberSourceCollectionProvenance.mjs'

/** Stateless binding-declaration helpers for the callable AST walker. */
export class GerberSourceDeclaration {
    /**
     * Declares a binding pattern from an AST initializer.
     * @param {Record<string, any>} context Declaration context.
     * @returns {void}
     */
    static declare(context) {
        const { pattern, initializer, position, text, accesses } = context
        for (const target of GerberSourceAstSupport.patternTargets(
            pattern,
            initializer
        )) {
            accesses.push({ ...target, index: position(pattern.start) })
        }
        GerberSourceDeclaration.declareSource({
            ...context,
            expression: initializer ? text(initializer) : '',
            collectionDepth: GerberSourceCollectionProvenance.depth(
                initializer,
                context.scope
            )
        })
    }

    /**
     * Declares a binding pattern from explicit source text.
     * @param {Record<string, any>} context Declaration context.
     * @returns {void}
     */
    static declareSource(context) {
        const { pattern } = context
        if (!pattern) return
        if (pattern.type === 'Identifier') {
            GerberSourceBindingRecorder.record({
                name: pattern.name,
                expression: context.expression,
                initializer: context.initializer,
                scope: context.scope,
                start: context.start,
                kind: context.kind,
                collectionDepth: context.collectionDepth || 0,
                bindings: context.bindings
            })
            return
        }
        if (pattern.type === 'AssignmentPattern') {
            GerberSourceDeclaration.declareSource({
                ...context,
                pattern: pattern.left
            })
            return
        }
        if (pattern.type === 'RestElement') {
            GerberSourceDeclaration.declareSource({
                ...context,
                pattern: pattern.argument
            })
            return
        }
        if (pattern.type === 'ArrayPattern') {
            for (const element of pattern.elements) {
                GerberSourceDeclaration.declareSource({
                    ...context,
                    pattern: element,
                    collectionDepth: Math.max(
                        0,
                        (context.collectionDepth || 0) - 1
                    )
                })
            }
        }
    }

    /**
     * Records one AST-backed lexical binding.
     * @param {Record<string, any>} context Binding context.
     * @returns {void}
     */
    static recordBinding(context) {
        GerberSourceBindingRecorder.record({
            name: context.name,
            expression: context.text(context.initializer),
            initializer: context.initializer,
            scope: context.scope,
            start: context.start,
            kind: context.kind,
            collectionDepth: GerberSourceCollectionProvenance.depth(
                context.initializer,
                context.scope
            ),
            bindings: context.bindings
        })
    }
}

Object.freeze(GerberSourceDeclaration.prototype)
Object.freeze(GerberSourceDeclaration)
