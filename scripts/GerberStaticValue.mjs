/**
 * Resolves side-effect-free JavaScript literals through lexical bindings.
 */
export class GerberStaticValue {
    /**
     * Resolves one statically known expression value.
     * @param {Record<string, any> | null} node Expression node.
     * @param {{ get: (name: string) => Record<string, any> | null } | null} [environment] Lexical environment.
     * @param {Set<string>} [seen] Active identifier chain.
     * @returns {{ known: boolean, value?: any }} Static value result.
     */
    static resolve(node, environment = null, seen = new Set()) {
        if (!node) return { known: false }
        if (
            [
                'ParenthesizedExpression',
                'TSAsExpression',
                'TSTypeAssertion',
                'TypeCastExpression',
                'ChainExpression'
            ].includes(node.type)
        ) {
            return GerberStaticValue.resolve(
                node.expression || node.argument,
                environment,
                seen
            )
        }
        if (node.type === 'BooleanLiteral') {
            return { known: true, value: node.value }
        }
        if (node.type === 'NullLiteral') return { known: true, value: null }
        if (node.type === 'NumericLiteral') {
            return { known: true, value: node.value }
        }
        if (node.type === 'StringLiteral') {
            return { known: true, value: node.value }
        }
        if (node.type === 'BigIntLiteral') {
            return { known: true, value: BigInt(node.value) }
        }
        if (node.type === 'TemplateLiteral' && !node.expressions.length) {
            return {
                known: true,
                value: node.quasis.map((quasi) => quasi.value.cooked).join('')
            }
        }
        if (node.type === 'ThisExpression') {
            return environment?.thisValue || { known: false }
        }
        if (
            [
                'ArrayExpression',
                'ArrowFunctionExpression',
                'ClassExpression',
                'FunctionExpression',
                'NewExpression',
                'ObjectExpression',
                'RegExpLiteral'
            ].includes(node.type)
        ) {
            return { known: true, value: node }
        }
        if (node.type === 'Identifier') {
            const binding = environment?.get(node.name)
            if (!binding && node.name === 'undefined') {
                return { known: true, value: undefined }
            }
            if (!binding && node.name === 'NaN') {
                return { known: true, value: Number.NaN }
            }
            if (!binding && node.name === 'Infinity') {
                return { known: true, value: Number.POSITIVE_INFINITY }
            }
            if (seen.has(node.name)) return { known: false }
            const initializer = binding?.initializer
            if (!initializer) return { known: false }
            const next = new Set(seen)
            next.add(node.name)
            return GerberStaticValue.resolve(initializer, environment, next)
        }
        if (node.type === 'UnaryExpression') {
            if (node.operator === 'void') {
                return { known: true, value: undefined }
            }
            const argument = GerberStaticValue.resolve(
                node.argument,
                environment,
                seen
            )
            if (!argument.known) return argument
            if (node.operator === '!') {
                return { known: true, value: !argument.value }
            }
            if (node.operator === '+') {
                return { known: true, value: +argument.value }
            }
            if (node.operator === '-') {
                return { known: true, value: -argument.value }
            }
        }
        if (node.type === 'LogicalExpression') {
            const left = GerberStaticValue.resolve(node.left, environment, seen)
            if (!left.known) return left
            if (node.operator === '&&') {
                return left.value
                    ? GerberStaticValue.resolve(node.right, environment, seen)
                    : left
            }
            if (node.operator === '||') {
                return left.value
                    ? left
                    : GerberStaticValue.resolve(node.right, environment, seen)
            }
            if (node.operator === '??') {
                return left.value === null || left.value === undefined
                    ? GerberStaticValue.resolve(node.right, environment, seen)
                    : left
            }
        }
        if (node.type === 'ConditionalExpression') {
            const test = GerberStaticValue.truth(node.test, environment)
            return test === null
                ? { known: false }
                : GerberStaticValue.resolve(
                      test ? node.consequent : node.alternate,
                      environment,
                      seen
                  )
        }
        if (node.type === 'SequenceExpression') {
            return GerberStaticValue.resolve(
                node.expressions.at(-1),
                environment,
                seen
            )
        }
        if (node.type === 'BinaryExpression') {
            const left = GerberStaticValue.resolve(node.left, environment, seen)
            const right = GerberStaticValue.resolve(
                node.right,
                environment,
                seen
            )
            if (!left.known || !right.known) return { known: false }
            return GerberStaticValue.#binary(
                node.operator,
                left.value,
                right.value
            )
        }
        return { known: false }
    }

    /**
     * Evaluates one side-effect-free binary operation.
     * @param {string} operator JavaScript operator.
     * @param {any} left Left value.
     * @param {any} right Right value.
     * @returns {{ known: boolean, value?: any }} Static result.
     */
    static #binary(operator, left, right) {
        try {
            const operations = {
                '===': () => left === right,
                '!==': () => left !== right,
                '==': () => left == right,
                '!=': () => left != right,
                '<': () => left < right,
                '<=': () => left <= right,
                '>': () => left > right,
                '>=': () => left >= right,
                '+': () => left + right,
                '-': () => left - right,
                '*': () => left * right,
                '/': () => left / right,
                '%': () => left % right,
                '**': () => left ** right,
                '|': () => left | right,
                '&': () => left & right,
                '^': () => left ^ right,
                '<<': () => left << right,
                '>>': () => left >> right,
                '>>>': () => left >>> right
            }
            const evaluate = operations[operator]
            return evaluate
                ? { known: true, value: evaluate() }
                : { known: false }
        } catch {
            return { known: false }
        }
    }

    /**
     * Resolves statically known JavaScript truthiness.
     * @param {Record<string, any> | null} node Expression node.
     * @param {{ get: (name: string) => Record<string, any> | null } | null} [environment] Lexical environment.
     * @returns {boolean | null} Known truthiness or null.
     */
    static truth(node, environment = null) {
        const result = GerberStaticValue.resolve(node, environment)
        return result.known ? Boolean(result.value) : null
    }

    /**
     * Resolves whether an expression is null or undefined.
     * @param {Record<string, any> | null} node Expression node.
     * @param {{ get: (name: string) => Record<string, any> | null } | null} [environment] Lexical environment.
     * @returns {boolean | null} Known nullishness or null.
     */
    static nullish(node, environment = null) {
        const result = GerberStaticValue.resolve(node, environment)
        return result.known
            ? result.value === null || result.value === undefined
            : null
    }
}
