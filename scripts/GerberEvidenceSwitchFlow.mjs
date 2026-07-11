import { GerberControlFlow } from './GerberControlFlow.mjs'
import { GerberEvidenceProvenance } from './GerberEvidenceProvenance.mjs'
import { GerberSwitchSelection } from './GerberSwitchSelection.mjs'

/**
 * Executes known and uncertain switch paths with JavaScript fallthrough.
 */
export class GerberEvidenceSwitchFlow {
    /**
     * Executes one switch statement through evidence callbacks.
     * @param {Record<string, any>} node Switch statement.
     * @param {Record<string, any>} environment Current environment.
     * @param {(expression: Record<string, any> | null, environment: Record<string, any>) => Set<string>} evaluate Expression evaluator.
     * @param {(statements: Record<string, any>[], environment: Record<string, any>) => Record<string, any>} executeStatements Statement-list executor.
     * @returns {{ terminated: boolean, abrupt: string, values: Set<string> }} Flow outcome.
     */
    static analyze(node, environment, evaluate, executeStatements) {
        evaluate(node.discriminant, environment)
        const selection = GerberSwitchSelection.resolve(node, environment)
        if (selection.known) {
            return analyzeKnown(
                node,
                selection.startIndex,
                environment,
                executeStatements
            )
        }
        return analyzeUnknown(node, environment, evaluate, executeStatements)
    }
}

/**
 * Executes the exact selected case and its fallthrough successors.
 * @param {Record<string, any>} node Switch statement.
 * @param {number} startIndex Selected case index.
 * @param {Record<string, any>} environment Current environment.
 * @param {(statements: Record<string, any>[], environment: Record<string, any>) => Record<string, any>} executeStatements Statement-list executor.
 * @returns {{ terminated: boolean, abrupt: string, values: Set<string> }} Flow outcome.
 */
function analyzeKnown(node, startIndex, environment, executeStatements) {
    if (startIndex < 0) return open()
    const values = new Set()
    for (let index = startIndex; index < node.cases.length; index += 1) {
        const outcome = executeStatements(
            node.cases[index].consequent,
            environment
        )
        addAll(values, outcome.values)
        if (isConsumedBreak(outcome)) return open(values)
        if (outcome.terminated) return { ...outcome, values }
    }
    return open(values)
}

/**
 * Executes every possible entry case and merges only reachable exit states.
 * @param {Record<string, any>} node Switch statement.
 * @param {Record<string, any>} environment Current environment.
 * @param {(expression: Record<string, any> | null, environment: Record<string, any>) => Set<string>} evaluate Expression evaluator.
 * @param {(statements: Record<string, any>[], environment: Record<string, any>) => Record<string, any>} executeStatements Statement-list executor.
 * @returns {{ terminated: boolean, abrupt: string, values: Set<string> }} Flow outcome.
 */
function analyzeUnknown(node, environment, evaluate, executeStatements) {
    const defaultIndex = node.cases.findIndex((branch) => !branch.test)
    const starts = node.cases.map((branch, index) => index)
    if (defaultIndex < 0) starts.push(-1)
    if (!starts.length) return open()

    const paths = starts.map((startIndex) => {
        const active = environment.fork()
        evaluateCaseTests(node, startIndex, active, evaluate)
        return {
            environment: active,
            outcome:
                startIndex < 0
                    ? open()
                    : executePath(node, startIndex, active, executeStatements)
        }
    })
    environment.mergeFrom(
        paths
            .filter((path) => !path.outcome.terminated)
            .map((path) => path.environment)
    )
    return mergeOutcomes(paths.map((path) => path.outcome))
}

/**
 * Evaluates the case tests encountered before a possible entry point.
 * @param {Record<string, any>} node Switch statement.
 * @param {number} startIndex Possible entry index or negative for no match.
 * @param {Record<string, any>} environment Path environment.
 * @param {(expression: Record<string, any> | null, environment: Record<string, any>) => Set<string>} evaluate Expression evaluator.
 * @returns {void}
 */
function evaluateCaseTests(node, startIndex, environment, evaluate) {
    const defaultIndex = node.cases.findIndex((branch) => !branch.test)
    const lastTest =
        startIndex < 0 || startIndex === defaultIndex
            ? node.cases.length - 1
            : startIndex
    for (let index = 0; index <= lastTest; index += 1) {
        evaluate(node.cases[index]?.test, environment)
    }
}

/**
 * Executes one possible entry point through all fallthrough cases.
 * @param {Record<string, any>} node Switch statement.
 * @param {number} startIndex Entry case index.
 * @param {Record<string, any>} environment Path environment.
 * @param {(statements: Record<string, any>[], environment: Record<string, any>) => Record<string, any>} executeStatements Statement-list executor.
 * @returns {{ terminated: boolean, abrupt: string, values: Set<string> }} Flow outcome.
 */
function executePath(node, startIndex, environment, executeStatements) {
    const values = new Set()
    for (let index = startIndex; index < node.cases.length; index += 1) {
        const outcome = executeStatements(
            node.cases[index].consequent,
            environment
        )
        addAll(values, outcome.values)
        if (isConsumedBreak(outcome)) return open(values)
        if (outcome.terminated) return { ...outcome, values }
    }
    return open(values)
}

/**
 * Merges complete alternative outcomes without inventing an open path.
 * @param {Record<string, any>[]} outcomes Alternative outcomes.
 * @returns {{ terminated: boolean, abrupt: string, values: Set<string> }} Merged outcome.
 */
function mergeOutcomes(outcomes) {
    const values = union(...outcomes.map((outcome) => outcome.values))
    if (outcomes.some((outcome) => !outcome.terminated)) return open(values)
    let abrupt = outcomes[0]?.abrupt || ''
    for (const outcome of outcomes.slice(1)) {
        abrupt = GerberEvidenceProvenance.mergeAbrupt(
            { terminated: true, abrupt },
            outcome,
            true
        )
    }
    return { terminated: true, abrupt: abrupt || 'abrupt', values }
}

/**
 * Checks whether the switch consumes one unlabeled break.
 * @param {{ terminated: boolean, abrupt: string }} outcome Flow outcome.
 * @returns {boolean} Whether this is an unlabeled switch break.
 */
function isConsumedBreak(outcome) {
    return (
        outcome.terminated &&
        GerberControlFlow.kind(outcome.abrupt) === 'break' &&
        !GerberControlFlow.label(outcome.abrupt)
    )
}

/**
 * Creates one non-terminating switch outcome.
 * @param {Set<string>} [values] Possible return values.
 * @returns {{ terminated: false, abrupt: string, values: Set<string> }} Open outcome.
 */
function open(values = new Set()) {
    return { terminated: false, abrupt: '', values: new Set(values || []) }
}

/**
 * Adds an iterable to one set.
 * @param {Set<string>} destination Destination set.
 * @param {Iterable<string>} source Source values.
 * @returns {void}
 */
function addAll(destination, source) {
    for (const value of source || []) destination.add(value)
}

/**
 * Unions symbolic value sets without mutating an input.
 * @param {...Set<string>} sets Value sets.
 * @returns {Set<string>} Union.
 */
function union(...sets) {
    return new Set(sets.flatMap((set) => [...(set || [])]))
}
