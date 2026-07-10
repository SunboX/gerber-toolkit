import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

/**
 * Reads a package-relative UTF-8 file.
 * @param {string} path Package-relative path.
 * @returns {Promise<string>}
 */
async function readPackageFile(path) {
    return readFile(new URL(path, root), 'utf8')
}

test('package exposes gerber parser and renderer entrypoints', async () => {
    const raw = await readPackageFile('package.json')
    const pkg = JSON.parse(raw)

    assert.equal(pkg.name, 'gerber-toolkit')
    assert.equal(pkg.type, 'module')
    assert.equal(pkg.exports['.'], './src/index.mjs')
    assert.equal(pkg.exports['./parser'], './src/parser.mjs')
    assert.equal(pkg.exports['./renderers'], './src/renderers.mjs')
    assert.equal(pkg.exports['./scene3d'], './src/scene3d.mjs')
    assert.equal(pkg.scripts.test, 'node --test')
})

test('public entrypoints export parser and renderer APIs', async () => {
    const indexSource = await readPackageFile('src/index.mjs')
    const parserSource = await readPackageFile('src/parser.mjs')
    const rendererSource = await readPackageFile('src/renderers.mjs')
    const scene3dSource = await readPackageFile('src/scene3d.mjs')

    assert.match(indexSource, /export \* from '\.\/parser\.mjs'/)
    assert.match(indexSource, /export \* from '\.\/renderers\.mjs'/)
    assert.match(indexSource, /export \* from '\.\/scene3d\.mjs'/)
    assert.match(parserSource, /GerberParser/)
    assert.match(parserSource, /GerberProjectLoader/)
    assert.match(parserSource, /GerberCoordinateParser/)
    assert.match(parserSource, /GerberLayerRoleResolver/)
    assert.match(rendererSource, /GerberPcbSvgRenderer/)
    assert.match(rendererSource, /PcbInteractionIndex/)
    assert.match(rendererSource, /PcbInteractionLayerModel/)
    assert.match(scene3dSource, /PcbScene3dBuilder/)
    assert.match(scene3dSource, /PcbScene3dScenePreparator/)
    assert.match(scene3dSource, /PcbScene3dModelRegistry/)
})
