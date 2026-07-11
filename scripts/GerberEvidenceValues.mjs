/** Encodes one origin, invocation, and result path. */
export function encode(origin, path, invocation = '') {
    return `${origin}${invocation ? `\u0002${invocation}` : ''}\u0000${path}`
}

/** Decodes one symbolic evidence value. */
export function decode(value) {
    const separator = value.indexOf('\u0000')
    const identity = value.slice(0, separator)
    const invocationSeparator = identity.indexOf('\u0002')
    return {
        origin:
            invocationSeparator < 0
                ? identity
                : identity.slice(0, invocationSeparator),
        invocation:
            invocationSeparator < 0
                ? ''
                : identity.slice(invocationSeparator + 1),
        path: value.slice(separator + 1)
    }
}

/** Appends a child path to symbolic evidence values. */
export function mapValues(values, child) {
    const mapped = new Set()
    for (const value of values || []) {
        const pair = decode(value)
        mapped.add(
            encode(
                pair.origin,
                [pair.path, child].filter(Boolean).join('.'),
                pair.invocation
            )
        )
    }
    return mapped
}

/** Unions symbolic evidence sets. */
export function union(...sets) {
    const result = new Set()
    for (const set of sets) addAll(result, set)
    return result
}

/** Wraps callback values as a supplied argument. */
export function argument(values) {
    return { values: new Set(values || []), undefined: false }
}

/** Intersects exact symbolic pairs across alternatives. */
export function intersection(...sets) {
    if (!sets.length) return new Set()
    return new Set(
        [...sets[0]].filter((value) =>
            sets.slice(1).every((set) => set.has(value))
        )
    )
}

/** Wraps symbolic values with one container index. */
export function indexValues(values, index) {
    return new Set(
        [...values].map((value) => {
            const pair = decode(value)
            return encode(
                pair.origin,
                `\u0001${index}\u0001${pair.path}`,
                pair.invocation
            )
        })
    )
}

/** Selects and unwraps one literal container index. */
export function selectedIndex(values, index) {
    const prefix = `\u0001${index}\u0001`
    return new Set(
        [...values].flatMap((value) => {
            const pair = decode(value)
            return pair.path.startsWith(prefix)
                ? [
                      encode(
                          pair.origin,
                          pair.path.slice(prefix.length),
                          pair.invocation
                      )
                  ]
                : []
        })
    )
}

/** Adds all values from one iterable to a set. */
export function addAll(destination, source) {
    for (const value of source || []) destination.add(value)
}

/** Adds one value to a map of sets. */
export function addMapped(map, key, value) {
    const values = map.get(key) || new Set()
    values.add(value)
    map.set(key, values)
}

/** Checks member-expression node variants. */
export function isMember(node) {
    return ['MemberExpression', 'OptionalMemberExpression'].includes(node?.type)
}

/** Checks call-expression node variants. */
export function isCall(node) {
    return ['CallExpression', 'OptionalCallExpression'].includes(node?.type)
}

/** Checks function-like AST node variants. */
export function isFunction(node) {
    return [
        'ArrowFunctionExpression',
        'FunctionDeclaration',
        'FunctionExpression',
        'ObjectMethod'
    ].includes(node?.type)
}

/** Reads one static member or property name. */
export function memberName(node) {
    const property = node?.property || node?.key
    if (!property) return ''
    if (!node.computed && property.type === 'Identifier') return property.name
    if (['StringLiteral', 'NumericLiteral'].includes(property.type)) {
        return String(property.value)
    }
    return ''
}

/** Reads the final static call name. */
export function callName(callee) {
    return callee?.type === 'Identifier' ? callee.name : memberName(callee)
}

/** Checks a literal expression that denotes undefined. */
export function isUndefinedValue(node) {
    return (
        (node?.type === 'Identifier' && node.name === 'undefined') ||
        (node?.type === 'UnaryExpression' && node.operator === 'void')
    )
}

/** Unwraps a direct intrinsic Boolean call. */
export function booleanArgument(node) {
    return isCall(node) &&
        node.callee?.type === 'Identifier' &&
        node.callee.name === 'Boolean'
        ? node.arguments[0]?.expression || node.arguments[0] || null
        : null
}

/** Lists recursively asserted object-literal field paths. */
export function literalFields(node, prefix = '') {
    if (node?.type === 'ArrayExpression') {
        return [
            ...new Set(
                node.elements.flatMap((element) =>
                    literalFields(element?.argument || element, prefix)
                )
            )
        ]
    }
    if (node?.type !== 'ObjectExpression') return []
    const fields = []
    for (const property of node.properties) {
        if (property.type === 'SpreadElement') continue
        const name = memberName(property)
        if (!name) continue
        const path = [prefix, name].filter(Boolean).join('.')
        fields.push(path, ...literalFields(property.value, path))
    }
    return [...new Set(fields)]
}

/** Reads an exact array literal of string keys. */
export function literalStringSet(node) {
    if (node?.type !== 'ArrayExpression') return new Set()
    const values = node.elements.map((element) =>
        element?.type === 'StringLiteral' ? element.value : null
    )
    return values.every((value) => value !== null) ? new Set(values) : new Set()
}
