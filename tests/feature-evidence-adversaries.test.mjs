import assert from 'node:assert/strict'
import test from 'node:test'

import { GerberFeatureEvidence } from '../scripts/GerberFeatureEvidence.mjs'

/**
 * Creates one synthetic result-field feature.
 * @param {string} name Result-relative field path.
 * @returns {Record<string, any>} Feature record.
 */
function resultFeature(name) {
    return {
        feature: `.#GerberParser.parse().result.${name}`,
        kind: 'field',
        exportName: 'GerberParser',
        methodName: 'parse',
        methodType: 'static',
        sourceContract: { type: 'result-field', name }
    }
}

/**
 * Matches one feature against a single evidence source.
 * @param {string} name Result-relative field path.
 * @param {string} source Evidence source.
 * @returns {boolean} Match result.
 */
function matches(name, source) {
    const feature = resultFeature(name)
    return GerberFeatureEvidence.matchesAcross(
        feature,
        ['GerberParser', 'parse', name.split('.').at(-1)],
        [
            `import assert from 'node:assert/strict'\nimport test from 'node:test'\nimport { GerberParser } from '../src/parser.mjs'\n${source}`
        ]
    )
}

test('result evidence rejects tokens and fields found only in comments', () => {
    assert.equal(matches('x', '/* GerberParser parse x */'), false)
    assert.equal(
        matches(
            'holes.x',
            'const result = GerberParser.parse()\nvoid result.holes\n// x\n'
        ),
        false
    )
})

test('result evidence keeps shadowed aliases in same-file lexical scopes', () => {
    const source = `
        {
            const result = GerberParser.parse()
            void result.real
        }
        {
            const result = Other.build()
            void result.holes.x
        }
    `
    assert.equal(matches('holes.x', source), false)
})

test('result evidence requires the complete expected branch', () => {
    assert.equal(
        matches(
            'detail.pads.holeDiameter',
            'const result = GerberParser.parse()\nvoid result.unrelated.pads.holeDiameter\n'
        ),
        false
    )
})

test('unrelated key assertions do not reject an exact result access', () => {
    const source = `
        const result = GerberParser.parse()
        void result.detail.polygons.holes.x
        const other = { holes: { y: 1 } }
        assert.deepEqual(Object.keys(other.holes).sort(), ['y'])
    `
    assert.equal(matches('detail.polygons.holes.x', source), true)
})

test('unreachable whole-result equality is not semantic evidence', () => {
    for (const assertion of [
        'const unused = () => assert.deepEqual(result, delegated)',
        'if (false) assert.deepEqual(result, delegated)'
    ]) {
        const source = `
            const result = GerberParser.parse()
            const delegated = Other.build()
            const x = true
            void x
            ${assertion}
        `
        assert.equal(matches('holes.x', source), false, assertion)
    }
})

test('exact reachable access remains valid evidence', () => {
    assert.equal(
        matches(
            'detail.polygons.holes.x',
            'const result = GerberParser.parse()\nvoid result.detail.polygons.holes.x\n'
        ),
        true
    )
})

test('result evidence skips assertions after continue and break', () => {
    for (const control of ['continue', 'break']) {
        const source = `
            const result = GerberParser.parse()
            const delegated = Other.build()
            const x = true
            void x
            for (const value of [1]) {
                void value
                ${control}
                assert.deepEqual(result, delegated)
            }
        `
        assert.equal(matches('holes.x', source), false, control)
    }
})

test('result evidence skips code after a terminating finally', () => {
    const source = `
        test('evidence', () => {
            const result = GerberParser.parse()
            const delegated = Other.build()
            const x = true
            void x
            try {
                void result
            } finally {
                return
            }
            assert.deepEqual(result, delegated)
        })
    `
    assert.equal(matches('holes.x', source), false)
})

test('result evidence includes catch alternatives and preserves returns through open finally', () => {
    const source = `
        const result = GerberParser.parse()
        try {
            maybeThrow()
        } catch {
            void result.catchAlternativeReal
        }
        function inspect() {
            try {
                return result
            } finally {
                void result.finallyObservedReal
            }
            void result.afterReturnGhost
        }
        inspect()
    `
    assert.equal(matches('catchAlternativeReal', source), true)
    assert.equal(matches('finallyObservedReal', source), true)
    assert.equal(matches('afterReturnGhost', source), false)
})

test('result evidence skips impossible logical assertions', () => {
    const source = `
        const result = GerberParser.parse()
        const delegated = Other.build()
        const x = true
        void x
        false && assert.deepEqual(result, delegated)
        true || assert.deepEqual(result, delegated)
    `
    assert.equal(matches('holes.x', source), false)
})

test('result evidence selects known switch cases with fallthrough and abrupt flow', () => {
    const fallthrough = `
        const result = GerberParser.parse()
        const mode = 'live'
        switch (mode) {
            case 'dead':
                void result.deadCase
                break
            case 'live':
                void result.liveCase
            case 'fallthrough':
                void result.fallthroughCase
                break
            default:
                void result.defaultCase
        }
        void result.afterSwitch
    `
    for (const field of ['liveCase', 'fallthroughCase', 'afterSwitch']) {
        assert.equal(matches(field, fallthrough), true, field)
    }
    for (const field of ['deadCase', 'defaultCase']) {
        assert.equal(matches(field, fallthrough), false, field)
    }

    const abrupt = `
        test('evidence', () => {
            const result = GerberParser.parse()
            switch ('stop') {
                case 'stop':
                    void result.beforeReturn
                    return
                default:
                    void result.returnDefault
            }
            void result.afterReturn
        })
    `
    assert.equal(matches('beforeReturn', abrupt), true)
    assert.equal(matches('returnDefault', abrupt), false)
    assert.equal(matches('afterReturn', abrupt), false)
})

test('result evidence applies nullish rather than truthy reachability', () => {
    const source = `
        const result = GerberParser.parse()
        'present' ?? void result.stringGhost
        0 ?? void result.zeroGhost
        null ?? void result.nullishReal
    `
    assert.equal(matches('stringGhost', source), false)
    assert.equal(matches('zeroGhost', source), false)
    assert.equal(matches('nullishReal', source), true)
})

test('result evidence executes callbacks only for proven collections', () => {
    const source = `
        const result = GerberParser.parse()
        const fake = { map(callback) { return callback } }
        fake.map(() => void result.fakeGhost)
        const fakeIterator = { forEach(callback) { return callback } }
        fakeIterator.forEach(() => void result.forEachGhost)
        function inspectIterator(unknown) {
            unknown.forEach(() => void result.unknownForEachGhost)
        }
        inspectIterator({ forEach(callback) { return callback } })
        ;[1].map(() => void result.literalReal)
        ;[1].forEach(() => void result.forEachReal)
    `
    assert.equal(matches('fakeGhost', source), false)
    assert.equal(matches('forEachGhost', source), false)
    assert.equal(matches('unknownForEachGhost', source), false)
    assert.equal(matches('literalReal', source), true)
    assert.equal(matches('forEachReal', source), true)
})

test('result evidence requires array proof for callbacks on public results', () => {
    const unproven = `
        const result = GerberParser.parse()
        result.custom.map(() => void result.publicGhost)
    `
    assert.equal(matches('publicGhost', unproven), false)

    const proven = `
        const result = GerberParser.parse()
        assert.equal(Array.isArray(result.items), true)
        result.items.map((item) => void item.publicReal)
    `
    assert.equal(matches('items.publicReal', proven), true)

    const fakeProof = `
        const result = GerberParser.parse()
        const fakeAssert = { equal() {} }
        fakeAssert.equal(Array.isArray(result.items), true)
        result.items.map((item) => void item.fakeProofGhost)
    `
    assert.equal(matches('items.fakeProofGhost', fakeProof), false)
})

test('result evidence accepts delegation only from imported assertions', () => {
    const source = `
        import { GerberParser } from '../src/parser.mjs'
        import { PcbInteractionIndex } from '../src/renderers.mjs'
        const result = GerberParser.parse()
        const delegated = PcbInteractionIndex.build()
        const fakeAssert = { deepEqual() {} }
        fakeAssert.deepEqual(result, delegated)
    `
    assert.equal(
        GerberFeatureEvidence.resultPathMatches(
            resultFeature('holes.x'),
            source
        ),
        false
    )
})

test('result evidence requires imported public receiver provenance', () => {
    const sources = {
        objectShadow: `
            {
                const GerberParser = { parse() { return {} } }
                const result = GerberParser.parse()
                void result.objectShadow
            }
        `,
        classShadow: `
            {
                class GerberParser { static parse() { return {} } }
                const result = GerberParser.parse()
                void result.classShadow
            }
        `,
        parameterShadow: `
            function inspect(GerberParser) {
                const result = GerberParser.parse()
                void result.parameterShadow
            }
            inspect({ parse() { return {} } })
        `
    }
    for (const [field, source] of Object.entries(sources)) {
        assert.equal(matches(field, source), false, field)
    }
    assert.equal(
        matches(
            'importedReal',
            'const result = GerberParser.parse()\nvoid result.importedReal'
        ),
        true
    )
})

test('result evidence retains named and namespace public import aliases', () => {
    const feature = resultFeature('aliasedReal')
    for (const source of [
        `
            import { GerberParser as ImportedParser } from '../src/parser.mjs'
            const result = ImportedParser.parse()
            void result.aliasedReal
        `,
        `
            import * as GerberApi from '../src/parser.mjs'
            const result = GerberApi.GerberParser.parse()
            void result.aliasedReal
        `
    ]) {
        assert.equal(
            GerberFeatureEvidence.matches(
                feature,
                ['GerberParser', 'parse', 'aliasedReal'],
                source
            ),
            true,
            source
        )
    }
})

test('result evidence rejects shadowed intrinsic collection constructors', () => {
    const source = `
        const result = GerberParser.parse()
        function inspect(Array, Object) {
            Array.from([1]).map(() => void result.shadowArrayGhost)
            Object.values({ value: 1 }).forEach(
                () => void result.shadowObjectGhost
            )
        }
        inspect(
            { from() { return { map() {} } } },
            { values() { return { forEach() {} } } }
        )
    `
    for (const field of ['shadowArrayGhost', 'shadowObjectGhost']) {
        assert.equal(matches(field, source), false, field)
    }
})

test('result evidence rejects nonexistent node test callback imports', () => {
    const source = `
        import { forEach } from 'node:test'
        forEach('not a framework callback', () => {
            const result = GerberParser.parse()
            void result.fakeFrameworkGhost
        })
    `
    assert.equal(matches('fakeFrameworkGhost', source), false)
})

test('result evidence rejects public-looking imports outside package entrypoints', () => {
    for (const importPath of [
        '../fixtures/parser.mjs',
        '../fixtures/src/parser.mjs',
        '../../fake/src/index.mjs',
        'gerber-toolkit/not-an-entrypoint'
    ]) {
        const source = `
            import { GerberParser } from '${importPath}'
            const result = GerberParser.parse()
            void result.fixtureImportGhost
        `
        assert.equal(
            GerberFeatureEvidence.resultPathMatches(
                resultFeature('fixtureImportGhost'),
                source
            ),
            false,
            importPath
        )
    }
})

test('result evidence ignores Object.keys calls through lexical shadows', () => {
    const source = `
        const result = GerberParser.parse()
        function inspect(Object) {
            void result.shadowedObjectReal
            assert.deepEqual(Object.keys(result), ['other'])
        }
        inspect({ keys() { return ['other'] } })
    `
    assert.equal(matches('shadowedObjectReal', source), true)
})

test('result evidence preserves imported assertion semantics across aliases', () => {
    const source = `
        import { ok as deepEqual } from 'node:assert/strict'
        import { GerberParser } from '../src/parser.mjs'
        import { PcbInteractionIndex } from '../src/renderers.mjs'
        const result = GerberParser.parse()
        const delegated = PcbInteractionIndex.build()
        deepEqual(result, delegated)
    `
    assert.equal(
        GerberFeatureEvidence.resultPathMatches(
            resultFeature('assertionAliasGhost'),
            source
        ),
        false
    )
})

test('result evidence preserves switch and loop control through open finally blocks', () => {
    const switchSource = `
        const result = GerberParser.parse()
        switch ('live') {
            case 'live':
                try {
                    break
                } finally {
                    void result
                }
            case 'fallthrough':
                void result.fallthroughGhost
        }
        void result.afterSwitchReal
    `
    assert.equal(matches('fallthroughGhost', switchSource), false)
    assert.equal(matches('afterSwitchReal', switchSource), true)

    for (const control of ['continue', 'break']) {
        const field =
            control === 'continue'
                ? 'afterFinallyContinueGhost'
                : 'afterFinallyBreakGhost'
        const source = `
            const result = GerberParser.parse()
            for (const value of [1]) {
                void value
                try {
                    ${control}
                } finally {
                    void result
                }
                void result.${field}
            }
        `
        assert.equal(matches(field, source), false, control)
    }
})

test('result evidence preserves labeled control through open finally blocks', () => {
    for (const [label, control, field, wrapper] of [
        [
            'outerBreak',
            'break outerBreak',
            'labeledBreakGhost',
            (body) => `switch ('live') { case 'live': ${body} }`
        ],
        [
            'outerContinue',
            'continue outerContinue',
            'labeledContinueGhost',
            (body) => body
        ]
    ]) {
        const controlled = wrapper(`
            try {
                ${control}
            } finally {
                void result
            }
        `)
        const source = `
            const result = GerberParser.parse()
            ${label}: for (const value of [1]) {
                void value
                ${controlled}
                void result.${field}
            }
        `
        assert.equal(matches(field, source), false, control)
    }
})

test('token evidence masks regex statements after control headers', () => {
    for (const source of [
        'if (ready) /GerberParser parse x/.test(value)',
        'while (ready) /GerberParser parse x/.test(value)',
        "if (ready && value === ')') /GerberParser parse x/.test(value)",
        'while (ready /* ) */) /GerberParser parse x/.test(value)'
    ]) {
        assert.equal(
            GerberFeatureEvidence.tokensMatch(
                ['GerberParser', 'parse', 'x'],
                source
            ),
            false,
            source
        )
    }
})
