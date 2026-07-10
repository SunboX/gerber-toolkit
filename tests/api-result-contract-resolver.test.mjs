import assert from 'node:assert/strict'
import test from 'node:test'

import { GerberApiContractInspector } from '../scripts/GerberApiContractInspector.mjs'

test('Gerber API inspector follows aliased constructed instance receivers', async () => {
    class ValueBox {
        toObject() {
            return { value: true }
        }
    }
    class AliasReceiver {
        static build() {
            const box = new ValueBox()
            const alias = box
            return alias.toObject()
        }
    }
    const contracts = await GerberApiContractInspector.inspect([
        {
            entrypoint: '.',
            target: './index.mjs',
            api: { AliasReceiver, ValueBox }
        }
    ])

    assert.equal(
        contracts.features.some(
            (feature) =>
                feature.feature === '.#AliasReceiver.build().result.value'
        ),
        true
    )
})

test('Gerber API inspector projects returned member-expression aliases', async () => {
    class PropertyAlias {
        static build() {
            const wrapper = { payload: { value: true } }
            const alias = wrapper.payload
            return alias
        }
    }
    const contracts = await GerberApiContractInspector.inspect([
        {
            entrypoint: '.',
            target: './index.mjs',
            api: { PropertyAlias }
        }
    ])

    assert.equal(
        contracts.features.some(
            (feature) =>
                feature.feature === '.#PropertyAlias.build().result.value'
        ),
        true
    )
})

test('Gerber API inspector binds array element shapes into map callbacks', async () => {
    class MapWrapper {
        static build() {
            const items = [{ value: true }]
            return items.map((item) => ({ wrapped: item }))
        }
    }
    const contracts = await GerberApiContractInspector.inspect([
        {
            entrypoint: '.',
            target: './index.mjs',
            api: { MapWrapper }
        }
    ])

    assert.equal(
        contracts.features.some(
            (feature) =>
                feature.feature === '.#MapWrapper.build().result.wrapped.value'
        ),
        true
    )
})

test('Gerber API inspector unfolds one recursive array element shape', async () => {
    class RecursiveTree {
        static build(node) {
            return {
                value: node.value,
                children: (node.children || []).map((child) =>
                    RecursiveTree.build(child)
                )
            }
        }
    }
    const contracts = await GerberApiContractInspector.inspect([
        {
            entrypoint: '.',
            target: './index.mjs',
            api: { RecursiveTree }
        }
    ])

    assert.equal(
        contracts.features.some(
            (feature) =>
                feature.feature ===
                '.#RecursiveTree.build().result.children.value'
        ),
        true
    )
})

test('Gerber API inspector resolves tested parser and scene collection element contracts', async () => {
    const [rootApi, parserApi, sceneApi] = await Promise.all([
        import('../src/index.mjs'),
        import('../src/parser.mjs'),
        import('../src/scene3d.mjs')
    ])
    const contracts = await GerberApiContractInspector.inspect(
        [
            { entrypoint: '.', target: './src/index.mjs', api: rootApi },
            {
                entrypoint: './parser',
                target: './src/parser.mjs',
                api: parserApi
            },
            {
                entrypoint: './scene3d',
                target: './src/scene3d.mjs',
                api: sceneApi
            }
        ],
        { sourceRoot: process.cwd() }
    )
    const features = new Set(
        contracts.features.map((feature) => feature.feature)
    )

    for (const feature of [
        '.#GerberParser.parseArrayBuffer().result.pcb.fabrication.layers.primitives.type',
        '.#GerberParser.parseArrayBuffer().result.pcb.fabrication.layers.primitives.width',
        '.#GerberParser.parseArrayBuffer().result.pcb.fabrication.layers.primitives.polarity',
        '.#GerberParser.parseArrayBuffer().result.pcb.fabrication.layers.primitives.attributes.object',
        '.#GerberParser.parseArrayBuffer().result.pcb.fabrication.layers.drills.diameter',
        './parser#GerberParser.fromLayers().result.pcb.fabrication.layers.primitives.type',
        '.#PcbScene3dBuilder.build().result.detail.tracks.layerId',
        '.#PcbScene3dBuilder.build().result.detail.tracks.y1',
        './scene3d#PcbScene3dBuilder.build().result.detail.tracks.layerId'
    ]) {
        assert.equal(features.has(feature), true, `Missing ${feature}`)
    }
})
