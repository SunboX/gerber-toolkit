import assert from 'node:assert/strict'
import test from 'node:test'

import { GerberFeatureEvidence } from '../scripts/GerberFeatureEvidence.mjs'

/**
 * Creates one result-field feature.
 * @param {string} field Result field.
 * @returns {Record<string, any>} Feature record.
 */
function resultFeature(field) {
    return {
        exportName: 'GerberParser',
        methodName: 'parse',
        sourceContract: { type: 'result-field', name: field }
    }
}

/**
 * Matches one field against a source body with canonical imports.
 * @param {string} field Result field.
 * @param {string} body Source body.
 * @returns {boolean} Whether semantic evidence matches.
 */
function matches(field, body) {
    const source = `
        import assert from 'node:assert/strict'
        import { GerberParser } from '../src/parser.mjs'
        ${body}
    `
    return GerberFeatureEvidence.resultPathMatches(resultFeature(field), source)
}

test('catch evidence remains reachable when a returned call can throw', () => {
    const source = `
        const result = GerberParser.parse()
        function inspect() {
            try {
                return maybeThrow()
            } catch {
                void result.catchReturnReal
            }
        }
        inspect()
    `

    assert.equal(matches('catchReturnReal', source), true)
})

test('unknown switch evidence merges complete branch termination', () => {
    const source = `
        const result = GerberParser.parse()
        function inspect(mode) {
            switch (mode) {
                case 'a':
                    void result.switchAReal
                    return
                default:
                    void result.switchBReal
                    return
            }
            void result.afterUnknownSwitchGhost
        }
        inspect(dynamicMode)
    `

    assert.equal(matches('switchAReal', source), true)
    assert.equal(matches('switchBReal', source), true)
    assert.equal(matches('afterUnknownSwitchGhost', source), false)
})

test('do while evidence preserves return completion and this nullishness', () => {
    const source = `
        const result = GerberParser.parse()
        function inspect() {
            do {
                void result.doWhileReal
                return
            } while (false)
            void result.afterDoWhileGhost
        }
        function standalone() {
            this ?? void result.standaloneThisReal
        }
        const owner = {
            run() {
                this ?? void result.thisGhost
            }
        }
        inspect()
        standalone()
        owner.run()
    `

    assert.equal(matches('doWhileReal', source), true)
    assert.equal(matches('afterDoWhileGhost', source), false)
    assert.equal(matches('thisGhost', source), false)
    assert.equal(matches('standaloneThisReal', source), true)
})

test('collection callback proofs expire on reassignment and skip empty arrays', () => {
    const reassigned = `
        const result = GerberParser.parse()
        assert.ok(Array.isArray(result.items))
        result.items = { map(callback) { return callback } }
        result.items.map(() => void result.reassignedCollectionGhost)
    `
    const empty = `
        const result = GerberParser.parse()
        ;[].forEach(() => void result.emptyCollectionGhost)
    `

    assert.equal(matches('reassignedCollectionGhost', reassigned), false)
    assert.equal(matches('emptyCollectionGhost', empty), false)
})

test('collection proofs join only paths that reach the callback', () => {
    const terminatingProof = `
        const result = GerberParser.parse()
        function inspect(flag) {
            if (flag) {
                assert.ok(Array.isArray(result.items))
                return
            }
            result.items.map(() => void result.items.branchProofGhost)
        }
        inspect(dynamicFlag)
    `
    const terminatingInvalidation = `
        const result = GerberParser.parse()
        assert.ok(Array.isArray(result.items))
        function inspect(flag) {
            if (flag) {
                result.items = {}
                return
            }
            result.items.map(() => void result.items.branchProofReal)
        }
        inspect(dynamicFlag)
    `

    assert.equal(matches('items.branchProofGhost', terminatingProof), false)
    assert.equal(
        matches('items.branchProofReal', terminatingInvalidation),
        true
    )
})

test('variant key exclusions do not veto independent positive evidence', () => {
    const variantA = `
        import assert from 'node:assert/strict'
        import { GerberParser } from '../src/parser.mjs'
        const result = GerberParser.parse('a')
        assert.deepEqual(Object.keys(result), ['variantA'])
    `
    const variantB = `
        import { GerberParser } from '../src/parser.mjs'
        const result = GerberParser.parse('b')
        void result.variantB
    `

    assert.equal(
        GerberFeatureEvidence.matchesAcross(
            resultFeature('variantB'),
            ['GerberParser', 'parse'],
            [variantA, variantB]
        ),
        true
    )
})

test('evidence state joins uncertain branches and zero-iteration loops', () => {
    const branches = `
        let result
        if (dynamicFlag) result = GerberParser.parse('a')
        else result = GerberParser.parse('b')
        void result.branchAliasReal
    `
    const loop = `
        let result = GerberParser.parse('initial')
        while (dynamicFlag) {
            result = {}
            break
        }
        void result.initialLoopReal
    `

    assert.equal(matches('branchAliasReal', branches), true)
    assert.equal(matches('initialLoopReal', loop), true)
})

test('evidence state joins try and catch exit environments', () => {
    const source = `
        let result = {}
        try {
            maybeThrow()
            result = GerberParser.parse('try')
        } catch {
            result = GerberParser.parse('catch')
        }
        void result.tryCatchAliasReal
    `

    assert.equal(matches('tryCatchAliasReal', source), true)

    const throwPoint = `
        let result = GerberParser.parse('initial')
        try {
            maybeThrow()
            result = {}
        } catch {}
        void result.beforeThrowAliasReal
    `
    assert.equal(matches('beforeThrowAliasReal', throwPoint), true)
})

test('evidence state retains uncertain early loop breaks', () => {
    const source = `
        let result = GerberParser.parse('initial')
        while (true) {
            if (dynamicFlag) break
            result = {}
            break
        }
        void result.earlyBreakAliasReal
    `

    assert.equal(matches('earlyBreakAliasReal', source), true)
})

test('evidence after statically infinite loops is unreachable', () => {
    const whileLoop = `
        const result = GerberParser.parse()
        while (true) {}
        void result.afterInfiniteWhileGhost
    `
    const forLoop = `
        const result = GerberParser.parse()
        for (;;) continue
        void result.afterInfiniteForGhost
    `
    const finite = `
        const result = GerberParser.parse()
        let running = true
        while (running) running = false
        void result.afterFiniteLoopReal
    `

    assert.equal(matches('afterInfiniteWhileGhost', whileLoop), false)
    assert.equal(matches('afterInfiniteForGhost', forLoop), false)
    assert.equal(matches('afterFiniteLoopReal', finite), true)
})

test('named collection callbacks execute with public result provenance', () => {
    const source = `
        const result = GerberParser.parse()
        assert.ok(Array.isArray(result.items))
        function inspect(item) {
            void item.value
        }
        result.items.map(inspect)
    `

    assert.equal(matches('items.value', source), true)
})

test('mutating imported public callables revokes result provenance', () => {
    const direct = `
        GerberParser.parse = () => ({ overwrittenGhost: true })
        const result = GerberParser.parse()
        void result.overwrittenGhost
    `
    const namespace = `
        import * as api from '../src/index.mjs'
        api.GerberParser.parse = () => ({ namespaceGhost: true })
        const result = api.GerberParser.parse()
        void result.namespaceGhost
    `

    assert.equal(matches('overwrittenGhost', direct), false)
    assert.equal(
        GerberFeatureEvidence.resultPathMatches(
            resultFeature('namespaceGhost'),
            namespace
        ),
        false
    )
})

test('finally evidence uses every completion path environment', () => {
    const publicResult = `
        function inspect() {
            let result = {}
            try {
                result = GerberParser.parse()
                return
            } finally {
                void result.finallyPublicReal
            }
        }
        inspect()
    `
    const replacedResult = `
        function inspect() {
            let result = GerberParser.parse()
            try {
                result = {}
                return
            } finally {
                void result.finallyPublicGhost
            }
        }
        inspect()
    `

    assert.equal(matches('finallyPublicReal', publicResult), true)
    assert.equal(matches('finallyPublicGhost', replacedResult), false)
})

test('mixed break and continue evidence retains the loop break path', () => {
    const source = `
        const result = GerberParser.parse()
        while (true) {
            if (dynamicFlag) break
            else continue
        }
        void result.mixedLoopEvidenceReal
    `

    assert.equal(matches('mixedLoopEvidenceReal', source), true)
})

test('expression alternatives join public result provenance', () => {
    const conditional = `
        let result = {}
        dynamicFlag
            ? result = GerberParser.parse('left')
            : result = GerberParser.parse('right')
        void result.conditionalEvidenceReal
    `
    const logical = `
        let result = GerberParser.parse('initial')
        dynamicFlag && (result = {})
        void result.logicalEvidenceReal
    `

    assert.equal(matches('conditionalEvidenceReal', conditional), true)
    assert.equal(matches('logicalEvidenceReal', logical), true)
})

test('hoisted evidence functions execute before their declaration', () => {
    const source = `
        const result = GerberParser.parse()
        inspect()
        function inspect() {
            void result.hoistedEvidenceReal
        }
    `

    assert.equal(matches('hoistedEvidenceReal', source), true)
})

test('evidence callbacks skip empty derived and sparse collections', () => {
    for (const [field, receiver] of [
        ['filterGhost', '[1].filter(() => false)'],
        ['sliceGhost', '[1].slice(0, 0)'],
        ['flatGhost', '[[]].flat()'],
        ['sparseGhost', '[, , ,]']
    ]) {
        assert.equal(
            matches(
                field,
                `const result = GerberParser.parse()
                 ;${receiver}.map(() => void result.${field})`
            ),
            false,
            field
        )
    }
})

test('catch parameters shadow outer public result bindings', () => {
    const source = `
        const result = GerberParser.parse()
        try {
            throw { catchShadowGhost: true }
        } catch (result) {
            void result.catchShadowGhost
        }
    `

    assert.equal(matches('catchShadowGhost', source), false)
})

test('catch evidence starts at actual reachable throw points', () => {
    const source = `
        let result = {}
        try {
            maybeThrow()
            result = GerberParser.parse()
        } catch {
            void result.afterThrowPointGhost
        }
    `

    assert.equal(matches('afterThrowPointGhost', source), false)
})

test('evidence skips statically empty for-of and for-in bodies', () => {
    const source = `
        const result = GerberParser.parse()
        for (const value of []) void result.emptyForOfGhost
        for (const key in {}) void result.emptyForInGhost
    `

    assert.equal(matches('emptyForOfGhost', source), false)
    assert.equal(matches('emptyForInGhost', source), false)
})

test('switch lexical evidence bindings do not escape', () => {
    const source = `
        const result = GerberParser.parse()
        switch (dynamicMode) {
            case 'inner':
                let result = {}
                void result.switchInnerGhost
                break
            default:
                break
        }
        void result.switchOuterReal
    `

    assert.equal(matches('switchInnerGhost', source), false)
    assert.equal(matches('switchOuterReal', source), true)
})

test('static binary and logical conditions gate evidence reachability', () => {
    const source = `
        const result = GerberParser.parse()
        if (1 !== 1) void result.binaryBranchGhost
        if (true && false) void result.logicalBranchGhost
        while (1 < 2) {}
        void result.binaryInfiniteGhost
    `

    assert.equal(matches('binaryBranchGhost', source), false)
    assert.equal(matches('logicalBranchGhost', source), false)
    assert.equal(matches('binaryInfiniteGhost', source), false)
})

test('completed try paths do not make later catch evidence reachable', () => {
    const source = `
        const result = GerberParser.parse()
        function inspect(flag) {
            try {
                if (flag) return
                else return
                unreachableCall()
            } catch {
                void result.completedCatchEvidenceGhost
            }
        }
        inspect(dynamicFlag)
    `

    assert.equal(matches('completedCatchEvidenceGhost', source), false)
})

test('nullish optional chains skip evidence arguments and keys', () => {
    const source = `
        const result = GerberParser.parse()
        const fn = null
        fn?.(void result.optionalArgumentGhost)
        null?.[void result.optionalComputedGhost]
    `

    assert.equal(matches('optionalArgumentGhost', source), false)
    assert.equal(matches('optionalComputedGhost', source), false)
})

test('logical and destructuring assignments update evidence exactly', () => {
    const logical = `
        const result = GerberParser.parse()
        let flag = false
        flag &&= void result.logicalAssignmentGhost
    `
    const arrayPattern = `
        let result = GerberParser.parse()
        ;[result] = [{}]
        void result.arrayPatternGhost
    `
    const objectPattern = `
        let result = GerberParser.parse()
        ;({ value: result } = { value: {} })
        void result.objectPatternGhost
    `

    assert.equal(matches('logicalAssignmentGhost', logical), false)
    assert.equal(matches('arrayPatternGhost', arrayPattern), false)
    assert.equal(matches('objectPatternGhost', objectPattern), false)
})

test('negative assertions and lvalue mutations are not positive evidence', () => {
    for (const [field, statement] of [
        ['undefinedGhost', 'assert.equal(result.undefinedGhost, undefined)'],
        ['falseGhost', 'assert.equal(Boolean(result.falseGhost), false)'],
        ['optionalGhost', 'assert.equal(result.optionalGhost?.x, undefined)'],
        ['assignedGhost', 'result.assignedGhost = 1'],
        ['deletedGhost', 'delete result.deletedGhost'],
        ['updatedGhost', 'result.updatedGhost++']
    ]) {
        assert.equal(
            matches(
                field,
                `const result = GerberParser.parse()
                 ${statement}`
            ),
            false,
            field
        )
    }
})

test('container indices and external union branches keep provenance separate', () => {
    const array = `
        const result = GerberParser.parse()
        const copy = [result, { arrayFabricated: true }]
        void copy[1].arrayFabricated
    `
    const conditional = `
        const result = GerberParser.parse()
        const copy = dynamicFlag
            ? result
            : { conditionalFabricated: true }
        void copy.conditionalFabricated
    `

    assert.equal(matches('arrayFabricated', array), false)
    assert.equal(matches('conditionalFabricated', conditional), false)
})

test('Object.keys exclusions remain scoped to one invocation', () => {
    const source = `
        const first = GerberParser.parse('first')
        assert.deepEqual(Object.keys(first), ['variantA'])
        const second = GerberParser.parse('second')
        void second.variantBReal
    `

    assert.equal(matches('variantBReal', source), true)
})
