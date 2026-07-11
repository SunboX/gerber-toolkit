import { GerberControlFlow } from './GerberControlFlow.mjs'
import { GerberLoopIterationReachability } from './GerberLoopIterationReachability.mjs'
import { GerberEvidenceProvenance } from './GerberEvidenceProvenance.mjs'
import { GerberStaticValue } from './GerberStaticValue.mjs'

/**
 * Joins branch and loop control flow for reachable evidence analysis.
 */
export class GerberEvidenceBranchFlow {
    /**
     * Executes a statically selected or uncertain conditional statement.
     * @param {Record<string, any>} node If statement.
     * @param {Record<string, any>} environment Current environment.
     * @param {(expression: Record<string, any> | null, environment: Record<string, any>) => Set<string>} evaluate Expression evaluator.
     * @param {(statement: Record<string, any> | null, environment: Record<string, any>) => Record<string, any>} execute Statement executor.
     * @returns {{ terminated: boolean, abrupt: string, values: Set<string> }} Flow outcome.
     */
    static analyzeIf(node, environment, evaluate, execute) {
        const truth = GerberStaticValue.truth(node.test, environment)
        evaluate(node.test, environment)
        if (truth === true) return execute(node.consequent, environment)
        if (truth === false) return execute(node.alternate, environment)

        const leftEnvironment = correlatedEnvironment(
            environment,
            node.test,
            true
        )
        const rightEnvironment = correlatedEnvironment(
            environment,
            node.test,
            false
        )
        const left = execute(node.consequent, leftEnvironment)
        const right = execute(node.alternate, rightEnvironment)
        environment.mergeFrom([
            ...(left.terminated ? [] : [leftEnvironment]),
            ...(right.terminated ? [] : [rightEnvironment])
        ])
        const complete = Boolean(node.alternate)
        const exits = [
            ...(left.exits || []),
            ...(right.exits || []),
            ...terminalExit(left, leftEnvironment),
            ...terminalExit(right, rightEnvironment)
        ]
        return {
            terminated: complete && left.terminated && right.terminated,
            abrupt: GerberEvidenceProvenance.mergeAbrupt(left, right, complete),
            values: union(left.values, right.values),
            exits
        }
    }

    /**
     * Executes one modeled loop iteration while retaining every exit state.
     * @param {Record<string, any>} node Loop statement.
     * @param {Record<string, any>} environment Current environment.
     * @param {string} controlLabel Label attached directly to the loop.
     * @param {(expression: Record<string, any> | null, environment: Record<string, any>) => Set<string>} evaluate Expression evaluator.
     * @param {(statement: Record<string, any> | null, environment: Record<string, any>) => Record<string, any>} execute Statement executor.
     * @param {(pattern: Record<string, any>, binding: Record<string, any>, environment: Record<string, any>) => void} declare Pattern declarer.
     * @returns {{ terminated: boolean, abrupt: string, values: Set<string> }} Flow outcome.
     */
    static analyzeLoop(
        node,
        environment,
        controlLabel,
        evaluate,
        execute,
        declare
    ) {
        const base = environment.fork()
        const setup = prepareLoop(node, base, evaluate)
        const skipped = base.fork()
        const loop = base.fork()
        declareLoopBinding(node, setup.sourceValues, loop, evaluate, declare)

        if (node.type !== 'DoWhileStatement' && setup.truth === false) {
            environment.mergeFrom([skipped])
            return open()
        }

        let body = open()
        let consumed = false
        const consumedExits = []
        const outerExits = []
        const values = new Set()
        let nextTruth = setup.truth
        let iterations = 0
        while (iterations < 8) {
            body = execute(node.body, loop)
            addAll(values, body.values)
            const iterationConsumed =
                body.terminated &&
                GerberControlFlow.consumedByLoop(body.abrupt, controlLabel)
            consumed = consumed || iterationConsumed
            for (const exit of body.exits || []) {
                if (
                    GerberControlFlow.consumedByLoop(exit.abrupt, controlLabel)
                ) {
                    consumedExits.push(exit)
                } else outerExits.push(exit)
            }
            evaluateLoopTail(node, body, iterationConsumed, loop, evaluate)
            nextTruth = loopTruth(node, loop)
            iterations += 1
            const directKind = GerberControlFlow.kind(body.abrupt)
            const continues =
                !body.terminated ||
                (iterationConsumed && directKind === 'continue') ||
                consumedExits.some(
                    (exit) => GerberControlFlow.kind(exit.abrupt) === 'continue'
                )
            if (
                ['ForInStatement', 'ForOfStatement'].includes(node.type) ||
                !continues ||
                nextTruth !== true
            ) {
                break
            }
        }
        body = { ...body, values }
        const guaranteedEntry =
            node.type === 'DoWhileStatement' || setup.truth === true
        const directKind = GerberControlFlow.kind(body.abrupt)
        const breakExit =
            (consumed && directKind === 'break') ||
            consumedExits.some(
                (exit) => GerberControlFlow.kind(exit.abrupt) === 'break'
            )
        const loopingPath =
            !body.terminated ||
            (consumed && directKind === 'continue') ||
            consumedExits.some(
                (exit) => GerberControlFlow.kind(exit.abrupt) === 'continue'
            )
        if (
            guaranteedEntry &&
            nextTruth === true &&
            loopingPath &&
            !breakExit
        ) {
            return {
                terminated: true,
                abrupt: 'halt',
                values: body.values,
                exits: outerExits
            }
        }

        if (node.type === 'DoWhileStatement') {
            if (body.terminated && !consumed && !consumedExits.length) {
                return { ...body, exits: outerExits }
            }
            environment.mergeFrom([
                ...(!body.terminated || consumed ? [loop] : []),
                ...consumedExits.map((exit) => exit.environment)
            ])
            return open(body.values, outerExits)
        }

        if (
            body.terminated &&
            !consumed &&
            !consumedExits.length &&
            guaranteedEntry
        ) {
            return { ...body, exits: outerExits }
        }
        const exits = [
            ...(guaranteedEntry ? [] : [skipped]),
            ...(!body.terminated || consumed ? [loop] : []),
            ...consumedExits.map((exit) => exit.environment)
        ]
        if (!exits.length) return { ...body, exits: outerExits }
        environment.mergeFrom(exits)
        return open(body.values, outerExits)
    }
}

/**
 * Resolves the next loop-test truth after one modeled iteration.
 * @param {Record<string, any>} node Loop statement.
 * @param {Record<string, any>} environment Post-iteration environment.
 * @returns {boolean | null} Known continuation truth or unknown.
 */
function loopTruth(node, environment) {
    if (!node.test) return node.type === 'ForStatement' ? true : null
    return GerberStaticValue.truth(node.test, environment)
}

/**
 * Evaluates loop setup expressions before entry alternatives diverge.
 * @param {Record<string, any>} node Loop statement.
 * @param {Record<string, any>} environment Loop-base environment.
 * @param {(expression: Record<string, any> | null, environment: Record<string, any>) => Set<string>} evaluate Expression evaluator.
 * @returns {{ truth: boolean | null, sourceValues: Set<string> }} Setup facts.
 */
function prepareLoop(node, environment, evaluate) {
    if (['ForInStatement', 'ForOfStatement'].includes(node.type)) {
        const sourceValues = evaluate(node.right, environment)
        return {
            truth: GerberLoopIterationReachability.mayIterate(
                node.type,
                node.right,
                environment
            ),
            sourceValues:
                node.type === 'ForInStatement' ? new Set() : sourceValues
        }
    }
    if (node.type === 'DoWhileStatement') {
        return { truth: true, sourceValues: new Set() }
    }
    evaluate(node.init, environment)
    const test = node.test
    const truth = test
        ? GerberStaticValue.truth(test, environment)
        : node.type === 'ForStatement'
          ? true
          : null
    evaluate(test, environment)
    return { truth, sourceValues: new Set() }
}

/**
 * Declares or evaluates the per-iteration left-hand binding.
 * @param {Record<string, any>} node Loop statement.
 * @param {Set<string>} sourceValues Iterable symbolic values.
 * @param {Record<string, any>} environment Iteration environment.
 * @param {(expression: Record<string, any> | null, environment: Record<string, any>) => Set<string>} evaluate Expression evaluator.
 * @param {(pattern: Record<string, any>, binding: Record<string, any>, environment: Record<string, any>) => void} declare Pattern declarer.
 * @returns {void}
 */
function declareLoopBinding(
    node,
    sourceValues,
    environment,
    evaluate,
    declare
) {
    if (!['ForInStatement', 'ForOfStatement'].includes(node.type)) return
    if (node.left?.type === 'VariableDeclaration') {
        for (const declaration of node.left.declarations) {
            declare(declaration.id, { values: sourceValues }, environment)
        }
        return
    }
    evaluate(node.left, environment)
}

/**
 * Evaluates the loop tail only on paths where JavaScript reaches it.
 * @param {Record<string, any>} node Loop statement.
 * @param {{ terminated: boolean, abrupt: string }} body Body outcome.
 * @param {boolean} consumed Whether the loop consumes body control flow.
 * @param {Record<string, any>} environment Iteration environment.
 * @param {(expression: Record<string, any> | null, environment: Record<string, any>) => Set<string>} evaluate Expression evaluator.
 * @returns {void}
 */
function evaluateLoopTail(node, body, consumed, environment, evaluate) {
    const kind = GerberControlFlow.kind(body.abrupt)
    const continues = !body.terminated || (consumed && kind === 'continue')
    if (!continues) return
    if (node.type === 'ForStatement') evaluate(node.update, environment)
    if (node.type === 'DoWhileStatement') evaluate(node.test, environment)
}

/**
 * Creates a non-terminating outcome with optional return values.
 * @param {Set<string>} [values] Possible returned symbolic values.
 * @returns {{ terminated: false, abrupt: string, values: Set<string> }} Open outcome.
 */
function open(values = new Set(), exits = []) {
    return {
        terminated: false,
        abrupt: '',
        values: new Set(values || []),
        exits: [...exits]
    }
}

/**
 * Retains one break/continue branch while its sibling remains open.
 * @param {Record<string, any>} outcome Branch outcome.
 * @param {Record<string, any>} environment Branch environment.
 * @param {Record<string, any>} sibling Sibling outcome.
 * @returns {Record<string, any>[]} Mixed control exits.
 */
function terminalExit(outcome, environment) {
    return outcome.terminated
        ? [{ abrupt: outcome.abrupt, environment, outcome }]
        : []
}

/**
 * Builds one branch environment from compatible correlated paths.
 * @param {Record<string, any>} environment Current environment.
 * @param {Record<string, any>} test Branch test.
 * @param {boolean} expected Selected truth value.
 * @returns {Record<string, any>} Correlation-preserving branch environment.
 */
function correlatedEnvironment(environment, test, expected) {
    if (!environment.pathAlternatives?.length) return environment.fork()
    const selected = environment.pathAlternatives.filter((alternative) => {
        const truth = GerberStaticValue.truth(test, alternative)
        return truth === expected || truth === null
    })
    if (!selected.length) return environment.fork()
    const branch = environment.fork(false)
    branch.mergeFrom(selected.map((alternative) => alternative.fork(false)))
    return branch
}

/**
 * Unions symbolic value sets without mutating an input.
 * @param {...Set<string>} sets Value sets.
 * @returns {Set<string>} Union.
 */
function union(...sets) {
    return new Set(sets.flatMap((set) => [...(set || [])]))
}

/** @param {Set<string>} destination Destination. @param {Set<string>} source Source. @returns {void} */
function addAll(destination, source) {
    for (const value of source || []) destination.add(value)
}
