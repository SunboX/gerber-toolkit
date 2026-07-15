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
    assert.equal(pkg.exports['./project'], './src/project.mjs')
    assert.equal(pkg.exports['./renderers'], './src/renderers.mjs')
    assert.equal(pkg.exports['./scene3d'], './src/scene3d.mjs')
    assert.equal(pkg.exports['./extensions'], './src/extensions.mjs')
    assert.equal(pkg.scripts.test, 'node --test')
})

test('package publishes the 0.4.0 release with its historical notes', async () => {
    const [rawPackage, readme, v020, v030, v040] = await Promise.all([
        readPackageFile('package.json'),
        readPackageFile('README.md'),
        readPackageFile('docs/release-notes-v0.2.0.md'),
        readPackageFile('docs/release-notes-v0.3.0.md'),
        readPackageFile('docs/release-notes-v0.4.0.md')
    ])
    const pkg = JSON.parse(rawPackage)

    assert.equal(pkg.version, '0.4.0')
    assert.equal(pkg.files.includes('docs'), true)
    assert.match(readme, /docs\/release-notes-v0\.2\.0\.md/)
    assert.match(readme, /docs\/release-notes-v0\.3\.0\.md/)
    assert.match(readme, /docs\/release-notes-v0\.4\.0\.md/)
    assert.match(v020, /^# gerber-toolkit 0\.2\.0/m)
    assert.match(v030, /^# gerber-toolkit 0\.3\.0/m)
    assert.match(v040, /^# gerber-toolkit 0\.4\.0/m)
})

test('common entrypoints expose shared APIs and extensions retain native APIs', async () => {
    const [rootApi, parser, project, renderers, scene3d, extensions] =
        await Promise.all([
            import('../src/index.mjs'),
            import('../src/parser.mjs'),
            import('../src/project.mjs'),
            import('../src/renderers.mjs'),
            import('../src/scene3d.mjs'),
            import('../src/extensions.mjs')
        ])

    assert.equal(parser.Parser, rootApi.Parser)
    assert.equal(project.ProjectLoader, rootApi.ProjectLoader)
    assert.equal(renderers.PcbSvgRenderer, rootApi.PcbSvgRenderer)
    assert.equal(scene3d.PcbScene3dBuilder, rootApi.PcbScene3dBuilder)
    assert.equal(typeof extensions.GerberParser, 'function')
    assert.equal(typeof extensions.GerberProjectLoader, 'function')
    assert.equal(typeof extensions.GerberPcbSvgRenderer, 'function')
    assert.equal(typeof extensions.PcbScene3dModelRegistry, 'function')
})
