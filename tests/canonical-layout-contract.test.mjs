import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const COMMON_EXPORTS = [
    '.',
    './parser',
    './project',
    './renderers',
    './interaction',
    './query',
    './manufacturing',
    './simulation',
    './scene3d',
    './capabilities',
    './extensions',
    './testing',
    './workers/parser.worker.mjs',
    './styles/renderers.css'
]

test('package exposes the complete common layout', async () => {
    const pkg = JSON.parse(
        await readFile(new URL('../package.json', import.meta.url), 'utf8')
    )
    assert.deepEqual(
        Object.keys(pkg.exports).filter(
            (entry) => !entry.startsWith('./extensions/')
        ),
        COMMON_EXPORTS
    )
})

test('common service subpaths forward exact CircuitJSON identities', async () => {
    for (const subpath of [
        'renderers',
        'interaction',
        'query',
        'manufacturing',
        'simulation',
        'scene3d',
        'testing'
    ]) {
        const [actual, expected] = await Promise.all([
            import(`../src/${subpath}.mjs`),
            import(`circuitjson-toolkit/${subpath}`)
        ])
        assert.deepEqual(
            Object.keys(actual).sort(),
            Object.keys(expected).sort(),
            subpath
        )
        for (const name of Object.keys(expected)) {
            assert.equal(actual[name], expected[name], `${subpath}:${name}`)
        }
    }
})

test('extensions preserve every native and shared export without collisions', async () => {
    const [actual, shared, parser, renderers, scene3d] = await Promise.all([
        import('../src/extensions.mjs'),
        import('circuitjson-toolkit/extensions'),
        import('../src/legacy-parser.mjs'),
        import('../src/legacy-renderers.mjs'),
        import('../src/legacy-scene3d.mjs')
    ])
    const native = new Set(
        [parser, renderers, scene3d].flatMap((namespace) =>
            Object.keys(namespace)
        )
    )
    assert.deepEqual(
        Object.keys(shared).filter((name) => native.has(name)),
        []
    )
    assert.deepEqual(
        Object.keys(actual).sort(),
        [...native, ...Object.keys(shared)].sort()
    )
})
