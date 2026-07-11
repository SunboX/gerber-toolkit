import assert from 'node:assert/strict'
import test from 'node:test'

import { zipSync } from 'fflate'
import { ToolkitContractFixtures } from 'circuitjson-toolkit/testing'

import { ProjectLoader } from '../src/project.mjs'

const FIXTURES = ToolkitContractFixtures.gerber()

test('project entries are descriptor-safe dense arrays', () => {
    const sparse = new Array(1)
    assert.throws(
        () => ProjectLoader.load(sparse),
        (error) => error?.code === 'ERR_PROJECT_INPUT'
    )
    let reads = 0
    const accessorEntries = new Array(1)
    Object.defineProperty(accessorEntries, 0, {
        enumerable: true,
        get() {
            reads += 1
            return FIXTURES.projectEntries[0]
        }
    })
    assert.throws(
        () => ProjectLoader.load(accessorEntries),
        (error) => error?.code === 'ERR_PROJECT_INPUT'
    )
    const customIterator = [...FIXTURES.projectEntries]
    Object.defineProperty(customIterator, Symbol.iterator, {
        value: () => {
            reads += 1
            return [][Symbol.iterator]()
        }
    })
    assert.throws(
        () => ProjectLoader.load(customIterator),
        (error) => error?.code === 'ERR_PROJECT_INPUT'
    )
    assert.equal(reads, 0)
})

test('ZIP expansion rejects unsafe member paths before prefixing', () => {
    const archive = zipSync({
        '../escape.gtl': new TextEncoder().encode(FIXTURES.parserInput.data)
    })
    assert.throws(
        () => ProjectLoader.load([{ name: 'contract.zip', data: archive }]),
        (error) => error?.code === 'ERR_ARCHIVE_PATH'
    )
})

test('project limits include expanded ZIP bytes', () => {
    const payload = new TextEncoder().encode(FIXTURES.parserInput.data)
    const archive = zipSync({ 'contract.gtl': payload })
    assert.throws(
        () =>
            ProjectLoader.load([{ name: 'contract.zip', data: archive }], {
                archiveLimits: {
                    maxTotalBytes: archive.byteLength + payload.byteLength - 1
                }
            }),
        (error) =>
            error?.code === 'ERR_ARCHIVE_LIMIT_EXCEEDED' &&
            error?.details?.limit === 'maxTotalBytes'
    )
})

test('project retains companion and attached assets under common modes', () => {
    const attached = new Uint8Array([1, 2, 3])
    const companion = new Uint8Array([4, 5, 6, 7])
    const project = ProjectLoader.load(
        [
            {
                ...FIXTURES.projectEntries[0],
                assets: [{ name: 'attached.step', data: attached }]
            },
            { name: 'companion.step', data: companion }
        ],
        { decodeAssets: 'full' }
    )

    assert.deepEqual(project.assets.map((asset) => asset.name).sort(), [
        'attached.step',
        'companion.step'
    ])
    assert.deepEqual(project.assets[0].data, attached)
    project.assets[0].data[0] = 99
    assert.deepEqual(attached, new Uint8Array([1, 2, 3]))
})

test('direct async project loading emits common progress and cancellation', async () => {
    const stages = []
    const project = await ProjectLoader.loadAsync(FIXTURES.projectEntries, {
        worker: false,
        onProgress: (row) => stages.push(row.stage)
    })
    assert.equal(project.schema, 'ecad-toolkit.project.v1')
    assert.deepEqual(stages, ['detect', 'project', 'project', 'complete'])

    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
        ProjectLoader.loadAsync(FIXTURES.projectEntries, {
            worker: false,
            signal: controller.signal
        }),
        (error) => error?.code === 'ERR_CANCELLED'
    )
})
