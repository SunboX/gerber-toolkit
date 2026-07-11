import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { validateFeaturePreservation } from '../scripts/check-feature-preservation.mjs'
import * as task1EvidenceContract from '../scripts/GerberTask1EvidenceContract.mjs'
import { GERBER_TASK1_PROVENANCE } from '../scripts/GerberTask1Provenance.mjs'

const AVAILABILITY = {
    'circuitjson-toolkit': 'shared',
    'gerber-toolkit': 'native',
    'altium-toolkit': 'derived',
    'kicad-toolkit': 'derived'
}
const { assertGerberTask1EvidenceContract } = task1EvidenceContract

/**
 * Recomputes the outer checksum after an intentional envelope mutation.
 * @param {Record<string, any>} apiBaseline API baseline candidate.
 * @returns {void}
 */
function resealApiBaseline(apiBaseline) {
    const { artifactChecksum: ignored, ...body } = apiBaseline
    apiBaseline.artifactChecksum = createHash('sha256')
        .update(JSON.stringify(body))
        .digest('hex')
}

/**
 * Changes one mutable Task 1 identity value without changing its envelope.
 * @param {Record<string, any>} candidate API baseline candidate.
 * @param {string} field Identity field under test.
 * @returns {void}
 */
function mutateIdentity(candidate, field) {
    if (field === 'package') candidate.package = 'renamed-gerber-toolkit'
    if (field === 'packageVersion') candidate.packageVersion = '0.1.22'
    if (field === 'provenance') {
        candidate.provenance = {
            ...candidate.provenance,
            evidenceCommit: '0'.repeat(40)
        }
    }
    if (field === 'artifactChecksum') {
        candidate.artifactChecksum = '0'.repeat(64)
        return
    }
    resealApiBaseline(candidate)
}

/**
 * Creates one synthetic capability row.
 * @returns {Record<string, any>} Capability row.
 */
function syntheticCapability() {
    return {
        id: 'parser.document.parse',
        category: 'parser.document',
        operation: 'parse',
        availability: { ...AVAILABILITY }
    }
}

/**
 * Creates one synthetic preservation feature.
 * @returns {Record<string, any>} Baseline feature.
 */
function syntheticFeature() {
    return {
        feature: 'mapped',
        kind: 'export',
        capabilityId: 'parser.document.parse',
        disposition: 'shared',
        replacement: 'Parser.parse()',
        availability: { ...AVAILABILITY },
        reason: 'Synthetic strict validation remains independently usable.',
        evidenceToken: 'GerberParser',
        evidenceTokens: ['GerberParser'],
        evidence: {
            source: { kind: 'source-contract' },
            usage: { kind: 'token-reference' }
        },
        sourceContract: { type: 'export', valueType: 'function' },
        tests: ['index.mjs'],
        documentation: ['index.mjs']
    }
}

/**
 * Creates an extracted-package fixture for one custom strict validator.
 * @param {import('node:test').TestContext} context Test context.
 * @param {Record<string, any>[]} inventory Synthetic capability inventory.
 * @returns {Promise<string>} Fixture package root.
 */
async function packageFixture(context, inventory) {
    const root = await mkdtemp(join(tmpdir(), 'gerber-task1-integrity-'))
    await writeFile(
        join(root, 'package.json'),
        JSON.stringify({
            name: 'gerber-integrity-fixture',
            version: '1.0.0',
            type: 'module',
            exports: { '.': './index.mjs' }
        })
    )
    await writeFile(
        join(root, 'index.mjs'),
        `export class GerberParser {}
export class ToolkitCapabilities {
    static inventory() { return ${JSON.stringify(inventory)} }
}
`
    )
    context.after(() => rm(root, { recursive: true, force: true }))
    return root
}

test('strict Task 1 identity survives mutable envelope fields', async (context) => {
    const apiBaseline = JSON.parse(
        await readFile('spec/api-baseline-v0.1.21.json', 'utf8')
    )
    const ledger = JSON.parse(
        await readFile('spec/feature-preservation.json', 'utf8')
    )
    const inventory = JSON.parse(
        await readFile('spec/capability-inventory-v0.1.21.json', 'utf8')
    )

    for (const field of [
        'package',
        'packageVersion',
        'provenance',
        'artifactChecksum'
    ]) {
        await context.test(field, async () => {
            const candidate = structuredClone(apiBaseline)
            mutateIdentity(candidate, field)
            await assert.rejects(
                () =>
                    validateFeaturePreservation({
                        apiBaseline: candidate,
                        ledger,
                        inventory,
                        strict: true,
                        packageRoot: process.cwd(),
                        repositoryRoot: process.cwd()
                    }),
                /Immutable Task 1 (?:evidence|provenance) drift/u
            )
        })
    }
})

test('strict Task 1 identity survives deleted envelope fields', async (context) => {
    const apiBaseline = JSON.parse(
        await readFile('spec/api-baseline-v0.1.21.json', 'utf8')
    )
    const ledger = JSON.parse(
        await readFile('spec/feature-preservation.json', 'utf8')
    )
    const inventory = JSON.parse(
        await readFile('spec/capability-inventory-v0.1.21.json', 'utf8')
    )

    for (const field of [
        'artifactChecksum',
        'entrypoints',
        'features',
        'package',
        'packageVersion',
        'provenance',
        'schema',
        'exports'
    ]) {
        await context.test(field, async () => {
            const candidate = structuredClone(apiBaseline)
            delete candidate[field]
            await assert.rejects(
                () =>
                    validateFeaturePreservation({
                        apiBaseline: candidate,
                        ledger,
                        inventory,
                        strict: true,
                        packageRoot: process.cwd(),
                        repositoryRoot: process.cwd()
                    }),
                /Immutable Task 1 (?:evidence|provenance) drift/u
            )
        })
    }
})

test('strict Task 1 identity keeps the immutable inventory anchor enabled', async () => {
    const apiBaseline = JSON.parse(
        await readFile('spec/api-baseline-v0.1.21.json', 'utf8')
    )
    const ledger = JSON.parse(
        await readFile('spec/feature-preservation.json', 'utf8')
    )
    mutateIdentity(apiBaseline, 'package')

    await assert.rejects(
        () =>
            validateFeaturePreservation({
                apiBaseline,
                ledger,
                inventory: [],
                strict: true,
                packageRoot: process.cwd(),
                repositoryRoot: process.cwd()
            }),
        /Immutable capability inventory drift/u
    )
})

test('strict custom validators may carry non-Task 1 provenance', async (context) => {
    const inventory = [syntheticCapability()]
    const packageRoot = await packageFixture(context, inventory)
    const feature = syntheticFeature()

    const result = await validateFeaturePreservation({
        apiBaseline: {
            provenance: { fixture: 'synthetic' },
            entrypoints: [{ entrypoint: '.', target: './index.mjs' }],
            features: [feature]
        },
        ledger: [{ package: 'fixture@1.0.0', ...feature }],
        inventory,
        strict: true,
        task1Identity: false,
        packageRoot,
        repositoryRoot: packageRoot
    })

    assert.deepEqual(result, { featureCount: 1, strict: true })
})

test('immutable Task 1 provenance pins all six source identities', () => {
    assert.equal(
        typeof task1EvidenceContract.assertGerberTask1Provenance,
        'function'
    )
    for (const field of Object.keys(GERBER_TASK1_PROVENANCE)) {
        const provenance = {
            ...GERBER_TASK1_PROVENANCE,
            [field]: '0'.repeat(40)
        }
        assert.throws(
            () => task1EvidenceContract.assertGerberTask1Provenance(provenance),
            /Immutable Task 1 provenance drift/u,
            field
        )
    }
})

test('immutable Task 1 contract rejects coordinated evidence and harness replacement', async () => {
    const apiBaseline = JSON.parse(
        await readFile('spec/api-baseline-v0.1.21.json', 'utf8')
    )
    const ledger = JSON.parse(
        await readFile('spec/feature-preservation.json', 'utf8')
    )
    apiBaseline.provenance = {
        ...apiBaseline.provenance,
        evidenceCommit: '0'.repeat(40),
        evidenceTree: '1'.repeat(40),
        harnessCommit: '0'.repeat(40),
        harnessTree: '1'.repeat(40)
    }
    resealApiBaseline(apiBaseline)

    assert.throws(
        () => assertGerberTask1EvidenceContract(apiBaseline, ledger),
        /Immutable Task 1 provenance drift/u
    )
})
