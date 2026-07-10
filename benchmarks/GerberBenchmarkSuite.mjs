import { createHash } from 'node:crypto'

import { GerberParser, GerberProjectLoader } from '../src/parser.mjs'
import { GerberPcbSvgRenderer, PcbInteractionIndex } from '../src/renderers.mjs'
import { GerberBenchmarkData } from './GerberBenchmarkData.mjs'
import { GerberLegacyProjectionBenchmarkAdapter } from './GerberLegacyProjectionBenchmarkAdapter.mjs'

/**
 * Defines reproducible Gerber parser, renderer, interaction, and clone workloads.
 */
export class GerberBenchmarkSuite {
    /**
     * Creates the complete immutable benchmark case catalog.
     * @returns {{ id: string, primary: boolean, size: string, workload: string, run: () => Promise<unknown> }[]} Benchmark cases.
     */
    static cases() {
        const archiveEntries = GerberBenchmarkData.archiveEntries()
        const interactionDocument = GerberBenchmarkData.interactionDocument()
        const interactionItems = PcbInteractionIndex.build(interactionDocument)
        const interactionQueries = GerberBenchmarkData.interactionQueries()
        const renderDocument = GerberBenchmarkData.renderDocument()
        const repeat = GerberBenchmarkData.stepRepeatInput()
        const small = GerberBenchmarkData.smallParserInput()
        const smallDocument = GerberBenchmarkData.smallDocument()
        const renderOptions = {
            renderMode: 'separated',
            layerIds: ['render-0', 'render-1']
        }
        return [
            {
                id: 'archive-parse-projection',
                primary: true,
                size: 'large',
                workload: 'legacy-generic-projection',
                fixtureChecksum: GerberBenchmarkSuite.#checksum(archiveEntries),
                run: async () => {
                    const result =
                        await GerberProjectLoader.loadEntries(archiveEntries)
                    return GerberLegacyProjectionBenchmarkAdapter.project(
                        result
                    )
                }
            },
            {
                id: 'mask-drill-hit-test',
                primary: true,
                size: 'large',
                workload: 'mask-drill-interaction',
                fixtureChecksum: GerberBenchmarkSuite.#checksum({
                    items: interactionItems,
                    queries: interactionQueries
                }),
                run: async () => {
                    let hitCount = 0
                    for (const query of interactionQueries) {
                        hitCount += PcbInteractionIndex.hitTestItems(
                            interactionItems,
                            query.point,
                            query.options
                        ).length
                    }
                    return { itemCount: interactionItems.length, hitCount }
                }
            },
            {
                id: 'step-repeat-large',
                primary: false,
                size: 'large',
                workload: 'step-repeat-parse',
                fixtureChecksum: GerberBenchmarkSuite.#checksum(repeat),
                run: async () =>
                    GerberParser.parseArrayBuffer(repeat.fileName, repeat.bytes)
            },
            {
                id: 'separated-render-large',
                primary: false,
                size: 'large',
                workload: 'separated-svg-render',
                fixtureChecksum: GerberBenchmarkSuite.#checksum({
                    document: renderDocument,
                    options: renderOptions
                }),
                run: async () =>
                    GerberPcbSvgRenderer.render(renderDocument, renderOptions)
            },
            {
                id: 'worker-clone-default',
                primary: false,
                size: 'large',
                workload: 'default-structured-clone',
                fixtureChecksum:
                    GerberBenchmarkSuite.#checksum(interactionDocument),
                run: async () => structuredClone(interactionDocument)
            },
            {
                id: 'parse-small',
                primary: false,
                size: 'small',
                workload: 'small-gerber-parse',
                fixtureChecksum: GerberBenchmarkSuite.#checksum(small),
                run: async () =>
                    GerberParser.parseArrayBuffer(small.fileName, small.bytes)
            },
            {
                id: 'render-small',
                primary: false,
                size: 'small',
                workload: 'small-svg-render',
                fixtureChecksum: GerberBenchmarkSuite.#checksum(smallDocument),
                run: async () => GerberPcbSvgRenderer.render(smallDocument)
            }
        ]
    }

    /**
     * Computes the deterministic checksum for all synthetic fixture semantics.
     * @returns {string} SHA-256 checksum.
     */
    static fixtureChecksum() {
        return GerberBenchmarkSuite.#checksum(
            GerberBenchmarkSuite.cases().map(({ id, fixtureChecksum }) => ({
                id,
                fixtureChecksum
            }))
        )
    }

    /**
     * Computes a stable checksum for one JSON-shaped fixture value.
     * @param {unknown} value Fixture value.
     * @returns {string} SHA-256 checksum.
     */
    static #checksum(value) {
        return createHash('sha256').update(JSON.stringify(value)).digest('hex')
    }
}
