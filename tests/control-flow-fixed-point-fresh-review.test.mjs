import assert from 'node:assert/strict'
import test from 'node:test'

import { GerberApiContractInspector } from '../scripts/GerberApiContractInspector.mjs'
import { GerberFeatureEvidence } from '../scripts/GerberFeatureEvidence.mjs'

/**
 * Inspects synthetic API result fields.
 * @param {Record<string, Function>} api Synthetic exports.
 * @returns {Promise<Set<string>>} Feature ids.
 */
async function inspect(api) {
    const contracts = await GerberApiContractInspector.inspect([
        { entrypoint: '.', target: './index.mjs', api }
    ])
    return new Set(contracts.features.map((feature) => feature.feature))
}

/**
 * Matches one parser result field against evidence source.
 * @param {string} field Result field.
 * @param {string} body Evidence body.
 * @returns {boolean} Evidence match.
 */
function evidence(field, body) {
    return GerberFeatureEvidence.resultPathMatches(
        {
            exportName: 'GerberParser',
            methodName: 'parse',
            sourceContract: { type: 'result-field', name: field }
        },
        `
            import { GerberParser } from '../src/parser.mjs'
            const result = GerberParser.parse()
            ${body}
        `
    )
}

test('loop analysis reaches later state-changing iterations', async () => {
    class LaterIteration {
        static build() {
            const output = []
            let phase = 0
            while (phase < 2) {
                if (phase === 1) {
                    output.push({ laterIterationReal: true })
                    phase = 2
                } else {
                    phase = 1
                }
            }
            return output
        }
    }
    const features = await inspect({ LaterIteration })

    assert.equal(
        features.has('.#LaterIteration.build().result.laterIterationReal'),
        true
    )
    assert.equal(
        evidence(
            'laterIterationReal',
            `
                let phase = 0
                while (phase < 2) {
                    if (phase === 1) {
                        void result.laterIterationReal
                        phase = 2
                    } else {
                        phase = 1
                    }
                }
            `
        ),
        true
    )
})

test('labeled block exits retain every state reaching the label boundary', async () => {
    class LabeledBlock {
        static build(flag) {
            let value
            exit: {
                if (flag) {
                    value = { labeledBreakReal: true }
                    break exit
                }
                value = { labeledOpenReal: true }
            }
            return value
        }
    }
    const features = await inspect({ LabeledBlock })

    for (const field of ['labeledBreakReal', 'labeledOpenReal']) {
        assert.equal(
            features.has(`.#LabeledBlock.build().result.${field}`),
            true,
            field
        )
    }
    const source = `
        let alias
        exit: {
            if (dynamicFlag) {
                alias = result.labeledBreak
                break exit
            }
            alias = result.labeledOpen
        }
        void alias.afterLabelReal
    `
    assert.equal(evidence('labeledBreak.afterLabelReal', source), true)
    assert.equal(evidence('labeledOpen.afterLabelReal', source), true)
})

test('duplicate switch literals start only at the first matching case', async () => {
    class DuplicateCase {
        static build() {
            switch ('same') {
                case 'same':
                    return { firstCaseReal: true }
                case 'same':
                    return { duplicateCaseGhost: true }
                default:
                    return { defaultCaseGhost: true }
            }
        }
    }
    const features = await inspect({ DuplicateCase })

    assert.equal(
        features.has('.#DuplicateCase.build().result.firstCaseReal'),
        true
    )
    for (const field of ['duplicateCaseGhost', 'defaultCaseGhost']) {
        assert.equal(
            features.has(`.#DuplicateCase.build().result.${field}`),
            false,
            field
        )
    }
    const source = `
        switch ('same') {
            case 'same':
                void result.firstCaseReal
                break
            case 'same':
                void result.duplicateCaseGhost
                break
            default:
                void result.defaultCaseGhost
        }
    `
    assert.equal(evidence('firstCaseReal', source), true)
    assert.equal(evidence('duplicateCaseGhost', source), false)
    assert.equal(evidence('defaultCaseGhost', source), false)
})

test('finally runs with every open and return-path environment', () => {
    const source = `
        function inspect(flag) {
            let alias
            try {
                if (flag) {
                    alias = result.returnPath
                    return
                }
                alias = result.openPath
            } finally {
                void alias.finallyReal
            }
        }
        inspect(dynamicFlag)
    `

    assert.equal(evidence('returnPath.finallyReal', source), true)
    assert.equal(evidence('openPath.finallyReal', source), true)
})

test('source finally executes against correlated return and open paths', async () => {
    class SourceFinallyPaths {
        static build(flag) {
            let value
            let returning
            try {
                if (flag) {
                    value = []
                    returning = true
                    return value
                }
                value = []
                returning = false
            } finally {
                if (returning) {
                    value.push({ returnFinallyReal: true })
                } else {
                    value.push({ openFinallyReal: true })
                }
            }
            return value
        }
    }
    const features = await inspect({ SourceFinallyPaths })

    for (const field of ['returnFinallyReal', 'openFinallyReal']) {
        assert.equal(
            features.has(`.#SourceFinallyPaths.build().result.${field}`),
            true,
            field
        )
    }
})

test('branch correlation excludes values from incompatible flag paths', async () => {
    class CorrelatedFlag {
        static build(mode) {
            let value
            let selected
            if (mode) {
                value = { correlatedLeftReal: true }
                selected = true
            } else {
                value = { correlatedRightGhost: true }
                selected = false
            }
            if (selected) return value
            return { correlatedFallbackReal: true }
        }
    }
    const features = await inspect({ CorrelatedFlag })

    for (const field of ['correlatedLeftReal', 'correlatedFallbackReal']) {
        assert.equal(
            features.has(`.#CorrelatedFlag.build().result.${field}`),
            true,
            field
        )
    }
    assert.equal(
        features.has('.#CorrelatedFlag.build().result.correlatedRightGhost'),
        false
    )
    const source = `
        let alias
        let selected
        if (dynamicFlag) {
            alias = result.correlatedLeft
            selected = true
        } else {
            alias = result.correlatedRight
            selected = false
        }
        if (selected) void alias.onlySelectedReal
    `
    assert.equal(evidence('correlatedLeft.onlySelectedReal', source), true)
    assert.equal(evidence('correlatedRight.onlySelectedReal', source), false)
})
