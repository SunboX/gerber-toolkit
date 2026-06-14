const EXTENSION_ROLES = new Map([
    ['gtl', ['top-copper', 'top']],
    ['gbl', ['bottom-copper', 'bottom']],
    ['gto', ['top-silkscreen', 'top']],
    ['gbo', ['bottom-silkscreen', 'bottom']],
    ['gts', ['top-soldermask', 'top']],
    ['gbs', ['bottom-soldermask', 'bottom']],
    ['gtp', ['top-paste', 'top']],
    ['gbp', ['bottom-paste', 'bottom']],
    ['gko', ['board-outline', 'both']],
    ['gm1', ['board-outline', 'both']],
    ['drl', ['plated-drill', 'both']],
    ['xln', ['plated-drill', 'both']]
])

/**
 * Resolves fabrication source file roles from common naming conventions.
 */
export class GerberLayerRoleResolver {
    /**
     * Resolves source-layer metadata for one file name.
     * @param {string} fileName Source file name.
     * @returns {{ role: string, side: string, isDrill: boolean, isDocumentation: boolean, plated: boolean }}
     */
    static resolve(fileName) {
        const normalized = GerberLayerRoleResolver.#baseName(fileName)
        const lower = normalized.toLowerCase()
        const extension = lower.split('.').pop() || ''
        const extensionRole = EXTENSION_ROLES.get(extension)

        if (GerberLayerRoleResolver.#isDrillMap(lower)) {
            return GerberLayerRoleResolver.#metadata(
                'drill-map',
                'both',
                false,
                true,
                false
            )
        }

        if (lower.includes('npth')) {
            return GerberLayerRoleResolver.#metadata(
                'nonplated-drill',
                'both',
                true,
                false,
                false
            )
        }

        if (lower.includes('pth') && extension === 'drl') {
            return GerberLayerRoleResolver.#metadata(
                'plated-drill',
                'both',
                true,
                false,
                true
            )
        }

        if (lower.includes('edge_cuts') || lower.includes('edge-cuts')) {
            return GerberLayerRoleResolver.#metadata(
                'board-outline',
                'both',
                false,
                false,
                false
            )
        }

        if (lower.includes('f_cu') || lower.includes('top_cu')) {
            return GerberLayerRoleResolver.#metadata(
                'top-copper',
                'top',
                false,
                false,
                false
            )
        }

        if (lower.includes('b_cu') || lower.includes('bottom_cu')) {
            return GerberLayerRoleResolver.#metadata(
                'bottom-copper',
                'bottom',
                false,
                false,
                false
            )
        }

        if (lower.includes('f_mask')) {
            return GerberLayerRoleResolver.#metadata(
                'top-soldermask',
                'top',
                false,
                false,
                false
            )
        }

        if (lower.includes('b_mask')) {
            return GerberLayerRoleResolver.#metadata(
                'bottom-soldermask',
                'bottom',
                false,
                false,
                false
            )
        }

        if (lower.includes('f_silk') || lower.includes('f_silkscreen')) {
            return GerberLayerRoleResolver.#metadata(
                'top-silkscreen',
                'top',
                false,
                false,
                false
            )
        }

        if (lower.includes('b_silk') || lower.includes('b_silkscreen')) {
            return GerberLayerRoleResolver.#metadata(
                'bottom-silkscreen',
                'bottom',
                false,
                false,
                false
            )
        }

        if (extensionRole) {
            return GerberLayerRoleResolver.#metadata(
                extensionRole[0],
                extensionRole[1],
                extension === 'drl' || extension === 'xln',
                false,
                true
            )
        }

        return GerberLayerRoleResolver.#metadata(
            'fabrication-layer',
            'both',
            false,
            false,
            false
        )
    }

    /**
     * Returns true when one path has a Gerber or drill extension.
     * @param {string} fileName Source file name.
     * @returns {boolean}
     */
    static isFabricationFileName(fileName) {
        const lower = String(fileName || '').toLowerCase()
        return /\.(?:gbr|gtl|gbl|gto|gbo|gts|gbs|gtp|gbp|gko|gm1|drl|xln)$/u.test(
            lower
        )
    }

    /**
     * Returns true when one path is a ZIP archive.
     * @param {string} fileName Source file name.
     * @returns {boolean}
     */
    static isZipFileName(fileName) {
        return String(fileName || '')
            .toLowerCase()
            .endsWith('.zip')
    }

    /**
     * Builds resolved metadata.
     * @param {string} role Layer role.
     * @param {string} side Layer side.
     * @param {boolean} isDrill Whether this is a drill file.
     * @param {boolean} isDocumentation Whether this is documentation artwork.
     * @param {boolean} plated Whether drill hits are plated.
     * @returns {{ role: string, side: string, isDrill: boolean, isDocumentation: boolean, plated: boolean }}
     */
    static #metadata(role, side, isDrill, isDocumentation, plated) {
        return { role, side, isDrill, isDocumentation, plated }
    }

    /**
     * Returns one path's final segment.
     * @param {string} fileName Source file name.
     * @returns {string}
     */
    static #baseName(fileName) {
        const normalized = String(fileName || '').replace(/\\+/gu, '/')
        const parts = normalized.split('/')
        return parts[parts.length - 1] || normalized
    }

    /**
     * Returns true when a file name describes drill-map artwork.
     * @param {string} lower Lowercase base file name.
     * @returns {boolean}
     */
    static #isDrillMap(lower) {
        return lower.includes('drl_map') || lower.includes('drill_map')
    }
}
