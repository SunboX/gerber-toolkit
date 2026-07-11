import { GerberSourceCollectionGuard } from './GerberSourceCollectionGuard.mjs'
import { GerberStaticValue } from './GerberStaticValue.mjs'

const ARRAY_RESULT_METHODS = new Set([
    'concat',
    'filter',
    'flat',
    'flatMap',
    'map',
    'slice',
    'splice'
])

/**
 * Proves intrinsic Array receivers without trusting method spelling alone.
 */
export class GerberSourceCollectionProvenance {
    /**
     * Checks whether a collection expression is not statically empty.
     * @param {Record<string, any> | null} node Collection expression.
     * @param {{ get: (name: string) => Record<string, any> | null }} scope Lexical scope.
     * @param {Set<string>} [seen] Active identifier chain.
     * @returns {boolean} Whether callbacks can execute.
     */
    static mayHaveElements(node, scope, seen = new Set()) {
        if (!node) return true
        const count = GerberSourceCollectionProvenance.#callbackElementCount(
            node,
            scope,
            seen
        )
        if (count !== null) return count > 0
        if (node.type === 'ArrayExpression') return node.elements.some(Boolean)
        if (node.type === 'ObjectExpression') {
            return GerberSourceCollectionProvenance.#arrayLikeMayHaveElements(
                node,
                scope
            )
        }
        if (node.type === 'Identifier') {
            if (seen.has(node.name)) return true
            const initializer = scope.get(node.name)?.initializer
            if (!initializer) return true
            const next = new Set(seen).add(node.name)
            return GerberSourceCollectionProvenance.mayHaveElements(
                initializer,
                scope,
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
            return GerberSourceCollectionProvenance.mayHaveElements(
                node.expression || node.argument,
                scope,
                seen
            )
        }
        if (node.type === 'ConditionalExpression') {
            return (
                GerberSourceCollectionProvenance.mayHaveElements(
                    node.consequent,
                    scope,
                    seen
                ) ||
                GerberSourceCollectionProvenance.mayHaveElements(
                    node.alternate,
                    scope,
                    seen
                )
            )
        }
        if (node.type === 'NewExpression') {
            return GerberSourceCollectionProvenance.#arrayConstructorMayHaveElements(
                node,
                scope
            )
        }
        if (!['CallExpression', 'OptionalCallExpression'].includes(node.type)) {
            return true
        }
        const callee = node.callee
        if (callee?.type === 'Identifier' && callee.name === 'Array') {
            return GerberSourceCollectionProvenance.#arrayConstructorMayHaveElements(
                node,
                scope
            )
        }
        if (!isMember(callee)) return true
        const owner = callee.object
        const method = staticName(callee)
        if (
            owner?.type === 'Identifier' &&
            owner.name === 'Array' &&
            !scope.get('Array')
        ) {
            if (method === 'of') return node.arguments.length > 0
            if (method === 'from') {
                return GerberSourceCollectionProvenance.mayHaveElements(
                    node.arguments[0],
                    scope,
                    seen
                )
            }
        }
        return ['filter', 'flat', 'flatMap', 'map', 'slice'].includes(method)
            ? GerberSourceCollectionProvenance.mayHaveElements(
                  owner,
                  scope,
                  seen
              )
            : true
    }

    /**
     * Counts statically visitable Array elements, excluding holes.
     * @param {Record<string, any> | null} node Collection expression.
     * @param {{ get: (name: string) => Record<string, any> | null }} scope Lexical scope.
     * @param {Set<string>} seen Active identifier chain.
     * @returns {number | null} Visitable count or null when unknown.
     */
    static #callbackElementCount(node, scope, seen) {
        if (!node) return null
        if (node.type === 'ArrayExpression') {
            let count = 0
            for (const element of node.elements) {
                if (!element) continue
                if (element.type !== 'SpreadElement') {
                    count += 1
                    continue
                }
                const spread =
                    GerberSourceCollectionProvenance.#callbackElementCount(
                        element.argument,
                        scope,
                        seen
                    )
                if (spread === null) return null
                count += spread
            }
            return count
        }
        if (node.type === 'Identifier') {
            if (seen.has(node.name)) return null
            const initializer = scope.get(node.name)?.initializer
            return initializer
                ? GerberSourceCollectionProvenance.#callbackElementCount(
                      initializer,
                      scope,
                      new Set(seen).add(node.name)
                  )
                : null
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
            return GerberSourceCollectionProvenance.#callbackElementCount(
                node.expression || node.argument,
                scope,
                seen
            )
        }
        if (node.type === 'NewExpression') {
            return GerberSourceCollectionProvenance.#arrayCallCount(node, scope)
        }
        if (!['CallExpression', 'OptionalCallExpression'].includes(node.type)) {
            return null
        }
        if (
            node.callee?.type === 'Identifier' &&
            node.callee.name === 'Array'
        ) {
            return GerberSourceCollectionProvenance.#arrayCallCount(node, scope)
        }
        if (!isMember(node.callee)) return null
        const owner = node.callee.object
        const method = staticName(node.callee)
        if (
            owner?.type === 'Identifier' &&
            owner.name === 'Array' &&
            !scope.get('Array')
        ) {
            if (method === 'of') return node.arguments.length
            if (method === 'from') {
                return GerberSourceCollectionProvenance.#arrayLikeLength(
                    node.arguments[0],
                    scope,
                    seen
                )
            }
        }
        const ownerCount =
            GerberSourceCollectionProvenance.#callbackElementCount(
                owner,
                scope,
                seen
            )
        if (method === 'map') return ownerCount
        if (method === 'filter') {
            if (ownerCount === 0) return 0
            return GerberSourceCollectionProvenance.#callbackTruth(
                node.arguments[0],
                scope
            ) === false
                ? 0
                : null
        }
        if (method === 'slice') {
            return GerberSourceCollectionProvenance.#sliceCount(
                owner,
                node.arguments,
                scope
            )
        }
        if (method === 'flat') {
            return GerberSourceCollectionProvenance.#flatCount(
                owner,
                node.arguments[0],
                scope
            )
        }
        return ownerCount === 0 && ['flatMap'].includes(method) ? 0 : null
    }

    /**
     * Counts visitable elements produced by intrinsic Array construction.
     * @param {Record<string, any>} node Array call or construction.
     * @param {{ get: (name: string) => Record<string, any> | null }} scope Scope.
     * @returns {number | null} Visitable count.
     */
    static #arrayCallCount(node, scope) {
        if (scope.get('Array')) return null
        if (node.arguments?.length !== 1) return node.arguments?.length || 0
        const length = GerberStaticValue.resolve(node.arguments[0], scope)
        return length.known && typeof length.value === 'number' ? 0 : 1
    }

    /**
     * Resolves a static array-like length, including sparse arrays.
     * @param {Record<string, any> | null} node Array-like expression.
     * @param {{ get: (name: string) => Record<string, any> | null }} scope Scope.
     * @param {Set<string>} seen Active identifier chain.
     * @returns {number | null} Effective length.
     */
    static #arrayLikeLength(node, scope, seen) {
        if (node?.type === 'ArrayExpression') return node.elements.length
        if (node?.type === 'ObjectExpression') {
            for (const property of [...(node.properties || [])].reverse()) {
                if (staticPropertyName(property) !== 'length') continue
                const value = GerberStaticValue.resolve(property.value, scope)
                if (!value.known) return null
                const length = Number(value.value)
                return Number.isNaN(length) || length <= 0
                    ? 0
                    : Math.min(Number.MAX_SAFE_INTEGER, Math.floor(length))
            }
        }
        return GerberSourceCollectionProvenance.#callbackElementCount(
            node,
            scope,
            seen
        )
    }

    /**
     * Counts elements selected by a statically bounded literal slice.
     * @param {Record<string, any>} owner Slice receiver.
     * @param {Record<string, any>[]} argumentsList Slice bounds.
     * @param {{ get: (name: string) => Record<string, any> | null }} scope Scope.
     * @returns {number | null} Selected visitable count.
     */
    static #sliceCount(owner, argumentsList, scope) {
        if (owner?.type !== 'ArrayExpression') return null
        const bounds = argumentsList.map((argument) =>
            GerberStaticValue.resolve(argument, scope)
        )
        if (bounds.some((bound) => !bound.known)) return null
        const start = bounds.length ? Number(bounds[0].value) : 0
        const end = bounds.length > 1 ? Number(bounds[1].value) : undefined
        return owner.elements.slice(start, end).filter(Boolean).length
    }

    /**
     * Counts a statically flattenable literal collection.
     * @param {Record<string, any>} owner Flat receiver.
     * @param {Record<string, any> | null} depthNode Optional depth.
     * @param {{ get: (name: string) => Record<string, any> | null }} scope Scope.
     * @returns {number | null} Flattened visitable count.
     */
    static #flatCount(owner, depthNode, scope) {
        if (owner?.type !== 'ArrayExpression') return null
        const resolved = depthNode
            ? GerberStaticValue.resolve(depthNode, scope)
            : { known: true, value: 1 }
        if (!resolved.known) return null
        const depth = Math.max(0, Math.floor(Number(resolved.value) || 0))
        const visit = (elements, remaining) => {
            let count = 0
            for (const element of elements) {
                if (!element) continue
                if (element.type === 'SpreadElement') return null
                if (remaining > 0 && element.type === 'ArrayExpression') {
                    const nested = visit(element.elements, remaining - 1)
                    if (nested === null) return null
                    count += nested
                } else count += 1
            }
            return count
        }
        return visit(owner.elements, depth)
    }

    /**
     * Resolves one inline or lexically bound callback's constant truthiness.
     * @param {Record<string, any> | null} callback Callback expression.
     * @param {{ get: (name: string) => Record<string, any> | null }} scope Scope.
     * @returns {boolean | null} Constant callback result truth.
     */
    static #callbackTruth(callback, scope) {
        let callable = callback
        if (callable?.type === 'Identifier') {
            callable = scope.get(callable.name)?.initializer
        }
        if (
            ![
                'ArrowFunctionExpression',
                'FunctionExpression',
                'FunctionDeclaration'
            ].includes(callable?.type)
        ) {
            return null
        }
        const expression =
            callable.body.type === 'BlockStatement'
                ? callable.body.body.length === 1 &&
                  callable.body.body[0].type === 'ReturnStatement'
                    ? callable.body.body[0].argument
                    : null
                : callable.body
        return GerberStaticValue.truth(expression, scope)
    }

    /**
     * Checks a static array-like object's effective length.
     * @param {Record<string, any>} node Object expression.
     * @param {{ get: (name: string) => Record<string, any> | null }} scope Lexical scope.
     * @returns {boolean} Whether Array.from can produce an element.
     */
    static #arrayLikeMayHaveElements(node, scope) {
        let length = null
        for (const property of node.properties || []) {
            if (property.type === 'SpreadElement') {
                length = null
                continue
            }
            if (staticPropertyName(property) !== 'length') continue
            const resolved = GerberStaticValue.resolve(property.value, scope)
            length = resolved.known ? Number(resolved.value) : null
        }
        return length === null || (!Number.isNaN(length) && length > 0)
    }

    /**
     * Checks intrinsic Array construction with a known zero length.
     * @param {Record<string, any>} node Array call or construction.
     * @param {{ get: (name: string) => Record<string, any> | null }} scope Lexical scope.
     * @returns {boolean} Whether the constructed Array can contain an element.
     */
    static #arrayConstructorMayHaveElements(node, scope) {
        if (scope.get('Array')) return true
        if (node.arguments?.length !== 1) return node.arguments?.length > 0
        const length = GerberStaticValue.resolve(node.arguments[0], scope)
        return (
            !length.known ||
            typeof length.value !== 'number' ||
            length.value !== 0
        )
    }

    /**
     * Checks whether an expression is structurally known to produce an Array.
     * @param {Record<string, any> | null} node Expression node.
     * @param {{ get: (name: string) => Record<string, any> | null }} scope Lexical scope.
     * @param {Set<string>} [seen] Active identifier chain.
     * @returns {boolean} Whether the receiver is a proven intrinsic collection.
     */
    static isIntrinsic(node, scope, seen = new Set()) {
        return GerberSourceCollectionProvenance.depth(node, scope, seen) > 0
    }

    /**
     * Resolves the proven nested Array depth of an expression.
     * @param {Record<string, any> | null} node Expression node.
     * @param {{ get: (name: string) => Record<string, any> | null }} scope Lexical scope.
     * @param {Set<string>} [seen] Active identifier chain.
     * @returns {number} Array nesting depth, zero when unproven.
     */
    static depth(node, scope, seen = new Set()) {
        if (!node) return 0
        const callableDepth = Number(scope.callDepth?.(node) || 0)
        if (callableDepth > 0) return callableDepth
        if (node.type === 'ArrayExpression') {
            if (!node.elements.length) return Number.POSITIVE_INFINITY
            const childDepth = Math.min(
                ...node.elements.map((element) =>
                    GerberSourceCollectionProvenance.depth(
                        element?.argument || element,
                        scope,
                        seen
                    )
                )
            )
            return childDepth > 0 ? childDepth + 1 : 1
        }
        if (node.type === 'Identifier') {
            if (seen.has(node.name)) return 0
            const binding = scope.get(node.name)
            if (binding?.collectionDepth > 0) return binding.collectionDepth
            const initializer = binding?.initializer
            if (!initializer) return 0
            const next = new Set(seen)
            next.add(node.name)
            return GerberSourceCollectionProvenance.depth(
                initializer,
                scope,
                next
            )
        }
        if (isMember(node)) {
            const target = memberTarget(node)
            const binding = target ? scope.get(target.root) : null
            const declaredDepth = binding?.collectionPaths?.get(target?.path)
            if (declaredDepth > 0) return declaredDepth
            return 0
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
            return GerberSourceCollectionProvenance.depth(
                node.expression || node.argument,
                scope,
                seen
            )
        }
        if (node.type === 'ConditionalExpression') {
            const guarded = !scope.get('Array')
                ? GerberSourceCollectionGuard.target(node.test)
                : null
            const consequent = GerberSourceCollectionGuard.matches(
                node.consequent,
                guarded
            )
                ? Math.max(
                      1,
                      GerberSourceCollectionProvenance.depth(
                          node.consequent,
                          scope,
                          seen
                      )
                  )
                : GerberSourceCollectionProvenance.depth(
                      node.consequent,
                      scope,
                      seen
                  )
            const alternate = GerberSourceCollectionProvenance.depth(
                node.alternate,
                scope,
                seen
            )
            return consequent > 0 && alternate > 0
                ? Math.min(consequent, alternate)
                : 0
        }
        if (node.type === 'LogicalExpression') {
            const left = GerberSourceCollectionProvenance.depth(
                node.left,
                scope,
                seen
            )
            const right = GerberSourceCollectionProvenance.depth(
                node.right,
                scope,
                seen
            )
            return left > 0 && right > 0 ? Math.min(left, right) : 0
        }
        if (node.type === 'SequenceExpression') {
            return GerberSourceCollectionProvenance.depth(
                node.expressions.at(-1),
                scope,
                seen
            )
        }
        if (node.type === 'NewExpression') {
            return node.callee?.type === 'Identifier' &&
                node.callee.name === 'Array' &&
                !scope.get('Array')
                ? 1
                : 0
        }
        if (!['CallExpression', 'OptionalCallExpression'].includes(node.type)) {
            return 0
        }
        const callee = node.callee
        if (
            !['MemberExpression', 'OptionalMemberExpression'].includes(
                callee?.type
            )
        ) {
            return 0
        }
        const owner = callee.object
        const method = staticName(callee)
        if (
            owner?.type === 'Identifier' &&
            owner.name === 'Array' &&
            !scope.get('Array')
        ) {
            if (method === 'from') {
                return Math.max(
                    1,
                    GerberSourceCollectionProvenance.depth(
                        node.arguments[0],
                        scope,
                        seen
                    )
                )
            }
            return method === 'of' ? 1 : 0
        }
        if (
            owner?.type === 'Identifier' &&
            owner.name === 'Object' &&
            !scope.get('Object')
        ) {
            return ['entries', 'keys', 'values'].includes(method) ? 1 : 0
        }
        return ARRAY_RESULT_METHODS.has(method)
            ? GerberSourceCollectionProvenance.depth(owner, scope, seen)
            : 0
    }
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
 * Resolves a static member target.
 * @param {Record<string, any> | null} node Member node.
 * @returns {{ root: string, path: string } | null} Static target.
 */
function memberTarget(node) {
    if (!node) return null
    if (node.type === 'Identifier') return { root: node.name, path: '' }
    if (!isMember(node)) return null
    const parent = memberTarget(node.object)
    const name = staticName(node)
    if (!parent || !name || /^\d+$/u.test(name)) return parent
    return {
        root: parent.root,
        path: [parent.path, name].filter(Boolean).join('.')
    }
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

/**
 * Reads one static object-property key.
 * @param {Record<string, any>} node Object property node.
 * @returns {string} Static key name.
 */
function staticPropertyName(node) {
    const key = node?.key
    if (!key) return ''
    if (!node.computed && key.type === 'Identifier') return key.name
    return ['StringLiteral', 'NumericLiteral'].includes(key.type)
        ? String(key.value)
        : ''
}
