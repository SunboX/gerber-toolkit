import { GerberSourceExpression } from './GerberSourceExpression.mjs'
import { GerberSourceCallable } from './GerberSourceCallable.mjs'
import { GerberSourceMutation } from './GerberSourceMutation.mjs'
import { GerberResultContextMaterializer } from './GerberResultContextMaterializer.mjs'
import { GerberResultAnalysisState } from './GerberResultAnalysisState.mjs'
import { GerberResultExpressionAnalysis } from './GerberResultExpressionAnalysis.mjs'
import { GerberResultLocalCallAnalysis } from './GerberResultLocalCallAnalysis.mjs'
import { GerberResultCallbackAnalysis } from './GerberResultCallbackAnalysis.mjs'
import { GerberResultCallAnalysis } from './GerberResultCallAnalysis.mjs'
import { GerberResultCollectionSelection } from './GerberResultCollectionSelection.mjs'
import { GerberResultCloneAnalysis } from './GerberResultCloneAnalysis.mjs'
import { GerberResultLocalMutation } from './GerberResultLocalMutation.mjs'
import { GerberResultObjectAnalysis } from './GerberResultObjectAnalysis.mjs'
import { GerberResultShapeProjection } from './GerberResultShapeProjection.mjs'

const MAX_RECURSIVE_FIELD_OCCURRENCES = 4

/**
 * Resolves nested public result fields through local values and call graphs.
 */
export class GerberApiResultContractResolver {
    /**
     * Adds recursively delegated result paths to callable graph nodes.
     * @param {Map<string, Record<string, any>>} nodesByKey Callable graph.
     * @returns {void}
     */
    static resolve(nodesByKey) {
        const contractsByKey = new Map()
        const incomingByKey = new Map()
        const mutationsByKey = new Map()
        const collectionCallDepths =
            GerberResultAnalysisState.collectionCallDepths(nodesByKey)
        for (const node of nodesByKey.values()) {
            const contract = GerberApiResultContractResolver.#sourceContract(
                node,
                collectionCallDepths
            )
            for (const field of node.resultFields) {
                contract.result.fields.add(field)
            }
            for (const field of contract.result.fields) {
                node.resultFields.add(field)
            }
            node.resultTypes = new Map()
            contractsByKey.set(node.key, contract)
            incomingByKey.set(
                node.key,
                new Map(
                    node.parameters.map((parameter) => [
                        parameter.name,
                        new Set()
                    ])
                )
            )
            mutationsByKey.set(node.key, {
                parameters: new Map(
                    node.parameters.map((parameter) => [
                        parameter.name,
                        new Set()
                    ])
                ),
                locals: new Map(
                    [...contract.state.variables.keys()].map((name) => [
                        name,
                        new Set()
                    ])
                )
            })
        }

        let changed = true
        let passes = 0
        const passLimit = Math.max(1, nodesByKey.size * 8)
        while (changed && passes < passLimit) {
            changed = false
            passes += 1
            for (const node of nodesByKey.values()) {
                const contract = contractsByKey.get(node.key)
                const mutations = mutationsByKey.get(node.key)
                changed =
                    GerberApiResultContractResolver.#addMaterializedTypes(
                        node.resultTypes,
                        contract.result,
                        node,
                        nodesByKey,
                        contractsByKey
                    ) || changed
                changed =
                    GerberApiResultContractResolver.#propagateVariableTypes(
                        node,
                        contract,
                        nodesByKey,
                        contractsByKey
                    ) || changed
                for (const mutation of contract.mutations) {
                    const destination = node.parameters.some(
                        (parameter) => parameter.name === mutation.root
                    )
                        ? mutations.parameters.get(mutation.root)
                        : mutations.locals.get(mutation.root)
                    if (!destination) continue
                    changed =
                        GerberApiResultContractResolver.#addMaterializedShape(
                            destination,
                            mutation.shape,
                            node,
                            nodesByKey,
                            contractsByKey,
                            incomingByKey,
                            mutationsByKey
                        ) || changed
                }
                changed =
                    GerberApiResultContractResolver.#addMaterializedShape(
                        node.resultFields,
                        contract.result,
                        node,
                        nodesByKey,
                        contractsByKey,
                        incomingByKey,
                        mutationsByKey
                    ) || changed
                for (const call of contract.calls) {
                    const target = GerberApiResultContractResolver.#targetNode(
                        nodesByKey,
                        node,
                        call,
                        contractsByKey
                    )
                    if (!target || target.key === node.key) continue
                    const incoming = incomingByKey.get(target.key)
                    for (
                        let index = 0;
                        index < target.parameters.length;
                        index += 1
                    ) {
                        const argument = call.arguments[index]
                        if (!argument) continue
                        changed =
                            GerberApiResultContractResolver.#addMaterializedShape(
                                incoming.get(target.parameters[index].name),
                                argument,
                                node,
                                nodesByKey,
                                contractsByKey,
                                incomingByKey,
                                mutationsByKey
                            ) || changed
                        const targetEffects = mutationsByKey
                            .get(target.key)
                            .parameters.get(target.parameters[index].name)
                        for (const location of call.locations[index] || []) {
                            const callerEffects = node.parameters.some(
                                (parameter) => parameter.name === location.root
                            )
                                ? mutations.parameters.get(location.root)
                                : mutations.locals.get(location.root)
                            for (const field of targetEffects || []) {
                                changed =
                                    GerberApiResultContractResolver.#addField(
                                        callerEffects,
                                        GerberSourceExpression.path(
                                            location.path,
                                            field
                                        )
                                    ) || changed
                            }
                        }
                    }
                }
            }
        }
        if (changed) {
            throw new Error('Result contract graph did not converge.')
        }
    }

    /**
     * Adds one abstract shape after resolving its calls and parameters.
     * @param {Set<string>} destination Destination field set.
     * @param {{ fields: Set<string>, references: Record<string, string>[], parameters: Record<string, string>[] }} shape Abstract shape.
     * @param {Record<string, any>} node Shape-owning callable.
     * @param {Map<string, Record<string, any>>} nodesByKey Callable graph.
     * @param {Map<string, Record<string, any>>} contractsByKey Source contracts.
     * @param {Map<string, Map<string, Set<string>>>} incomingByKey Parameter shapes.
     * @param {Map<string, Record<string, Map<string, Set<string>>>>} mutationsByKey Mutation shapes.
     * @param {Set<string>} [resolvingReferences] Contextual call edges already resolving.
     * @returns {boolean} Whether at least one field was added.
     */
    static #addMaterializedShape(
        destination,
        shape,
        node,
        nodesByKey,
        contractsByKey,
        incomingByKey,
        mutationsByKey,
        resolvingReferences = new Set()
    ) {
        let changed = false
        for (const field of shape.fields) {
            changed =
                GerberApiResultContractResolver.#addField(destination, field) ||
                changed
        }
        for (const reference of shape.references) {
            const target = GerberApiResultContractResolver.#targetNode(
                nodesByKey,
                node,
                reference,
                contractsByKey
            )
            if (!target) continue
            const targetFields =
                GerberResultContextMaterializer.referenceFields({
                    reference,
                    node,
                    target,
                    nodesByKey,
                    contractsByKey,
                    incomingByKey,
                    mutationsByKey,
                    targetNode: (owner, candidate) =>
                        GerberApiResultContractResolver.#targetNode(
                            nodesByKey,
                            owner,
                            candidate,
                            contractsByKey
                        ),
                    mapField: (field, source) =>
                        GerberApiResultContractResolver.#mappedSourceField(
                            field,
                            source
                        )
                })
            for (const field of targetFields) {
                const path = GerberApiResultContractResolver.#mappedSourceField(
                    field,
                    reference
                )
                changed =
                    GerberApiResultContractResolver.#addField(
                        destination,
                        path
                    ) || changed
            }
        }
        const incoming = incomingByKey.get(node.key)
        const mutations = mutationsByKey.get(node.key)
        for (const parameter of shape.parameters) {
            const fields = new Set([
                ...(incoming?.get(parameter.name) || []),
                ...(mutations?.parameters.get(parameter.name) || [])
            ])
            for (const field of fields) {
                changed =
                    GerberApiResultContractResolver.#addField(
                        destination,
                        GerberApiResultContractResolver.#mappedSourceField(
                            field,
                            parameter
                        )
                    ) || changed
            }
        }
        for (const local of shape.locals) {
            for (const field of mutations?.locals.get(local.name) || []) {
                changed =
                    GerberApiResultContractResolver.#addField(
                        destination,
                        GerberApiResultContractResolver.#mappedSourceField(
                            field,
                            local
                        )
                    ) || changed
            }
        }
        return changed
    }

    /**
     * Adds constructed result types after resolving static call references.
     * @param {Map<string, string>} destination Destination types.
     * @param {Record<string, any>} shape Abstract shape.
     * @param {Record<string, any>} node Shape-owning callable.
     * @param {Map<string, Record<string, any>>} nodesByKey Callable graph.
     * @param {Map<string, Record<string, any>>} contractsByKey Source contracts.
     * @returns {boolean} Whether at least one type was added.
     */
    static #addMaterializedTypes(
        destination,
        shape,
        node,
        nodesByKey,
        contractsByKey
    ) {
        let changed = false
        for (const [field, className] of shape.types) {
            changed =
                GerberApiResultContractResolver.#addType(
                    destination,
                    field,
                    className
                ) || changed
        }
        for (const reference of shape.references) {
            const target = GerberApiResultContractResolver.#targetNode(
                nodesByKey,
                node,
                reference,
                contractsByKey
            )
            if (!target) continue
            const targetTypes =
                target.key === node.key
                    ? contractsByKey.get(target.key).result.types
                    : target.resultTypes
            for (const [field, className] of targetTypes) {
                const mapped =
                    GerberApiResultContractResolver.#mappedSourceField(
                        field,
                        reference
                    )
                if (mapped === null) continue
                changed =
                    GerberApiResultContractResolver.#addType(
                        destination,
                        mapped,
                        className
                    ) || changed
            }
        }
        return changed
    }

    /**
     * Propagates constructed result member types into local call results.
     * @param {Record<string, any>} node Calling node.
     * @param {Record<string, any>} contract Calling source contract.
     * @param {Map<string, Record<string, any>>} nodesByKey Callable graph.
     * @param {Map<string, Record<string, any>>} contractsByKey Source contracts.
     * @returns {boolean} Whether at least one local type was added.
     */
    static #propagateVariableTypes(node, contract, nodesByKey, contractsByKey) {
        let changed = false
        for (const [name, expression] of contract.state.variables) {
            const call = GerberResultCallAnalysis.directCall(
                expression,
                contract.state
            )
            if (!call) continue
            const target = GerberApiResultContractResolver.#targetNode(
                nodesByKey,
                node,
                call,
                contractsByKey
            )
            if (!target) continue
            for (const [field, className] of target.resultTypes) {
                changed =
                    GerberApiResultContractResolver.#addType(
                        contract.state.variableTypes,
                        GerberSourceExpression.path(name, field),
                        className
                    ) || changed
            }
        }
        return (
            GerberSourceCallable.propagateVariableTypes(
                contract.state.variableTypes,
                contract.state.variables
            ) || changed
        )
    }

    /**
     * Adds one constructed type to a path map.
     * @param {Map<string, string>} destination Destination type map.
     * @param {string} field Result or local path.
     * @param {string} className Constructed class name.
     * @returns {boolean} Whether the type was added.
     */
    static #addType(destination, field, className) {
        if (!className || destination.has(field)) return false
        destination.set(field, className)
        return true
    }

    /**
     * Adds one non-empty field to a set.
     * @param {Set<string>} destination Destination field set.
     * @param {string} field Field path.
     * @returns {boolean} Whether the field was added.
     */
    static #addField(destination, field) {
        if (!destination || !field || destination.has(field)) return false
        const occurrences = new Map()
        for (const segment of field.split('.')) {
            const count = (occurrences.get(segment) || 0) + 1
            if (count > MAX_RECURSIVE_FIELD_OCCURRENCES) return false
            occurrences.set(segment, count)
        }
        destination.add(field)
        return true
    }

    /**
     * Applies one optional member selection and output prefix.
     * @param {string} field Source field.
     * @param {{ prefix?: string, select?: string }} source Shape source.
     * @returns {string | null} Mapped field or null when outside the selection.
     */
    static #mappedSourceField(field, source) {
        let mapped = field
        if (source.select) {
            if (mapped === source.select) mapped = ''
            else if (mapped.startsWith(`${source.select}.`)) {
                mapped = mapped.slice(source.select.length + 1)
            } else return null
        }
        return GerberSourceExpression.path(source.prefix || '', mapped)
    }

    /**
     * Resolves a same-entrypoint node before a wildcard supporting node.
     * @param {Map<string, Record<string, any>>} nodesByKey Callable graph.
     * @param {Record<string, any>} node Calling node.
     * @param {{ exportName: string, methodName: string, methodType: string }} reference Call reference.
     * @param {Map<string, Record<string, any>>} contractsByKey Source contracts.
     * @returns {Record<string, any> | undefined} Target node.
     */
    static #targetNode(nodesByKey, node, reference, contractsByKey) {
        const inferredClass =
            reference.methodType === 'instance-inferred'
                ? contractsByKey
                      ?.get(node.key)
                      ?.state.variableTypes.get(reference.receiver)
                : ''
        const exportName = inferredClass || reference.exportName
        const methodType = inferredClass ? 'instance' : reference.methodType
        if (!exportName || methodType === 'instance-inferred') return undefined
        const suffix = `${exportName}:${methodType}:${reference.methodName}`
        return (
            nodesByKey.get(`${node.entrypoint}:${suffix}`) ||
            nodesByKey.get(`*:${suffix}`)
        )
    }

    /**
     * Extracts one callable's result and argument-flow contracts.
     * @param {Record<string, any>} node Callable node.
     * @param {Map<string, number>} collectionCallDepths Declared collection-returning calls.
     * @returns {{ result: Record<string, any>, calls: Record<string, any>[], mutations: Record<string, any>[], state: Record<string, any> }} Source contract.
     */
    static #sourceContract(node, collectionCallDepths) {
        const state = GerberResultAnalysisState.create(
            node,
            collectionCallDepths
        )
        const result = GerberApiResultContractResolver.#shape()
        if (!node.generator) {
            for (const record of state.facts.returns) {
                const returnState = record.bindings
                    ? { ...state, returnBindings: record.bindings }
                    : state
                GerberApiResultContractResolver.#analyzeExpression(
                    record.expression,
                    '',
                    returnState,
                    result,
                    new Set(),
                    record.index
                )
            }
        }
        return {
            result,
            calls: node.generator
                ? []
                : GerberApiResultContractResolver.#callContracts(
                      node.source,
                      state
                  ),
            mutations: node.generator
                ? []
                : GerberSourceMutation.contracts(node.source, state, {
                      createShape: () =>
                          GerberApiResultContractResolver.#shape(),
                      analyze: (expression, prefix, shape, position) =>
                          GerberApiResultContractResolver.#analyzeExpression(
                              expression,
                              prefix,
                              state,
                              shape,
                              new Set(),
                              position
                          )
                  }),
            state
        }
    }

    /** Creates an empty abstract result shape. */
    static #shape() {
        return {
            fields: new Set(),
            types: new Map(),
            references: [],
            parameters: [],
            locals: []
        }
    }

    /** Adds fields, call references, and parameter aliases for an expression. */
    static #analyzeExpression(
        expression,
        prefix,
        state,
        shape,
        resolving,
        position = Number.MAX_SAFE_INTEGER
    ) {
        let value = expression.trim().replace(/^await\s+/u, '')
        if (!value) return
        value = GerberSourceExpression.stripParentheses(value)

        const constructed = /^new\s+([A-Z][A-Za-z0-9_$]*)\s*\(/u.exec(value)
        if (
            constructed &&
            GerberResultExpressionAnalysis.unshadowedIdentifier(
                constructed[1],
                state,
                position
            )
        ) {
            shape.types.set(prefix, constructed[1])
            return
        }
        const clone = GerberResultCloneAnalysis.resolve(value, {
            JSON: GerberResultExpressionAnalysis.unshadowedIdentifier(
                'JSON',
                state,
                position
            ),
            structuredClone:
                GerberResultExpressionAnalysis.unshadowedIdentifier(
                    'structuredClone',
                    state,
                    position
                ),
            undefined: GerberResultExpressionAnalysis.unshadowedIdentifier(
                'undefined',
                state,
                position
            ),
            Symbol: GerberResultExpressionAnalysis.unshadowedIdentifier(
                'Symbol',
                state,
                position
            )
        })
        if (clone) {
            if (clone.throws) return
            const clonedShape = GerberApiResultContractResolver.#shape()
            GerberApiResultContractResolver.#analyzeExpression(
                clone.source,
                '',
                state,
                clonedShape,
                resolving,
                position
            )
            GerberResultLocalMutation.applyDeleted(clonedShape, clone.removed)
            GerberResultShapeProjection.copy(shape, clonedShape, '', prefix)
            return
        }
        const clonedValue = GerberResultExpressionAnalysis.clonedValue(
            value,
            state,
            position
        )
        if (clonedValue !== null) {
            GerberApiResultContractResolver.#analyzeExpression(
                clonedValue,
                prefix,
                state,
                shape,
                resolving,
                position
            )
            return
        }

        const conditional = GerberSourceExpression.conditionalBranches(value)
        if (conditional) {
            for (const branch of conditional) {
                GerberApiResultContractResolver.#analyzeExpression(
                    branch,
                    prefix,
                    state,
                    shape,
                    resolving,
                    position
                )
            }
            return
        }
        const reachableAlternatives =
            GerberResultExpressionAnalysis.logicalAlternatives(
                value,
                state,
                position
            )
        const alternatives =
            reachableAlternatives ||
            GerberSourceExpression.logicalAlternatives(value)
        if (reachableAlternatives || alternatives.length > 1) {
            for (const alternative of alternatives) {
                GerberApiResultContractResolver.#analyzeExpression(
                    alternative,
                    prefix,
                    state,
                    shape,
                    resolving,
                    position
                )
            }
            return
        }
        if (
            value.startsWith('{') &&
            GerberSourceExpression.matchingDelimiter(value, 0, '{', '}') ===
                value.length - 1
        ) {
            GerberResultObjectAnalysis.analyze({
                source: value.slice(1, -1),
                prefix,
                state,
                shape,
                resolving,
                position,
                analyze: (...argumentsList) =>
                    GerberApiResultContractResolver.#analyzeExpression(
                        ...argumentsList
                    )
            })
            return
        }
        const selection = GerberResultCollectionSelection.resolve(
            value,
            state,
            position
        )
        if (selection?.handled) {
            for (const selected of selection.expressions) {
                GerberApiResultContractResolver.#analyzeExpression(
                    selected,
                    prefix,
                    state,
                    shape,
                    resolving,
                    position
                )
            }
            return
        }
        if (
            value.startsWith('[') &&
            GerberSourceExpression.matchingDelimiter(value, 0, '[', ']') ===
                value.length - 1
        ) {
            for (const element of GerberSourceExpression.splitTopLevel(
                value.slice(1, -1)
            )) {
                GerberApiResultContractResolver.#analyzeExpression(
                    element.trim().replace(/^\.\.\./u, ''),
                    prefix,
                    state,
                    shape,
                    resolving,
                    position
                )
            }
            return
        }
        if (
            GerberResultLocalCallAnalysis.analyze({
                expression: value,
                prefix,
                state,
                shape,
                resolving,
                position,
                services: {
                    createShape: () => GerberApiResultContractResolver.#shape(),
                    analyze: (...argumentsList) =>
                        GerberApiResultContractResolver.#analyzeExpression(
                            ...argumentsList
                        )
                }
            })
        ) {
            return
        }
        const callback = GerberResultCallbackAnalysis.analyze({
            expression: value,
            prefix,
            state,
            shape,
            resolving,
            position,
            services: {
                createShape: () => GerberApiResultContractResolver.#shape(),
                analyze: (...argumentsList) =>
                    GerberApiResultContractResolver.#analyzeExpression(
                        ...argumentsList
                    ),
                copy: (...argumentsList) =>
                    GerberResultShapeProjection.copy(...argumentsList)
            }
        })
        if (callback.handled) return
        const arraySource =
            callback.collectionDepth > 0
                ? GerberSourceCallable.arrayFromSource(value)
                : null
        if (arraySource !== null) {
            GerberApiResultContractResolver.#analyzeExpression(
                arraySource,
                prefix,
                state,
                shape,
                resolving,
                position
            )
            return
        }
        const identifier = /^([A-Za-z_$][\w$]*)$/u.exec(value)?.[1]
        if (identifier) {
            if (state.bindings.has(identifier)) {
                GerberResultShapeProjection.copy(
                    shape,
                    state.bindings.get(identifier),
                    '',
                    prefix
                )
                return
            }
            if (state.parameters.has(identifier)) {
                shape.parameters.push({ prefix, select: '', name: identifier })
            }
            const captured = state.returnBindings?.get(identifier)
            const lexical = captured
                ? [captured]
                : GerberSourceCallable.bindingExpressions(
                      identifier,
                      state,
                      position
                  )
            if (
                (lexical.length || state.variables.has(identifier)) &&
                !resolving.has(identifier)
            ) {
                const nextResolving = new Set(resolving).add(identifier)
                const initializers = lexical.length
                    ? lexical
                    : [state.variables.get(identifier)]
                const effects = GerberResultLocalMutation.resolve(
                    identifier,
                    initializers,
                    state,
                    position
                )
                if (effects.elements === null && !effects.deleted.size) {
                    for (const initializer of initializers) {
                        GerberApiResultContractResolver.#analyzeExpression(
                            initializer,
                            prefix,
                            state,
                            shape,
                            nextResolving,
                            position
                        )
                    }
                    for (const assignment of state.assignments.get(
                        identifier
                    ) || []) {
                        const path = GerberSourceExpression.path(
                            prefix,
                            assignment.path
                        )
                        shape.fields.add(path)
                        GerberApiResultContractResolver.#analyzeExpression(
                            assignment.expression,
                            path,
                            state,
                            shape,
                            nextResolving,
                            assignment.index
                        )
                    }
                    if (state.variableTypes.get(identifier) !== 'Map') {
                        shape.locals.push({
                            prefix,
                            select: '',
                            name: identifier
                        })
                    }
                    return
                }
                const localShape = GerberApiResultContractResolver.#shape()
                for (const initializer of effects.elements || initializers) {
                    GerberApiResultContractResolver.#analyzeExpression(
                        initializer,
                        '',
                        state,
                        localShape,
                        nextResolving,
                        position
                    )
                }
                for (const assignment of state.assignments.get(identifier) ||
                    []) {
                    const path = assignment.path
                    localShape.fields.add(path)
                    GerberApiResultContractResolver.#analyzeExpression(
                        assignment.expression,
                        path,
                        state,
                        localShape,
                        nextResolving,
                        assignment.index
                    )
                }
                if (state.variableTypes.get(identifier) !== 'Map') {
                    localShape.locals.push({
                        prefix: '',
                        select: '',
                        name: identifier
                    })
                }
                GerberResultLocalMutation.applyDeleted(
                    localShape,
                    effects.deleted
                )
                GerberResultShapeProjection.copy(shape, localShape, '', prefix)
            }
            return
        }
        const assigned = GerberResultExpressionAnalysis.objectAssignSources(
            value,
            state,
            position
        )
        if (assigned) {
            for (const source of assigned) {
                GerberApiResultContractResolver.#analyzeExpression(
                    source,
                    prefix,
                    state,
                    shape,
                    resolving,
                    position
                )
            }
            return
        }
        const call = GerberResultCallAnalysis.directCall(value, state)
        const collectionReceiver =
            ['get', 'values', 'entries']
                .map((method) =>
                    GerberSourceExpression.collectionReceiver(value, method)
                )
                .find((receiver) => receiver !== null) ?? null
        if (collectionReceiver !== null) {
            const member =
                GerberSourceExpression.memberAccess(collectionReceiver)
            const root =
                member?.root ||
                /^([A-Za-z_$][\w$]*)$/u.exec(collectionReceiver)?.[1]
            if (root && state.parameters.has(root)) {
                shape.parameters.push({
                    prefix,
                    select: member?.path || '',
                    name: root
                })
            } else if (root && state.variables.has(root)) {
                shape.locals.push({
                    prefix,
                    select: member?.path || '',
                    name: root
                })
            } else {
                GerberApiResultContractResolver.#analyzeExpression(
                    collectionReceiver,
                    prefix,
                    state,
                    shape,
                    resolving,
                    position
                )
            }
            return
        }
        if (call) {
            const argumentsList = call.argumentSources.map((argument) => {
                const argumentShape = GerberApiResultContractResolver.#shape()
                GerberApiResultContractResolver.#analyzeExpression(
                    argument,
                    '',
                    state,
                    argumentShape,
                    resolving,
                    position
                )
                return argumentShape
            })
            shape.references.push({
                prefix,
                select: '',
                ...call,
                arguments: argumentsList
            })
            return
        }
        const member = GerberSourceExpression.memberAccess(value)
        if (member) {
            if (
                state.variableTypes.get(
                    GerberSourceExpression.path(member.root, member.path)
                ) === 'Map'
            ) {
                return
            }
            const selected = GerberApiResultContractResolver.#shape()
            GerberApiResultContractResolver.#analyzeExpression(
                member.root,
                '',
                state,
                selected,
                resolving,
                position
            )
            GerberResultShapeProjection.copy(
                shape,
                selected,
                member.path,
                prefix
            )
        }
    }

    /** Parses call targets and abstract argument shapes from a callable. */
    static #callContracts(source, state) {
        const calls = []
        for (const call of state.facts.calls) {
            const argumentSources = call.arguments
            const argumentsList = argumentSources.map((argument) => {
                const shape = GerberApiResultContractResolver.#shape()
                GerberApiResultContractResolver.#analyzeExpression(
                    argument,
                    '',
                    state,
                    shape,
                    new Set(),
                    call.index
                )
                return shape
            })
            calls.push({
                ...GerberResultCallAnalysis.callTarget(
                    call.receiver,
                    call.methodName,
                    state
                ),
                arguments: argumentsList,
                locations: argumentSources.map((argument) =>
                    GerberSourceCallable.argumentLocations(
                        argument,
                        state,
                        call.index
                    )
                )
            })
        }
        return calls
    }
}
