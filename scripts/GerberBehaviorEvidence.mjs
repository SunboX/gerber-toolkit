import { parsers } from 'prettier/plugins/babel'

import { GerberFeatureEvidence } from './GerberFeatureEvidence.mjs'

const ANALYSIS_CACHE = new Map()
const MATCHERS = Object.freeze({
    'parser-gerber-structures-v1': Object.freeze({
        requirements: [
            requirement(
                'GerberParser',
                'parseArrayBuffer',
                [
                    /flash\.shape\s*,\s*['"]macro/u,
                    /layer\.primitives\.length\s*,\s*4/u,
                    /attributes\.object/u,
                    /\.polarity\s*,\s*['"]clear/u,
                    /\.transform/u
                ],
                [],
                ['pcb.fabrication.layers']
            )
        ]
    }),
    'parser-excellon-routes-v1': Object.freeze({
        requirements: [
            requirement(
                'GerberParser',
                'parseArrayBuffer',
                [
                    /layer\.drills\.length\s*,\s*2/u,
                    /layer\.drills\[1\][\s\S]*type:\s*['"]slot/u,
                    /layer\.drills\[1\][\s\S]*tool:\s*['"]T01/u
                ],
                [],
                ['pcb.fabrication.layers']
            )
        ]
    }),
    'project-zip-expansion-v1': Object.freeze({
        requirements: [
            requirement(
                'GerberProjectLoader',
                'loadEntries',
                [
                    /result\.documents\.length\s*,\s*1/u,
                    /result\.documents\[0\]\.pcb\.fabrication\.layers\.length\s*,\s*2/u,
                    /result\.assets\.length\s*,\s*0/u
                ],
                ['zipSync'],
                ['documents', 'assets']
            )
        ]
    }),
    'renderer-composite-separated-v1': Object.freeze({
        requirements: [
            requirement('GerberPcbSvgRenderer', 'render', [
                /data-render-mode=[\\"]*composite/u,
                /data-render-mode=[\\"]*separated/u
            ]),
            requirement('GerberPcbSvgRenderer', 'render', [
                /data-polarity=[\\"]*clear/u
            ])
        ]
    }),
    'interaction-mask-drill-route-v1': Object.freeze({
        requirements: [
            requirement('PcbInteractionIndex', 'build', [
                /items\.map\(\(item\)\s*=>\s*item\.kind\)[\s\S]*['"]flash['"][\s\S]*['"]line['"][\s\S]*['"]drill['"][\s\S]*['"]slot['"]/u,
                /items\.map\(\(item\)\s*=>\s*item\.bounds\)[\s\S]*minX:\s*0[\s\S]*minX:\s*3\.8[\s\S]*minX:\s*9\.5[\s\S]*minX:\s*11\.7/u
            ]),
            requirement('PcbInteractionIndex', 'hitTestItems', [
                /hits\.map\(\(item\)\s*=>\s*item\.kind\)[\s\S]*['"]slot['"]/u
            ])
        ]
    }),
    'scene-bare-board-v1': Object.freeze({
        requirements: [
            requirement(
                'PcbScene3dBuilder',
                'build',
                [
                    /scene\.components\.length\s*,\s*0/u,
                    /scene\.boardAssemblyModel\s*,\s*null/u,
                    /scene\.externalModels\s*,\s*\[\]/u
                ],
                [],
                ['board', 'components', 'externalModels', 'boardAssemblyModel']
            )
        ]
    })
})

/**
 * Validates explicitly named historical behavior-evidence contracts.
 */
export class GerberBehaviorEvidence {
    /**
     * Returns the JSON-shaped immutable contract behind one matcher id.
     * @param {string} matcher Stable matcher id.
     * @returns {Record<string, any> | null} Matcher contract.
     */
    static contract(matcher) {
        const definition = MATCHERS[matcher]
        if (!definition) return null
        return {
            requirements: definition.requirements.map((required) => ({
                exportName: required.exportName,
                methodName: required.methodName,
                assertions: required.assertions.map((pattern) => ({
                    source: pattern.source,
                    flags: pattern.flags
                })),
                calls: [...required.calls],
                resultPaths: [...required.resultPaths]
            }))
        }
    }

    /**
     * Checks whether pinned sources satisfy every clause of one stable matcher.
     * @param {string} matcher Stable matcher id.
     * @param {string[]} sources Historical test sources.
     * @returns {boolean} Whether behavior-specific evidence is complete.
     */
    static matches(matcher, sources) {
        const definition = MATCHERS[matcher]
        if (!definition || !Array.isArray(sources) || !sources.length) {
            return false
        }
        const analyses = sources.map((source) => analyze(source))
        return definition.requirements.every((required) =>
            analyses.some(
                ({ source, assertions, calls }) =>
                    GerberFeatureEvidence.invocationMatches(required, source) &&
                    required.calls.every((call) => calls.has(call)) &&
                    required.resultPaths.every((name) =>
                        GerberFeatureEvidence.resultPathMatches(
                            {
                                exportName: required.exportName,
                                methodName: required.methodName,
                                sourceContract: {
                                    type: 'result-field',
                                    name
                                }
                            },
                            source
                        )
                    ) &&
                    required.assertions.every((pattern) =>
                        assertions.some((assertion) => pattern.test(assertion))
                    )
            )
        )
    }

    /**
     * Returns whether one source invokes any public callable required by a matcher.
     * @param {string} matcher Stable matcher id.
     * @param {string} source Historical test source.
     * @returns {boolean} Whether the source can contribute evidence.
     */
    static relevant(matcher, source) {
        const definition = MATCHERS[matcher]
        return Boolean(
            definition?.requirements.some((required) =>
                GerberFeatureEvidence.invocationMatches(required, source)
            )
        )
    }

    /**
     * Returns whether a matcher id belongs to the immutable registry.
     * @param {string} matcher Matcher id.
     * @returns {boolean} Whether the matcher is supported.
     */
    static supports(matcher) {
        return Object.hasOwn(MATCHERS, matcher)
    }
}

/**
 * Creates one frozen matcher requirement.
 * @param {string} exportName Public export name.
 * @param {string} methodName Public method name.
 * @param {RegExp[]} assertions Required assertion fragments.
 * @param {string[]} [calls] Additional helper calls.
 * @param {string[]} [resultPaths] Required public-result paths.
 * @returns {Readonly<Record<string, any>>} Matcher requirement.
 */
function requirement(
    exportName,
    methodName,
    assertions,
    calls = [],
    resultPaths = []
) {
    return Object.freeze({
        exportName,
        methodName,
        assertions: Object.freeze(assertions),
        calls: Object.freeze(calls),
        resultPaths: Object.freeze(resultPaths)
    })
}

/**
 * Extracts executable assertion calls and helper invocations from one test.
 * @param {string} source Test source.
 * @returns {{ source: string, assertions: string[], calls: Set<string> }} Evidence analysis.
 */
function analyze(source) {
    const cached = ANALYSIS_CACHE.get(source)
    if (cached) return cached
    const ast = parsers.babel.parse(source, {
        filepath: 'gerber-behavior-evidence.test.mjs'
    })
    const assertions = []
    const calls = new Set()
    walk(ast.program, (node) => {
        if (node.type !== 'CallExpression') return
        const call = callName(node.callee)
        if (call) calls.add(call)
        if (!assertionCall(node.callee)) return
        if (!Number.isInteger(node.start) || !Number.isInteger(node.end)) return
        assertions.push(source.slice(node.start, node.end))
    })
    const analysis = { source, assertions, calls }
    ANALYSIS_CACHE.set(source, analysis)
    return analysis
}

/**
 * Traverses Babel syntax nodes without interpreting comments or literals.
 * @param {unknown} value Syntax value.
 * @param {(node: Record<string, any>) => void} visit Node callback.
 * @returns {void}
 */
function walk(value, visit) {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
        for (const entry of value) walk(entry, visit)
        return
    }
    if (typeof value.type === 'string') visit(value)
    for (const [key, entry] of Object.entries(value)) {
        if (['comments', 'errors', 'loc', 'tokens'].includes(key)) continue
        walk(entry, visit)
    }
}

/**
 * Resolves the terminal name of one direct call target.
 * @param {Record<string, any>} callee Call target.
 * @returns {string} Call name or an empty string.
 */
function callName(callee) {
    if (callee?.type === 'Identifier') return callee.name
    if (
        callee?.type === 'MemberExpression' &&
        !callee.computed &&
        callee.property?.type === 'Identifier'
    ) {
        return callee.property.name
    }
    return ''
}

/**
 * Returns whether a call invokes an assertion method.
 * @param {Record<string, any>} callee Call target.
 * @returns {boolean} Whether the target is assert.*.
 */
function assertionCall(callee) {
    return (
        callee?.type === 'MemberExpression' &&
        callee.object?.type === 'Identifier' &&
        callee.object.name === 'assert'
    )
}
