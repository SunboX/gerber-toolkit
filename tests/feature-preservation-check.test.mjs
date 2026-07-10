import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import {
    checkFeaturePreservation,
    validateFeaturePreservation
} from '../scripts/check-feature-preservation.mjs'

const execFileAsync = promisify(execFile)
const AVAILABILITY = {
    'circuitjson-toolkit': 'shared',
    'gerber-toolkit': 'native',
    'altium-toolkit': 'derived',
    'kicad-toolkit': 'derived'
}

/**
 * Creates one complete baseline feature.
 * @param {string} feature Stable feature id.
 * @param {Record<string, any>} [overrides] Feature overrides.
 * @returns {Record<string, any>} Baseline feature.
 */
function baselineFeature(feature, overrides = {}) {
    return {
        feature,
        kind: 'behavior',
        capabilityId: 'parser.document.parse',
        disposition: 'shared',
        replacement: 'Parser.parse()',
        availability: { ...AVAILABILITY },
        reason: 'Gerber parsing projects native data into the shared envelope.',
        evidenceToken: 'GerberParser',
        evidenceTokens: ['GerberParser'],
        sourceContract: { type: 'behavior', description: feature },
        tests: ['index.mjs'],
        documentation: ['index.mjs'],
        ...overrides
    }
}

/**
 * Creates one ledger row from a baseline feature.
 * @param {string} feature Stable feature id.
 * @param {Record<string, any>} [overrides] Row overrides.
 * @returns {Record<string, any>} Ledger row.
 */
function ledgerRow(feature, overrides = {}) {
    return {
        package: 'gerber-toolkit@0.1.21',
        ...baselineFeature(feature),
        ...overrides
    }
}

/**
 * Creates one normalized capability row.
 * @param {string} id Capability id.
 * @returns {Record<string, string>} Capability row.
 */
function capabilityRow(id, availability = AVAILABILITY) {
    const parts = id.split('.')
    return {
        id,
        category: parts.slice(0, -1).join('.'),
        operation: parts.at(-1),
        availability: { ...availability }
    }
}

/**
 * Creates a package root used by strict packed-entrypoint tests.
 * @param {import('node:test').TestContext} context Test context.
 * @param {Record<string, any>[]} inventory Capability inventory.
 * @returns {Promise<string>} Fixture root.
 */
async function packageFixture(context, inventory, options = {}) {
    const root = await mkdtemp(join(tmpdir(), 'gerber-feature-package-'))
    const exports = { '.': './index.mjs', ...(options.exports || {}) }
    await writeFile(
        join(root, 'package.json'),
        JSON.stringify({
            name: 'gerber-feature-fixture',
            version: '1.0.0',
            type: 'module',
            exports
        })
    )
    await writeFile(
        join(root, 'index.mjs'),
        options.source ||
            `export class GerberParser {}\nexport class ToolkitCapabilities { static inventory() { return ${JSON.stringify(inventory)} } }\n`
    )
    for (const [path, source] of Object.entries(options.files || {})) {
        await writeFile(join(root, path), source)
    }
    context.after(() => rm(root, { recursive: true, force: true }))
    return root
}

test('feature checker rejects missing, stale, and duplicate mappings', async () => {
    const mapped = baselineFeature('mapped')

    await assert.rejects(
        () =>
            validateFeaturePreservation({
                apiBaseline: { entrypoints: [], features: [mapped] },
                ledger: []
            }),
        /Missing feature-preservation mappings: mapped/u
    )
    await assert.rejects(
        () =>
            validateFeaturePreservation({
                apiBaseline: { entrypoints: [], features: [] },
                ledger: [ledgerRow('stale')]
            }),
        /Stale feature-preservation mappings: stale/u
    )
    await assert.rejects(
        () =>
            validateFeaturePreservation({
                apiBaseline: { entrypoints: [], features: [mapped, mapped] },
                ledger: [ledgerRow('mapped')]
            }),
        /Duplicate baseline features: mapped/u
    )
    await assert.rejects(
        () =>
            validateFeaturePreservation({
                apiBaseline: { entrypoints: [], features: [mapped] },
                ledger: [ledgerRow('mapped'), ledgerRow('mapped')]
            }),
        /Duplicate ledger features: mapped/u
    )
})

test('feature checker rejects incomplete and divergent preservation decisions', async () => {
    const apiBaseline = {
        entrypoints: [],
        features: [baselineFeature('mapped')]
    }
    const invalidRows = [
        ledgerRow('mapped', { replacement: '' }),
        ledgerRow('mapped', { tests: [] }),
        ledgerRow('mapped', { documentation: [] }),
        ledgerRow('mapped', { disposition: 'removed' }),
        ledgerRow('mapped', {
            availability: { 'gerber-toolkit': 'native' }
        })
    ]

    for (const row of invalidRows) {
        await assert.rejects(
            () => validateFeaturePreservation({ apiBaseline, ledger: [row] }),
            /Invalid feature-preservation row for mapped/u
        )
    }

    await assert.rejects(
        () =>
            validateFeaturePreservation({
                apiBaseline,
                ledger: [ledgerRow('mapped', { replacement: 'Other API' })]
            }),
        /Baseline and ledger mapping differ for mapped/u
    )
})

test('strict feature checker rejects fictitious capability mappings', async (context) => {
    const packageRoot = await packageFixture(context, [
        capabilityRow('parser.document.parse')
    ])
    const feature = baselineFeature('mapped', {
        capabilityId: 'imaginary.operation'
    })

    await assert.rejects(
        () =>
            validateFeaturePreservation({
                apiBaseline: {
                    entrypoints: [
                        {
                            entrypoint: '.',
                            target: './index.mjs',
                            exports: [{ name: 'GerberParser' }]
                        }
                    ],
                    features: [feature]
                },
                ledger: [
                    ledgerRow('mapped', {
                        capabilityId: 'imaginary.operation'
                    })
                ],
                strict: true,
                packageRoot,
                repositoryRoot: packageRoot
            }),
        /Fictitious capabilityId mappings: imaginary\.operation/u
    )
})

test('strict feature checker rejects stale packed API mappings', async (context) => {
    const packageRoot = await packageFixture(context, [
        capabilityRow('parser.document.parse')
    ])
    const feature = baselineFeature('.#MissingExport', {
        kind: 'export',
        entrypoint: '.',
        exportName: 'MissingExport'
    })

    await assert.rejects(
        () =>
            validateFeaturePreservation({
                apiBaseline: {
                    entrypoints: [
                        {
                            entrypoint: '.',
                            target: './index.mjs',
                            exports: [{ name: 'GerberParser' }]
                        }
                    ],
                    features: [feature]
                },
                ledger: [
                    ledgerRow(feature.feature, {
                        kind: 'export',
                        entrypoint: '.',
                        exportName: 'MissingExport'
                    })
                ],
                strict: true,
                packageRoot,
                repositoryRoot: packageRoot
            }),
        /Stale packed API features: \.#MissingExport/u
    )
})

test('strict feature checker safely verifies instance accessors', async (context) => {
    const packageRoot = await packageFixture(
        context,
        [capabilityRow('parser.document.parse')],
        {
            source: `export class GerberParser { get assets() { return [] } }\nexport class ToolkitCapabilities { static inventory() { return ${JSON.stringify([capabilityRow('parser.document.parse')])} } }\n`
        }
    )
    const feature = baselineFeature('.#GerberParser.prototype.assets', {
        kind: 'field',
        entrypoint: '.',
        exportName: 'GerberParser',
        methodName: 'assets',
        methodType: 'instance-accessor',
        sourceContract: {
            type: 'accessor',
            name: 'assets',
            get: true,
            set: false
        }
    })

    const result = await validateFeaturePreservation({
        apiBaseline: {
            entrypoints: [{ entrypoint: '.', target: './index.mjs' }],
            features: [feature]
        },
        ledger: [
            ledgerRow(feature.feature, {
                kind: feature.kind,
                entrypoint: feature.entrypoint,
                exportName: feature.exportName,
                methodName: feature.methodName,
                methodType: feature.methodType,
                sourceContract: feature.sourceContract
            })
        ],
        strict: true,
        packageRoot,
        repositoryRoot: packageRoot
    })

    assert.equal(result.strict, true)
})

test('strict feature checker rejects changed signatures, options, and results', async (context) => {
    const packageRoot = await packageFixture(
        context,
        [capabilityRow('parser.document.parse')],
        {
            source: `export class GerberParser { static parse(input, options = {}) { return { ok: true, input, options } } }\nexport class ToolkitCapabilities { static inventory() { return ${JSON.stringify([capabilityRow('parser.document.parse')])} } }\n`
        }
    )
    const mismatches = [
        baselineFeature('.#GerberParser.parse()', {
            kind: 'method',
            entrypoint: '.',
            exportName: 'GerberParser',
            methodName: 'parse',
            methodType: 'static',
            sourceContract: {
                type: 'method',
                signature: '(different)',
                parameters: []
            }
        }),
        baselineFeature(
            '.#GerberParser.parse().argument.options.property.missingOption',
            {
                kind: 'option',
                entrypoint: '.',
                exportName: 'GerberParser',
                methodName: 'parse',
                methodType: 'static',
                sourceContract: {
                    type: 'property',
                    argument: 'options',
                    name: 'missingOption'
                }
            }
        ),
        baselineFeature('.#GerberParser.parse().result.missingResult', {
            kind: 'field',
            entrypoint: '.',
            exportName: 'GerberParser',
            methodName: 'parse',
            methodType: 'static',
            sourceContract: {
                type: 'result-field',
                name: 'missingResult'
            }
        })
    ]

    for (const feature of mismatches) {
        await assert.rejects(
            () =>
                validateFeaturePreservation({
                    apiBaseline: {
                        entrypoints: [
                            { entrypoint: '.', target: './index.mjs' }
                        ],
                        features: [feature]
                    },
                    ledger: [
                        ledgerRow(feature.feature, {
                            kind: feature.kind,
                            entrypoint: feature.entrypoint,
                            exportName: feature.exportName,
                            methodName: feature.methodName,
                            methodType: feature.methodType,
                            sourceContract: feature.sourceContract
                        })
                    ],
                    strict: true,
                    packageRoot,
                    repositoryRoot: packageRoot
                }),
            /Packed API contract mismatch/u
        )
    }
})

test('strict feature checker imports every packed worker entrypoint', async (context) => {
    const packageRoot = await packageFixture(
        context,
        [capabilityRow('parser.document.parse')],
        {
            exports: { './worker': './worker.mjs' },
            files: {
                'worker.mjs':
                    "throw new Error('worker entrypoint was imported')\n"
            }
        }
    )
    const feature = baselineFeature('mapped')

    await assert.rejects(
        () =>
            validateFeaturePreservation({
                apiBaseline: {
                    entrypoints: [{ entrypoint: '.', target: './index.mjs' }],
                    features: [feature]
                },
                ledger: [ledgerRow('mapped')],
                strict: true,
                packageRoot,
                repositoryRoot: packageRoot
            }),
        /worker entrypoint was imported/u
    )
})

test('strict feature checker rejects capability availability drift', async (context) => {
    const driftedAvailability = {
        ...AVAILABILITY,
        'gerber-toolkit': 'unavailable'
    }
    const packageRoot = await packageFixture(context, [
        capabilityRow('parser.document.parse', driftedAvailability)
    ])
    const feature = baselineFeature('mapped')

    await assert.rejects(
        () =>
            validateFeaturePreservation({
                apiBaseline: {
                    entrypoints: [{ entrypoint: '.', target: './index.mjs' }],
                    features: [feature]
                },
                ledger: [ledgerRow('mapped')],
                strict: true,
                packageRoot,
                repositoryRoot: packageRoot
            }),
        /Capability inventory availability mismatch/u
    )
})

test('strict feature checker validates evidence paths and symbol references', async (context) => {
    const packageRoot = await packageFixture(context, [
        capabilityRow('parser.document.parse')
    ])
    const apiBaseline = {
        entrypoints: [
            {
                entrypoint: '.',
                target: './index.mjs',
                exports: [{ name: 'GerberParser' }]
            }
        ],
        features: [baselineFeature('mapped')]
    }

    await assert.rejects(
        () =>
            validateFeaturePreservation({
                apiBaseline: {
                    ...apiBaseline,
                    features: [
                        baselineFeature('mapped', {
                            tests: ['missing.test.mjs']
                        })
                    ]
                },
                ledger: [ledgerRow('mapped', { tests: ['missing.test.mjs'] })],
                strict: true,
                packageRoot,
                repositoryRoot: packageRoot
            }),
        /Missing evidence paths: missing\.test\.mjs/u
    )
    await assert.rejects(
        () =>
            validateFeaturePreservation({
                apiBaseline: {
                    ...apiBaseline,
                    features: [
                        baselineFeature('mapped', {
                            evidenceToken: 'MissingSymbol',
                            evidenceTokens: ['MissingSymbol']
                        })
                    ]
                },
                ledger: [
                    ledgerRow('mapped', {
                        evidenceToken: 'MissingSymbol',
                        evidenceTokens: ['MissingSymbol']
                    })
                ],
                strict: true,
                packageRoot,
                repositoryRoot: packageRoot
            }),
        /Evidence tests do not reference MissingSymbol for mapped/u
    )
})

test('file-backed and command feature checks use requested artifacts', async (context) => {
    const root = await mkdtemp(join(tmpdir(), 'gerber-feature-files-'))
    const apiPath = join(root, 'api.json')
    const ledgerPath = join(root, 'ledger.json')
    await writeFile(
        apiPath,
        JSON.stringify({
            entrypoints: [],
            features: [baselineFeature('missing')]
        })
    )
    await writeFile(ledgerPath, '[]')
    context.after(() => rm(root, { recursive: true, force: true }))

    await assert.rejects(
        () =>
            checkFeaturePreservation({
                apiPath,
                ledgerPath,
                repositoryRoot: root
            }),
        /Missing feature-preservation mappings: missing/u
    )
    await assert.rejects(
        () =>
            execFileAsync(process.execPath, [
                fileURLToPath(
                    new URL(
                        '../scripts/check-feature-preservation.mjs',
                        import.meta.url
                    )
                ),
                '--api',
                apiPath,
                '--ledger',
                ledgerPath,
                '--repository-root',
                root
            ]),
        (error) => {
            assert.match(
                String(error.stderr),
                /Missing feature-preservation mappings: missing/u
            )
            return true
        }
    )
})

test('strict file-backed checker imports capabilities from an npm pack', async (context) => {
    const root = await mkdtemp(join(tmpdir(), 'gerber-feature-pack-'))
    const apiPath = join(root, 'api.json')
    const ledgerPath = join(root, 'ledger.json')
    const feature = baselineFeature('mapped')
    await writeFile(
        join(root, 'package.json'),
        JSON.stringify({
            name: 'gerber-feature-fixture',
            version: '1.0.0',
            type: 'module',
            exports: { '.': './index.mjs' },
            files: ['index.mjs']
        })
    )
    await writeFile(
        join(root, 'index.mjs'),
        `export class GerberParser {}\nexport class ToolkitCapabilities { static inventory() { return ${JSON.stringify([capabilityRow('parser.document.parse')])} } }\n`
    )
    await writeFile(
        apiPath,
        JSON.stringify({
            entrypoints: [
                {
                    entrypoint: '.',
                    target: './index.mjs',
                    exports: [
                        { name: 'GerberParser' },
                        { name: 'ToolkitCapabilities' }
                    ]
                }
            ],
            features: [feature]
        })
    )
    await writeFile(ledgerPath, JSON.stringify([ledgerRow('mapped')]))
    context.after(() => rm(root, { recursive: true, force: true }))

    const result = await checkFeaturePreservation({
        apiPath,
        ledgerPath,
        repositoryRoot: root,
        strict: true
    })

    assert.equal(result.featureCount, 1)
    assert.equal(result.strict, true)
})

test('strict file-backed checker resolves real packed runtime dependencies', async () => {
    const result = await checkFeaturePreservation({ strict: true })

    assert.equal(result.featureCount > 0, true)
    assert.equal(result.strict, true)
})
