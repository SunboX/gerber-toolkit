import assert from 'node:assert/strict'
import test from 'node:test'

import {
    GerberPcbSvgRenderer,
    PcbInteractionIndex,
    PcbInteractionLayerModel
} from '../src/renderers.mjs'

/**
 * Builds a normalized Gerber document for renderer tests.
 * @returns {object}
 */
function createDocument() {
    return {
        sourceFormat: 'gerber',
        kind: 'pcb',
        fileName: 'synthetic-fabrication',
        pcb: {
            bounds: { minX: 0, minY: 0, maxX: 10, maxY: 8 },
            fabrication: {
                renderMode: 'composite',
                layers: [
                    {
                        id: 'layer-1',
                        fileName: 'sample-F_Cu.gtl',
                        role: 'top-copper',
                        side: 'top',
                        primitives: [
                            {
                                type: 'flash',
                                shape: 'circle',
                                x: 2,
                                y: 3,
                                diameter: 1
                            }
                        ],
                        drills: []
                    },
                    {
                        id: 'layer-2',
                        fileName: 'sample-PTH.drl',
                        role: 'plated-drill',
                        side: 'both',
                        primitives: [],
                        drills: [
                            {
                                x: 5,
                                y: 4,
                                diameter: 0.8,
                                plated: true,
                                tool: 'T01'
                            }
                        ]
                    }
                ]
            }
        }
    }
}

/**
 * Builds a compact two-sided Gerber document for view tests.
 * @returns {object}
 */
function createTwoSideDocument() {
    const document = createDocument()
    document.pcb.fabrication.layers.push({
        id: 'layer-3',
        fileName: 'sample-B_Cu.gbl',
        role: 'bottom-copper',
        side: 'bottom',
        primitives: [
            {
                type: 'line',
                x1: 6,
                y1: 2,
                x2: 8,
                y2: 2,
                width: 0.5
            }
        ],
        drills: []
    })
    return document
}

/**
 * Builds a bottom silkscreen document with a long clockwise arc.
 * @returns {object}
 */
function createLongArcDocument() {
    const document = createDocument()
    document.pcb.bounds = { minX: 0, minY: -30, maxX: 30, maxY: 10 }
    document.pcb.fabrication.layers = [
        {
            id: 'bottom-silkscreen',
            fileName: 'sample-B_Silkscreen.gbo',
            role: 'bottom-silkscreen',
            side: 'bottom',
            primitives: [
                {
                    type: 'arc',
                    x1: 18,
                    y1: -10,
                    x2: 10,
                    y2: -10,
                    i: -4,
                    j: -10,
                    clockwise: true,
                    width: 0.2
                }
            ],
            drills: []
        }
    ]
    return document
}

test('GerberPcbSvgRenderer renders a composite fabrication stack', () => {
    const markup = GerberPcbSvgRenderer.render(createDocument())

    assert.match(markup, /^<svg /)
    assert.match(markup, /data-source-format="gerber"/)
    assert.match(markup, /data-render-mode="composite"/)
    assert.match(markup, /gerber-role-top-copper/)
    assert.match(markup, /gerber-role-plated-drill/)
})

test('GerberPcbSvgRenderer maps fabrication Y-up coordinates to SVG space', () => {
    const markup = GerberPcbSvgRenderer.render(createDocument())

    assert.match(markup, /viewBox="-2\.5 -1\.5 11\.9 9\.9"/)
    assert.match(
        markup,
        /<g class="gerber-coordinate-space" transform="translate\(0 6\.9\) scale\(1 -1\)">/
    )
    assert.match(markup, /<circle[^>]+cx="2" cy="3"/)
})

test('GerberPcbSvgRenderer centers the viewBox on rendered fabrication layers', () => {
    const document = createDocument()
    document.pcb.bounds = { minX: 0, minY: -40, maxX: 10, maxY: 8 }
    document.pcb.fabrication.layers.push({
        id: 'documentation-layer',
        fileName: 'sample-drawing.gbr',
        role: 'drill-map',
        side: 'both',
        isDocumentation: true,
        primitives: [
            {
                type: 'flash',
                shape: 'circle',
                x: 5,
                y: -40,
                diameter: 1
            }
        ],
        drills: []
    })

    const markup = GerberPcbSvgRenderer.render(document)

    assert.match(markup, /viewBox="-2\.5 -1\.5 11\.9 9\.9"/)
    assert.match(markup, /transform="translate\(0 6\.9\) scale\(1 -1\)"/)
})

test('GerberPcbSvgRenderer emits self-contained paint styles', () => {
    const markup = GerberPcbSvgRenderer.render(createDocument())

    assert.match(markup, /<style>/)
    assert.match(markup, /gerber-board-background[^>]*fill="none"/)
    assert.match(markup, /var\(--pcb-board-fill,#d8e8e4\)/)
    assert.match(
        markup,
        /var\(--pcb-surface-track-color,rgba\(199,82,45,0\.92\)\)/
    )
    assert.match(markup, /var\(--pcb-via-hole-fill,#0f746c\)/)
    assert.match(markup, /\.gerber-line/)
})

test('GerberPcbSvgRenderer maps active side to app palette classes', () => {
    const topMarkup = GerberPcbSvgRenderer.render(createTwoSideDocument(), {
        side: 'top'
    })
    const bottomMarkup = GerberPcbSvgRenderer.render(createTwoSideDocument(), {
        side: 'bottom'
    })

    assert.match(
        topMarkup,
        /gerber-role-top-copper pcb-copper pcb-copper--surface/
    )
    assert.match(
        topMarkup,
        /gerber-role-bottom-copper pcb-copper pcb-copper--subsurface/
    )
    assert.match(
        bottomMarkup,
        /gerber-role-top-copper pcb-copper pcb-copper--subsurface/
    )
    assert.match(
        bottomMarkup,
        /gerber-role-bottom-copper pcb-copper pcb-copper--surface/
    )
    assert.match(topMarkup, /class="gerber-primitive gerber-line pcb-track/)
    assert.match(topMarkup, /class="gerber-primitive gerber-flash[^"]* pcb-pad/)
    assert.match(topMarkup, /class="gerber-drill[^"]* pcb-via-drill/)
})

test('GerberPcbSvgRenderer lets track widths scale in board units', () => {
    const markup = GerberPcbSvgRenderer.render(createTwoSideDocument())

    assert.match(markup, /class="gerber-primitive gerber-line pcb-track/)
    assert.match(markup, /<line[^>]+stroke-width="0\.5"/)
    assert.doesNotMatch(
        markup,
        /\.gerber-primitive,\.gerber-macro-primitive\{vector-effect:non-scaling-stroke;\}/
    )
})

test('GerberPcbSvgRenderer preserves long arc sweeps from Gerber centers', () => {
    const markup = GerberPcbSvgRenderer.render(createLongArcDocument(), {
        side: 'bottom'
    })

    assert.match(markup, /viewBox="-0\.87033 -34\.87033 29\.740659 29\.740659"/)
    assert.match(markup, /<path[^>]+class="[^"]*gerber-arc/)
    assert.match(markup, /A 10\.77032961426901 10\.77032961426901 0 1 0 10 -10/)
})

test('GerberPcbSvgRenderer maps small drilled flashes to via rings', () => {
    const document = createDocument()
    document.pcb.fabrication.layers[0].primitives.push(
        {
            type: 'flash',
            shape: 'circle',
            x: 4,
            y: 4,
            diameter: 0.6
        },
        {
            type: 'flash',
            shape: 'circle',
            x: 6,
            y: 4,
            diameter: 1.8
        }
    )
    document.pcb.fabrication.layers[1].drills.push(
        {
            x: 4,
            y: 4,
            diameter: 0.3,
            plated: true,
            tool: 'T02'
        },
        {
            x: 6,
            y: 4,
            diameter: 0.8,
            plated: true,
            tool: 'T03'
        }
    )

    const markup = GerberPcbSvgRenderer.render(document)

    assert.match(
        markup,
        /<circle class="gerber-primitive gerber-flash gerber-flash-circle pcb-via gerber-polarity-dark"[^>]+cx="4" cy="4"/
    )
    assert.match(
        markup,
        /<circle class="gerber-primitive gerber-flash gerber-flash-circle pcb-pad gerber-polarity-dark"[^>]+cx="6" cy="4"/
    )
})

test('GerberPcbSvgRenderer mirrors bottom-side composite output', () => {
    const topMarkup = GerberPcbSvgRenderer.render(createTwoSideDocument(), {
        side: 'top'
    })
    const bottomMarkup = GerberPcbSvgRenderer.render(createTwoSideDocument(), {
        side: 'bottom'
    })

    assert.notEqual(bottomMarkup, topMarkup)
    assert.match(bottomMarkup, /data-render-side="bottom"/)
    assert.match(bottomMarkup, /transform="translate\([^"]+\) scale\(-1 -1\)"/)
})

test('GerberPcbSvgRenderer renders board fill from outline layers', () => {
    const document = createDocument()
    document.pcb.fabrication.layers.push({
        id: 'board-outline',
        fileName: 'sample-Edge_Cuts.gm1',
        role: 'board-outline',
        side: 'both',
        primitives: [
            { type: 'line', x1: 0, y1: 0, x2: 4, y2: 0, width: 0.1 },
            { type: 'line', x1: 4, y1: 0, x2: 4, y2: 3, width: 0.1 },
            { type: 'line', x1: 4, y1: 3, x2: 0, y2: 3, width: 0.1 },
            { type: 'line', x1: 0, y1: 3, x2: 0, y2: 0, width: 0.1 }
        ],
        drills: []
    })

    const markup = GerberPcbSvgRenderer.render(document)

    assert.match(
        markup,
        /<path class="gerber-board-fill pcb-board" d="M 0 0 L 4 0 L 4 3 L 0 3 L 0 0 Z"/
    )
    assert.match(markup, /fill-rule="evenodd"/)
})

test('GerberPcbSvgRenderer renders one separated source layer', () => {
    const markup = GerberPcbSvgRenderer.render(createDocument(), {
        renderMode: 'separated',
        layerId: 'layer-2'
    })

    assert.match(markup, /data-render-mode="separated"/)
    assert.match(markup, /gerber-role-plated-drill/)
    assert.doesNotMatch(
        markup,
        /<g class="gerber-layer gerber-role-top-copper"/
    )
})

test('GerberPcbSvgRenderer renders selected source layers together', () => {
    const markup = GerberPcbSvgRenderer.render(createTwoSideDocument(), {
        renderMode: 'separated',
        layerIds: ['layer-1', 'layer-3']
    })

    assert.match(markup, /data-render-mode="separated"/)
    assert.match(markup, /gerber-role-top-copper/)
    assert.match(markup, /gerber-role-bottom-copper/)
    assert.doesNotMatch(markup, /gerber-role-plated-drill/)
})

test('PcbInteractionIndex filters selected Gerber source layers together', () => {
    const items = PcbInteractionIndex.build(createTwoSideDocument(), {
        renderMode: 'separated',
        layerIds: ['layer-1', 'layer-3']
    })

    assert.equal(items.length, 2)
    assert.deepEqual(
        items.map((item) => item.layerId),
        ['layer-1', 'layer-3']
    )
})

test('Gerber renderer helpers expose layer metadata and hit-test items', () => {
    const document = createDocument()
    const layers = PcbInteractionLayerModel.resolve(document)
    const items = PcbInteractionIndex.build(document)

    assert.equal(layers.physicalLayers.length, 2)
    assert.equal(layers.virtualLayers.length, 1)
    assert.equal(items.length, 2)
    assert.equal(items[0].sourceFormat, 'gerber')
})
