import assert from 'node:assert/strict'
import test from 'node:test'

import { GerberApiContractInspector } from '../scripts/GerberApiContractInspector.mjs'

/**
 * Inspects synthetic exports and returns their feature ids.
 * @param {Record<string, Function>} api Synthetic exports.
 * @returns {Promise<Set<string>>} Captured feature ids.
 */
async function inspectFeatures(api) {
    const contracts = await GerberApiContractInspector.inspect([
        { entrypoint: '.', target: './index.mjs', api }
    ])
    return new Set(contracts.features.map((feature) => feature.feature))
}

test('private collection variants retain external provenance through identity calls', async () => {
    class IndirectExternalVariant {
        static build(receiver) {
            void IndirectExternalVariant.#make()
            return IndirectExternalVariant.#project(
                IndirectExternalVariant.#identity(receiver)
            )
        }

        static #identity(value) {
            return value
        }

        static #make() {
            return { kind: 'items', items: [{ value: true }] }
        }

        static #project(receiver) {
            if (receiver.kind === 'items') {
                return receiver.items.map((item) => ({ value: item.value }))
            }
            return []
        }
    }
    const features = await inspectFeatures({ IndirectExternalVariant })

    assert.equal(
        features.has('.#IndirectExternalVariant.build().result.value'),
        false
    )
})

test('catch alternatives remain reachable when a returned call can throw', async () => {
    class CatchReturnCall {
        static build() {
            try {
                return CatchReturnCall.#risky()
            } catch {
                return { caughtReal: true }
            }
        }

        static #risky() {
            throw new Error('possible')
        }
    }
    const features = await inspectFeatures({ CatchReturnCall })

    assert.equal(
        features.has('.#CatchReturnCall.build().result.caughtReal'),
        true
    )
})

test('unknown switches merge complete branch termination', async () => {
    class UnknownSwitchCompletion {
        static build(mode) {
            switch (mode) {
                case 'a':
                    return { switchAReal: true }
                default:
                    return { switchBReal: true }
            }
            return { afterUnknownSwitchGhost: true }
        }
    }
    const features = await inspectFeatures({ UnknownSwitchCompletion })

    for (const field of ['switchAReal', 'switchBReal']) {
        assert.equal(
            features.has(`.#UnknownSwitchCompletion.build().result.${field}`),
            true,
            field
        )
    }
    assert.equal(
        features.has(
            '.#UnknownSwitchCompletion.build().result.afterUnknownSwitchGhost'
        ),
        false
    )
})

test('do while propagates guaranteed first-iteration return completion', async () => {
    class DoWhileCompletion {
        static build() {
            do {
                return { doWhileReal: true }
            } while (false)
            return { afterDoWhileGhost: true }
        }
    }
    const features = await inspectFeatures({ DoWhileCompletion })

    assert.equal(
        features.has('.#DoWhileCompletion.build().result.doWhileReal'),
        true
    )
    assert.equal(
        features.has('.#DoWhileCompletion.build().result.afterDoWhileGhost'),
        false
    )
})

test('this is non-nullish and empty arrays do not execute callbacks', async () => {
    class NullishAndEmptyCallbacks {
        static thisValue() {
            return this ?? { thisGhost: true }
        }

        static standaloneThis() {
            function helper() {
                return this ?? { standaloneThisReal: true }
            }
            return helper()
        }

        static lexicalThis() {
            const helper = () => this ?? { lexicalThisGhost: true }
            return helper()
        }

        static emptyMap() {
            return [].map(() => ({ emptyMapGhost: true }))
        }

        static emptyForEach() {
            const output = []
            ;[].forEach(() => output.push({ emptyForEachGhost: true }))
            return output
        }

        static emptyArrayFrom() {
            return Array.from({ length: 0 }, () => ({
                emptyArrayFromGhost: true
            }))
        }
    }
    const features = await inspectFeatures({ NullishAndEmptyCallbacks })

    for (const [method, field] of [
        ['thisValue', 'thisGhost'],
        ['lexicalThis', 'lexicalThisGhost'],
        ['emptyMap', 'emptyMapGhost'],
        ['emptyForEach', 'emptyForEachGhost'],
        ['emptyArrayFrom', 'emptyArrayFromGhost']
    ]) {
        assert.equal(
            features.has(
                `.#NullishAndEmptyCallbacks.${method}().result.${field}`
            ),
            false,
            field
        )
    }
    assert.equal(
        features.has(
            '.#NullishAndEmptyCallbacks.standaloneThis().result.standaloneThisReal'
        ),
        true
    )
})

test('option properties come only from reachable code', async () => {
    class ReachableOptions {
        static build(options = {}) {
            function unused() {
                return options.deadOptionGhost
            }
            if (false) void options.deadBranchGhost
            void unused
            return { reachable: true }
        }

        static defaults(options = {}, value = options.defaultOptionReal) {
            void value
            return { reachable: true }
        }

        static destructures(options = {}) {
            const {
                destructuredOptionReal,
                nested: { nestedOptionReal }
            } = options
            void destructuredOptionReal
            void nestedOptionReal
            return { reachable: true }
        }
    }
    const features = await inspectFeatures({ ReachableOptions })

    for (const field of ['deadOptionGhost', 'deadBranchGhost']) {
        assert.equal(
            features.has(
                `.#ReachableOptions.build().argument.options.property.${field}`
            ),
            false,
            field
        )
    }
    for (const [method, field] of [
        ['defaults', 'defaultOptionReal'],
        ['destructures', 'destructuredOptionReal'],
        ['destructures', 'nested'],
        ['destructures', 'nested.nestedOptionReal']
    ]) {
        assert.equal(
            features.has(
                `.#ReachableOptions.${method}().argument.options.property.${field}`
            ),
            true,
            `${method}.${field}`
        )
    }
})

test('result state joins uncertain branches and zero-iteration loops', async () => {
    class JoinedResultState {
        static branches(flag) {
            let result
            if (flag) result = { leftReal: true }
            else result = { rightReal: true }
            return result
        }

        static loop(flag) {
            let result = { initialReal: true }
            while (flag) {
                result = { loopReal: true }
                break
            }
            return result
        }
    }
    const features = await inspectFeatures({ JoinedResultState })

    for (const [method, field] of [
        ['branches', 'leftReal'],
        ['branches', 'rightReal'],
        ['loop', 'initialReal'],
        ['loop', 'loopReal']
    ]) {
        assert.equal(
            features.has(`.#JoinedResultState.${method}().result.${field}`),
            true,
            `${method}.${field}`
        )
    }
})

test('result state joins exclude paths that terminate before the join', async () => {
    class TerminatedResultState {
        static branch(flag) {
            let result = { branchInitialReal: true }
            if (flag) {
                result = { branchTerminatedGhost: true }
                return { branchEarlyReal: true }
            }
            return result
        }

        static loop(flag) {
            let result = { loopInitialReal: true }
            while (flag) {
                result = { loopTerminatedGhost: true }
                return { loopEarlyReal: true }
            }
            return result
        }
    }
    const features = await inspectFeatures({ TerminatedResultState })

    for (const field of [
        'branchInitialReal',
        'branchEarlyReal',
        'loopInitialReal',
        'loopEarlyReal'
    ]) {
        const method = field.startsWith('branch') ? 'branch' : 'loop'
        assert.equal(
            features.has(`.#TerminatedResultState.${method}().result.${field}`),
            true,
            field
        )
    }
    for (const field of ['branchTerminatedGhost', 'loopTerminatedGhost']) {
        const method = field.startsWith('branch') ? 'branch' : 'loop'
        assert.equal(
            features.has(`.#TerminatedResultState.${method}().result.${field}`),
            false,
            field
        )
    }
})

test('result state joins try catch and unknown switch exits', async () => {
    class CompoundResultState {
        static tryCatch(flag) {
            let result = { tryInitialGhost: true }
            try {
                if (flag) throw new Error('possible')
                result = { tryPathReal: true }
            } catch {
                result = { catchPathReal: true }
            }
            return result
        }

        static tryThrowPoint() {
            let result = { beforeThrowReal: true }
            try {
                CompoundResultState.#maybeThrow()
                result = { afterThrowReal: true }
            } catch {}
            return result
        }

        static #maybeThrow() {
            if (Math.random() > 0.5) throw new Error('possible')
        }

        static switchState(mode) {
            let result = { switchInitialGhost: true }
            switch (mode) {
                case 'left':
                    result = { switchLeftReal: true }
                    break
                case 'early':
                    result = { switchTerminatedGhost: true }
                    return { switchEarlyReal: true }
                default:
                    result = { switchRightReal: true }
            }
            return result
        }

        static switchEntry(mode) {
            let result = { switchEntryInitialReal: true }
            switch (mode) {
                case 'poison':
                    result = { switchEntryPoisonGhost: true }
                    return { switchEntryPoisonReturnReal: true }
                case 'read':
                    return result
                default:
                    return { switchEntryDefaultReal: true }
            }
        }
    }
    const features = await inspectFeatures({ CompoundResultState })

    for (const [method, field] of [
        ['tryCatch', 'tryPathReal'],
        ['tryCatch', 'catchPathReal'],
        ['tryThrowPoint', 'beforeThrowReal'],
        ['tryThrowPoint', 'afterThrowReal'],
        ['switchState', 'switchLeftReal'],
        ['switchState', 'switchRightReal'],
        ['switchState', 'switchEarlyReal'],
        ['switchEntry', 'switchEntryInitialReal'],
        ['switchEntry', 'switchEntryPoisonReturnReal'],
        ['switchEntry', 'switchEntryDefaultReal']
    ]) {
        assert.equal(
            features.has(`.#CompoundResultState.${method}().result.${field}`),
            true,
            `${method}.${field}`
        )
    }
    for (const [method, field] of [
        ['tryCatch', 'tryInitialGhost'],
        ['switchState', 'switchInitialGhost'],
        ['switchState', 'switchTerminatedGhost'],
        ['switchEntry', 'switchEntryPoisonGhost']
    ]) {
        assert.equal(
            features.has(`.#CompoundResultState.${method}().result.${field}`),
            false,
            `${method}.${field}`
        )
    }
})

test('loop state retains uncertain early break exits', async () => {
    class EarlyBreakState {
        static build(flag) {
            let result = { earlyBreakInitialReal: true }
            while (true) {
                if (flag) break
                result = { earlyBreakLoopReal: true }
                break
            }
            return result
        }
    }
    const features = await inspectFeatures({ EarlyBreakState })

    for (const field of ['earlyBreakInitialReal', 'earlyBreakLoopReal']) {
        assert.equal(
            features.has(`.#EarlyBreakState.build().result.${field}`),
            true,
            field
        )
    }
})

test('statically infinite loops do not reach following results', async () => {
    class InfiniteCompletion {
        static whileLoop() {
            while (true) {}
            return { afterInfiniteWhileGhost: true }
        }

        static forLoop() {
            for (;;) continue
            return { afterInfiniteForGhost: true }
        }

        static finiteMutation() {
            let running = true
            while (running) running = false
            return { afterFiniteLoopReal: true }
        }
    }
    const features = await inspectFeatures({ InfiniteCompletion })

    for (const [method, field] of [
        ['whileLoop', 'afterInfiniteWhileGhost'],
        ['forLoop', 'afterInfiniteForGhost']
    ]) {
        assert.equal(
            features.has(`.#InfiniteCompletion.${method}().result.${field}`),
            false,
            field
        )
    }
    assert.equal(
        features.has(
            '.#InfiniteCompletion.finiteMutation().result.afterFiniteLoopReal'
        ),
        true
    )
})

test('named collection callbacks preserve their reachable result shape', async () => {
    class NamedCallbackResult {
        static build(items) {
            function project(item) {
                return { namedProjectionReal: item.value }
            }
            return Array.from(items).map(project)
        }
    }
    const features = await inspectFeatures({ NamedCallbackResult })

    assert.equal(
        features.has(
            '.#NamedCallbackResult.build().result.namedProjectionReal'
        ),
        true
    )
})

test('shadowed intrinsics do not contribute result fields', async () => {
    class ShadowedIntrinsics {
        static assign(Object) {
            return Object.assign({}, { shadowedAssignGhost: true })
        }

        static clone(structuredClone) {
            return structuredClone({ shadowedCloneGhost: true })
        }

        static json(JSON) {
            return JSON.parse(JSON.stringify({ shadowedJsonGhost: true }))
        }

        static assignControl() {
            return Object.assign({}, { intrinsicAssignReal: true })
        }

        static cloneControl() {
            return structuredClone({ intrinsicCloneReal: true })
        }

        static jsonControl() {
            return JSON.parse(JSON.stringify({ intrinsicJsonReal: true }))
        }
    }
    const features = await inspectFeatures({ ShadowedIntrinsics })

    for (const [method, field] of [
        ['assign', 'shadowedAssignGhost'],
        ['clone', 'shadowedCloneGhost'],
        ['json', 'shadowedJsonGhost']
    ]) {
        assert.equal(
            features.has(`.#ShadowedIntrinsics.${method}().result.${field}`),
            false,
            `${method}.${field}`
        )
    }
    for (const [method, field] of [
        ['assignControl', 'intrinsicAssignReal'],
        ['cloneControl', 'intrinsicCloneReal'],
        ['jsonControl', 'intrinsicJsonReal']
    ]) {
        assert.equal(
            features.has(`.#ShadowedIntrinsics.${method}().result.${field}`),
            true,
            `${method}.${field}`
        )
    }
})

test('constructed result types require an unshadowed constructor', async () => {
    class ConstructedHelper {
        make() {
            return { constructedField: true }
        }
    }

    class ShadowedConstruction {
        static build(ConstructedHelper) {
            const instance = new ConstructedHelper()
            return instance.make()
        }
    }

    class ProvenConstruction {
        static build() {
            const instance = new ConstructedHelper()
            return instance.make()
        }
    }
    const features = await inspectFeatures({
        ConstructedHelper,
        ShadowedConstruction,
        ProvenConstruction
    })

    assert.equal(
        features.has('.#ShadowedConstruction.build().result.constructedField'),
        false
    )
    assert.equal(
        features.has('.#ProvenConstruction.build().result.constructedField'),
        true
    )
})

test('mixed break and continue branches retain the reachable loop exit', async () => {
    class MixedLoopExit {
        static build(flag) {
            let result = { mixedLoopExitReal: true }
            while (true) {
                if (flag) break
                else continue
            }
            return result
        }
    }
    const features = await inspectFeatures({ MixedLoopExit })

    assert.equal(
        features.has('.#MixedLoopExit.build().result.mixedLoopExitReal'),
        true
    )
})

test('expression alternatives join every reachable result state', async () => {
    class ExpressionStateJoin {
        static conditional(flag) {
            let result
            flag
                ? (result = { conditionalLeftReal: true })
                : (result = { conditionalRightReal: true })
            return result
        }

        static logicalAnd(flag) {
            let result = { andInitialReal: true }
            flag && (result = { andBranchReal: true })
            return result
        }

        static logicalOr(flag) {
            let result = { orInitialReal: true }
            flag || (result = { orBranchReal: true })
            return result
        }

        static nullish(value) {
            let result = { nullishInitialReal: true }
            value ?? (result = { nullishBranchReal: true })
            return result
        }
    }
    const features = await inspectFeatures({ ExpressionStateJoin })

    for (const [method, field] of [
        ['conditional', 'conditionalLeftReal'],
        ['conditional', 'conditionalRightReal'],
        ['logicalAnd', 'andInitialReal'],
        ['logicalAnd', 'andBranchReal'],
        ['logicalOr', 'orInitialReal'],
        ['logicalOr', 'orBranchReal'],
        ['nullish', 'nullishInitialReal'],
        ['nullish', 'nullishBranchReal']
    ]) {
        assert.equal(
            features.has(`.#ExpressionStateJoin.${method}().result.${field}`),
            true,
            `${method}.${field}`
        )
    }
})

test('local function declarations are callable before their declaration', async () => {
    class HoistedLocalFunction {
        static build() {
            return helper()

            function helper() {
                return { hoistedFunctionReal: true }
            }
        }
    }
    const features = await inspectFeatures({ HoistedLocalFunction })

    assert.equal(
        features.has(
            '.#HoistedLocalFunction.build().result.hoistedFunctionReal'
        ),
        true
    )
})

test('callbacks skip statically empty derived and sparse collections', async () => {
    class EmptyDerivedCollections {
        static filter() {
            return [1].filter(() => false).map(() => ({ filterGhost: true }))
        }

        static slice() {
            return [1].slice(0, 0).map(() => ({ sliceGhost: true }))
        }

        static flat() {
            return [[]].flat().map(() => ({ flatGhost: true }))
        }

        static sparse() {
            return [, , ,].map(() => ({ sparseGhost: true }))
        }
    }
    const features = await inspectFeatures({ EmptyDerivedCollections })

    for (const [method, field] of [
        ['filter', 'filterGhost'],
        ['slice', 'sliceGhost'],
        ['flat', 'flatGhost'],
        ['sparse', 'sparseGhost']
    ]) {
        assert.equal(
            features.has(
                `.#EmptyDerivedCollections.${method}().result.${field}`
            ),
            false,
            `${method}.${field}`
        )
    }
})

test('catch parameters shadow outer bindings and retain thrown shapes', async () => {
    class CatchParameterBinding {
        static build() {
            const result = { catchOuterGhost: true }
            void result
            try {
                throw { catchValueReal: true }
            } catch (result) {
                return result
            }
        }
    }
    const features = await inspectFeatures({ CatchParameterBinding })

    assert.equal(
        features.has('.#CatchParameterBinding.build().result.catchValueReal'),
        true
    )
    assert.equal(
        features.has('.#CatchParameterBinding.build().result.catchOuterGhost'),
        false
    )
})

test('catch state comes from each reachable throw point', async () => {
    class CatchThrowPointState {
        static build() {
            let result = { beforeCatchReal: true }
            try {
                CatchThrowPointState.#risky()
                result = { afterCatchGhost: true }
                return { normalReturnReal: true }
            } catch {
                return result
            }
        }

        static #risky() {
            if (Math.random() > 0.5) throw new Error('possible')
        }
    }
    const features = await inspectFeatures({ CatchThrowPointState })

    for (const field of ['beforeCatchReal', 'normalReturnReal']) {
        assert.equal(
            features.has(`.#CatchThrowPointState.build().result.${field}`),
            true,
            field
        )
    }
    assert.equal(
        features.has('.#CatchThrowPointState.build().result.afterCatchGhost'),
        false
    )
})

test('statically empty for-of and for-in bodies are unreachable', async () => {
    class EmptyIterationBodies {
        static forOf() {
            const result = []
            for (const value of []) {
                result.push({ emptyForOfGhost: value })
            }
            return result
        }

        static forIn() {
            const result = []
            for (const key in {}) {
                result.push({ emptyForInGhost: key })
            }
            return result
        }
    }
    const features = await inspectFeatures({ EmptyIterationBodies })

    for (const [method, field] of [
        ['forOf', 'emptyForOfGhost'],
        ['forIn', 'emptyForInGhost']
    ]) {
        assert.equal(
            features.has(`.#EmptyIterationBodies.${method}().result.${field}`),
            false,
            field
        )
    }
})

test('switch lexical declarations do not escape their switch scope', async () => {
    class SwitchLexicalScope {
        static build(mode) {
            let result = { switchOuterReal: true }
            switch (mode) {
                case 'inner':
                    let result = { switchInnerGhost: true }
                    void result
                    break
                default:
                    break
            }
            return result
        }
    }
    const features = await inspectFeatures({ SwitchLexicalScope })

    assert.equal(
        features.has('.#SwitchLexicalScope.build().result.switchOuterReal'),
        true
    )
    assert.equal(
        features.has('.#SwitchLexicalScope.build().result.switchInnerGhost'),
        false
    )
})

test('static binary and logical conditions preserve exact reachability', async () => {
    class StaticConditionReachability {
        static equality() {
            if (1 === 1) return { equalityReal: true }
            return { equalityGhost: true }
        }

        static logical() {
            if (true && false) return { logicalGhost: true }
            return { logicalReal: true }
        }

        static infinite() {
            while (1 < 2) {}
            return { binaryInfiniteGhost: true }
        }
    }
    const features = await inspectFeatures({ StaticConditionReachability })

    for (const [method, field] of [
        ['equality', 'equalityReal'],
        ['logical', 'logicalReal']
    ]) {
        assert.equal(
            features.has(
                `.#StaticConditionReachability.${method}().result.${field}`
            ),
            true,
            field
        )
    }
    for (const [method, field] of [
        ['equality', 'equalityGhost'],
        ['logical', 'logicalGhost'],
        ['infinite', 'binaryInfiniteGhost']
    ]) {
        assert.equal(
            features.has(
                `.#StaticConditionReachability.${method}().result.${field}`
            ),
            false,
            field
        )
    }
})

test('catch reachability ignores safe and completed try code', async () => {
    class ExactCatchReachability {
        static safeBinary() {
            try {
                void (1 + 1)
                return { safeTryReal: true }
            } catch {
                return { safeBinaryCatchGhost: true }
            }
        }

        static completed(flag) {
            try {
                if (flag) return { completedLeftReal: true }
                else return { completedRightReal: true }
                unreachableCall()
            } catch {
                return { completedCatchGhost: true }
            }
        }
    }
    const features = await inspectFeatures({ ExactCatchReachability })

    for (const [method, field] of [
        ['safeBinary', 'safeTryReal'],
        ['completed', 'completedLeftReal'],
        ['completed', 'completedRightReal']
    ]) {
        assert.equal(
            features.has(
                `.#ExactCatchReachability.${method}().result.${field}`
            ),
            true,
            field
        )
    }
    for (const [method, field] of [
        ['safeBinary', 'safeBinaryCatchGhost'],
        ['completed', 'completedCatchGhost']
    ]) {
        assert.equal(
            features.has(
                `.#ExactCatchReachability.${method}().result.${field}`
            ),
            false,
            field
        )
    }
})

test('do-while evaluates its condition only after a continuing body', async () => {
    class DoWhileConditionOrder {
        static build(options = {}) {
            do {
                return { doBodyReal: true }
            } while (options.doConditionGhost)
        }
    }
    const features = await inspectFeatures({ DoWhileConditionOrder })

    assert.equal(
        features.has('.#DoWhileConditionOrder.build().result.doBodyReal'),
        true
    )
    assert.equal(
        features.has(
            '.#DoWhileConditionOrder.build().argument.options.property.doConditionGhost'
        ),
        false
    )
})

test('nullish optional chains skip arguments and computed keys', async () => {
    class OptionalChainReachability {
        static build(options = {}) {
            null?.(options.optionalArgumentGhost)
            null?.[options.optionalComputedGhost]
            return { optionalChainReal: true }
        }
    }
    const features = await inspectFeatures({ OptionalChainReachability })

    assert.equal(
        features.has(
            '.#OptionalChainReachability.build().result.optionalChainReal'
        ),
        true
    )
    for (const field of ['optionalArgumentGhost', 'optionalComputedGhost']) {
        assert.equal(
            features.has(
                `.#OptionalChainReachability.build().argument.options.property.${field}`
            ),
            false,
            field
        )
    }
})

test('logical and destructuring assignments preserve exact state', async () => {
    class AssignmentSemantics {
        static logical() {
            let result = { logicalAssignmentReal: true }
            let flag = false
            flag &&= result = { logicalAssignmentGhost: true }
            return result
        }

        static arrayPattern() {
            let result = { arrayPatternGhost: true }
            ;[result] = [{ arrayPatternReal: true }]
            return result
        }

        static objectPattern() {
            let result = { objectPatternGhost: true }
            ;({ value: result } = {
                value: { objectPatternReal: true }
            })
            return result
        }
    }
    const features = await inspectFeatures({ AssignmentSemantics })

    for (const [method, field] of [
        ['logical', 'logicalAssignmentReal'],
        ['arrayPattern', 'arrayPatternReal'],
        ['objectPattern', 'objectPatternReal']
    ]) {
        assert.equal(
            features.has(`.#AssignmentSemantics.${method}().result.${field}`),
            true,
            field
        )
    }
    for (const [method, field] of [
        ['logical', 'logicalAssignmentGhost'],
        ['arrayPattern', 'arrayPatternGhost'],
        ['objectPattern', 'objectPatternGhost']
    ]) {
        assert.equal(
            features.has(`.#AssignmentSemantics.${method}().result.${field}`),
            false,
            field
        )
    }
})
