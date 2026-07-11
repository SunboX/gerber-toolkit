import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

/**
 * Reads one repository JSON artifact.
 * @param {string} path Repository-relative path.
 * @returns {Promise<any>} Parsed JSON value.
 */
async function readJson(path) {
    return JSON.parse(await readFile(path, 'utf8'))
}

test('Gerber baseline preserves tested pad fields and excludes impossible polygon-hole fields', async () => {
    const api = await readJson('spec/api-baseline-v0.1.21.json')
    const features = new Set(api.features.map((row) => row.feature))
    const padFields = [
        'hasTopSolderMaskOpening',
        'holeDiameter',
        'holeRotation',
        'holeShape',
        'holeSlotLength'
    ]
    const requiredPads = ['.', './scene3d'].flatMap((entrypoint) =>
        [
            'PcbScene3dBuilder.build()',
            'PcbScene3dScenePreparator.prepare()'
        ].flatMap((owner) =>
            ['detail.pads', 'pads'].flatMap((collection) =>
                padFields.map(
                    (field) =>
                        `${entrypoint}#${owner}.result.${collection}.${field}`
                )
            )
        )
    )
    const impossibleLeaves = [
        'layerId',
        'sweepAngle',
        'type',
        'width',
        'x1',
        'x2',
        'y1',
        'y2'
    ]
    const impossibleHoles = ['.', './scene3d'].flatMap((entrypoint) =>
        [
            'PcbScene3dBuilder.build()',
            'PcbScene3dScenePreparator.prepare()'
        ].flatMap((owner) =>
            ['detail.polygons', 'zones'].flatMap((collection) =>
                impossibleLeaves.map(
                    (field) =>
                        `${entrypoint}#${owner}.result.${collection}.holes.${field}`
                )
            )
        )
    )

    assert.deepEqual(
        requiredPads.filter((feature) => !features.has(feature)),
        []
    )
    assert.deepEqual(
        impossibleHoles.filter((feature) => features.has(feature)),
        []
    )
})
