const ARRAY_RESULT_METHODS = new Set([
    'concat',
    'filter',
    'flat',
    'flatMap',
    'map',
    'slice',
    'splice'
])
const COLLECTION_METHODS = new Set([
    'at',
    'every',
    'filter',
    'find',
    'findLast',
    'flat',
    'flatMap',
    'forEach',
    'get',
    'map',
    'reduce',
    'reduceRight',
    'some',
    'values'
])
const FRAMEWORK_CALLBACKS = new Set([
    'after',
    'afterEach',
    'before',
    'beforeEach',
    'describe',
    'it',
    'suite',
    'test'
])
const ASSERTION_METHODS = new Set([
    'deepEqual',
    'deepStrictEqual',
    'equal',
    'ok',
    'strictEqual'
])
const PUBLIC_SOURCE =
    /^(?:gerber-toolkit(?:\/(?:parser|renderers|scene3d|extensions))?|\.\/index\.mjs|\.\.\/src\/(?:index|parser|renderers|scene3d|extensions|legacy-parser|legacy-renderers|legacy-scene3d)\.mjs|\.\.\/\.\.\/source\/src\/(?:index|parser|renderers|scene3d)\.mjs)$/u

/**
 * Tracks imported public symbols and intrinsic evidence collections.
 */
export class GerberEvidenceProvenance {
    /**
     * Checks a supported intrinsic collection method.
     * @param {string} method Method name.
     * @returns {boolean} Whether collection semantics are modeled.
     */
    static isCollectionMethod(method) {
        return COLLECTION_METHODS.has(method)
    }

    /**
     * Checks a test-framework callback that is synchronously registered.
     * @param {string} name Call name.
     * @returns {boolean} Whether the callback body is reachable evidence.
     */
    static executesFrameworkCallback(name) {
        return FRAMEWORK_CALLBACKS.has(name)
    }

    /**
     * Extracts values explicitly asserted to satisfy `Array.isArray`.
     * @param {Record<string, any>} callee Assertion callee.
     * @param {Record<string, any>[]} argumentsList Assertion arguments.
     * @param {{ get: (name: string) => Record<string, any> | null }} environment Lexical environment.
     * @returns {Record<string, any>[]} Asserted Array expressions.
     */
    static assertedArrays(callee, argumentsList, environment) {
        if (!GerberEvidenceProvenance.isAssertion(callee, environment)) {
            return []
        }
        if (environment.get('Array')) return []
        const assertion = GerberEvidenceProvenance.assertionMethod(
            callee,
            environment
        )
        const values = argumentsList.map(
            (argument) => argument.expression || argument
        )
        if (assertion === 'ok') {
            const target = arrayIsArrayTarget(values[0])
            return target ? [target] : []
        }
        if (
            !['deepEqual', 'deepStrictEqual', 'equal', 'strictEqual'].includes(
                assertion
            )
        ) {
            return []
        }
        for (const [candidate, expected] of [
            [values[0], values[1]],
            [values[1], values[0]]
        ]) {
            const target = arrayIsArrayTarget(candidate)
            if (
                target &&
                expected?.type === 'BooleanLiteral' &&
                expected.value
            ) {
                return [target]
            }
        }
        return []
    }

    /**
     * Checks whether a callee resolves through an imported `node:assert` API.
     * @param {Record<string, any> | null} callee Callee node.
     * @param {{ get: (name: string) => Record<string, any> | null }} environment Lexical environment.
     * @returns {boolean} Whether this is a trusted assertion.
     */
    static isAssertion(callee, environment) {
        return Boolean(
            GerberEvidenceProvenance.assertionMethod(callee, environment)
        )
    }

    /**
     * Resolves the canonical imported assertion method behind a local alias.
     * @param {Record<string, any> | null} callee Callee node.
     * @param {{ get: (name: string) => Record<string, any> | null }} environment Lexical environment.
     * @returns {string} Canonical assertion method or an empty string.
     */
    static assertionMethod(callee, environment) {
        if (callee?.type === 'Identifier') {
            const binding = environment.get(callee.name)
            return ASSERTION_METHODS.has(binding?.assertionMethod)
                ? binding.assertionMethod
                : ''
        }
        if (!isMember(callee) || callee.object?.type !== 'Identifier') {
            return ''
        }
        const method = staticName(callee)
        return environment.get(callee.object.name)?.assertionApi === true &&
            ASSERTION_METHODS.has(method)
            ? method
            : ''
    }

    /**
     * Merges abrupt-flow kinds from two complete alternatives.
     * @param {{ terminated: boolean, abrupt: string }} left Left outcome.
     * @param {{ terminated: boolean, abrupt: string }} right Right outcome.
     * @param {boolean} complete Whether both alternatives exist.
     * @returns {string} Shared abrupt kind or empty string.
     */
    static mergeAbrupt(left, right, complete) {
        if (!complete || !left.terminated || !right.terminated) return ''
        if (left.abrupt === right.abrupt) return left.abrupt
        const terminal = new Set(['return', 'throw', 'abrupt', 'halt'])
        return terminal.has(left.abrupt) && terminal.has(right.abrupt)
            ? 'abrupt'
            : ''
    }

    /**
     * Creates a public-symbol binding for one package API import.
     * @param {Record<string, any>} specifier Import specifier.
     * @param {string} source Import source.
     * @returns {Record<string, any> | null} Evidence binding or null.
     */
    static importBinding(specifier, source) {
        if (/^node:assert(?:\/strict)?$/u.test(source)) {
            if (
                specifier.type === 'ImportDefaultSpecifier' ||
                specifier.type === 'ImportNamespaceSpecifier'
            ) {
                return {
                    values: new Set(),
                    methods: new Map(),
                    assertionApi: true,
                    initializer: null,
                    collection: false
                }
            }
            const method = specifier.imported?.name || specifier.imported?.value
            if (
                specifier.type === 'ImportSpecifier' &&
                ASSERTION_METHODS.has(method)
            ) {
                return {
                    values: new Set(),
                    methods: new Map(),
                    assertionMethod: method,
                    initializer: null,
                    collection: false
                }
            }
        }
        if (source === 'node:test') {
            const callback =
                specifier.type === 'ImportSpecifier'
                    ? specifier.imported?.name || specifier.imported?.value
                    : specifier.type === 'ImportDefaultSpecifier'
                      ? 'test'
                      : ''
            if (FRAMEWORK_CALLBACKS.has(callback)) {
                return {
                    values: new Set(),
                    methods: new Map(),
                    frameworkCallback: true,
                    initializer: null,
                    collection: false
                }
            }
        }
        if (!PUBLIC_SOURCE.test(source)) return null
        if (specifier.type === 'ImportNamespaceSpecifier') {
            return {
                values: new Set(),
                methods: new Map(),
                publicNamespace: true,
                initializer: null,
                collection: false
            }
        }
        const publicSymbol =
            specifier.type === 'ImportSpecifier'
                ? specifier.imported?.name || specifier.imported?.value
                : specifier.type === 'ImportDefaultSpecifier'
                  ? specifier.local?.name
                  : ''
        if (!publicSymbol) return null
        return {
            values: new Set(),
            methods: new Map(),
            publicSymbol,
            initializer: null,
            collection: false
        }
    }

    /**
     * Resolves a direct call only through an imported public binding.
     * @param {Record<string, any> | null} callee Callee node.
     * @param {{ get: (name: string) => Record<string, any> | null }} environment Lexical environment.
     * @returns {string} Public callable identity or empty string.
     */
    static directCallable(callee, environment) {
        const identity = GerberEvidenceProvenance.publicCallableIdentity(
            callee,
            environment
        )
        return environment.revokedCallables?.has(identity) ? '' : identity
    }

    /**
     * Resolves the canonical imported public callable targeted by a member.
     * @param {Record<string, any> | null} callee Member node.
     * @param {{ get: (name: string) => Record<string, any> | null }} environment Lexical environment.
     * @returns {string} Public callable identity or empty string.
     */
    static publicCallableIdentity(callee, environment) {
        if (!isMember(callee)) return ''
        const method = staticName(callee)
        if (callee.object?.type === 'Identifier') {
            const binding = environment.get(callee.object.name)
            return binding?.publicSymbol && method
                ? `${binding.publicSymbol}.${method}`
                : ''
        }
        if (
            isMember(callee.object) &&
            callee.object.object?.type === 'Identifier'
        ) {
            const namespace = environment.get(callee.object.object.name)
            const publicSymbol = staticName(callee.object)
            return namespace?.publicNamespace && publicSymbol && method
                ? `${publicSymbol}.${method}`
                : ''
        }
        return ''
    }

    /**
     * Checks whether a callback receiver has intrinsic or public-result provenance.
     * @param {Record<string, any> | null} node Receiver expression.
     * @param {{ get: (name: string) => Record<string, any> | null }} environment Lexical environment.
     * @param {Set<string>} [receiverValues] Encoded public result values.
     * @param {Set<string>} [provenCollections] Values proven by assertions.
     * @param {Set<string>} [seen] Active identifier chain.
     * @returns {boolean} Whether collection callback semantics are proven.
     */
    static isCollection(
        node,
        environment,
        receiverValues = new Set(),
        provenCollections = new Set(),
        seen = new Set()
    ) {
        if ([...receiverValues].some((value) => provenCollections.has(value))) {
            return true
        }
        if (!node) return false
        if (node.type === 'ArrayExpression') return true
        if (node.type === 'Identifier') {
            if (seen.has(node.name)) return false
            const binding = environment.get(node.name)
            if (binding?.collection) return true
            if (!binding?.initializer) return false
            const next = new Set(seen)
            next.add(node.name)
            return GerberEvidenceProvenance.isCollection(
                binding.initializer,
                environment,
                new Set(),
                provenCollections,
                next
            )
        }
        if (
            [
                'ParenthesizedExpression',
                'TSAsExpression',
                'TSTypeAssertion',
                'TypeCastExpression',
                'ChainExpression'
            ].includes(node.type)
        ) {
            return GerberEvidenceProvenance.isCollection(
                node.expression || node.argument,
                environment,
                new Set(),
                provenCollections,
                seen
            )
        }
        if (node.type === 'ConditionalExpression') {
            return (
                GerberEvidenceProvenance.isCollection(
                    node.consequent,
                    environment,
                    new Set(),
                    provenCollections,
                    seen
                ) &&
                GerberEvidenceProvenance.isCollection(
                    node.alternate,
                    environment,
                    new Set(),
                    provenCollections,
                    seen
                )
            )
        }
        if (node.type === 'LogicalExpression') {
            return (
                GerberEvidenceProvenance.isCollection(
                    node.left,
                    environment,
                    new Set(),
                    provenCollections,
                    seen
                ) &&
                GerberEvidenceProvenance.isCollection(
                    node.right,
                    environment,
                    new Set(),
                    provenCollections,
                    seen
                )
            )
        }
        if (!isCall(node) || !isMember(node.callee)) return false
        const owner = node.callee.object
        const method = staticName(node.callee)
        if (
            owner?.type === 'Identifier' &&
            owner.name === 'Array' &&
            !environment.get('Array')
        ) {
            return ['from', 'of'].includes(method)
        }
        if (
            owner?.type === 'Identifier' &&
            owner.name === 'Object' &&
            !environment.get('Object')
        ) {
            return ['entries', 'keys', 'values'].includes(method)
        }
        return (
            ARRAY_RESULT_METHODS.has(method) &&
            GerberEvidenceProvenance.isCollection(
                owner,
                environment,
                new Set(),
                provenCollections,
                seen
            )
        )
    }
}

/**
 * Extracts the argument of one intrinsic `Array.isArray` call.
 * @param {Record<string, any> | null} node Candidate call.
 * @returns {Record<string, any> | null} Tested value or null.
 */
function arrayIsArrayTarget(node) {
    if (
        !isCall(node) ||
        !isMember(node.callee) ||
        node.callee.object?.type !== 'Identifier' ||
        node.callee.object.name !== 'Array' ||
        staticName(node.callee) !== 'isArray'
    ) {
        return null
    }
    return node.arguments[0]?.expression || node.arguments[0] || null
}

/**
 * Checks a member-expression variant.
 * @param {Record<string, any> | null} node AST node.
 * @returns {boolean} Whether the node is a member expression.
 */
function isMember(node) {
    return ['MemberExpression', 'OptionalMemberExpression'].includes(node?.type)
}

/**
 * Checks a call-expression variant.
 * @param {Record<string, any> | null} node AST node.
 * @returns {boolean} Whether the node is a call expression.
 */
function isCall(node) {
    return ['CallExpression', 'OptionalCallExpression'].includes(node?.type)
}

/**
 * Reads one static member name.
 * @param {Record<string, any>} node Member node.
 * @returns {string} Static property name.
 */
function staticName(node) {
    const property = node?.property
    if (!property) return ''
    if (!node.computed && property.type === 'Identifier') return property.name
    return ['StringLiteral', 'NumericLiteral'].includes(property.type)
        ? String(property.value)
        : ''
}
