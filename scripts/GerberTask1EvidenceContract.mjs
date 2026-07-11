import { createHash } from 'node:crypto'

import { GERBER_TASK1_PROVENANCE } from './GerberTask1Provenance.mjs'

export const GERBER_TASK1_API_CONTRACT_CHECKSUM =
    'd7cfc63587c737a8abce56dbd0f353b941020eabc96dd6045bb50905c43c7a70'
export const GERBER_TASK1_LEDGER_CHECKSUM =
    '6de6e47417d3c1b88cca3d0c8bd23af812dcafb2f1b0172c963fcd3fa1004372'
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
