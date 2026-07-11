import assert from 'node:assert/strict'
import test from 'node:test'

import { GerberApiContractInspector } from '../scripts/GerberApiContractInspector.mjs'

test('Gerber API inspector propagates JSDoc result fields through helper calls', async () => {
    class TypedHelper {
        /** @returns {{ items: { type: string }[] }} Typed helper payload. */
        static build() {
            return { items: [] }
        }
    }
    class TypedDelegate {
        static build() {
            return { payload: TypedHelper.build() }
        }
    }
    const contracts = await GerberApiContractInspector.inspect([
        {
            entrypoint: '.',
            target: './index.mjs',
            api: { TypedDelegate, TypedHelper }
        }
    ])

    assert.equal(
        contracts.features.some(
            ({ feature }) =>
                feature === '.#TypedDelegate.build().result.payload.items.type'
        ),
        true
    )
})

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

test('Gerber API inspector captures direct local array receiver pushes', async () => {
    class DirectArrayPush {
        static build() {
            const output = []
            output.push({ nested: { value: true } })
            return output
        }
    }
    const contracts = await GerberApiContractInspector.inspect([
        {
            entrypoint: '.',
            target: './index.mjs',
            api: { DirectArrayPush }
        }
    ])
    const features = new Set(
        contracts.features.map((feature) => feature.feature)
    )

    assert.equal(
        features.has('.#DirectArrayPush.build().result.nested.value'),
        true
    )
})

test('Gerber API inspector invokes constructed member receivers', async () => {
    class MemberBounds {
        toObject() {
            return { minX: 1, maxY: 2 }
        }
    }
    class ConstructedMemberReceiver {
        static build() {
            const state = {}
            state.bounds = new MemberBounds()
            return state.bounds.toObject()
        }
    }
    const contracts = await GerberApiContractInspector.inspect([
        {
            entrypoint: '.',
            target: './index.mjs',
            api: { ConstructedMemberReceiver, MemberBounds }
        }
    ])
    const features = new Set(
        contracts.features.map((feature) => feature.feature)
    )

    for (const feature of [
        '.#ConstructedMemberReceiver.build().result.minX',
        '.#ConstructedMemberReceiver.build().result.maxY'
    ]) {
        assert.equal(features.has(feature), true, `Missing ${feature}`)
    }
})

test('Gerber API inspector binds array element shapes into flatMap callbacks', async () => {
    class FlatMapWrapper {
        static build() {
            const items = [{ value: true }]
            return items.flatMap((item) => [{ wrapped: item }])
        }
    }
    const contracts = await GerberApiContractInspector.inspect([
        {
            entrypoint: '.',
            target: './index.mjs',
            api: { FlatMapWrapper }
        }
    ])

    assert.equal(
        contracts.features.some(
            (feature) =>
                feature.feature ===
                '.#FlatMapWrapper.build().result.wrapped.value'
        ),
        true
    )
})

test('Gerber API inspector propagates call mutations through local aliases', async () => {
    class AliasMutationHelper {
        static append(target) {
            target.items.push({ value: true })
        }
    }
    class AliasMutation {
        static build(state) {
            const alias = state
            AliasMutationHelper.append(alias)
            return state
        }

        static buildMember(state) {
            const alias = state.payload
            AliasMutationHelper.append(alias)
            return state
        }
    }
    const contracts = await GerberApiContractInspector.inspect([
        {
            entrypoint: '.',
            target: './index.mjs',
            api: { AliasMutation, AliasMutationHelper }
        }
    ])
    const features = new Set(
        contracts.features.map((feature) => feature.feature)
    )

    for (const feature of [
        '.#AliasMutation.build().result.items.value',
        '.#AliasMutation.buildMember().result.payload.items.value'
    ]) {
        assert.equal(features.has(feature), true, `Missing ${feature}`)
    }
})

test('Gerber API inspector propagates mutations through iteration bindings', async () => {
    class IterationMutation {
        static build(state) {
            for (const item of state.items || []) {
                item.flags.push({ enabled: true })
                item.marked = true
            }
            return state
        }
    }
    const contracts = await GerberApiContractInspector.inspect([
        {
            entrypoint: '.',
            target: './index.mjs',
            api: { IterationMutation }
        }
    ])
    const features = new Set(
        contracts.features.map((feature) => feature.feature)
    )

    for (const feature of [
        '.#IterationMutation.build().result.items.flags.enabled',
        '.#IterationMutation.build().result.items.marked'
    ]) {
        assert.equal(features.has(feature), true, `Missing ${feature}`)
    }
})

test('Gerber API inspector ignores mutations written only in comments and strings', async () => {
    class LexicalMutationNoise {
        static build() {
            const output = []
            /* output.push({ ghost: true }) */
            const sourceText = 'output.push({ phantom: true })'
            void sourceText
            return output
        }
    }
    const contracts = await GerberApiContractInspector.inspect([
        {
            entrypoint: '.',
            target: './index.mjs',
            api: { LexicalMutationNoise }
        }
    ])
    const features = new Set(
        contracts.features.map((feature) => feature.feature)
    )

    assert.equal(
        features.has('.#LexicalMutationNoise.build().result.ghost'),
        false
    )
    assert.equal(
        features.has('.#LexicalMutationNoise.build().result.phantom'),
        false
    )
})

test('Gerber API inspector keeps nested callback returns out of the outer result', async () => {
    class NestedCallbackReturn {
        static build() {
            const helper = () => {
                return { ghost: true }
            }
            helper()
            return { real: true }
        }
    }
    const contracts = await GerberApiContractInspector.inspect([
        {
            entrypoint: '.',
            target: './index.mjs',
            api: { NestedCallbackReturn }
        }
    ])
    const features = new Set(
        contracts.features.map((feature) => feature.feature)
    )

    assert.equal(
        features.has('.#NestedCallbackReturn.build().result.real'),
        true
    )
    assert.equal(
        features.has('.#NestedCallbackReturn.build().result.ghost'),
        false
    )
})

test('Gerber API inspector scopes reused iteration bindings to their loop body', async () => {
    class ScopedIterationMutation {
        static build(state) {
            for (const item of state.left) {
                item.leftOnly = true
            }
            for (const item of state.right) {
                item.rightOnly = true
            }
            return state
        }
    }
    const contracts = await GerberApiContractInspector.inspect([
        {
            entrypoint: '.',
            target: './index.mjs',
            api: { ScopedIterationMutation }
        }
    ])
    const features = new Set(
        contracts.features.map((feature) => feature.feature)
    )

    for (const feature of [
        '.#ScopedIterationMutation.build().result.left.leftOnly',
        '.#ScopedIterationMutation.build().result.right.rightOnly'
    ]) {
        assert.equal(features.has(feature), true, `Missing ${feature}`)
    }
    for (const feature of [
        '.#ScopedIterationMutation.build().result.left.rightOnly',
        '.#ScopedIterationMutation.build().result.right.leftOnly'
    ]) {
        assert.equal(features.has(feature), false, `Unexpected ${feature}`)
    }
})

test('Gerber API inspector invokes constructed members initialized inside object literals', async () => {
    class LiteralBounds {
        toObject() {
            return { value: true }
        }
    }
    class LiteralConstructedMember {
        static build() {
            const state = { bounds: new LiteralBounds() }
            return state.bounds.toObject()
        }
    }
    const contracts = await GerberApiContractInspector.inspect([
        {
            entrypoint: '.',
            target: './index.mjs',
            api: { LiteralBounds, LiteralConstructedMember }
        }
    ])

    assert.equal(
        contracts.features.some(
            (feature) =>
                feature.feature ===
                '.#LiteralConstructedMember.build().result.value'
        ),
        true
    )
})

test('Gerber API inspector propagates Object.assign source shapes into its target', async () => {
    class AssignedDrillFields {
        static build() {
            return { holeDiameter: 1, holeShape: 2 }
        }
    }
    class AssignedPad {
        static build() {
            const pad = { x: 1 }
            Object.assign(pad, AssignedDrillFields.build())
            return pad
        }
    }
    const contracts = await GerberApiContractInspector.inspect([
        {
            entrypoint: '.',
            target: './index.mjs',
            api: { AssignedDrillFields, AssignedPad }
        }
    ])
    const features = new Set(
        contracts.features.map((feature) => feature.feature)
    )

    for (const feature of [
        '.#AssignedPad.build().result.holeDiameter',
        '.#AssignedPad.build().result.holeShape'
    ]) {
        assert.equal(features.has(feature), true, `Missing ${feature}`)
    }
})

test('Gerber API inspector follows chained Array.from flat filter and map element flow', async () => {
    class CollectionPipeline {
        static build(groups) {
            return Array.from(groups)
                .flat()
                .filter((item) => item.enabled)
                .map((item) => ({ value: item.value }))
        }
    }
    const contracts = await GerberApiContractInspector.inspect([
        {
            entrypoint: '.',
            target: './index.mjs',
            api: { CollectionPipeline }
        }
    ])

    assert.equal(
        contracts.features.some(
            (feature) =>
                feature.feature === '.#CollectionPipeline.build().result.value'
        ),
        true
    )
})

test('Gerber API inspector resolves tested parser and scene collection element contracts', async () => {
    const [parserApi, renderersApi, sceneApi] = await Promise.all([
        import('../src/legacy-parser.mjs'),
        import('../src/legacy-renderers.mjs'),
        import('../src/legacy-scene3d.mjs')
    ])
    const rootApi = { ...parserApi, ...renderersApi, ...sceneApi }
    const contracts = await GerberApiContractInspector.inspect(
        [
            { entrypoint: '.', target: './src/index.mjs', api: rootApi },
            {
                entrypoint: './parser',
                target: './src/parser.mjs',
                api: parserApi
            },
            {
                entrypoint: './renderers',
                target: './src/renderers.mjs',
                api: renderersApi
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

    const requiredByEntrypoint = {
        '.': [
            'GerberParser.parseArrayBuffer().result.pcb.fabrication.layers.primitives.primitives.type',
            'GerberParser.parseArrayBuffer().result.pcb.fabrication.layers.primitives.primitives.exposure',
            'GerberParser.parseArrayBuffer().result.pcb.fabrication.layers.primitives.primitives.diameter',
            'GerberParser.parseArrayBuffer().result.pcb.fabrication.layers.primitives.primitives.width',
            'GerberParser.parseArrayBuffer().result.pcb.fabrication.layers.bounds.minX',
            'GerberParser.parseArrayBuffer().result.pcb.fabrication.layers.bounds.minY',
            'GerberParser.parseArrayBuffer().result.pcb.fabrication.layers.bounds.maxX',
            'GerberParser.parseArrayBuffer().result.pcb.fabrication.layers.bounds.maxY',
            'PcbInteractionIndex.build().result.id',
            'PcbInteractionIndex.build().result.sourceFormat',
            'PcbInteractionIndex.build().result.layerId',
            'PcbInteractionIndex.build().result.role',
            'PcbInteractionIndex.build().result.kind',
            'PcbInteractionIndex.build().result.bounds.minX',
            'PcbInteractionIndex.build().result.bounds.minY',
            'PcbInteractionIndex.build().result.bounds.maxX',
            'PcbInteractionIndex.build().result.bounds.maxY',
            'PcbScene3dBuilder.build().result.detail.vias.x',
            'PcbScene3dBuilder.build().result.detail.vias.y',
            'PcbScene3dBuilder.build().result.detail.vias.diameter',
            'PcbScene3dBuilder.build().result.detail.vias.holeDiameter',
            'PcbScene3dBuilder.build().result.detail.vias.isPlated',
            'PcbScene3dBuilder.build().result.detail.vias.barrelOnly',
            'PcbScene3dBuilder.build().result.detail.polygons.holes.x',
            'PcbScene3dBuilder.build().result.detail.polygons.holes.y',
            'PcbScene3dBuilder.build().result.detail.tracks.solderMaskOpening'
        ],
        './parser': [
            'GerberParser.parseArrayBuffer().result.pcb.fabrication.layers.primitives.primitives.type',
            'GerberParser.parseArrayBuffer().result.pcb.fabrication.layers.primitives.primitives.exposure',
            'GerberParser.parseArrayBuffer().result.pcb.fabrication.layers.primitives.primitives.diameter',
            'GerberParser.parseArrayBuffer().result.pcb.fabrication.layers.primitives.primitives.width',
            'GerberParser.parseArrayBuffer().result.pcb.fabrication.layers.bounds.minX',
            'GerberParser.parseArrayBuffer().result.pcb.fabrication.layers.bounds.minY',
            'GerberParser.parseArrayBuffer().result.pcb.fabrication.layers.bounds.maxX',
            'GerberParser.parseArrayBuffer().result.pcb.fabrication.layers.bounds.maxY'
        ],
        './renderers': [
            'PcbInteractionIndex.build().result.id',
            'PcbInteractionIndex.build().result.sourceFormat',
            'PcbInteractionIndex.build().result.layerId',
            'PcbInteractionIndex.build().result.role',
            'PcbInteractionIndex.build().result.kind',
            'PcbInteractionIndex.build().result.bounds.minX',
            'PcbInteractionIndex.build().result.bounds.minY',
            'PcbInteractionIndex.build().result.bounds.maxX',
            'PcbInteractionIndex.build().result.bounds.maxY'
        ],
        './scene3d': [
            'PcbScene3dBuilder.build().result.detail.vias.x',
            'PcbScene3dBuilder.build().result.detail.vias.y',
            'PcbScene3dBuilder.build().result.detail.vias.diameter',
            'PcbScene3dBuilder.build().result.detail.vias.holeDiameter',
            'PcbScene3dBuilder.build().result.detail.vias.isPlated',
            'PcbScene3dBuilder.build().result.detail.vias.barrelOnly',
            'PcbScene3dBuilder.build().result.detail.polygons.holes.x',
            'PcbScene3dBuilder.build().result.detail.polygons.holes.y',
            'PcbScene3dBuilder.build().result.detail.tracks.solderMaskOpening'
        ]
    }
    for (const [entrypoint, contractsForEntrypoint] of Object.entries(
        requiredByEntrypoint
    )) {
        for (const contract of contractsForEntrypoint) {
            const feature = `${entrypoint}#${contract}`
            assert.equal(features.has(feature), true, `Missing ${feature}`)
        }
    }

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

    const padFields = [
        'hasTopSolderMaskOpening',
        'holeDiameter',
        'holeRotation',
        'holeShape',
        'holeSlotLength'
    ]
    for (const entrypoint of ['.', './scene3d']) {
        for (const owner of [
            'PcbScene3dBuilder.build()',
            'PcbScene3dScenePreparator.prepare()'
        ]) {
            for (const collection of ['detail.pads', 'pads']) {
                for (const field of padFields) {
                    const feature = `${entrypoint}#${owner}.result.${collection}.${field}`
                    assert.equal(
                        features.has(feature),
                        true,
                        `Missing ${feature}`
                    )
                }
            }
        }
    }

    const pointCollections = [
        'board.cutouts.points',
        'detail.polygons.points',
        'zones.points'
    ]
    const impossiblePointFields = [
        'layerId',
        'sweepAngle',
        'type',
        'width',
        'x1',
        'x2',
        'y1',
        'y2'
    ]
    for (const entrypoint of ['.', './scene3d']) {
        for (const owner of [
            'PcbScene3dBuilder.build()',
            'PcbScene3dScenePreparator.prepare()'
        ]) {
            for (const collection of pointCollections) {
                for (const field of impossiblePointFields) {
                    const feature = `${entrypoint}#${owner}.result.${collection}.${field}`
                    assert.equal(
                        features.has(feature),
                        false,
                        `Unexpected ${feature}`
                    )
                }
            }
            for (const collection of ['detail.polygons', 'zones']) {
                const feature = `${entrypoint}#${owner}.result.${collection}.hasSolderMask`
                assert.equal(features.has(feature), true, `Missing ${feature}`)
            }
        }
    }
})
