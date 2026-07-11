import { ToolkitCapabilities as SharedCapabilities } from 'circuitjson-toolkit'

const NATIVE = new Map([
    ['parse.document', 'Parse Gerber and Excellon into CircuitJSON.'],
    ['project.load', 'Load and combine fabrication project entries.'],
    ['worker.parse', 'Parse Gerber through the shared worker protocol.'],
    [
        'worker.load-project',
        'Load Gerber projects through the shared worker protocol.'
    ]
])
const LEGACY = Object.freeze([
    ['extension.gerber.coordinate', 'native', 'gerber-toolkit/extensions'],
    ['extension.gerber.layer', 'native', 'gerber-toolkit/extensions'],
    ['extension.gerber.sceneModels', 'native', 'gerber-toolkit/extensions'],
    ['interaction.pcb.hitTest', 'shared', 'PcbInteractionIndex'],
    ['parser.document.parse', 'native', 'Parser'],
    ['project.archive.load', 'native', 'ProjectLoader'],
    ['renderer.pcb.render', 'shared', 'PcbSvgRenderer'],
    ['scene3d.pcb.build', 'shared', 'PcbScene3dBuilder']
])

/** Reports common and Gerber-native capability availability. */
export class ToolkitCapabilities {
    /** @returns {Record<string, any>[]} Stable clone-safe inventory. */
    static inventory() {
        const common = SharedCapabilities.inventory().map((row) => {
            const summary = NATIVE.get(row.id)
            if (!summary) return { ...row }
            return {
                ...row,
                status: 'native',
                entrypoint: row.id.startsWith('worker.')
                    ? 'gerber-toolkit/workers/parser.worker.mjs'
                    : row.entrypoint,
                summary,
                reason: summary
            }
        })
        const legacy = LEGACY.map(([id, status, entrypoint]) => {
            const parts = id.split('.')
            const summary = `Preserve the Gerber ${id} capability.`
            return {
                id,
                category: parts.slice(0, -1).join('.'),
                operation: parts.at(-1),
                status,
                entrypoint,
                summary,
                reason: summary,
                tested: true,
                documented: true
            }
        })
        return [...common, ...legacy].sort((left, right) =>
            left.id.localeCompare(right.id)
        )
    }
}

Object.freeze(ToolkitCapabilities.prototype)
Object.freeze(ToolkitCapabilities)
