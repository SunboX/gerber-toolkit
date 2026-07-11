import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import {
    checkFeaturePreservation,
    validateFeaturePreservation as validateSyntheticFeaturePreservation
} from '../scripts/check-feature-preservation.mjs'
import { GerberBehaviorEvidence } from '../scripts/GerberBehaviorEvidence.mjs'
import { GerberFeatureEvidence } from '../scripts/GerberFeatureEvidence.mjs'
import { assertGerberTask1EvidenceContract } from '../scripts/GerberTask1EvidenceContract.mjs'

const execFileAsync = promisify(execFile)
const AVAILABILITY = {
    'circuitjson-toolkit': 'shared',
    'gerber-toolkit': 'native',
    'altium-toolkit': 'derived',
    'kicad-toolkit': 'derived'
}

/**
 * Runs strict synthetic fixtures with an explicit Task 1 anchor opt-out.
 * @param {Record<string, any>} options Synthetic validation options.
 * @returns {ReturnType<typeof validateSyntheticFeaturePreservation>} Validation promise.
 */
function validateFeaturePreservation(options) {
    return validateSyntheticFeaturePreservation({
        ...options,
        task1Identity: false
    })
}

test('immutable evidence rejects an identically self-resealed baseline and ledger', async () => {
    const apiBaseline = JSON.parse(
        await readFile('spec/api-baseline-v0.1.21.json', 'utf8')
    )
    const ledger = JSON.parse(
        await readFile('spec/feature-preservation.json', 'utf8')
    )
    const removed = apiBaseline.features.shift()
    const ledgerIndex = ledger.findIndex(
        (row) => row.feature === removed.feature
    )
    ledger.splice(ledgerIndex, 1)
    const { artifactChecksum: ignored, ...body } = apiBaseline
    apiBaseline.artifactChecksum = createHash('sha256')
        .update(JSON.stringify(body))
        .digest('hex')

    assert.throws(
        () => assertGerberTask1EvidenceContract(apiBaseline, ledger),
        /Immutable Task 1 evidence drift/u
    )
})

/**
 * Creates one complete baseline feature.
 * @param {string} feature Stable feature id.
 * @param {Record<string, any>} [overrides] Feature overrides.
 * @returns {Record<string, any>} Baseline feature.
 */
function baselineFeature(feature, overrides = {}) {
    const row = {
        feature,
        kind: 'export',
        capabilityId: 'parser.document.parse',
        disposition: 'shared',
        replacement: 'Parser.parse()',
        availability: { ...AVAILABILITY },
        reason: 'Gerber parsing projects native data into the shared envelope.',
        evidenceToken: 'GerberParser',
        evidenceTokens: ['GerberParser'],
        sourceContract: { type: 'export', valueType: 'function' },
        tests: ['index.mjs'],
        documentation: ['index.mjs'],
        ...overrides
    }
    if (!Object.hasOwn(overrides, 'evidence')) {
        row.evidence = defaultEvidence(row)
    }
    return row
}

/**
 * Creates one ledger row from a baseline feature.
 * @param {string} feature Stable feature id.
 * @param {Record<string, any>} [overrides] Row overrides.
 * @returns {Record<string, any>} Ledger row.
 */
function ledgerRow(feature, overrides = {}) {
    const row = {
        package: 'gerber-toolkit@0.1.21',
        ...baselineFeature(feature),
        ...overrides
    }
    if (!Object.hasOwn(overrides, 'evidence')) {
        row.evidence = defaultEvidence(row)
    }
    return row
}

/**
 * Creates synthetic usage evidence consistent with one source contract.
 * @param {Record<string, any>} row Synthetic feature.
 * @returns {Record<string, any>} Evidence descriptor.
 */
function defaultEvidence(row) {
    return {
        source: { kind: 'source-contract' },
        usage: {
            kind:
                row.sourceContract?.type === 'result-field'
                    ? 'result-path'
                    : 'token-reference'
        }
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

test('strict feature checker rejects inventory rows beyond the frozen eight', async (context) => {
    const inventory = JSON.parse(
        await readFile('spec/capability-inventory-v0.1.21.json', 'utf8')
    )
    assert.equal(inventory.length, 8)
    const additional = capabilityRow('imaginary.valid.operation')
    const packageRoot = await packageFixture(context, [
        ...inventory,
        additional
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
                inventory,
                strict: true,
                packageRoot,
                repositoryRoot: packageRoot
            }),
        /Packed capability inventory drift:.*imaginary\.valid\.operation/u
    )
})

test('strict command rejects a supplied ninth row against the immutable inventory checksum', async (context) => {
    const root = await mkdtemp(join(tmpdir(), 'gerber-feature-inventory-'))
    const inventory = JSON.parse(
        await readFile('spec/capability-inventory-v0.1.21.json', 'utf8')
    )
    const inventoryPath = join(root, 'capability-inventory.json')
    await writeFile(
        inventoryPath,
        JSON.stringify([
            ...inventory,
            capabilityRow('imaginary.valid.operation')
        ])
    )
    context.after(() => rm(root, { recursive: true, force: true }))

    await assert.rejects(
        () =>
            execFileAsync(process.execPath, [
                fileURLToPath(
                    new URL(
                        '../scripts/check-feature-preservation.mjs',
                        import.meta.url
                    )
                ),
                '--strict',
                '--inventory',
                inventoryPath,
                '--repository-root',
                process.cwd()
            ]),
        (error) => {
            assert.match(
                String(error.stderr),
                /Immutable capability inventory drift: expected 8 rows/u
            )
            return true
        }
    )
})

test('strict command rejects extra fields on immutable inventory rows', async (context) => {
    const root = await mkdtemp(join(tmpdir(), 'gerber-feature-inventory-'))
    const inventory = JSON.parse(
        await readFile('spec/capability-inventory-v0.1.21.json', 'utf8')
    )
    inventory[0].untrustedNote = 'ignored by normalized checksum'
    const inventoryPath = join(root, 'capability-inventory.json')
    await writeFile(inventoryPath, JSON.stringify(inventory))
    context.after(() => rm(root, { recursive: true, force: true }))

    await assert.rejects(
        () =>
            execFileAsync(process.execPath, [
                fileURLToPath(
                    new URL(
                        '../scripts/check-feature-preservation.mjs',
                        import.meta.url
                    )
                ),
                '--strict',
                '--inventory',
                inventoryPath,
                '--repository-root',
                process.cwd()
            ]),
        (error) => {
            assert.match(
                String(error.stderr),
                /Immutable capability inventory drift: expected 8 rows/u
            )
            return true
        }
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

test('strict feature checker rejects token-only behavior evidence', async (context) => {
    const inventory = [capabilityRow('parser.document.parse')]
    const packageRoot = await packageFixture(context, inventory, {
        files: {
            'evidence.test.mjs': 'void GerberParser\n'
        }
    })
    const evidence = {
        source: { kind: 'source-contract' },
        usage: {
            kind: 'behavior-matcher',
            matcher: 'parser-gerber-structures-v1',
            contract: GerberBehaviorEvidence.contract(
                'parser-gerber-structures-v1'
            )
        }
    }
    const feature = baselineFeature('parser preserves Gerber structures', {
        kind: 'behavior',
        sourceContract: {
            type: 'behavior',
            description: 'parser preserves Gerber structures'
        },
        evidence,
        tests: ['evidence.test.mjs']
    })

    await assert.rejects(
        () =>
            validateFeaturePreservation({
                apiBaseline: {
                    entrypoints: [{ entrypoint: '.', target: './index.mjs' }],
                    features: [feature]
                },
                ledger: [ledgerRow(feature.feature, feature)],
                inventory,
                strict: true,
                packageRoot,
                repositoryRoot: packageRoot
            }),
        /Behavior evidence does not satisfy parser-gerber-structures-v1/u
    )

    const tampered = structuredClone(feature)
    tampered.evidence.usage.contract.requirements = []
    await assert.rejects(
        () =>
            validateFeaturePreservation({
                apiBaseline: {
                    entrypoints: [{ entrypoint: '.', target: './index.mjs' }],
                    features: [tampered]
                },
                ledger: [ledgerRow(tampered.feature, tampered)],
                inventory,
                strict: true,
                packageRoot,
                repositoryRoot: packageRoot
            }),
        /Invalid feature-preservation row/u
    )
})

test('strict feature checker accepts source-only inferred result contracts', async (context) => {
    const inventory = [capabilityRow('parser.document.parse')]
    const packageRoot = await packageFixture(context, inventory, {
        source: `export class GerberParser { static parse() { return { unobserved: true } } }\nexport class ToolkitCapabilities { static inventory() { return ${JSON.stringify(inventory)} } }\n`
    })
    const feature = baselineFeature(
        '.#GerberParser.parse().result.unobserved',
        {
            kind: 'field',
            entrypoint: '.',
            exportName: 'GerberParser',
            methodName: 'parse',
            methodType: 'static',
            sourceContract: {
                type: 'result-field',
                name: 'unobserved'
            },
            evidence: {
                source: { kind: 'source-contract' },
                usage: null
            },
            evidenceToken: null,
            evidenceTokens: [],
            tests: []
        }
    )

    const result = await validateFeaturePreservation({
        apiBaseline: {
            entrypoints: [{ entrypoint: '.', target: './index.mjs' }],
            features: [feature]
        },
        ledger: [ledgerRow(feature.feature, feature)],
        inventory,
        strict: true,
        packageRoot,
        repositoryRoot: packageRoot
    })

    assert.deepEqual(result, { featureCount: 1, strict: true })
})

test('strict feature checker rejects class method and leaf coincidence without result-path evidence', async (context) => {
    const inventory = [capabilityRow('parser.document.parse')]
    const packageRoot = await packageFixture(context, inventory, {
        source: `export class GerberParser {\n    static parse() {\n        return { holes: { x: 1 } }\n    }\n}\nexport class ToolkitCapabilities { static inventory() { return ${JSON.stringify(inventory)} } }\n`,
        files: {
            'evidence.test.mjs':
                'const result = GerberParser.parse()\nconst unrelated = { x: true }\nvoid result.real\nvoid unrelated\n'
        }
    })
    const feature = baselineFeature('.#GerberParser.parse().result.holes.x', {
        kind: 'field',
        entrypoint: '.',
        exportName: 'GerberParser',
        methodName: 'parse',
        methodType: 'static',
        sourceContract: {
            type: 'result-field',
            name: 'holes.x'
        },
        evidenceToken: 'x',
        evidenceTokens: ['GerberParser', 'parse', 'x'],
        tests: ['evidence.test.mjs']
    })
    const row = ledgerRow(feature.feature, feature)

    await assert.rejects(
        () =>
            validateFeaturePreservation({
                apiBaseline: {
                    entrypoints: [{ entrypoint: '.', target: './index.mjs' }],
                    features: [feature]
                },
                ledger: [row],
                inventory,
                strict: true,
                packageRoot,
                repositoryRoot: packageRoot
            }),
        /Evidence tests do not reference a result path for \.#GerberParser\.parse\(\)\.result\.holes\.x/u
    )
})

test('result-path evidence keeps same-named aliases scoped to their test files', () => {
    const feature = baselineFeature('.#GerberParser.parse().result.holes.x', {
        kind: 'field',
        entrypoint: '.',
        exportName: 'GerberParser',
        methodName: 'parse',
        methodType: 'static',
        sourceContract: {
            type: 'result-field',
            name: 'holes.x'
        }
    })

    assert.equal(
        GerberFeatureEvidence.matchesAcross(
            feature,
            ['GerberParser', 'parse', 'x'],
            [
                'const result = GerberParser.parse()\nconst x = true\nvoid result.real\nvoid x\n',
                'const result = unrelated()\nvoid result.holes.x\n'
            ]
        ),
        false
    )
})

test('strict feature checker accepts exact whole-result equality delegation', async (context) => {
    const inventory = [capabilityRow('parser.document.parse')]
    const packageRoot = await packageFixture(context, inventory, {
        source: `export class GerberBuilder { static build() { return { zones: [{ type: 'fill' }] } } }\nexport class GerberPreparator { static prepare() { return GerberBuilder.build() } }\nexport class ToolkitCapabilities { static inventory() { return ${JSON.stringify(inventory)} } }\n`,
        files: {
            'evidence.test.mjs':
                "import assert from 'node:assert/strict'\nimport { GerberBuilder, GerberPreparator } from './index.mjs'\nconst built = GerberBuilder.build()\nconst prepared = GerberPreparator.prepare()\nconst type = true\nassert.deepEqual(prepared, built)\nvoid type\n"
        }
    })
    const feature = baselineFeature(
        '.#GerberPreparator.prepare().result.zones.type',
        {
            kind: 'field',
            entrypoint: '.',
            exportName: 'GerberPreparator',
            methodName: 'prepare',
            methodType: 'static',
            sourceContract: {
                type: 'result-field',
                name: 'zones.type'
            },
            evidenceToken: 'type',
            evidenceTokens: ['GerberPreparator', 'prepare', 'type'],
            tests: ['evidence.test.mjs']
        }
    )

    await validateFeaturePreservation({
        apiBaseline: {
            entrypoints: [{ entrypoint: '.', target: './index.mjs' }],
            features: [feature]
        },
        ledger: [ledgerRow(feature.feature, feature)],
        inventory,
        strict: true,
        packageRoot,
        repositoryRoot: packageRoot
    })
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
            exports: {
                '.': './index.mjs',
                './styles/renderers.css': './renderers.css'
            },
            files: ['index.mjs', 'renderers.css']
        })
    )
    await writeFile(
        join(root, 'index.mjs'),
        `export class GerberParser {}\nexport class ToolkitCapabilities { static inventory() { return ${JSON.stringify([capabilityRow('parser.document.parse')])} } }\n`
    )
    await writeFile(join(root, 'renderers.css'), '.board { display: block; }\n')
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
        task1Identity: false,
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
