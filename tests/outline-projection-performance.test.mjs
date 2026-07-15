import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import test from 'node:test'

import { GerberCircuitJsonOutlineProjector } from '../src/convergence/GerberCircuitJsonOutlineProjector.mjs'
import { ProjectLoader } from '../src/project.mjs'

const SAMPLE_COUNTS = [8_000, 16_000]

/**
 * Builds one densely segmented, source-continuous mechanical profile.
 * @param {number} count Segment count.
 * @returns {string} Synthetic Gerber source.
 */
function denseProfile(count) {
    const coordinate = (value) =>
        String(Math.round(value * 10_000)).padStart(10, '0')
    const rows = ['%FSLAX46Y46*%', '%MOMM*%', '%ADD10C,0.100*%', 'D10*']
    for (let index = 0; index <= count; index += 1) {
        const angle = (2 * Math.PI * (index % count)) / count
        rows.push(
            `X${coordinate(50 + 40 * Math.cos(angle))}Y${coordinate(50 + 40 * Math.sin(angle))}D${index === 0 ? '02' : '01'}*`
        )
    }
    rows.push('M02*')
    return rows.join('\n')
}

/**
 * Measures one complete parse and canonical projection.
 * @param {string} source Gerber source.
 * @returns {number} Elapsed milliseconds.
 */
function measureProjection(source) {
    const start = performance.now()
    const project = ProjectLoader.load([
        { name: 'dense-profile.gm1', data: source }
    ])
    assert.equal(
        project.documents[0].model.filter(
            (element) => element.type === 'pcb_board'
        ).length,
        1
    )
    return performance.now() - start
}

/**
 * Returns the median of one numeric sample set.
 * @param {number[]} samples Samples.
 * @returns {number} Median sample.
 */
function median(samples) {
    const ordered = [...samples].sort((left, right) => left - right)
    return ordered[Math.floor(ordered.length / 2)]
}

test(
    'large source-continuous outlines avoid quadratic chain assembly',
    { timeout: 15_000 },
    () => {
        const sources = new Map(
            SAMPLE_COUNTS.map((count) => [count, denseProfile(count)])
        )
        const samples = new Map(SAMPLE_COUNTS.map((count) => [count, []]))

        for (const count of SAMPLE_COUNTS) {
            measureProjection(sources.get(count))
        }
        for (let iteration = 0; iteration < 3; iteration += 1) {
            const order =
                iteration % 2 === 0
                    ? SAMPLE_COUNTS
                    : [...SAMPLE_COUNTS].reverse()
            for (const count of order) {
                samples.get(count).push(measureProjection(sources.get(count)))
            }
        }

        const small = median(samples.get(SAMPLE_COUNTS[0]))
        const large = median(samples.get(SAMPLE_COUNTS[1]))
        assert.ok(
            large < small * 3.25,
            `doubling segments took ${large.toFixed(1)} ms after ${small.toFixed(1)} ms`
        )
    }
)

test(
    'very large connected outlines flatten without argument overflow',
    { timeout: 15_000 },
    () => {
        const count = 140_000
        const primitives = Array.from({ length: count }, (_, index) => {
            const startAngle = (2 * Math.PI * index) / count
            const endAngle = (2 * Math.PI * (index + 1)) / count
            return {
                type: 'line',
                x1: 50 + 40 * Math.cos(startAngle),
                y1: 50 + 40 * Math.sin(startAngle),
                x2: 50 + 40 * Math.cos(endAngle),
                y2: 50 + 40 * Math.sin(endAngle),
                width: 0.1,
                polarity: 'dark',
                sourcePathId: 'dense-outline'
            }
        })
        const projected = GerberCircuitJsonOutlineProjector.project([
            {
                role: 'board-outline',
                primitives
            }
        ])

        assert.equal(projected.boards.length, 1)
        assert.equal(projected.cutouts.length, 0)
    }
)
