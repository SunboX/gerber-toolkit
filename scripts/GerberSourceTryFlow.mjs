import { GerberSourceAstSupport } from './GerberSourceAstSupport.mjs'
import { GerberSourceBindingJoin } from './GerberSourceBindingJoin.mjs'
import { GerberThrowReachability } from './GerberThrowReachability.mjs'

const FLOW_OPEN = 'open'
const FLOW_THROW = 'throw'

/**
 * Executes source try/catch/finally while joining reachable exit bindings.
 */
export class GerberSourceTryFlow {
    /**
     * Analyzes one try statement through caller-owned source state.
     * @param {{ node: Record<string, any>, scope: Record<string, any>, outer: boolean, bindings: Record<string, any>[], returns: Record<string, any>[], position: (value: number) => number, executeTry: (statement: Record<string, any>, scope: Record<string, any>, outer: boolean, start: number) => { flow: string, points: { records: Record<string, any>[], scope: Record<string, any>[] }[] }, executeHandler: (handler: Record<string, any>, initializer: Record<string, any> | null, scope: Record<string, any>, outer: boolean) => string }} options Analysis services.
     * @returns {string} Combined source control flow.
     */
    static analyze(options) {
        const { node, scope, outer, bindings, returns, position, abruptExits } =
            options
        const returnStart = returns.length
        const exitStart = abruptExits.length
        const baselineCount = bindings.length
        const baselineScope = GerberSourceBindingJoin.snapshot(scope)
        const blockExecution = options.executeTry(
            node.block,
            scope,
            outer,
            baselineCount
        )
        const blockFlow = blockExecution.flow
        const blockRecords = bindings.slice(baselineCount)
        const blockScope = GerberSourceBindingJoin.snapshot(scope)
        let priorFlow = blockFlow
        let handlerFlow = null
        let handlerRecords = []
        let handlerScope = null
        const catchReachable =
            Boolean(node.handler) &&
            (blockFlow === FLOW_THROW ||
                GerberThrowReachability.canThrow(node.block))

        if (catchReachable) {
            let handlerPrelude = []
            if (blockFlow !== FLOW_THROW) {
                const preludeStart = bindings.length
                const points = blockExecution.points.length
                    ? blockExecution.points
                    : [{ records: [], scope: baselineScope }]
                GerberSourceBindingJoin.mergeScopes(
                    baselineScope,
                    points.map((point) => point.scope)
                )
                GerberSourceBindingJoin.mergeRecords(
                    bindings,
                    baselineCount,
                    points.map((point) => point.records),
                    position(node.handler.body.start)
                )
                handlerPrelude = bindings.slice(preludeStart)
            }
            const handlerStart = bindings.length
            handlerFlow = options.executeHandler(
                node.handler,
                blockFlow === FLOW_THROW
                    ? directThrownArgument(node.block)
                    : null,
                scope,
                outer
            )
            handlerRecords = [
                ...handlerPrelude,
                ...bindings.slice(handlerStart)
            ]
            handlerScope = GerberSourceBindingJoin.snapshot(scope)
            priorFlow =
                blockFlow === FLOW_THROW
                    ? handlerFlow
                    : GerberSourceAstSupport.mergeFlows(
                          blockFlow,
                          handlerFlow,
                          true
                      )
        }

        const alternatives = []
        const scopeAlternatives = []
        if (blockFlow === FLOW_OPEN) {
            alternatives.push(blockRecords)
            scopeAlternatives.push(blockScope)
        }
        if (handlerFlow === FLOW_OPEN) {
            alternatives.push(handlerRecords)
            scopeAlternatives.push(handlerScope)
        }
        const joinPosition = position(node.finalizer?.start || node.end)
        GerberSourceBindingJoin.mergeScopes(baselineScope, scopeAlternatives)
        GerberSourceBindingJoin.mergeRecords(
            bindings,
            baselineCount,
            alternatives,
            joinPosition
        )

        const beforeFinally = returns.length
        if (!node.finalizer) return priorFlow
        const completionPaths = [
            ...(blockFlow === FLOW_OPEN
                ? [
                      {
                          flow: FLOW_OPEN,
                          scope: blockScope,
                          records: blockRecords
                      }
                  ]
                : []),
            ...(handlerFlow === FLOW_OPEN
                ? [
                      {
                          flow: FLOW_OPEN,
                          scope: handlerScope,
                          records: handlerRecords
                      }
                  ]
                : []),
            ...abruptExits
                .slice(exitStart)
                .filter((exit) => !(node.handler && exit.flow === FLOW_THROW))
        ]
        if (
            blockFlow !== FLOW_OPEN &&
            !completionPaths.some((path) => path.flow === blockFlow)
        ) {
            completionPaths.push({
                flow: blockFlow,
                scope: blockScope,
                records: blockRecords
            })
        }
        if (
            handlerFlow &&
            handlerFlow !== FLOW_OPEN &&
            !completionPaths.some((path) => path.flow === handlerFlow)
        ) {
            completionPaths.push({
                flow: handlerFlow,
                scope: handlerScope,
                records: handlerRecords
            })
        }
        const finalPaths = []
        for (const path of uniquePaths(completionPaths)) {
            GerberSourceBindingJoin.restore(path.scope)
            const start = bindings.length
            const finallyFlow = options.executeTry(
                node.finalizer,
                scope,
                outer,
                start
            ).flow
            finalPaths.push({
                flow: finallyFlow === FLOW_OPEN ? path.flow : finallyFlow,
                finallyFlow,
                scope: GerberSourceBindingJoin.snapshot(scope),
                records: [...path.records, ...bindings.slice(start)]
            })
        }
        const openFinalPaths = finalPaths.filter(
            (path) => path.flow === FLOW_OPEN
        )
        GerberSourceBindingJoin.mergeScopes(
            baselineScope,
            openFinalPaths.map((path) => path.scope)
        )
        GerberSourceBindingJoin.mergeRecords(
            bindings,
            baselineCount,
            openFinalPaths.map((path) => path.records),
            position(node.end)
        )
        const overriding = finalPaths.map((path) => path.finallyFlow)
        if (
            overriding.length &&
            overriding.every(
                (flow) => flow !== FLOW_OPEN && flow === overriding[0]
            )
        ) {
            returns.splice(returnStart, beforeFinally - returnStart)
            return overriding[0]
        }
        return priorFlow
    }
}

/**
 * Deduplicates identical completion scopes and flows.
 * @param {Record<string, any>[]} paths Completion paths.
 * @returns {Record<string, any>[]} Unique paths.
 */
function uniquePaths(paths) {
    const unique = new Map()
    for (const path of paths) {
        const declarations = path.scope.flatMap((entry) =>
            [...entry.declarations].map(([name, value]) => [
                name,
                value?.initializer?.start,
                value?.initializer?.end
            ])
        )
        unique.set(JSON.stringify([path.flow, declarations]), path)
    }
    return [...unique.values()]
}

/**
 * Finds the direct thrown value for an exactly throwing statement list.
 * @param {Record<string, any>} block Try block.
 * @returns {Record<string, any> | null} Thrown expression or null.
 */
function directThrownArgument(block) {
    const statement = block?.body?.at(-1)
    return statement?.type === 'ThrowStatement' ? statement.argument : null
}
