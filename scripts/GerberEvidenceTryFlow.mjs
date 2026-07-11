import { GerberEvidenceProvenance } from './GerberEvidenceProvenance.mjs'
import { GerberEvidenceThrowReachability } from './GerberEvidenceThrowReachability.mjs'

/**
 * Preserves exact abrupt-flow kinds across evidence try/catch/finally blocks.
 */
export class GerberEvidenceTryFlow {
    /**
     * Executes one try statement through the caller's evidence interpreter.
     * @param {Record<string, any>} node Try statement AST node.
     * @param {Record<string, any>} environment Current lexical environment.
     * @param {(statement: Record<string, any>, environment: Record<string, any>) => { outcome: Record<string, any>, points: Record<string, any>[] }} executeTry Try/finally executor.
     * @param {(handler: Record<string, any>, environment: Record<string, any>, values: Set<string>) => Record<string, any>} executeHandler Catch executor.
     * @returns {{ terminated: boolean, abrupt: string, values: Set<string> }} Flow outcome.
     */
    static analyze(node, environment, executeTry, executeHandler) {
        const blockEnvironment = environment.fork()
        const execution = executeTry(node.block, blockEnvironment)
        const block = execution.outcome
        let paths = completionPaths(block, blockEnvironment)
        if (node.handler) {
            const handled = []
            let caughtPath = false
            for (const path of paths) {
                if (path.outcome.abrupt !== 'throw') {
                    handled.push(path)
                    continue
                }
                caughtPath = true
                const handlerEnvironment = path.environment.fork()
                const handler = executeHandler(
                    node.handler,
                    handlerEnvironment,
                    path.outcome.values
                )
                handled.push(...completionPaths(handler, handlerEnvironment))
            }
            if (!caughtPath && handlerMayRun(node, block)) {
                const handlerEnvironment = environment.fork()
                handlerEnvironment.mergeFrom(
                    execution.points.length
                        ? execution.points
                        : [environment.fork()]
                )
                const handler = executeHandler(
                    node.handler,
                    handlerEnvironment,
                    new Set()
                )
                handled.push(...completionPaths(handler, handlerEnvironment))
            }
            paths = handled
        }
        if (node.finalizer) {
            const finalized = []
            for (const path of paths) {
                const finalizerEnvironment = path.environment.fork()
                const finalizer = executeTry(
                    node.finalizer,
                    finalizerEnvironment
                ).outcome
                for (const finalPath of completionPaths(
                    finalizer,
                    finalizerEnvironment
                )) {
                    finalized.push({
                        environment: finalPath.environment,
                        outcome: finalPath.outcome.terminated
                            ? finalPath.outcome
                            : {
                                  ...path.outcome,
                                  values: union(
                                      path.outcome.values,
                                      finalPath.outcome.values
                                  )
                              }
                    })
                }
            }
            paths = finalized
        }
        return mergePaths(paths, environment)
    }
}

/**
 * Expands mixed terminal exits into independent completion paths.
 * @param {Record<string, any>} outcome Aggregate outcome.
 * @param {Record<string, any>} environment Aggregate environment.
 * @returns {{ outcome: Record<string, any>, environment: Record<string, any> }[]} Completion paths.
 */
function completionPaths(outcome, environment) {
    const exits = (outcome.exits || []).map((exit) => ({
        environment: exit.environment,
        outcome: exit.outcome || {
            terminated: true,
            abrupt: exit.abrupt,
            values: new Set()
        }
    }))
    if (outcome.terminated && exits.length) return exits
    return [
        {
            environment,
            outcome: { ...outcome, exits: [] }
        },
        ...exits
    ]
}

/**
 * Merges independent completion paths back into one flow outcome.
 * @param {{ outcome: Record<string, any>, environment: Record<string, any> }[]} paths Completion paths.
 * @param {Record<string, any>} environment Destination environment.
 * @returns {Record<string, any>} Aggregate outcome.
 */
function mergePaths(paths, environment) {
    const open = paths.filter((path) => !path.outcome.terminated)
    const terminal = paths.filter((path) => path.outcome.terminated)
    if (open.length) {
        environment.mergeFrom(open.map((path) => path.environment))
    }
    let abrupt = ''
    for (const path of terminal) {
        abrupt = abrupt
            ? GerberEvidenceProvenance.mergeAbrupt(
                  { terminated: true, abrupt },
                  path.outcome,
                  true
              )
            : path.outcome.abrupt
    }
    return {
        terminated: !open.length,
        abrupt: open.length ? '' : abrupt,
        values: union(...paths.map((path) => path.outcome.values)),
        exits: terminal.map((path) => ({
            abrupt: path.outcome.abrupt,
            environment: path.environment,
            outcome: path.outcome
        }))
    }
}

/**
 * Checks whether a non-throw completion still has a throwing evaluation path.
 * @param {Record<string, any>} node Try statement.
 * @param {{ terminated: boolean, abrupt: string }} block Try-block outcome.
 * @returns {boolean} Whether the catch handler is reachable.
 */
function handlerMayRun(node, block) {
    void block
    return GerberEvidenceThrowReachability.canThrow(node.block)
}

/**
 * Unions symbolic value sets without mutating an input.
 * @param {...Set<string>} sets Value sets.
 * @returns {Set<string>} Union.
 */
function union(...sets) {
    return new Set(sets.flatMap((set) => [...(set || [])]))
}
