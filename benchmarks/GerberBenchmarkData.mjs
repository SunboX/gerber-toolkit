import { createHash } from 'node:crypto'

import { strToU8, zipSync } from 'fflate'

const ARCHIVE_LINE_COUNT = 700
const INTERACTION_ITEM_COUNT = 1200
const RENDER_PRIMITIVE_COUNT = 900
const STEP_REPEAT_AXIS_COUNT = 34

/**
 * Builds deterministic synthetic Gerber benchmark inputs.
 */
export class GerberBenchmarkData {
    /**
     * Creates one synthetic ZIP fabrication entry.
     * @returns {{ name: string, bytes: Uint8Array }[]} Project-loader entries.
     */
    static archiveEntries() {
        const files = {
            'synthetic-F_Cu.gtl': strToU8(
                GerberBenchmarkData.#lineGerber(ARCHIVE_LINE_COUNT, 0)
            ),
            'synthetic-B_Cu.gbl': strToU8(
                GerberBenchmarkData.#lineGerber(ARCHIVE_LINE_COUNT, 17)
            ),
            'synthetic-Edge_Cuts.gm1': strToU8(
                GerberBenchmarkData.#outlineGerber()
            ),
            'synthetic-PTH.drl': strToU8(GerberBenchmarkData.#drillFile(240))
        }
        return [
            {
                name: 'synthetic-fabrication.zip',
                bytes: zipSync(files, {
                    level: 6,
                    mtime: new Date(1980, 0, 1)
                })
            }
        ]
    }

    /**
     * Creates a large step-repeat Gerber source.
     * @returns {{ fileName: string, bytes: Uint8Array }} Parser input.
     */
    static stepRepeatInput() {
        const count = STEP_REPEAT_AXIS_COUNT
        const source = [
            '%FSLAX24Y24*%',
            '%MOMM*%',
            '%ADD10C,0.500*%',
            'D10*',
            `%SRX${count}Y${count}I0.500J0.500*%`,
            'X010000Y010000D03*',
            '%SR*%',
            'M02*'
        ].join('\n')
        return {
            fileName: 'synthetic-repeat.gtl',
            bytes: new TextEncoder().encode(source)
        }
    }

    /**
     * Creates a large document for mask/drill interaction work.
     * @returns {Record<string, any>} Legacy Gerber document.
     */
    static interactionDocument() {
        const copper = []
        const mask = []
        const drills = []
        for (let index = 0; index < INTERACTION_ITEM_COUNT; index += 1) {
            const x = (index % 60) * 0.5
            const y = Math.floor(index / 60) * 0.5
            copper.push({
                type: 'line',
                x1: x,
                y1: y,
                x2: x + 0.35,
                y2: y,
                width: 0.18,
                polarity: 'dark'
            })
            if (index % 3 === 0) {
                mask.push({
                    type: 'flash',
                    shape: 'circle',
                    x: x + 0.15,
                    y,
                    diameter: 0.42,
                    polarity: 'dark'
                })
            }
            if (index % 2 === 0) {
                drills.push({
                    type: 'drill',
                    x: x + 0.15,
                    y,
                    diameter: 0.25,
                    plated: index % 4 === 0,
                    tool: 'T01'
                })
            }
        }
        return GerberBenchmarkData.#document('synthetic-interaction', [
            GerberBenchmarkData.#layer(
                'top-copper',
                'synthetic-F_Cu.gtl',
                'top-copper',
                'top',
                copper,
                []
            ),
            GerberBenchmarkData.#layer(
                'top-mask',
                'synthetic-F_Mask.gts',
                'top-soldermask',
                'top',
                mask,
                []
            ),
            GerberBenchmarkData.#layer(
                'drill',
                'synthetic-PTH.drl',
                'plated-drill',
                'both',
                [],
                drills
            )
        ])
    }

    /**
     * Creates every point and tolerance used by the hit-test benchmark.
     * @returns {{ point: { x: number, y: number }, options: { tolerance: number } }[]} Hit-test queries.
     */
    static interactionQueries() {
        return Array.from({ length: 180 }, (_, index) => ({
            point: {
                x: (index % 60) * 0.5 + 0.15,
                y: Math.floor(index / 60) * 0.5
            },
            options: { tolerance: 0.05 }
        }))
    }

    /**
     * Creates a large multi-layer separated-render document.
     * @returns {Record<string, any>} Legacy Gerber document.
     */
    static renderDocument() {
        const layers = []
        for (let layerIndex = 0; layerIndex < 4; layerIndex += 1) {
            const primitives = []
            for (let index = 0; index < RENDER_PRIMITIVE_COUNT; index += 1) {
                const x = (index % 45) * 0.6
                const y = Math.floor(index / 45) * 0.6
                primitives.push({
                    type: 'line',
                    x1: x,
                    y1: y,
                    x2: x + 0.45,
                    y2: y + (index % 2 ? 0.2 : 0),
                    width: 0.16 + layerIndex * 0.01,
                    polarity: index % 11 === 0 ? 'clear' : 'dark'
                })
            }
            const side = layerIndex % 2 === 0 ? 'top' : 'bottom'
            layers.push(
                GerberBenchmarkData.#layer(
                    `render-${layerIndex}`,
                    `synthetic-layer-${layerIndex}.gbr`,
                    `${side}-copper`,
                    side,
                    primitives,
                    []
                )
            )
        }
        return GerberBenchmarkData.#document('synthetic-render', layers)
    }

    /**
     * Creates a compact parsed-document fixture with line and drill geometry.
     * @returns {Record<string, any>} Legacy Gerber document.
     */
    static smallDocument() {
        return GerberBenchmarkData.#document('synthetic-small', [
            GerberBenchmarkData.#layer(
                'small-copper',
                'synthetic-small.gtl',
                'top-copper',
                'top',
                [
                    {
                        type: 'line',
                        x1: 0,
                        y1: 0,
                        x2: 2,
                        y2: 0,
                        width: 0.2,
                        polarity: 'dark'
                    }
                ],
                [
                    {
                        type: 'drill',
                        x: 1,
                        y: 0,
                        diameter: 0.3,
                        plated: false,
                        tool: 'T01'
                    }
                ]
            )
        ])
    }

    /**
     * Creates one compact parser input.
     * @returns {{ fileName: string, bytes: Uint8Array }} Parser input.
     */
    static smallParserInput() {
        return {
            fileName: 'synthetic-small.gtl',
            bytes: new TextEncoder().encode(
                GerberBenchmarkData.#lineGerber(8, 0)
            )
        }
    }

    /**
     * Returns the structural descriptor used for the fixture checksum.
     * @returns {Record<string, any>} Deterministic fixture descriptor.
     */
    static fixtureDescriptor() {
        const archive = GerberBenchmarkData.archiveEntries()[0].bytes
        const repeat = GerberBenchmarkData.stepRepeatInput().bytes
        return {
            schema: 'gerber-toolkit.benchmark-fixtures.v1',
            archiveLineCount: ARCHIVE_LINE_COUNT,
            interactionItemCount: INTERACTION_ITEM_COUNT,
            renderPrimitiveCount: RENDER_PRIMITIVE_COUNT,
            stepRepeatAxisCount: STEP_REPEAT_AXIS_COUNT,
            archiveChecksum: GerberBenchmarkData.#checksum(archive),
            stepRepeatChecksum: GerberBenchmarkData.#checksum(repeat)
        }
    }

    /**
     * Creates one normalized legacy Gerber document.
     * @param {string} fileName Synthetic source label.
     * @param {Record<string, any>[]} layers Fabrication layers.
     * @returns {Record<string, any>} Legacy document.
     */
    static #document(fileName, layers) {
        const bounds = GerberBenchmarkData.#bounds(layers)
        return {
            sourceFormat: 'gerber',
            kind: 'pcb',
            fileName,
            pcb: {
                bounds,
                boardOutline: [],
                components: [],
                fabrication: { renderMode: 'composite', layers }
            },
            bom: [],
            diagnostics: []
        }
    }

    /**
     * Creates one fabrication layer and derives its bounds.
     * @param {string} id Layer id.
     * @param {string} fileName Layer file name.
     * @param {string} role Layer role.
     * @param {string} side Layer side.
     * @param {Record<string, any>[]} primitives Gerber primitives.
     * @param {Record<string, any>[]} drills Excellon drills.
     * @returns {Record<string, any>} Fabrication layer.
     */
    static #layer(id, fileName, role, side, primitives, drills) {
        return {
            id,
            fileName,
            role,
            side,
            unit: 'mm',
            primitives,
            drills,
            diagnostics: [],
            attributes: {},
            bounds: GerberBenchmarkData.#bounds([{ primitives, drills }])
        }
    }

    /**
     * Resolves conservative bounds for synthetic layers.
     * @param {Record<string, any>[]} layers Fabrication layers.
     * @returns {{ minX: number, minY: number, maxX: number, maxY: number }} Bounds.
     */
    static #bounds(layers) {
        const points = []
        for (const layer of layers) {
            for (const primitive of layer.primitives || []) {
                for (const key of ['x', 'x1', 'x2']) {
                    if (Number.isFinite(primitive[key])) {
                        points.push({ axis: 'x', value: primitive[key] })
                    }
                }
                for (const key of ['y', 'y1', 'y2']) {
                    if (Number.isFinite(primitive[key])) {
                        points.push({ axis: 'y', value: primitive[key] })
                    }
                }
            }
            for (const drill of layer.drills || []) {
                for (const key of ['x', 'x1', 'x2']) {
                    if (Number.isFinite(drill[key])) {
                        points.push({ axis: 'x', value: drill[key] })
                    }
                }
                for (const key of ['y', 'y1', 'y2']) {
                    if (Number.isFinite(drill[key])) {
                        points.push({ axis: 'y', value: drill[key] })
                    }
                }
            }
        }
        const x = points
            .filter((point) => point.axis === 'x')
            .map((point) => point.value)
        const y = points
            .filter((point) => point.axis === 'y')
            .map((point) => point.value)
        return {
            minX: x.length ? Math.min(...x) : 0,
            minY: y.length ? Math.min(...y) : 0,
            maxX: x.length ? Math.max(...x) : 1,
            maxY: y.length ? Math.max(...y) : 1
        }
    }

    /**
     * Builds a deterministic line-heavy Gerber file.
     * @param {number} count Draw command count.
     * @param {number} offset Coordinate offset.
     * @returns {string} Gerber source.
     */
    static #lineGerber(count, offset) {
        const commands = [
            '%FSLAX24Y24*%',
            '%MOMM*%',
            '%ADD10C,0.200*%',
            'D10*',
            'X000000Y000000D02*'
        ]
        for (let index = 0; index < count; index += 1) {
            const x = ((index + offset) % 90) * 1000
            const y = Math.floor(index / 90) * 1000
            commands.push(
                `X${String(x).padStart(6, '0')}Y${String(y).padStart(6, '0')}D01*`
            )
        }
        commands.push('M02*')
        return commands.join('\n')
    }

    /**
     * Builds one synthetic rectangular board outline.
     * @returns {string} Gerber source.
     */
    static #outlineGerber() {
        return [
            '%FSLAX24Y24*%',
            '%MOMM*%',
            '%ADD10C,0.100*%',
            'D10*',
            'X000000Y000000D02*',
            'X300000Y000000D01*',
            'X300000Y200000D01*',
            'X000000Y200000D01*',
            'X000000Y000000D01*',
            'M02*'
        ].join('\n')
    }

    /**
     * Builds one deterministic Excellon file.
     * @param {number} count Drill hit count.
     * @returns {string} Excellon source.
     */
    static #drillFile(count) {
        const commands = ['M48', 'METRIC,TZ', 'T01C0.300', '%', 'T01']
        for (let index = 0; index < count; index += 1) {
            const x = (index % 40) * 500
            const y = Math.floor(index / 40) * 500
            commands.push(
                `X${String(x).padStart(6, '0')}Y${String(y).padStart(6, '0')}`
            )
        }
        commands.push('M30')
        return commands.join('\n')
    }

    /**
     * Computes a byte-oriented SHA-256 checksum.
     * @param {Uint8Array} bytes Fixture bytes.
     * @returns {string} Hex checksum.
     */
    static #checksum(bytes) {
        return createHash('sha256').update(bytes).digest('hex')
    }
}
