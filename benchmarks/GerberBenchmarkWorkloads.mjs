import { PcbInteractionIndex as CanonicalInteractionIndex } from '../src/interaction.mjs'
import { ProjectLoader } from '../src/project.mjs'
import { GerberProjectLoader } from '../src/legacy-parser.mjs'
import { PcbInteractionIndex as LegacyInteractionIndex } from '../src/legacy-renderers.mjs'
import { GerberCircuitJsonProjector } from '../src/convergence/GerberCircuitJsonProjector.mjs'
import { GerberLegacyProjectionBenchmarkAdapter } from './GerberLegacyProjectionBenchmarkAdapter.mjs'

const WORKLOAD_KEYS = [
    'archiveProjection',
    'createInteractionIndex',
    'defaultResult',
    'hitTest'
]

/**
 * Defines replaceable production-path workloads behind stable benchmark shapes.
 */
export class GerberBenchmarkWorkloads {
    /**
     * Creates the frozen historical workload implementations.
     * @param {Partial<Record<(typeof WORKLOAD_KEYS)[number], Function>>} [overrides] Test or comparison overrides.
     * @returns {Readonly<Record<(typeof WORKLOAD_KEYS)[number], Function>>} Historical workloads.
     */
    static baseline(overrides = {}) {
        return GerberBenchmarkWorkloads.#merge(
            {
                archiveProjection: async (entries) => {
                    const result =
                        await GerberProjectLoader.loadEntries(entries)
                    return GerberLegacyProjectionBenchmarkAdapter.project(
                        result
                    )
                },
                createInteractionIndex: async (document) => {
                    const target = LegacyInteractionIndex.build(document)
                    return { itemCount: target.length, target }
                },
                hitTest: (index, query) =>
                    LegacyInteractionIndex.hitTestItems(
                        index.target,
                        query.point,
                        query.options
                    ),
                defaultResult: async (_entries, context) =>
                    context.defaultDocument
            },
            overrides
        )
    }

    /**
     * Creates current workload implementations with explicit Task 2 seams.
     * @param {Partial<Record<(typeof WORKLOAD_KEYS)[number], Function>>} [overrides] Current production adapters or test doubles.
     * @returns {Readonly<Record<(typeof WORKLOAD_KEYS)[number], Function>>} Current workloads.
     */
    static current(overrides = {}) {
        return GerberBenchmarkWorkloads.#merge(
            {
                archiveProjection: async (entries) =>
                    ProjectLoader.load(
                        GerberBenchmarkWorkloads.#commonEntries(entries),
                        { worker: false }
                    ).documents[0].model,
                createInteractionIndex: async (document) => {
                    const model = GerberCircuitJsonProjector.project(document)
                    return {
                        itemCount: model.length,
                        target: CanonicalInteractionIndex.create(model)
                    }
                },
                hitTest: (index, query) =>
                    index.target.hitTest(query.point, query.options),
                defaultResult: async (entries) =>
                    ProjectLoader.load(
                        GerberBenchmarkWorkloads.#commonEntries(entries),
                        { worker: false }
                    )
            },
            overrides
        )
    }

    /**
     * Maps historical benchmark entries onto the common app entry shape.
     * @param {Record<string, any>[]} entries Historical entries.
     * @returns {{ name: string, data: unknown }[]} Common entries.
     */
    static #commonEntries(entries) {
        return entries.map((entry) => ({
            name: entry.name,
            data: entry.data ?? entry.bytes ?? entry.buffer
        }))
    }

    /**
     * Applies only known callable overrides to one workload profile.
     * @param {Record<string, Function>} defaults Default implementations.
     * @param {Record<string, unknown>} overrides Candidate overrides.
     * @returns {Readonly<Record<string, Function>>} Validated workload profile.
     */
    static #merge(defaults, overrides) {
        const unknown = Object.keys(overrides).filter(
            (key) => !WORKLOAD_KEYS.includes(key)
        )
        if (unknown.length > 0) {
            throw new TypeError(
                `Unknown Gerber benchmark workload: ${unknown.join(', ')}`
            )
        }
        const result = { ...defaults }
        for (const key of WORKLOAD_KEYS) {
            if (overrides[key] !== undefined) {
                if (typeof overrides[key] !== 'function') {
                    throw new TypeError(
                        `Gerber benchmark workload ${key} must be callable.`
                    )
                }
                result[key] = overrides[key]
            }
        }
        return Object.freeze(result)
    }
}
