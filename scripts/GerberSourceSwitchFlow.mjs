import { GerberControlFlow } from './GerberControlFlow.mjs'
import { GerberSourceAstSupport } from './GerberSourceAstSupport.mjs'
import { GerberSourceBindingJoin } from './GerberSourceBindingJoin.mjs'
import { GerberSwitchSelection } from './GerberSwitchSelection.mjs'

const FLOW_OPEN = 'open'

/**
 * Executes known and uncertain source switch paths with binding joins.
 */
export class GerberSourceSwitchFlow {
    /**
     * Analyzes one switch through caller-owned source state.
     * @param {{ node: Record<string, any>, scope: Record<string, any>, outer: boolean, bindings: Record<string, any>[], position: (value: number) => number, evaluate: (expression: Record<string, any> | null, scope: Record<string, any>) => void, executeStatements: (statements: Record<string, any>[], scope: Record<string, any>, outer: boolean) => string }} options Analysis services.
     * @returns {string} Combined source control flow.
     */
    static analyze(options) {
        const { node, scope, evaluate } = options
        evaluate(node.discriminant, scope)
        const selection = GerberSwitchSelection.resolve(node, scope)
        return selection.known
            ? analyzeKnown(options, selection.startIndex)
            : analyzeUnknown(options)
    }
}

/**
 * Executes one statically selected entry and its fallthrough successors.
 * @param {Record<string, any>} options Analysis services.
 * @param {number} startIndex Selected case index.
 * @returns {string} Exact selected-path flow.
 */
function analyzeKnown(options, startIndex) {
    const { node, scope, outer, executeStatements } = options
    if (startIndex < 0) return FLOW_OPEN
    for (let index = startIndex; index < node.cases.length; index += 1) {
        const flow = executeStatements(
            node.cases[index].consequent,
            scope,
            outer
        )
        if (isConsumedBreak(flow)) return FLOW_OPEN
        if (flow !== FLOW_OPEN) return flow
    }
    return FLOW_OPEN
}

/**
 * Executes every uncertain case once and joins each possible switch exit.
 * @param {Record<string, any>} options Analysis services.
 * @returns {string} Merged alternative flow.
 */
function analyzeUnknown(options) {
    const {
        node,
        scope,
        outer,
        bindings,
        position,
        evaluate,
        executeStatements
    } = options
    const baselineCount = bindings.length
    const baselineScope = GerberSourceBindingJoin.snapshot(scope)
    const defaultIndex = node.cases.findIndex((branch) => !branch.test)
    const starts = node.cases.map((_branch, index) => index)
    if (defaultIndex < 0) starts.push(-1)
    const paths = starts.map((startIndex) =>
        executeUncertainPath({
            node,
            scope,
            outer,
            bindings,
            position,
            evaluate,
            executeStatements,
            baselineCount,
            baselineScope,
            defaultIndex,
            startIndex
        })
    )
    const exits = paths.filter((path) => path.flow === FLOW_OPEN)
    GerberSourceBindingJoin.mergeScopes(
        baselineScope,
        exits.map((path) => path.scope)
    )
    GerberSourceBindingJoin.mergeRecords(
        bindings,
        baselineCount,
        exits.map((path) => path.records),
        position(node.end)
    )
    let merged = paths.shift()?.flow || FLOW_OPEN
    for (const path of paths) {
        merged = GerberSourceAstSupport.mergeFlows(merged, path.flow, true)
    }
    return merged
}

/**
 * Executes one possible entry through tests and fallthrough cases.
 * @param {Record<string, any>} options Path analysis services.
 * @returns {{ flow: string, records: Record<string, any>[], scope: Record<string, any>[] }} Path result.
 */
function executeUncertainPath(options) {
    const {
        node,
        scope,
        outer,
        bindings,
        position,
        evaluate,
        executeStatements,
        baselineCount,
        baselineScope,
        defaultIndex,
        startIndex
    } = options
    GerberSourceBindingJoin.restore(baselineScope)
    const recordStart = bindings.length
    const branch = node.cases[startIndex]
    GerberSourceBindingJoin.mergeRecords(
        bindings,
        baselineCount,
        [[]],
        position(branch?.consequent[0]?.start || branch?.start || node.end)
    )
    evaluateCaseTests(node, startIndex, defaultIndex, scope, evaluate)
    if (startIndex < 0) {
        return {
            flow: FLOW_OPEN,
            records: bindings.slice(recordStart),
            scope: GerberSourceBindingJoin.snapshot(scope)
        }
    }
    for (let index = startIndex; index < node.cases.length; index += 1) {
        const flow = executeStatements(
            node.cases[index].consequent,
            scope,
            outer
        )
        if (flow === FLOW_OPEN) continue
        return {
            flow: isConsumedBreak(flow) ? FLOW_OPEN : flow,
            records: bindings.slice(recordStart),
            scope: GerberSourceBindingJoin.snapshot(scope)
        }
    }
    return {
        flow: FLOW_OPEN,
        records: bindings.slice(recordStart),
        scope: GerberSourceBindingJoin.snapshot(scope)
    }
}

/**
 * Evaluates the case tests that precede one possible entry.
 * @param {Record<string, any>} node Switch statement.
 * @param {number} startIndex Possible entry index.
 * @param {number} defaultIndex Default case index or negative.
 * @param {Record<string, any>} scope Active path scope.
 * @param {(expression: Record<string, any> | null, scope: Record<string, any>) => void} evaluate Expression evaluator.
 * @returns {void}
 */
function evaluateCaseTests(node, startIndex, defaultIndex, scope, evaluate) {
    const lastTest =
        startIndex < 0 || startIndex === defaultIndex
            ? node.cases.length - 1
            : startIndex
    for (let index = 0; index <= lastTest; index += 1) {
        evaluate(node.cases[index]?.test, scope)
    }
}

/**
 * Checks whether an unlabeled break exits this switch.
 * @param {string} flow Encoded control flow.
 * @returns {boolean} Whether the switch consumes the break.
 */
function isConsumedBreak(flow) {
    return (
        GerberControlFlow.kind(flow) === 'break' &&
        !GerberControlFlow.label(flow)
    )
}
