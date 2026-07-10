import { createHash } from 'node:crypto'

const TOOLKITS = Object.freeze([
    'circuitjson-toolkit',
    'gerber-toolkit',
    'altium-toolkit',
    'kicad-toolkit'
])

/**
 * Immutable checksum of the canonical eight-row Task 1 capability inventory.
 */
export const GERBER_TASK1_CAPABILITY_INVENTORY_CHECKSUM =
    'fd78eb477610861e1104c1cd10c6387a98e77e9d0c740f358806b31a1898f451'

/**
 * Rejects any Task 1 inventory that differs from the committed canonical set.
 * @param {unknown} inventory Capability inventory candidate.
 * @returns {void}
 */
export function assertGerberTask1CapabilityInventory(inventory) {
    const rows = Array.isArray(inventory) ? inventory : []
    const observedChecksum = capabilityInventoryChecksum(rows)
    if (
        rows.length !== 8 ||
        observedChecksum !== GERBER_TASK1_CAPABILITY_INVENTORY_CHECKSUM
    ) {
        throw new Error(
            `Immutable capability inventory drift: expected 8 rows with checksum ${GERBER_TASK1_CAPABILITY_INVENTORY_CHECKSUM}, received ${rows.length} rows with checksum ${observedChecksum}.`
        )
    }
}

/**
 * Computes the order-independent checksum for one capability inventory.
 * @param {Record<string, any>[]} inventory Capability inventory rows.
 * @returns {string} SHA-256 checksum.
 */
export function capabilityInventoryChecksum(inventory) {
    const normalized = inventory
        .map((row) => ({
            id: String(row?.id || ''),
            category: String(row?.category || ''),
            operation: String(row?.operation || ''),
            availability: Object.fromEntries(
                TOOLKITS.map((toolkit) => [
                    toolkit,
                    String(row?.availability?.[toolkit] || '')
                ])
            )
        }))
        .sort((left, right) => left.id.localeCompare(right.id))
    return createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
}
