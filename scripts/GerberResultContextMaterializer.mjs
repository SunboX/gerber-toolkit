/**
 * Materializes result contracts with call-site-specific parameter shapes.
 */
export class GerberResultContextMaterializer {
    /**
     * Resolves one referenced callable without merging unrelated call sites.
     * @param {Record<string, any>} options Materialization inputs.
     * @returns {Set<string>} Concrete target result fields.
     */
    static referenceFields(options) {
        const environment = parameterEnvironment(
            options.node,
            options.incomingByKey,
            options.mutationsByKey
        )
        return targetFields(
            options.reference,
            options.node,
            options.target,
            environment,
            options,
            new Set([options.node.key])
        )
    }
}

/**
 * Materializes a target result using concrete argument shapes.
 * @param {Record<string, any>} reference Calling reference.
 * @param {Record<string, any>} caller Calling node.
 * @param {Record<string, any>} target Target node.
 * @param {Map<string, Set<string>>} callerEnvironment Caller parameters.
 * @param {Record<string, any>} options Shared graph services.
 * @param {Set<string>} resolving Contextual call stack.
 * @returns {Set<string>} Concrete target fields.
 */
function targetFields(
    reference,
    caller,
    target,
    callerEnvironment,
    options,
    resolving
) {
    const environment = new Map()
    for (let index = 0; index < target.parameters.length; index += 1) {
        const argument = reference.arguments?.[index]
        const fields = argument
            ? shapeFields(
                  argument,
                  caller,
                  callerEnvironment,
                  options,
                  resolving
              )
            : new Set()
        for (const field of options.mutationsByKey
            .get(target.key)
            ?.parameters.get(target.parameters[index].name) || []) {
            fields.add(field)
        }
        environment.set(target.parameters[index].name, fields)
    }
    return shapeFields(
        options.contractsByKey.get(target.key).result,
        target,
        environment,
        options,
        new Set(resolving).add(target.key)
    )
}

/**
 * Materializes an abstract shape under one parameter environment.
 * @param {Record<string, any>} shape Abstract shape.
 * @param {Record<string, any>} node Shape-owning node.
 * @param {Map<string, Set<string>>} environment Parameter fields.
 * @param {Record<string, any>} options Shared graph services.
 * @param {Set<string>} resolving Contextual call stack.
 * @returns {Set<string>} Concrete fields.
 */
function shapeFields(shape, node, environment, options, resolving) {
    const fields = new Set(shape.fields)
    for (const parameter of shape.parameters) {
        for (const field of environment.get(parameter.name) || []) {
            const mapped = options.mapField(field, parameter)
            if (mapped) fields.add(mapped)
        }
    }
    for (const local of shape.locals) {
        for (const field of options.mutationsByKey
            .get(node.key)
            ?.locals.get(local.name) || []) {
            const mapped = options.mapField(field, local)
            if (mapped) fields.add(mapped)
        }
    }
    for (const reference of shape.references) {
        const target = options.targetNode(node, reference)
        if (!target) continue
        const concrete = resolving.has(target.key)
            ? new Set(options.contractsByKey.get(target.key).result.fields)
            : targetFields(
                  reference,
                  node,
                  target,
                  environment,
                  options,
                  resolving
              )
        for (const field of concrete) {
            const mapped = options.mapField(field, reference)
            if (mapped) fields.add(mapped)
        }
    }
    return fields
}

/**
 * Builds the current global parameter environment for one graph node.
 * @param {Record<string, any>} node Callable node.
 * @param {Map<string, Map<string, Set<string>>>} incomingByKey Incoming fields.
 * @param {Map<string, Record<string, Map<string, Set<string>>>>} mutationsByKey Mutation fields.
 * @returns {Map<string, Set<string>>} Parameter environment.
 */
function parameterEnvironment(node, incomingByKey, mutationsByKey) {
    return new Map(
        node.parameters.map((parameter) => [
            parameter.name,
            new Set([
                ...(incomingByKey.get(node.key)?.get(parameter.name) || []),
                ...(mutationsByKey
                    .get(node.key)
                    ?.parameters.get(parameter.name) || [])
            ])
        ])
    )
}
