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
        const renderDocument = GerberBenchmarkData.renderDocument()
        const repeat = GerberBenchmarkData.stepRepeatInput()
        const small = GerberBenchmarkData.smallParserInput()
        const smallDocument = GerberBenchmarkData.smallDocument()
        return [
            {
                id: 'archive-parse-projection',
                primary: true,
                size: 'large',
                workload: 'legacy-generic-projection',
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
                run: async () => {
                    let hitCount = 0
                    for (let index = 0; index < 180; index += 1) {
                        const x = (index % 60) * 0.5 + 0.15
                        const y = Math.floor(index / 60) * 0.5
                        hitCount += PcbInteractionIndex.hitTestItems(
                            interactionItems,
                            { x, y },
                            { tolerance: 0.05 }
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
                run: async () =>
                    GerberParser.parseArrayBuffer(repeat.fileName, repeat.bytes)
            },
            {
                id: 'separated-render-large',
                primary: false,
                size: 'large',
                workload: 'separated-svg-render',
                run: async () =>
                    GerberPcbSvgRenderer.render(renderDocument, {
                        renderMode: 'separated',
                        layerIds: ['render-0', 'render-1']
                    })
            },
            {
                id: 'worker-clone-default',
                primary: false,
                size: 'large',
                workload: 'default-structured-clone',
                run: async () => structuredClone(interactionDocument)
            },
            {
                id: 'parse-small',
                primary: false,
                size: 'small',
                workload: 'small-gerber-parse',
                run: async () =>
                    GerberParser.parseArrayBuffer(small.fileName, small.bytes)
            },
            {
                id: 'render-small',
                primary: false,
                size: 'small',
                workload: 'small-svg-render',
                run: async () => GerberPcbSvgRenderer.render(smallDocument)
            }
        ]
    }

    /**
     * Computes the deterministic checksum for all synthetic fixture semantics.
     * @returns {string} SHA-256 checksum.
     */
    static fixtureChecksum() {
        return createHash('sha256')
            .update(JSON.stringify(GerberBenchmarkData.fixtureDescriptor()))
            .digest('hex')
    }
}
