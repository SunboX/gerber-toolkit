import assert from 'node:assert/strict'
import test from 'node:test'

import { GerberApiContractInspector } from '../scripts/GerberApiContractInspector.mjs'
import { GerberSourceExpression } from '../scripts/GerberSourceExpression.mjs'

/**
 * Inspects synthetic exports and returns their stable feature ids.
 * @param {Record<string, Function>} api Synthetic package exports.
 * @returns {Promise<Set<string>>} Captured feature ids.
 */
async function inspectFeatures(api) {
    const contracts = await GerberApiContractInspector.inspect([
        { entrypoint: '.', target: './index.mjs', api }
    ])
    return new Set(contracts.features.map((feature) => feature.feature))
}

test('Gerber source masks preserve UTF-16 offsets and template expressions', () => {
    const source =
        "const emoji = '😀'; const value = `hidden ${output.push({ real: true })}`"
    const mask = GerberSourceExpression.codeMask(source)

    assert.equal(mask.length, source.length)
    assert.equal(mask.includes('hidden'), false)
    assert.equal(mask.includes('output.push({ real: true })'), true)
})

test('Gerber API inspector keeps block-shadowed aliases in lexical scope', async () => {
    class ScopedAliases {
        static build(state) {
            {
                const target = state.left
                target.leftOnly = true
            }
            {
                const target = state.right
                target.rightOnly = true
            }
            return state
        }
    }
    const features = await inspectFeatures({ ScopedAliases })

    for (const path of ['left.leftOnly', 'right.rightOnly']) {
        assert.equal(
            features.has(`.#ScopedAliases.build().result.${path}`),
            true,
            `Missing ${path}`
        )
    }
    for (const path of ['left.rightOnly', 'right.leftOnly']) {
        assert.equal(
            features.has(`.#ScopedAliases.build().result.${path}`),
            false,
            `Unexpected ${path}`
        )
    }
})

test('Gerber API inspector resolves alias reassignments at each mutation', async () => {
    class ReassignedAlias {
        static build(state) {
            let target = state.left
            target.leftOnly = true
            target = state.right
            target.rightOnly = true
            return state
        }
    }
    const features = await inspectFeatures({ ReassignedAlias })

    for (const path of ['left.leftOnly', 'right.rightOnly']) {
        assert.equal(
            features.has(`.#ReassignedAlias.build().result.${path}`),
            true,
            `Missing ${path}`
        )
    }
    for (const path of ['left.rightOnly', 'right.leftOnly']) {
        assert.equal(
            features.has(`.#ReassignedAlias.build().result.${path}`),
            false,
            `Unexpected ${path}`
        )
    }
})

test('Gerber API inspector ignores nested object methods and dead mutations', async () => {
    class DeadCode {
        static build() {
            const output = []
            const helper = {
                make() {
                    output.push({ nestedGhost: true })
                    return { returnedGhost: true }
                }
            }
            const unused = () => output.push({ callbackGhost: true })
            void helper
            void unused
            if (false) output.push({ branchGhost: true })
            return output
            output.push({ lateGhost: true })
        }
    }
    const features = await inspectFeatures({ DeadCode })

    for (const field of [
        'nestedGhost',
        'returnedGhost',
        'callbackGhost',
        'branchGhost',
        'lateGhost'
    ]) {
        assert.equal(
            features.has(`.#DeadCode.build().result.${field}`),
            false,
            `Unexpected ${field}`
        )
    }
})

test('Gerber API inspector follows reachable local and collection callbacks', async () => {
    class ReachableCallbacks {
        static build() {
            const output = []
            const append = () => output.push({ direct: true })
            append()
            ;[1].forEach(() => output.push({ iterated: true }))
            return output
        }
    }
    const features = await inspectFeatures({ ReachableCallbacks })

    for (const field of ['direct', 'iterated']) {
        assert.equal(
            features.has(`.#ReachableCallbacks.build().result.${field}`),
            true,
            `Missing ${field}`
        )
    }
})

test('Gerber API inspector preserves executable template interpolations and UTF-16 positions', async () => {
    class LexicalExecution {
        static build() {
            const output = []
            const emoji = '😀'
            const text = `${output.push({ interpolated: true })}`
            void emoji
            void text
            output.push({ afterEmoji: true })
            return output
        }
    }
    const features = await inspectFeatures({ LexicalExecution })

    for (const field of ['interpolated', 'afterEmoji']) {
        assert.equal(
            features.has(`.#LexicalExecution.build().result.${field}`),
            true,
            `Missing ${field}`
        )
    }
})

test('Gerber API inspector resolves a directly returned Object.assign', async () => {
    class AssignedFields {
        static build() {
            return { assigned: true }
        }
    }
    class DirectAssign {
        static build() {
            const value = { own: true }
            return Object.assign(value, AssignedFields.build())
        }
    }
    const features = await inspectFeatures({ AssignedFields, DirectAssign })

    for (const field of ['own', 'assigned']) {
        assert.equal(
            features.has(`.#DirectAssign.build().result.${field}`),
            true,
            `Missing ${field}`
        )
    }
})

test('Gerber API inspector resolves the Array.from mapper overload', async () => {
    class ArrayFromMapper {
        static build(items) {
            return Array.from(items, (item) => ({ mapped: item }))
        }
    }
    const features = await inspectFeatures({ ArrayFromMapper })

    assert.equal(features.has('.#ArrayFromMapper.build().result.mapped'), true)
})

test('Gerber API inspector materializes shared parameter spreads per call site', async () => {
    class ContextMapper {
        static line(value) {
            return ContextMapper.#copy(value)
        }

        static point(value) {
            return ContextMapper.#copy(value)
        }

        static #copy(value) {
            return { ...value }
        }
    }
    class ContextResult {
        static build() {
            return {
                line: ContextMapper.line({ type: 'line', x1: 1 }),
                point: ContextMapper.point({ x: 1, y: 2 })
            }
        }
    }
    const features = await inspectFeatures({ ContextMapper, ContextResult })

    for (const path of ['line.type', 'line.x1', 'point.x', 'point.y']) {
        assert.equal(
            features.has(`.#ContextResult.build().result.${path}`),
            true,
            `Missing ${path}`
        )
    }
    for (const path of ['line.x', 'line.y', 'point.type', 'point.x1']) {
        assert.equal(
            features.has(`.#ContextResult.build().result.${path}`),
            false,
            `Unexpected ${path}`
        )
    }
})

test('Gerber API inspector skips impossible logical mutation branches', async () => {
    class LogicalReachability {
        static build() {
            const output = []
            false && output.push({ falseAnd: true })
            true || output.push({ trueOr: true })
            true && output.push({ trueAnd: true })
            false || output.push({ falseOr: true })
            return output
        }
    }
    const features = await inspectFeatures({ LogicalReachability })

    for (const field of ['falseAnd', 'trueOr']) {
        assert.equal(
            features.has(`.#LogicalReachability.build().result.${field}`),
            false,
            `Unexpected ${field}`
        )
    }
    for (const field of ['trueAnd', 'falseOr']) {
        assert.equal(
            features.has(`.#LogicalReachability.build().result.${field}`),
            true,
            `Missing ${field}`
        )
    }
})

test('Gerber API inspector selects known switch cases and preserves abrupt flow', async () => {
    class SwitchFallthrough {
        static build() {
            const output = []
            const mode = 'live'
            switch (mode) {
                case 'dead':
                    output.push({ deadCase: true })
                    break
                case 'live':
                    output.push({ liveCase: true })
                case 'fallthrough':
                    output.push({ fallthroughCase: true })
                    break
                default:
                    output.push({ defaultCase: true })
            }
            output.push({ afterSwitch: true })
            return output
        }
    }
    class SwitchReturn {
        static build() {
            const output = []
            switch ('stop') {
                case 'stop':
                    return [{ returned: true }]
                default:
                    output.push({ returnDefault: true })
            }
            output.push({ afterReturn: true })
            return output
        }
    }
    const features = await inspectFeatures({ SwitchFallthrough, SwitchReturn })

    for (const field of ['liveCase', 'fallthroughCase', 'afterSwitch']) {
        assert.equal(
            features.has(`.#SwitchFallthrough.build().result.${field}`),
            true,
            `Missing ${field}`
        )
    }
    for (const field of ['deadCase', 'defaultCase']) {
        assert.equal(
            features.has(`.#SwitchFallthrough.build().result.${field}`),
            false,
            `Unexpected ${field}`
        )
    }
    assert.equal(features.has('.#SwitchReturn.build().result.returned'), true)
    for (const field of ['returnDefault', 'afterReturn']) {
        assert.equal(
            features.has(`.#SwitchReturn.build().result.${field}`),
            false,
            `Unexpected ${field}`
        )
    }
})

test('Gerber API inspector applies nullish rather than truthy reachability', async () => {
    class NullishReachability {
        static build() {
            const output = []
            'present' ?? output.push({ stringGhost: true })
            0 ?? output.push({ zeroGhost: true })
            null ?? output.push({ nullishReal: true })
            return output
        }
    }
    const features = await inspectFeatures({ NullishReachability })

    for (const field of ['stringGhost', 'zeroGhost']) {
        assert.equal(
            features.has(`.#NullishReachability.build().result.${field}`),
            false,
            `Unexpected ${field}`
        )
    }
    assert.equal(
        features.has('.#NullishReachability.build().result.nullishReal'),
        true
    )
})

test('Gerber API inspector invokes callbacks only for proven collections', async () => {
    class CallbackProvenance {
        static build(unknown) {
            const output = []
            const fake = {
                map(callback) {
                    return callback
                }
            }
            fake.map(() => output.push({ fakeGhost: true }))
            unknown.map(() => output.push({ unknownGhost: true }))
            ;[1].map(() => output.push({ literalReal: true }))
            const copied = Array.from([1])
            copied.find(() => output.push({ copiedReal: true }))
            return output
        }
    }
    const features = await inspectFeatures({ CallbackProvenance })

    for (const field of ['fakeGhost', 'unknownGhost']) {
        assert.equal(
            features.has(`.#CallbackProvenance.build().result.${field}`),
            false,
            `Unexpected ${field}`
        )
    }
    for (const field of ['literalReal', 'copiedReal']) {
        assert.equal(
            features.has(`.#CallbackProvenance.build().result.${field}`),
            true,
            `Missing ${field}`
        )
    }
})

test('Gerber API inspector rejects returned callbacks without intrinsic collection provenance', async () => {
    class UnknownMapReturn {
        static build(receiver) {
            return receiver.map(() => ({ unknownMapGhost: true }))
        }
    }
    class FakeMapReturn {
        static build() {
            const fake = {
                map(callback) {
                    void callback
                    return { actual: true }
                }
            }
            return fake.map(() => ({ fakeMapGhost: true }))
        }
    }
    class ShadowedArrayReturn {
        static build(Array) {
            return Array.from([1], () => ({ shadowArrayGhost: true }))
        }
    }
    class UnknownMemberProjection {
        static build(receiver) {
            return (receiver.items || []).map((item) => ({
                memberGhost: item.value
            }))
        }
    }
    class LocalMemberProjection {
        static build() {
            const fake = {
                items: {
                    map(callback) {
                        void callback
                        return { actual: true }
                    }
                }
            }
            return fake.items.map((item) => ({ localGhost: item.value }))
        }
    }
    class PrivateMemberProjection {
        static build(receiver) {
            return PrivateMemberProjection.#project(receiver)
        }

        static #project(receiver) {
            return (receiver.items || []).map((item) => ({
                privateGhost: item.value
            }))
        }
    }
    class PrivateMemberKey {
        static build(receiver) {
            return PrivateMemberKey.#project(receiver)
        }

        static #project(receiver) {
            return receiver.items.map((item) => ({ value: item.value }))
        }
    }
    class GuardedPrivateMemberKey {
        static build(receiver) {
            return GuardedPrivateMemberKey.#project(receiver)
        }

        static #project(receiver) {
            if (receiver.kind === 'items') {
                return receiver.items.map((item) => ({ value: item.value }))
            }
            return []
        }
    }
    class ConstructedPrivateMemberKey {
        static build() {
            return ConstructedPrivateMemberKey.#project(
                ConstructedPrivateMemberKey.#make()
            )
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
    class UnusedPrivateVariant {
        static build(receiver) {
            return UnusedPrivateVariant.#project(receiver)
        }

        static #unused() {
            return { kind: 'items', items: [{ value: true }] }
        }

        static #project(receiver) {
            if (receiver.kind === 'items') {
                return receiver.items.map((item) => ({ value: item.value }))
            }
            return []
        }
    }
    class UnrelatedPrivateVariant {
        static build(receiver) {
            void UnrelatedPrivateVariant.#make()
            return UnrelatedPrivateVariant.#project(receiver)
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
    const features = await inspectFeatures({
        UnknownMapReturn,
        FakeMapReturn,
        ShadowedArrayReturn,
        UnknownMemberProjection,
        LocalMemberProjection,
        PrivateMemberProjection,
        PrivateMemberKey,
        GuardedPrivateMemberKey,
        ConstructedPrivateMemberKey,
        UnusedPrivateVariant,
        UnrelatedPrivateVariant
    })

    for (const [exportName, field] of [
        ['UnknownMapReturn', 'unknownMapGhost'],
        ['FakeMapReturn', 'fakeMapGhost'],
        ['ShadowedArrayReturn', 'shadowArrayGhost'],
        ['UnknownMemberProjection', 'memberGhost'],
        ['LocalMemberProjection', 'localGhost'],
        ['PrivateMemberProjection', 'privateGhost'],
        ['PrivateMemberKey', 'value'],
        ['GuardedPrivateMemberKey', 'value'],
        ['UnusedPrivateVariant', 'value'],
        ['UnrelatedPrivateVariant', 'value']
    ]) {
        assert.equal(
            features.has(`.#${exportName}.build().result.${field}`),
            false,
            `Unexpected ${field}`
        )
    }
    assert.equal(
        features.has('.#ConstructedPrivateMemberKey.build().result.value'),
        true
    )
})

test('Gerber API inspector excludes falsy non-nullish return alternatives', async () => {
    class NullishReturn {
        static zero() {
            return 0 ?? { zeroGhost: true }
        }

        static empty() {
            return '' ?? { emptyGhost: true }
        }

        static bool() {
            return false ?? { falseGhost: true }
        }

        static actual() {
            return null ?? { nullishReal: true }
        }

        static nan() {
            return NaN ?? { nanGhost: true }
        }

        static object() {
            return {} ?? { objectGhost: true }
        }
    }
    const features = await inspectFeatures({ NullishReturn })

    for (const [method, field] of [
        ['zero', 'zeroGhost'],
        ['empty', 'emptyGhost'],
        ['bool', 'falseGhost'],
        ['nan', 'nanGhost'],
        ['object', 'objectGhost']
    ]) {
        assert.equal(
            features.has(`.#NullishReturn.${method}().result.${field}`),
            false,
            `Unexpected ${field}`
        )
    }
    assert.equal(
        features.has('.#NullishReturn.actual().result.nullishReal'),
        true
    )
})

test('Gerber API inspector preserves labeled control through open finally blocks', async () => {
    class LabeledFinallyFlow {
        static build() {
            const output = []
            outerBreak: for (const value of [1]) {
                void value
                switch ('live') {
                    case 'live':
                        try {
                            break outerBreak
                        } finally {
                            void output
                        }
                }
                output.push({ labeledBreakGhost: true })
            }
            outerContinue: for (const value of [1]) {
                void value
                try {
                    continue outerContinue
                } finally {
                    void output
                }
                output.push({ labeledContinueGhost: true })
            }
            output.push({ afterLabelsReal: true })
            return output
        }
    }
    const features = await inspectFeatures({ LabeledFinallyFlow })

    assert.equal(
        features.has('.#LabeledFinallyFlow.build().result.afterLabelsReal'),
        true
    )
    for (const field of ['labeledBreakGhost', 'labeledContinueGhost']) {
        assert.equal(
            features.has(`.#LabeledFinallyFlow.build().result.${field}`),
            false,
            `Unexpected ${field}`
        )
    }
})

test('Gerber API inspector preserves break and continue through open finally blocks', async () => {
    class FinallyFlow {
        static build() {
            const output = []
            switch ('live') {
                case 'live':
                    try {
                        output.push({ selectedReal: true })
                        break
                    } finally {
                        void output
                    }
                case 'fallthrough':
                    output.push({ fallthroughGhost: true })
            }
            for (const value of [1]) {
                void value
                try {
                    continue
                } finally {
                    void output
                }
                output.push({ afterContinueGhost: true })
            }
            for (const value of [1]) {
                void value
                try {
                    break
                } finally {
                    void output
                }
                output.push({ afterBreakGhost: true })
            }
            return output
        }
    }
    const features = await inspectFeatures({ FinallyFlow })

    assert.equal(
        features.has('.#FinallyFlow.build().result.selectedReal'),
        true
    )
    for (const field of [
        'fallthroughGhost',
        'afterContinueGhost',
        'afterBreakGhost'
    ]) {
        assert.equal(
            features.has(`.#FinallyFlow.build().result.${field}`),
            false,
            `Unexpected ${field}`
        )
    }
})

test('Gerber API inspector propagates JSDoc array depth through nested callbacks', async () => {
    class TypedNestedCollection {
        /**
         * @param {{ x: number }[][]} groups Nested point groups.
         * @returns {{ points: { x: number }[] }[]}
         */
        static build(groups) {
            return (groups || []).map((points) => ({
                points: points.map((point) => ({ x: point.x }))
            }))
        }
    }
    const features = await inspectFeatures({ TypedNestedCollection })

    assert.equal(
        features.has('.#TypedNestedCollection.build().result.points.x'),
        true
    )
})

test('Gerber API inspector recognizes generic JSDoc Array provenance', async () => {
    class GenericArrayCollection {
        /**
         * @param {Array<{ x: number }>} items Point items.
         * @returns {object[]}
         */
        static build(items) {
            const output = []
            ;(items || []).forEach((item) => output.push({ x: item.x }))
            return output
        }
    }
    const features = await inspectFeatures({ GenericArrayCollection })

    assert.equal(
        features.has('.#GenericArrayCollection.build().result.x'),
        true
    )
})

test('Gerber API inspector skips statements after continue and break', async () => {
    class LoopReachability {
        static build() {
            const output = []
            for (const value of [1]) {
                void value
                continue
                output.push({ afterContinue: true })
            }
            for (const value of [1]) {
                void value
                break
                output.push({ afterBreak: true })
            }
            return output
        }
    }
    const features = await inspectFeatures({ LoopReachability })

    for (const field of ['afterContinue', 'afterBreak']) {
        assert.equal(
            features.has(`.#LoopReachability.build().result.${field}`),
            false,
            `Unexpected ${field}`
        )
    }
})

test('Gerber API inspector honors a terminating finally return', async () => {
    class FinallyReachability {
        static build() {
            const output = []
            try {
                return { overridden: true }
            } finally {
                output.push({ final: true })
                return output
            }
            output.push({ afterFinally: true })
        }
    }
    const features = await inspectFeatures({ FinallyReachability })

    assert.equal(
        features.has('.#FinallyReachability.build().result.final'),
        true
    )
    for (const field of ['overridden', 'afterFinally']) {
        assert.equal(
            features.has(`.#FinallyReachability.build().result.${field}`),
            false,
            `Unexpected ${field}`
        )
    }
})

test('Gerber API inspector includes catch alternatives and preserves returns through open finally', async () => {
    class TryCompletion {
        static catches() {
            try {
                TryCompletion.#risky()
            } catch {
                return { catchAlternativeReal: true }
            }
            return { afterTryReal: true }
        }

        static finalizes() {
            try {
                return { returnThroughFinallyReal: true }
            } finally {
                void 0
            }
        }

        static #risky() {
            throw new Error('possible')
        }
    }
    const features = await inspectFeatures({ TryCompletion })

    for (const [method, field] of [
        ['catches', 'catchAlternativeReal'],
        ['catches', 'afterTryReal'],
        ['finalizes', 'returnThroughFinallyReal']
    ]) {
        assert.equal(
            features.has(`.#TryCompletion.${method}().result.${field}`),
            true,
            `Missing ${field}`
        )
    }
})

test('Gerber API inspector excludes unreachable legacy delegates', async () => {
    class DelegateTarget {
        static build() {
            return { ghost: true }
        }
    }
    class DeadDelegates {
        static build() {
            if (false) return DelegateTarget.build()
            function unused() {
                return DelegateTarget.build()
            }
            void unused
            return { real: true }
        }
    }
    const features = await inspectFeatures({ DelegateTarget, DeadDelegates })

    assert.equal(features.has('.#DeadDelegates.build().result.real'), true)
    assert.equal(features.has('.#DeadDelegates.build().result.ghost'), false)
})

test('Gerber API inspector resolves Array.from function-expression mappers', async () => {
    class FunctionMapper {
        static build(items) {
            return Array.from(items, function (item) {
                return { mappedByFunction: item }
            })
        }
    }
    const features = await inspectFeatures({ FunctionMapper })

    assert.equal(
        features.has('.#FunctionMapper.build().result.mappedByFunction'),
        true
    )
})
