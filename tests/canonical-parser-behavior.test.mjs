import assert from 'node:assert/strict'
import test from 'node:test'

import { ToolkitContractFixtures } from 'circuitjson-toolkit/testing'

import { GerberParser } from '../src/core/gerber/GerberParser.mjs'
import { Parser } from '../src/parser.mjs'

const FIXTURE = ToolkitContractFixtures.gerber().parserInput

test('parser rejects accessors without invoking them', () => {
    let reads = 0
    const input = {
        fileName: FIXTURE.fileName,
        get data() {
            reads += 1
            return FIXTURE.data
        }
    }
    assert.equal(Parser.supports(input), false)
    assert.throws(
        () => Parser.parse(input),
        (error) => error?.code === 'ERR_GERBER_PARSE'
    )
    assert.throws(
        () =>
            Parser.parse(FIXTURE, {
                get worker() {
                    reads += 1
                    return false
                }
            }),
        (error) => error?.code === 'ERR_GERBER_PARSE'
    )
    assert.equal(reads, 0)
})

test('parser preserves exact Uint8Array windows and executes native parsing once', () => {
    const payload = new TextEncoder().encode(FIXTURE.data)
    const container = new Uint8Array(payload.byteLength + 8)
    container.fill(0xa5)
    container.set(payload, 4)
    const before = container.slice()
    const original = GerberParser.parseArrayBuffer
    let calls = 0
    GerberParser.parseArrayBuffer = (...arguments_) => {
        calls += 1
        return Reflect.apply(original, GerberParser, arguments_)
    }
    try {
        const document = Parser.parse({
            fileName: FIXTURE.fileName,
            data: container.subarray(4, 4 + payload.byteLength)
        })
        assert.equal(document.source.format, 'gerber')
        assert.deepEqual(container, before)
        assert.equal(calls, 1)
    } finally {
        GerberParser.parseArrayBuffer = original
    }
})

test('parser applies common extension and asset policies', () => {
    const source = new Uint8Array([1, 2, 3, 4])
    const none = Parser.parse(FIXTURE, { extensions: 'none' })
    const metadata = Parser.parse(FIXTURE, { extensions: 'metadata' })
    const full = Parser.parse(
        { ...FIXTURE, assets: [{ name: 'model.step', data: source }] },
        { extensions: 'full', decodeAssets: 'full' }
    )
    const selected = Parser.parse(FIXTURE, {
        extensions: ['gerber.native-model']
    })

    assert.equal(none.extensions.gerber.$meta.completeness, 'none')
    assert.equal(metadata.extensions.gerber.$meta.completeness, 'metadata')
    assert.equal(Object.hasOwn(metadata.extensions.gerber, 'native'), false)
    assert.equal(Object.hasOwn(full.extensions.gerber, 'native'), true)
    assert.equal(Object.hasOwn(selected.extensions.gerber, 'native'), true)
    assert.deepEqual(full.assets[0].data, source)
    full.assets[0].data[0] = 99
    assert.deepEqual(source, new Uint8Array([1, 2, 3, 4]))
    assert.throws(
        () => Parser.parse(FIXTURE, { extensions: ['unknown'] }),
        (error) => error?.code === 'ERR_CAPABILITY_UNAVAILABLE'
    )
})

test('async parser emits ordered progress and honors cancellation', async () => {
    const controller = new AbortController()
    const stages = []
    await assert.rejects(
        Parser.parseAsync(FIXTURE, {
            worker: false,
            signal: controller.signal,
            onProgress: (row) => {
                stages.push(row.stage)
                if (row.stage === 'validate') controller.abort()
            }
        }),
        (error) => error?.code === 'ERR_CANCELLED'
    )
    assert.deepEqual(stages, ['detect', 'decode', 'validate'])
})
