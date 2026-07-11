import assert from 'node:assert/strict'
import test from 'node:test'

import { GerberFeatureEvidence } from '../scripts/GerberFeatureEvidence.mjs'

/**
 * Matches one parser result field against a complete test body.
 * @param {string} field Result-relative field.
 * @param {string} body Test body.
 * @returns {boolean} Evidence match.
 */
function matches(field, body) {
    const source = `
        import assert from 'node:assert/strict'
        import test from 'node:test'
        import { GerberParser } from '../src/parser.mjs'
        ${body}
    `
    return GerberFeatureEvidence.resultPathMatches(
        {
            exportName: 'GerberParser',
            methodName: 'parse',
            sourceContract: { type: 'result-field', name: field }
        },
        source
    )
}

test('overridden collection methods do not execute intrinsic callbacks', () => {
    const publicResult = `
        const result = GerberParser.parse()
        assert.ok(Array.isArray(result.items))
        result.items.map = () => []
        result.items.map(() => void result.items.publicOverrideGhost)
    `
    const localAlias = `
        const result = GerberParser.parse()
        const values = [1]
        const alias = values
        alias.map = () => []
        values.map(() => void result.localOverrideGhost)
    `

    assert.equal(matches('items.publicOverrideGhost', publicResult), false)
    assert.equal(matches('localOverrideGhost', localAlias), false)
})

test('reduce evidence distinguishes accumulator item and result semantics', () => {
    const source = `
        const result = GerberParser.parse()
        assert.ok(Array.isArray(result.items))
        const reduced = result.items.reduce((accumulator, item) => {
            void accumulator.accumulatorReal
            void item.itemReal
            return accumulator
        }, result.summary)
        void reduced.reducedReal
    `

    assert.equal(matches('summary.accumulatorReal', source), true)
    assert.equal(matches('items.accumulatorReal', source), false)
    assert.equal(matches('items.itemReal', source), true)
    assert.equal(matches('summary.reducedReal', source), true)
    assert.equal(matches('items.reducedReal', source), false)
})

test('non-value collection methods do not leak receiver provenance', () => {
    const source = `
        const result = GerberParser.parse()
        assert.ok(Array.isArray(result.items))
        const every = result.items.every((item) => Boolean(item.enabled))
        const some = result.items.some((item) => Boolean(item.visible))
        const each = result.items.forEach((item) => void item.visited)
        void every.everyGhost
        void some.someGhost
        void each.forEachGhost
    `

    assert.equal(matches('items.enabled', source), true)
    assert.equal(matches('items.visible', source), true)
    assert.equal(matches('items.visited', source), true)
    for (const field of ['everyGhost', 'someGhost', 'forEachGhost']) {
        assert.equal(matches(`items.${field}`, source), false, field)
    }
})

test('generator and skipped test callbacks remain unexecuted', () => {
    const source = `
        const result = GerberParser.parse()
        test('generator', function* () {
            void result.generatorGhost
        })
        test.skip('skipped', () => void result.skippedGhost)
        test.todo('todo', () => void result.todoGhost)
        ;[1].map(function* () {
            void result.generatorMapGhost
        })
    `

    for (const field of [
        'generatorGhost',
        'skippedGhost',
        'todoGhost',
        'generatorMapGhost'
    ]) {
        assert.equal(matches(field, source), false, field)
    }
})

test('for-in binds property keys while for-of binds public elements', () => {
    const source = `
        const result = GerberParser.parse()
        assert.ok(Array.isArray(result.items))
        for (const key in result.items) void key.forInGhost
        for (const item of result.items) void item.forOfReal
    `

    assert.equal(matches('items.forInGhost', source), false)
    assert.equal(matches('items.forOfReal', source), true)
})

test('Array.isArray branch guards provide proof only in the true branch', () => {
    const source = `
        const result = GerberParser.parse()
        if (Array.isArray(result.items)) {
            result.items.map((item) => void item.guardedReal)
        } else {
            result.items.map((item) => void item.unguardedGhost)
        }
    `

    assert.equal(matches('items.guardedReal', source), true)
    assert.equal(matches('items.unguardedGhost', source), false)
})

test('nested callable defaults execute only for missing arguments', () => {
    const missing = `
        const result = GerberParser.parse()
        function inspect(value = result.defaults) {
            void value.defaultReal
        }
        inspect()
    `
    const provided = `
        const result = GerberParser.parse()
        function inspect(value = result.defaults) {
            void value.providedGhost
        }
        inspect({})
    `

    assert.equal(matches('defaults.defaultReal', missing), true)
    assert.equal(matches('defaults.providedGhost', provided), false)
})
