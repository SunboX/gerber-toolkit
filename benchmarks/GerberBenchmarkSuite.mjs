import { createHash } from 'node:crypto'

import { GerberParser } from '../src/legacy-parser.mjs'
import {
    GerberPcbSvgRenderer,
    PcbInteractionIndex
} from '../src/legacy-renderers.mjs'
import { GerberBenchmarkData } from './GerberBenchmarkData.mjs'
import { GerberBenchmarkWorkloads } from './GerberBenchmarkWorkloads.mjs'

const STRUCTURAL_CHECKSUMS = Object.freeze({
    archive: '51d74710d2699af3982f923c94c91a34146d9eca3f9cb08543987f71c616290a',
    currentArchive:
        '8ede57443600338ed9e47ea1672d98bd661ce57750211442b625127253510eb0',
    hitTest: '4909cfcf2ba7e1060cada21b0932da63914e7d1f5be463c9df33b68533587b08',
    currentHitTest:
        '1c5eacc1903dbc06018c8128020c492e8d37e2dfef9e7c9402c85a6ccc81ec4e',
    repeat: '77d49e9c381212f4c35c86c4a6ebd8b937a1245f6af8065807eb6c45aaae1891',
    render: '006ec0bab3b85c723baf9bd47581d2e0a20a578bc06834d37ee5252b4784d3a3',
    baselineClone:
        'e05b9b3e9a29eb3b0bd40d4c3a42f805779eea699f6555fc708450df38f18acf',
    currentClone:
        'a02f0bb282dfc7c7f1d686e6d2c4e24b6882db271ab6a258110f4ccb7026fced',
    smallParse:
        '93c6eea8c928ebb92e72a03237866c5dac70a36ad2d341c7db948a450b2ce5f6',
    smallRender:
        'deb0a12d569b8dc6f2eee52772b1623122581c857b94d9636ae05f854b381a90'
})

/**
 * Defines reproducible Gerber parser, renderer, interaction, and clone workloads.
 */
export class GerberBenchmarkSuite {
    /**
     * Creates the benchmark catalog for a current or frozen baseline profile.
     * @param {{ profile?: 'baseline' | 'current', workloads?: Readonly<Record<string, Function>> }} [options] Workload profile.
     * @returns {{ id: string, primary: boolean, size: string, workload: string, fixtureChecksum: string, expectedStructuralChecksum: string, prepare?: () => Promise<unknown> | unknown, run: (prepared?: unknown) => Promise<unknown> }[]} Benchmark cases.
     */
    static cases(options = {}) {
        const profile = GerberBenchmarkSuite.#profile(options.profile)
        const workloads =
            options.workloads || GerberBenchmarkSuite.#workloads(profile)
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
        const defaultContext = { defaultDocument: interactionDocument }
        const defaultFixture =
            profile === 'baseline' ? interactionDocument : archiveEntries
        const defaultChecksum =
            profile === 'baseline'
                ? STRUCTURAL_CHECKSUMS.baselineClone
                : STRUCTURAL_CHECKSUMS.currentClone
        return [
            {
                id: 'archive-parse-projection',
                primary: true,
                size: 'large',
                workload:
                    profile === 'baseline'
                        ? 'legacy-generic-projection'
                        : 'canonical-project-model',
                fixtureChecksum: GerberBenchmarkSuite.#checksum(archiveEntries),
                expectedStructuralChecksum:
                    profile === 'baseline'
                        ? STRUCTURAL_CHECKSUMS.archive
                        : STRUCTURAL_CHECKSUMS.currentArchive,
                run: async () => workloads.archiveProjection(archiveEntries)
            },
            {
                id: 'mask-drill-hit-test',
                primary: true,
                size: 'large',
                workload:
                    profile === 'baseline'
                        ? 'mask-drill-interaction'
                        : 'canonical-circuitjson-interaction',
                fixtureChecksum: GerberBenchmarkSuite.#checksum({
                    items: interactionItems,
                    queries: interactionQueries
                }),
                expectedStructuralChecksum:
                    profile === 'baseline'
                        ? STRUCTURAL_CHECKSUMS.hitTest
                        : STRUCTURAL_CHECKSUMS.currentHitTest,
                prepare: async () =>
                    workloads.createInteractionIndex(interactionDocument),
                run: async (prepared) => {
                    const index =
                        prepared === undefined
                            ? await workloads.createInteractionIndex(
                                  interactionDocument
                              )
                            : prepared
                    let hitCount = 0
                    for (const query of interactionQueries) {
                        const hits = workloads.hitTest(index, query)
                        if (!Array.isArray(hits)) {
                            throw new TypeError(
                                'Gerber hit-test workload must return an array.'
                            )
                        }
                        hitCount += hits.length
                    }
                    return { itemCount: index.itemCount, hitCount }
                }
            },
            {
                id: 'step-repeat-large',
                primary: false,
                size: 'large',
                workload: 'step-repeat-parse',
                fixtureChecksum: GerberBenchmarkSuite.#checksum(repeat),
                expectedStructuralChecksum: STRUCTURAL_CHECKSUMS.repeat,
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
                expectedStructuralChecksum: STRUCTURAL_CHECKSUMS.render,
                run: async () =>
                    GerberPcbSvgRenderer.render(renderDocument, renderOptions)
            },
            {
                id: 'worker-clone-default',
                primary: false,
                size: 'large',
                workload:
                    profile === 'baseline'
                        ? 'default-structured-clone'
                        : 'canonical-project-structured-clone',
                fixtureChecksum: GerberBenchmarkSuite.#checksum(defaultFixture),
                expectedStructuralChecksum: defaultChecksum,
                prepare: async () =>
                    workloads.defaultResult(archiveEntries, defaultContext),
                run: async (prepared) => {
                    const value =
                        prepared === undefined
                            ? await workloads.defaultResult(
                                  archiveEntries,
                                  defaultContext
                              )
                            : prepared
                    return structuredClone(value)
                }
            },
            {
                id: 'parse-small',
                primary: false,
                size: 'small',
                workload: 'small-gerber-parse',
                fixtureChecksum: GerberBenchmarkSuite.#checksum(small),
                expectedStructuralChecksum: STRUCTURAL_CHECKSUMS.smallParse,
                run: async () =>
                    GerberParser.parseArrayBuffer(small.fileName, small.bytes)
            },
            {
                id: 'render-small',
                primary: false,
                size: 'small',
                workload: 'small-svg-render',
                fixtureChecksum: GerberBenchmarkSuite.#checksum(smallDocument),
                expectedStructuralChecksum: STRUCTURAL_CHECKSUMS.smallRender,
                run: async () => GerberPcbSvgRenderer.render(smallDocument)
            }
        ]
    }

    /**
     * Creates the trusted comparison contract for one profile.
     * @param {{ profile?: 'baseline' | 'current', workloads?: Readonly<Record<string, Function>> }} [options] Workload profile.
     * @returns {{ id: string, primary: boolean, size: string, workload: string, fixtureChecksum: string, structuralChecksum: string }[]} Case contracts.
     */
    static contract(options = {}) {
        return GerberBenchmarkSuite.cases(options).map(
            ({
                id,
                primary,
                size,
                workload,
                fixtureChecksum,
                expectedStructuralChecksum
            }) => ({
                id,
                primary,
                size,
                workload,
                fixtureChecksum,
                structuralChecksum: expectedStructuralChecksum
            })
        )
    }

    /**
     * Computes the deterministic fixture checksum for one profile.
     * @param {{ profile?: 'baseline' | 'current', workloads?: Readonly<Record<string, Function>> }} [options] Workload profile.
     * @returns {string} SHA-256 checksum.
     */
    static fixtureChecksum(options = {}) {
        return GerberBenchmarkSuite.#checksum(
            GerberBenchmarkSuite.cases(options).map(
                ({ id, fixtureChecksum }) => ({ id, fixtureChecksum })
            )
        )
    }

    /**
     * Validates one workload profile name.
     * @param {unknown} value Profile candidate.
     * @returns {'baseline' | 'current'} Profile name.
     */
    static #profile(value) {
        const profile = value === undefined ? 'baseline' : value
        if (profile !== 'baseline' && profile !== 'current') {
            throw new TypeError(`Unknown Gerber benchmark profile: ${profile}`)
        }
        return profile
    }

    /**
     * Creates the default workloads for one profile.
     * @param {'baseline' | 'current'} profile Profile name.
     * @returns {Readonly<Record<string, Function>>} Workload implementations.
     */
    static #workloads(profile) {
        return profile === 'baseline'
            ? GerberBenchmarkWorkloads.baseline()
            : GerberBenchmarkWorkloads.current()
    }

    /**
     * Computes a stable checksum for one JSON-shaped value.
     * @param {unknown} value JSON-shaped value.
     * @returns {string} SHA-256 checksum.
     */
    static #checksum(value) {
        return createHash('sha256').update(JSON.stringify(value)).digest('hex')
    }
}
