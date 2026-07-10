import assert from 'node:assert/strict'
import test from 'node:test'
import { zipSync } from 'fflate'

import { GerberProjectLoader } from '../src/parser.mjs'

/**
 * Encodes fixture text as bytes.
 * @param {string} text Fixture text.
 * @returns {Uint8Array}
 */
function textBytes(text) {
    return new TextEncoder().encode(text)
}

/**
 * Returns a minimal Gerber layer with one flashed feature.
 * @param {string} x Coordinate token.
 * @returns {string}
 */
function gerberLayer(x) {
    return [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%ADD10C,0.100*%',
        'D10*',
        `${x}Y000000D03*`,
        'M02*'
    ].join('\n')
}

test('GerberProjectLoader groups selected fabrication files into one composite document', async () => {
    const result = await GerberProjectLoader.loadEntries([
        { name: 'sample-F_Cu.gtl', bytes: textBytes(gerberLayer('X001000')) },
        { name: 'sample-B_Cu.gbl', bytes: textBytes(gerberLayer('X002000')) }
    ])

    assert.equal(result.documents.length, 1)
    assert.equal(result.documents[0].sourceFormat, 'gerber')
    assert.equal(result.documents[0].pcb.fabrication.layers.length, 2)
    assert.equal(result.documents[0].pcb.fabrication.renderMode, 'composite')
    assert.deepEqual(result.documents[0].pcb.components, [])
    assert.equal(result.documents[0].pcb.boardOutline.widthMil, 7.874016)
    assert.equal(result.project.sourceFormat, 'gerber')
    assert.equal(result.project.fileName, 'fabrication-package')
    assert.deepEqual(
        result.project.documents.map(({ fileName, role, side }) => ({
            fileName,
            role,
            side
        })),
        [
            {
                fileName: 'sample-F_Cu.gtl',
                role: 'top-copper',
                side: 'top'
            },
            {
                fileName: 'sample-B_Cu.gbl',
                role: 'bottom-copper',
                side: 'bottom'
            }
        ]
    )
})

test('GerberProjectLoader expands fabrication zip archives', async () => {
    const archive = zipSync({
        'nested/sample-F_Cu.gtl': textBytes(gerberLayer('X001000')),
        'nested/sample-PTH.drl': textBytes(
            'M48\nMETRIC,TZ\nT01C0.5\n%\nT01\nX001000Y001000\nM30\n'
        )
    })

    const result = await GerberProjectLoader.loadEntries([
        { name: 'sample-package.zip', bytes: archive }
    ])

    assert.equal(result.documents.length, 1)
    assert.equal(result.documents[0].pcb.fabrication.layers.length, 2)
    assert.equal(result.assets.length, 0)
    assert.equal(result.diagnostics.length, 0)
})

test('GerberProjectLoader classifies fabrication entries', () => {
    const archive = zipSync({
        'nested/sample-F_Cu.gtl': textBytes(gerberLayer('X001000'))
    })

    assert.equal(
        GerberProjectLoader.canLoadEntries([
            {
                name: 'single-layer.gtl',
                buffer: textBytes(gerberLayer('X001000')).buffer
            }
        ]),
        true
    )
    assert.equal(
        GerberProjectLoader.canLoadEntries([
            { name: 'sample-package.zip', bytes: archive }
        ]),
        true
    )
    assert.equal(
        GerberProjectLoader.canLoadEntries([
            {
                name: 'project.zip',
                bytes: zipSync({ 'demo.kicad_pcb': textBytes('(kicad_pcb)') })
            }
        ]),
        false
    )
})
