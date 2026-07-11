import { GerberControlFlow } from './GerberControlFlow.mjs'

const FLOW_OPEN = 'open'
const FLOW_HALT = 'halt'

/**
 * Resolves loop completion after one conservative modeled iteration.
 */
export class GerberSourceLoopFlow {
    /**
     * Combines direct and mixed exits with the next static test value.
     * @param {{ bodyFlow: string, consumed: boolean, loopExits: Record<string, any>[], guaranteedEntry: boolean, nextTruth: boolean | null }} options Loop state.
     * @returns {string} Loop completion flow.
     */
    static completion(options) {
        const { bodyFlow, consumed, loopExits, guaranteedEntry, nextTruth } =
            options
        const directKind = GerberControlFlow.kind(bodyFlow)
        const breakExit =
            (consumed && directKind === 'break') ||
            loopExits.some(
                (exit) => GerberControlFlow.kind(exit.flow) === 'break'
            )
        const loopingPath =
            bodyFlow === FLOW_OPEN ||
            (consumed && directKind === 'continue') ||
            loopExits.some(
                (exit) => GerberControlFlow.kind(exit.flow) === 'continue'
            )
        if (
            guaranteedEntry &&
            nextTruth === true &&
            loopingPath &&
            !breakExit
        ) {
            return FLOW_HALT
        }
        if (consumed || loopExits.length) return FLOW_OPEN
        return guaranteedEntry && bodyFlow !== FLOW_OPEN ? bodyFlow : FLOW_OPEN
    }
}
