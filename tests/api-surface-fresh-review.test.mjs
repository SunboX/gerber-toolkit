import assert from 'node:assert/strict'
import test from 'node:test'

import { GerberApiContractInspector } from '../scripts/GerberApiContractInspector.mjs'

/**
 * Finds one captured feature by exact id.
 * @param {Record<string, any>} contracts Captured API contracts.
 * @param {string} id Feature id.
 * @returns {Record<string, any> | undefined} Matching feature.
 */
function feature(contracts, id) {
    return contracts.features.find((candidate) => candidate.feature === id)
}

test('API surface includes inherited fields accessors and callable semantics', async () => {
    class ParentSurface {
        static inheritedStaticField = true
        inheritedInstanceField = true

        static inheritedStaticMethod() {
            return { inheritedStaticResult: true }
        }

        static get inheritedStaticAccessor() {
            return true
        }

        inheritedInstanceMethod() {
            return { inheritedInstanceResult: true }
        }

        get inheritedInstanceAccessor() {
            return true
        }
    }

    class ChildSurface extends ParentSurface {
        static ownStaticField = true
        ownInstanceField = true

        static get ownStaticAccessor() {
            return true
        }

        static async load() {
            return { asyncResult: true }
        }

        static *iterate() {
            return { generatorReturnGhost: true }
        }

        static async *stream() {
            return { asyncGeneratorReturnGhost: true }
        }
    }

    const contracts = await GerberApiContractInspector.inspect([
        {
            entrypoint: '.',
            target: './index.mjs',
            api: { ChildSurface }
        }
    ])
    const exported = contracts.entrypoints[0].exports[0]

    assert.deepEqual(exported.staticFields, [
        'inheritedStaticField',
        'ownStaticField'
    ])
    assert.deepEqual(exported.staticAccessors, [
        'inheritedStaticAccessor',
        'ownStaticAccessor'
    ])
    assert.deepEqual(exported.instanceFields, [
        'inheritedInstanceField',
        'ownInstanceField'
    ])
    assert.equal(exported.staticMethods.includes('inheritedStaticMethod'), true)
    assert.equal(
        exported.instanceMethods.includes('inheritedInstanceMethod'),
        true
    )
    assert.equal(
        exported.instanceAccessors.includes('inheritedInstanceAccessor'),
        true
    )

    for (const id of [
        '.#ChildSurface.inheritedStaticField',
        '.#ChildSurface.ownStaticField',
        '.#ChildSurface.inheritedStaticAccessor',
        '.#ChildSurface.ownStaticAccessor',
        '.#ChildSurface.prototype.inheritedInstanceField',
        '.#ChildSurface.prototype.ownInstanceField',
        '.#ChildSurface.prototype.inheritedInstanceAccessor',
        '.#ChildSurface.inheritedStaticMethod()',
        '.#ChildSurface.prototype.inheritedInstanceMethod()'
    ]) {
        assert.ok(feature(contracts, id), `Missing ${id}`)
    }

    assert.deepEqual(
        feature(contracts, '.#ChildSurface.load()').sourceContract,
        {
            type: 'method',
            signature: '()',
            parameters: [],
            async: true,
            generator: false,
            resultKind: 'promise'
        }
    )
    assert.deepEqual(
        feature(contracts, '.#ChildSurface.iterate()').sourceContract,
        {
            type: 'method',
            signature: '()',
            parameters: [],
            async: false,
            generator: true,
            resultKind: 'iterator'
        }
    )
    assert.deepEqual(
        feature(contracts, '.#ChildSurface.stream()').sourceContract,
        {
            type: 'method',
            signature: '()',
            parameters: [],
            async: true,
            generator: true,
            resultKind: 'async-iterator'
        }
    )
    assert.ok(feature(contracts, '.#ChildSurface.load().result.asyncResult'))
    assert.equal(
        Boolean(
            feature(
                contracts,
                '.#ChildSurface.iterate().result.generatorReturnGhost'
            )
        ),
        false
    )
    assert.equal(
        Boolean(
            feature(
                contracts,
                '.#ChildSurface.stream().result.asyncGeneratorReturnGhost'
            )
        ),
        false
    )
})

test('export contracts preserve exact root and subpath identity', async () => {
    class SharedExport {}
    class DistinctExport {}
    const contracts = await GerberApiContractInspector.inspect([
        {
            entrypoint: '.',
            target: './index.mjs',
            api: { SharedExport, DistinctExport }
        },
        {
            entrypoint: './testing',
            target: './testing.mjs',
            api: { SharedExport, DistinctExport: class DistinctExport {} }
        }
    ])

    assert.deepEqual(
        feature(contracts, '.#SharedExport').sourceContract.aliases,
        ['.#SharedExport', './testing#SharedExport']
    )
    assert.deepEqual(
        feature(contracts, './testing#SharedExport').sourceContract.aliases,
        ['.#SharedExport', './testing#SharedExport']
    )
    assert.deepEqual(
        feature(contracts, '.#DistinctExport').sourceContract.aliases,
        ['.#DistinctExport']
    )
    assert.deepEqual(
        feature(contracts, './testing#DistinctExport').sourceContract.aliases,
        ['./testing#DistinctExport']
    )
})

test('public method contracts parse private field references in class scope', async () => {
    class PrivateFieldSurface {
        #record = { value: true }

        static read(instance) {
            return instance.#record
        }
    }

    const contracts = await GerberApiContractInspector.inspect([
        {
            entrypoint: '.',
            target: './index.mjs',
            api: { PrivateFieldSurface }
        }
    ])

    assert.ok(feature(contracts, '.#PrivateFieldSurface.read()'))
})

test('API inspection preserves inherited native callables without parsing bodies', async () => {
    class NativeSurface extends Error {}

    const contracts = await GerberApiContractInspector.inspect([
        {
            entrypoint: '.',
            target: './index.mjs',
            api: { NativeSurface }
        }
    ])

    assert.equal(
        feature(contracts, '.#NativeSurface.captureStackTrace()').sourceContract
            .resultKind,
        'native'
    )
    assert.equal(
        feature(contracts, '.#NativeSurface.prototype.toString()')
            .sourceContract.resultKind,
        'native'
    )
})
