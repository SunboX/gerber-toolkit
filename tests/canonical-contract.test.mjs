import assert from 'node:assert/strict'
import test from 'node:test'

import * as sharedToolkit from 'circuitjson-toolkit'
import {
    ToolkitContractFixtures,
    runToolkitContract
} from 'circuitjson-toolkit/testing'

import * as toolkit from '../src/index.mjs'

test('Gerber root exposes the exact shared toolkit surface', () => {
    assert.deepEqual(
        Object.keys(toolkit).sort(),
        Object.keys(sharedToolkit).sort()
    )
})

test('Gerber package passes the shared observable toolkit contract', async () => {
    const report = await runToolkitContract(toolkit, {
        fixtures: ToolkitContractFixtures.gerber()
    })

    assert.equal(report.schema, 'ecad-toolkit.contract-report.v1')
    assert.deepEqual(report.failures, [])
    assert.equal(
        report.checks.every((row) => row.status === 'passed'),
        true
    )
})
