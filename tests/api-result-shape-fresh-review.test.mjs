import assert from 'node:assert/strict'
import test from 'node:test'

import { GerberApiContractInspector } from '../scripts/GerberApiContractInspector.mjs'

/**
 * Inspects synthetic exports and returns stable feature ids.
 * @param {Record<string, Function>} api Synthetic exports.
 * @returns {Promise<Set<string>>} Captured feature ids.
 */
async function inspectFeatures(api) {
    const contracts = await GerberApiContractInspector.inspect([
        { entrypoint: '.', target: './index.mjs', api }
    ])
    return new Set(contracts.features.map((feature) => feature.feature))
}

/**
 * Checks one result field.
 * @param {Set<string>} features Captured features.
 * @param {string} owner Export and method owner.
 * @param {string} field Result field.
 * @param {boolean} expected Expected presence.
 * @returns {void}
 */
function result(features, owner, field, expected) {
    assert.equal(
        features.has(`.#${owner}.result.${field}`),
        expected,
        `${owner}.${field}`
    )
}

test('literal collection selectors preserve the selected runtime shape', async () => {
    class CollectionSelectors {
        static at() {
            return [{ atFirstReal: true }, { atSecondGhost: true }].at(0)
        }

        static find() {
            return [{ findFirstReal: true }, { findSecondGhost: true }].find(
                () => true
            )
        }

        static pop() {
            return [{ popFirstGhost: true }, { popLastReal: true }].pop()
        }

        static shift() {
            return [
                { shiftFirstReal: true },
                { shiftSecondGhost: true }
            ].shift()
        }

        static slice() {
            return [{ sliceFirstGhost: true }, { sliceSecondReal: true }].slice(
                1
            )
        }

        static concat() {
            return [{ concatLeftReal: true }].concat([
                { concatRightReal: true }
            ])
        }
    }
    const features = await inspectFeatures({ CollectionSelectors })

    for (const [method, real, ghost] of [
        ['at', 'atFirstReal', 'atSecondGhost'],
        ['find', 'findFirstReal', 'findSecondGhost'],
        ['pop', 'popLastReal', 'popFirstGhost'],
        ['shift', 'shiftFirstReal', 'shiftSecondGhost'],
        ['slice', 'sliceSecondReal', 'sliceFirstGhost']
    ]) {
        result(features, `CollectionSelectors.${method}()`, real, true)
        result(features, `CollectionSelectors.${method}()`, ghost, false)
    }
    result(features, 'CollectionSelectors.concat()', 'concatLeftReal', true)
    result(features, 'CollectionSelectors.concat()', 'concatRightReal', true)
})

test('result mutations honor delete splice and Map storage semantics', async () => {
    class ResultMutations {
        static deleted() {
            const value = { deletedGhost: true, retainedReal: true }
            delete value.deletedGhost
            return value
        }

        static spliced() {
            const values = [
                { splicedGhost: true },
                { spliceRetainedReal: true }
            ]
            values.splice(0, 1)
            return values
        }

        static mapStorage() {
            const values = new Map()
            values.set('entry', { mapStorageGhost: true })
            return values
        }
    }
    const features = await inspectFeatures({ ResultMutations })

    result(features, 'ResultMutations.deleted()', 'retainedReal', true)
    result(features, 'ResultMutations.deleted()', 'deletedGhost', false)
    result(features, 'ResultMutations.spliced()', 'spliceRetainedReal', true)
    result(features, 'ResultMutations.spliced()', 'splicedGhost', false)
    result(features, 'ResultMutations.mapStorage()', 'mapStorageGhost', false)
})

test('object members and callback kinds match their runtime result surface', async () => {
    class ExactResultKinds {
        static objectMembers() {
            return {
                methodReal() {},
                get getterReal() {
                    return true
                },
                set setterReal(value) {
                    void value
                }
            }
        }

        static asyncMapper() {
            return [1].map(async () => ({ asyncMapperGhost: true }))
        }

        static generatorMapper() {
            return [1].map(function* () {
                return { generatorMapperGhost: true }
            })
        }

        static overriddenMap() {
            const values = [1]
            values.map = () => []
            return values.map(() => ({ overriddenMapGhost: true }))
        }
    }
    const features = await inspectFeatures({ ExactResultKinds })

    for (const field of ['methodReal', 'getterReal', 'setterReal']) {
        result(features, 'ExactResultKinds.objectMembers()', field, true)
    }
    for (const [method, field] of [
        ['asyncMapper', 'asyncMapperGhost'],
        ['generatorMapper', 'generatorMapperGhost'],
        ['overriddenMap', 'overriddenMapGhost']
    ]) {
        result(features, `ExactResultKinds.${method}()`, field, false)
    }
})

test('JSON and structured clone contracts follow runtime drop and throw rules', async () => {
    class CloneSemantics {
        static json() {
            return JSON.parse(
                JSON.stringify({
                    jsonKeptReal: true,
                    jsonUndefinedGhost: undefined,
                    jsonFunctionGhost() {},
                    nested: {
                        nestedKeptReal: true,
                        nestedUndefinedGhost: undefined
                    }
                })
            )
        }

        static structured() {
            try {
                return structuredClone({
                    structuredSymbolGhost: Symbol('unsupported')
                })
            } catch {
                return { structuredCloneCaughtReal: true }
            }
        }

        static structuredValue() {
            return structuredClone({ structuredKeptReal: true })
        }
    }
    const features = await inspectFeatures({ CloneSemantics })

    for (const field of ['jsonKeptReal', 'nested', 'nested.nestedKeptReal']) {
        result(features, 'CloneSemantics.json()', field, true)
    }
    for (const field of [
        'jsonUndefinedGhost',
        'jsonFunctionGhost',
        'nested.nestedUndefinedGhost'
    ]) {
        result(features, 'CloneSemantics.json()', field, false)
    }
    result(
        features,
        'CloneSemantics.structured()',
        'structuredCloneCaughtReal',
        true
    )
    result(
        features,
        'CloneSemantics.structured()',
        'structuredSymbolGhost',
        false
    )
    result(
        features,
        'CloneSemantics.structuredValue()',
        'structuredKeptReal',
        true
    )
})
