import { cloneEvidenceBinding } from './GerberEvidenceEnvironment.mjs'
import {
    isCall,
    isMember,
    mapValues,
    memberName
} from './GerberEvidenceValues.mjs'

/** Stateless helpers used by the lexical evidence interpreter. */
export class GerberEvidenceAnalyzerSupport {
    /**
     * Resolves an unshadowed `Object.keys(value)` target.
     * @param {Record<string, any>} node Candidate expression.
     * @param {GerberEvidenceEnvironment} environment Lexical environment.
     * @param {(node: Record<string, any>) => Set<string>} expression Expression evaluator.
     * @returns {Set<string>} Symbolic target.
     */
    static objectKeysTarget(node, environment, expression) {
        let value = node
        if (
            isCall(value) &&
            isMember(value.callee) &&
            memberName(value.callee) === 'sort'
        ) {
            value = value.callee.object
        }
        if (
            !isCall(value) ||
            !isMember(value.callee) ||
            value.callee.object?.name !== 'Object' ||
            memberName(value.callee) !== 'keys' ||
            environment.get('Object')
        ) {
            return new Set()
        }
        return expression(value.arguments[0]?.expression || value.arguments[0])
    }

    /**
     * Declares identifier and destructuring patterns recursively.
     * @param {Record<string, any>} pattern Binding pattern.
     * @param {Record<string, any>} binding Symbolic binding.
     * @param {GerberEvidenceEnvironment} environment Lexical environment.
     * @returns {void}
     */
    static declarePattern(pattern, binding, environment) {
        if (!pattern) return
        if (pattern.type === 'Identifier') {
            environment.declare(pattern.name, cloneEvidenceBinding(binding))
            return
        }
        if (pattern.type === 'AssignmentPattern') {
            GerberEvidenceAnalyzerSupport.declarePattern(
                pattern.left,
                binding,
                environment
            )
            return
        }
        if (pattern.type === 'RestElement') {
            GerberEvidenceAnalyzerSupport.declarePattern(
                pattern.argument,
                binding,
                environment
            )
            return
        }
        if (pattern.type === 'ArrayPattern') {
            for (const element of pattern.elements) {
                GerberEvidenceAnalyzerSupport.declarePattern(
                    element,
                    binding,
                    environment
                )
            }
            return
        }
        if (pattern.type === 'ObjectPattern') {
            for (const property of pattern.properties) {
                const name = memberName(property)
                GerberEvidenceAnalyzerSupport.declarePattern(
                    property.value || property.argument,
                    {
                        ...binding,
                        values: name
                            ? mapValues(binding.values || new Set(), name)
                            : binding.values
                    },
                    environment
                )
            }
        }
    }
}

Object.freeze(GerberEvidenceAnalyzerSupport.prototype)
Object.freeze(GerberEvidenceAnalyzerSupport)
