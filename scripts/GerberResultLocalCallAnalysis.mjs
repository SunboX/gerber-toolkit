import { GerberSourceAst } from './GerberSourceAst.mjs'
import { GerberSourceCallable } from './GerberSourceCallable.mjs'

/**
 * Materializes direct calls to lexically bound local functions.
 */
export class GerberResultLocalCallAnalysis {
    /**
     * Analyzes one exact local call in its lexical argument context.
     * @param {{ expression: string, prefix: string, state: Record<string, any>, shape: Record<string, any>, resolving: Set<string>, position: number, services: { analyze: Function, createShape: Function } }} options Analysis inputs.
     * @returns {boolean} Whether a local call was handled.
     */
    static analyze(options) {
        const call = GerberSourceCallable.localCall(
            options.expression,
            options.state,
            options.position
        )
        if (!call) return false
        const key = `local:${call.source}`
        if (options.resolving.has(key)) return true
        const facts = GerberSourceAst.facts(call.source)
        const variables = new Map(
            facts.bindings
                .filter((binding) => binding.expression)
                .map((binding) => [binding.name, binding.expression])
        )
        const child = {
            ...options.state,
            source: call.source,
            facts,
            variables,
            assignments: facts.assignments,
            variableTypes: GerberSourceCallable.variableTypes(
                variables,
                facts.assignments
            ),
            lexicalBindings: facts.bindings,
            thisValue: call.source.includes('=>')
                ? options.state.thisValue
                : { known: true, value: undefined },
            parameters: new Set(),
            bindings: new Map(options.state.bindings)
        }
        const parameters = GerberSourceCallable.callableParameters(call.source)
        for (let index = 0; index < parameters.length; index += 1) {
            const parameter = parameters[index]
            if (!parameter.name) continue
            child.parameters.add(parameter.name)
            const argument =
                call.argumentSources[index] || parameter.defaultExpression
            if (!argument) continue
            const value = options.services.createShape()
            options.services.analyze(
                argument,
                '',
                child,
                value,
                options.resolving,
                options.position
            )
            child.bindings.set(parameter.name, value)
        }
        const resolving = new Set(options.resolving).add(key)
        for (const returned of facts.returns) {
            options.services.analyze(
                returned.expression,
                options.prefix,
                child,
                options.shape,
                resolving,
                returned.index
            )
        }
        return true
    }
}
