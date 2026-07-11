import { createHash } from 'node:crypto'

import { GERBER_TASK1_PROVENANCE } from './GerberTask1Provenance.mjs'

export const GERBER_TASK1_API_CONTRACT_CHECKSUM =
    '2f3f9a9cfeab953d1319f512a11b92030f5a5ed9610e4f33dfa5cf2c98932678'
export const GERBER_TASK1_LEDGER_CHECKSUM =
    'f288d06505440c1b3c0ea7eba8f9ed8ad8a9306b3ad8c74e026e1ab03e26e50a'
const PROVENANCE_FIELDS = Object.freeze([
    'sourceCommit',
    'sourceTree',
    'evidenceCommit',
    'evidenceTree',
    'harnessCommit',
    'harnessTree'
])

/**
 * Rejects a Task 1 baseline and ledger that were altered and self-resealed.
 * @param {Record<string, any>} apiBaseline API baseline candidate.
 * @param {Record<string, any>[]} ledger Preservation ledger candidate.
 * @returns {void}
 */
export function assertGerberTask1EvidenceContract(apiBaseline, ledger) {
    assertGerberTask1Provenance(apiBaseline?.provenance)
    const apiChecksum = checksum({
        schema: apiBaseline?.schema,
        package: apiBaseline?.package,
        packageVersion: apiBaseline?.packageVersion,
        entrypoints: apiBaseline?.entrypoints,
        exports: apiBaseline?.exports,
        features: apiBaseline?.features
    })
    const ledgerChecksum = checksum(ledger)
    if (
        !validEnvelope(apiBaseline) ||
        apiChecksum !== GERBER_TASK1_API_CONTRACT_CHECKSUM ||
        ledgerChecksum !== GERBER_TASK1_LEDGER_CHECKSUM
    ) {
        throw new Error(
            `Immutable Task 1 evidence drift: expected API contract checksum ${GERBER_TASK1_API_CONTRACT_CHECKSUM} and ledger checksum ${GERBER_TASK1_LEDGER_CHECKSUM}, received ${apiChecksum} and ${ledgerChecksum}.`
        )
    }
}

/**
 * Rejects provenance unless every Task 1 source identity is pinned exactly.
 * @param {Record<string, any>} provenance Provenance candidate.
 * @returns {void}
 */
export function assertGerberTask1Provenance(provenance) {
    const valid =
        provenance &&
        typeof provenance === 'object' &&
        !Array.isArray(provenance) &&
        Object.keys(provenance).sort().join(',') ===
            [...PROVENANCE_FIELDS].sort().join(',') &&
        PROVENANCE_FIELDS.every(
            (field) => provenance[field] === GERBER_TASK1_PROVENANCE[field]
        )
    if (!valid) {
        throw new Error('Immutable Task 1 provenance drift.')
    }
}

/**
 * Requires the exact artifact envelope and stable historical source identity.
 * @param {Record<string, any>} apiBaseline API baseline candidate.
 * @returns {boolean} Whether the immutable envelope is valid.
 */
function validEnvelope(apiBaseline) {
    const keys = Object.keys(apiBaseline || {}).sort()
    const { artifactChecksum, ...body } = apiBaseline || {}
    return (
        JSON.stringify(keys) ===
            JSON.stringify([
                'artifactChecksum',
                'entrypoints',
                'exports',
                'features',
                'package',
                'packageVersion',
                'provenance',
                'schema'
            ]) && artifactChecksum === checksum(body)
    )
}

/**
 * Computes a deterministic JSON checksum.
 * @param {unknown} value JSON-shaped value.
 * @returns {string} SHA-256 checksum.
 */
function checksum(value) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
