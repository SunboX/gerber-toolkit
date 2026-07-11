import assert from 'node:assert/strict'
import test from 'node:test'

import { PcbInteractionIndex } from '../src/legacy-renderers.mjs'

test('PcbInteractionIndex preserves mask drill route and slot bounds', () => {
    const document = {
        pcb: {
            fabrication: {
                layers: [
                    {
                        id: 'top-mask',
                        role: 'top-soldermask',
                        primitives: [
                            {
                                type: 'flash',
                                x: 1,
                                y: 2,
                                diameter: 2
                            }
                        ],
                        drills: []
                    },
                    {
                        id: 'top-copper',
                        role: 'top-copper',
                        primitives: [
                            {
                                type: 'line',
                                x1: 4,
                                y1: 5,
                                x2: 8,
                                y2: 5,
                                width: 0.4
                            }
                        ],
                        drills: []
                    },
                    {
                        id: 'drill',
                        role: 'plated-drill',
                        primitives: [],
                        drills: [
                            { x: 10, y: 10, diameter: 1 },
                            {
                                type: 'slot',
                                x1: 12,
                                y1: 10,
                                x2: 14,
                                y2: 10,
                                diameter: 0.6
                            }
                        ]
                    }
                ]
            }
        }
    }

    const items = PcbInteractionIndex.build(document)

    assert.deepEqual(
        items.map((item) => item.kind),
        ['flash', 'line', 'drill', 'slot']
    )
    assert.deepEqual(
        items.map((item) => item.bounds),
        [
            { minX: 0, minY: 1, maxX: 2, maxY: 3 },
            { minX: 3.8, minY: 4.8, maxX: 8.2, maxY: 5.2 },
            { minX: 9.5, minY: 9.5, maxX: 10.5, maxY: 10.5 },
            { minX: 11.7, minY: 9.7, maxX: 14.3, maxY: 10.3 }
        ]
    )

    const hits = PcbInteractionIndex.hitTestItems(
        items,
        { x: 13, y: 10 },
        { tolerance: 0.01 }
    )
    assert.deepEqual(
        hits.map((item) => item.kind),
        ['slot']
    )
})
