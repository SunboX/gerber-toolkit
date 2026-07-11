import { GerberDiscriminatedCollectionProvenance } from './GerberDiscriminatedCollectionProvenance.mjs'
import { GerberSourceAst } from './GerberSourceAst.mjs'
import { GerberSourceCallable } from './GerberSourceCallable.mjs'
import { GerberJsdocCollectionProvenance } from './GerberJsdocCollectionProvenance.mjs'

const DISCRIMINATED_COLLECTIONS = new WeakMap()

/**
 * Creates lexical and type state for result-contract analysis.
 */
export class GerberResultAnalysisState {
    /**
     * Builds one callable analysis state.
     * @param {Record<string, any>} node Callable graph node.
     * @param {Map<string, number>} [collectionCallDepths] Declared collection-returning calls.
     * @returns {Record<string, any>} Analysis state.
     */
    static create(node, collectionCallDepths = new Map()) {
        const discriminated =
            DISCRIMINATED_COLLECTIONS.get(collectionCallDepths) || {}
        const collectionParameters = GerberJsdocCollectionProvenance.parameters(
            node.jsdoc
        )
        const facts = GerberSourceAst.facts(node.source, false, {
            collectionParameters
        })
        const variables = GerberResultAnalysisState.#variables(facts)
        const assignments = facts.assignments
        const parameters = new Set(
            node.parameters.map((parameter) => parameter.name)
        )
        const variableTypes = GerberSourceCallable.variableTypes(
            variables,
            assignments
        )
        GerberResultAnalysisState.#removeShadowedTypes(
            variableTypes,
            facts,
            parameters
        )
        return {
            variables,
            assignments,
            variableTypes,
            iterations: GerberResultAnalysisState.#iterations(facts),
            bindings: new Map(),
            lexicalBindings: facts.bindings,
            collectionParameters,
            collectionBindings: new Map(),
            collectionCallDepths,
            discriminatedCollections: discriminated.variants || new Set(),
            externalParameters:
                discriminated.externalParameters?.get(node.key) || new Set(),
            entrypoint: node.entrypoint,
            exportName: node.exportName,
            methodName: node.methodName,
            methodType: node.methodType,
            source: node.source,
            facts,
            parameters,
            thisValue: { known: true, value: Object.freeze({}) }
        }
    }

    /**
     * Indexes explicit collection return types for callable graph targets.
     * @param {Map<string, Record<string, any>>} nodesByKey Callable graph.
     * @returns {Map<string, number>} Collection depth by class and method.
     */
    static collectionCallDepths(nodesByKey) {
        const depths = new Map()
        for (const node of nodesByKey.values()) {
            const depth = GerberJsdocCollectionProvenance.returnDepth(
                node.jsdoc
            )
            if (depth > 0) {
                depths.set(`${node.exportName}.${node.methodName}`, depth)
            }
        }
        DISCRIMINATED_COLLECTIONS.set(
            depths,
            GerberDiscriminatedCollectionProvenance.catalog(nodesByKey, depths)
        )
        return depths
    }

    /**
     * Builds initializer lookup from one shared callable fact set.
     * @param {Record<string, any>} facts Callable facts.
     * @returns {Map<string, string>} Initializers by binding name.
     */
    static #variables(facts) {
        const variables = new Map()
        for (const binding of facts.bindings) {
            if (binding.expression) {
                variables.set(binding.name, binding.expression)
            }
        }
        return variables
    }

    /**
     * Builds scoped iteration lookup from one shared callable fact set.
     * @param {Record<string, any>} facts Callable facts.
     * @returns {Map<string, { expression: string, start: number, end: number }[]>} Iteration bindings.
     */
    static #iterations(facts) {
        const iterations = new Map()
        for (const binding of facts.bindings) {
            if (binding.kind !== 'iteration') continue
            const values = iterations.get(binding.name) || []
            values.push({
                expression: binding.expression,
                start: binding.scopeStart,
                end: binding.scopeEnd
            })
            iterations.set(binding.name, values)
        }
        return iterations
    }

    /**
     * Removes constructor inferences whose identifier resolves locally.
     * @param {Map<string, string>} types Inferred constructed types.
     * @param {Record<string, any>} facts Callable facts.
     * @param {Set<string>} parameters Callable parameter names.
     * @returns {void}
     */
    static #removeShadowedTypes(types, facts, parameters) {
        for (const [path, className] of types) {
            if (parameters.has(className)) {
                types.delete(path)
                continue
            }
            const position = GerberResultAnalysisState.#typePosition(
                path,
                className,
                facts
            )
            if (
                position !== null &&
                GerberSourceAst.activeBindings(
                    facts.bindings,
                    className,
                    position
                ).length
            ) {
                types.delete(path)
            }
        }
    }

    /**
     * Locates the expression that produced one inferred constructed type.
     * @param {string} path Local destination path.
     * @param {string} className Constructor identifier.
     * @param {Record<string, any>} facts Callable facts.
     * @returns {number | null} Source position or null.
     */
    static #typePosition(path, className, facts) {
        const [root, ...parts] = path.split('.')
        const relative = parts.join('.')
        const construction = new RegExp(`\\bnew\\s+${className}\\s*\\(`, 'u')
        for (const assignment of facts.assignments.get(root) || []) {
            if (
                assignment.path === relative &&
                construction.test(assignment.expression)
            ) {
                return assignment.index
            }
        }
        const binding = facts.bindings.find(
            (candidate) =>
                candidate.name === root &&
                construction.test(candidate.expression || '')
        )
        return binding?.start ?? null
    }
}
