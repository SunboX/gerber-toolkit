import { parsers } from 'prettier/plugins/babel'

import {
    GerberEvidenceEnvironment,
    cloneEvidenceBinding
} from './GerberEvidenceEnvironment.mjs'
import { GerberControlFlow } from './GerberControlFlow.mjs'
import { GerberEvidenceBranchFlow } from './GerberEvidenceBranchFlow.mjs'
import { GerberEvidenceBinding } from './GerberEvidenceBinding.mjs'
import { GerberEvidenceAnalyzerSupport } from './GerberEvidenceAnalyzerSupport.mjs'
import { GerberEvidenceCollectionState } from './GerberEvidenceCollectionState.mjs'
import { GerberEvidenceCollectionMethod } from './GerberEvidenceCollectionMethod.mjs'
import { GerberEvidenceLValue } from './GerberEvidenceLValue.mjs'
import { GerberEvidenceProvenance } from './GerberEvidenceProvenance.mjs'
import { GerberEvidenceSwitchFlow } from './GerberEvidenceSwitchFlow.mjs'
import { GerberEvidenceTryFlow } from './GerberEvidenceTryFlow.mjs'
import { GerberEvidenceThrowCapture } from './GerberEvidenceThrowCapture.mjs'
import { GerberOptionalChain } from './GerberOptionalChain.mjs'
import { GerberPatternAssignment } from './GerberPatternAssignment.mjs'
import { GerberSourceCollectionGuard } from './GerberSourceCollectionGuard.mjs'
import { GerberStaticValue } from './GerberStaticValue.mjs'
import {
    addAll,
    addMapped,
    argument,
    booleanArgument,
    callName,
    decode,
    encode,
    indexValues,
    intersection,
    isCall,
    isFunction,
    isMember,
    isUndefinedValue,
    literalFields,
    literalStringSet,
    mapValues,
    memberName,
    selectedIndex,
    union
} from './GerberEvidenceValues.mjs'

const ANALYSIS_CACHE = new Map()
export { GerberFeatureEvidence } from './GerberFeatureEvidenceFacade.mjs'

/**
 * Returns one cached immutable lexical analysis per test source.
 * @param {string} source Test source.
 * @returns {Record<string, any>} Reachable evidence facts.
 */
export function analyzeSource(source) {
    let analysis = ANALYSIS_CACHE.get(source)
    if (!analysis) {
        analysis = new GerberEvidenceAnalyzer(source).analyze()
        ANALYSIS_CACHE.set(source, analysis)
    }
    return analysis
}

/**
 * Interprets only reachable JavaScript evidence while preserving scope.
 */
class GerberEvidenceAnalyzer {
    /**
     * @param {string} source JavaScript test source.
     */
    constructor(source) {
        this.source = source
        this.accesses = []
        this.invocations = new Set()
        this.delegations = new Map()
        this.keySets = []
        this.executing = new Set()
        this.throwCapture = new GerberEvidenceThrowCapture()
    }

    /**
     * Analyzes the complete test program.
     * @returns {Record<string, any>} Reachable evidence facts.
     */
    analyze() {
        const ast = parsers.babel.parse(this.source, {
            filepath: 'gerber-evidence.test.mjs'
        })
        this.#statements(
            ast.program.body,
            new GerberEvidenceEnvironment(null, {
                known: true,
                value: undefined
            })
        )
        return {
            accesses: this.accesses,
            invocations: this.invocations,
            delegations: this.delegations,
            keySets: this.keySets
        }
    }

    /**
     * Executes a statement list until all paths terminate.
     * @param {Record<string, any>[]} statements AST statements.
     * @param {GerberEvidenceEnvironment} environment Lexical environment.
     * @returns {{ terminated: boolean, abrupt: string, values: Set<string> }} Flow outcome.
     */
    #statements(statements, environment) {
        const values = new Set()
        const exits = []
        for (const statement of statements || []) {
            if (statement.type !== 'FunctionDeclaration') continue
            environment.declare(
                statement.id?.name,
                GerberEvidenceBinding.create(statement, new Set(), environment)
            )
        }
        for (const statement of statements || []) {
            const outcome = this.#statement(statement, environment)
            addAll(values, outcome.values)
            exits.push(...(outcome.exits || []))
            if (outcome.terminated) {
                return {
                    terminated: true,
                    abrupt: outcome.abrupt,
                    values,
                    exits
                }
            }
        }
        return { terminated: false, abrupt: '', values, exits }
    }

    /**
     * Executes one reachable statement.
     * @param {Record<string, any>} node Statement node.
     * @param {GerberEvidenceEnvironment} environment Lexical environment.
     * @param {string} [controlLabel] Label attached directly to this statement.
     * @returns {{ terminated: boolean, abrupt: string, values: Set<string> }} Flow outcome.
     */
    #statement(node, environment, controlLabel = '') {
        const open = () => ({
            terminated: false,
            abrupt: '',
            values: new Set(),
            exits: []
        })
        if (!node) return open()
        if (node.type === 'BlockStatement') {
            return this.#statements(
                node.body,
                new GerberEvidenceEnvironment(environment)
            )
        }
        if (node.type === 'ImportDeclaration') {
            const source = String(node.source?.value || '')
            for (const specifier of node.specifiers || []) {
                const binding = GerberEvidenceProvenance.importBinding(
                    specifier,
                    source
                )
                if (binding) environment.declare(specifier.local?.name, binding)
            }
            return open()
        }
        if (node.type === 'VariableDeclaration') {
            for (const declaration of node.declarations) {
                const values = this.#expression(declaration.init, environment)
                GerberEvidenceAnalyzerSupport.declarePattern(
                    declaration.id,
                    GerberEvidenceBinding.create(
                        declaration.init,
                        values,
                        environment
                    ),
                    environment
                )
            }
            return open()
        }
        if (node.type === 'FunctionDeclaration') {
            environment.declare(
                node.id?.name,
                GerberEvidenceBinding.create(node, new Set(), environment)
            )
            return open()
        }
        if (node.type === 'ClassDeclaration') {
            environment.declare(
                node.id?.name,
                GerberEvidenceBinding.create(node, new Set(), environment)
            )
            return open()
        }
        if (node.type === 'ExpressionStatement') {
            this.#expression(node.expression, environment)
            return open()
        }
        if (node.type === 'ReturnStatement') {
            return {
                terminated: true,
                abrupt: 'return',
                values: this.#expression(node.argument, environment)
            }
        }
        if (node.type === 'ThrowStatement') {
            return {
                terminated: true,
                abrupt: 'throw',
                values: this.#expression(node.argument, environment)
            }
        }
        if (
            node.type === 'BreakStatement' ||
            node.type === 'ContinueStatement'
        ) {
            return {
                terminated: true,
                abrupt: GerberControlFlow.encode(
                    node.type === 'BreakStatement' ? 'break' : 'continue',
                    node
                ),
                values: new Set()
            }
        }
        if (node.type === 'IfStatement') {
            const guarded = !environment.get('Array')
                ? GerberSourceCollectionGuard.expression(node.test)
                : null
            return GerberEvidenceBranchFlow.analyzeIf(
                node,
                environment,
                (expression, active) => this.#expression(expression, active),
                (statement, active) => {
                    if (guarded && statement === node.consequent) {
                        addAll(
                            active.collections,
                            this.#expression(guarded, active)
                        )
                    }
                    return this.#statement(statement, active)
                }
            )
        }
        if (
            [
                'ForStatement',
                'ForInStatement',
                'ForOfStatement',
                'WhileStatement',
                'DoWhileStatement'
            ].includes(node.type)
        ) {
            return GerberEvidenceBranchFlow.analyzeLoop(
                node,
                environment,
                controlLabel,
                (expression, active) => this.#expression(expression, active),
                (statement, active) => this.#statement(statement, active),
                (pattern, binding, active) =>
                    GerberEvidenceAnalyzerSupport.declarePattern(
                        pattern,
                        binding,
                        active
                    )
            )
        }
        if (node.type === 'TryStatement') {
            return GerberEvidenceTryFlow.analyze(
                node,
                environment,
                (statement, active) =>
                    this.throwCapture.run(() =>
                        this.#statement(statement, active)
                    ),
                (handler, active, values) => {
                    const scoped = new GerberEvidenceEnvironment(active)
                    GerberEvidenceAnalyzerSupport.declarePattern(
                        handler.param,
                        GerberEvidenceBinding.create(null, values, scoped),
                        scoped
                    )
                    return this.#statements(handler.body.body, scoped)
                }
            )
        }
        if (node.type === 'SwitchStatement') {
            const switchEnvironment = new GerberEvidenceEnvironment(environment)
            return GerberEvidenceSwitchFlow.analyze(
                node,
                switchEnvironment,
                (expression, active) => this.#expression(expression, active),
                (statements, active) => this.#statements(statements, active)
            )
        }
        if (node.type === 'LabeledStatement') {
            const label = node.label?.name || ''
            const outcome = this.#statement(node.body, environment, label)
            const consumed = (outcome.exits || []).filter((exit) =>
                GerberControlFlow.consumedByLabel(exit.abrupt, label)
            )
            const direct = GerberControlFlow.consumedByLabel(
                outcome.abrupt,
                label
            )
            if (direct || consumed.length) {
                environment.mergeFrom([
                    ...(!outcome.terminated || direct ? [environment] : []),
                    ...consumed.map((exit) => exit.environment)
                ])
                return {
                    terminated: false,
                    abrupt: '',
                    values: outcome.values,
                    exits: (outcome.exits || []).filter(
                        (exit) => !consumed.includes(exit)
                    )
                }
            }
            return outcome
        }
        if (
            node.type === 'ExportNamedDeclaration' ||
            node.type === 'ExportDefaultDeclaration'
        ) {
            return this.#statement(node.declaration, environment)
        }
        return open()
    }

    /**
     * Symbolically evaluates one reachable expression.
     * @param {Record<string, any> | null} node Expression node.
     * @param {GerberEvidenceEnvironment} environment Lexical environment.
     * @returns {Set<string>} Encoded origin/path pairs.
     */
    #expression(node, environment) {
        if (!node) return new Set()
        if (node.type === 'Identifier') {
            return new Set(environment.get(node.name)?.values || [])
        }
        if (isMember(node)) {
            if (GerberOptionalChain.skipsMember(node, environment)) {
                return this.#expression(node.object, environment)
            }
            return this.#member(node, environment)
        }
        if (isCall(node)) {
            if (GerberOptionalChain.skipsCall(node, environment)) {
                return this.#expression(node.callee, environment)
            }
            return this.#call(node, environment)
        }
        if (
            [
                'AwaitExpression',
                'TSAsExpression',
                'TSTypeAssertion',
                'TypeCastExpression',
                'ParenthesizedExpression',
                'ChainExpression'
            ].includes(node.type)
        ) {
            return this.#expression(
                node.argument || node.expression,
                environment
            )
        }
        if (node.type === 'AssignmentExpression') {
            if (node.operator !== '=') {
                const previous = this.#expression(node.left, environment)
                const truth = GerberStaticValue.truth(node.left, environment)
                const nullish = GerberStaticValue.nullish(
                    node.left,
                    environment
                )
                if (
                    (node.operator === '&&=' && truth === false) ||
                    (node.operator === '||=' && truth === true) ||
                    (node.operator === '??=' && nullish === false)
                ) {
                    return previous
                }
                const required =
                    (node.operator === '&&=' && truth === true) ||
                    (node.operator === '||=' && truth === false) ||
                    (node.operator === '??=' && nullish === true)
                if (!required) {
                    const skipped = environment.fork()
                    const assigned = environment.fork()
                    const values = this.#expression(
                        { ...node, operator: '=' },
                        assigned
                    )
                    environment.mergeFrom([skipped, assigned])
                    return union(previous, values)
                }
            }
            const revoked = GerberEvidenceProvenance.publicCallableIdentity(
                node.left,
                environment
            )
            if (revoked) environment.revokedCallables.add(revoked)
            if (isMember(node.left)) {
                GerberEvidenceCollectionMethod.recordOverride(
                    node.left,
                    environment,
                    (value, active) => this.#expression(value, active)
                )
            }
            const values = this.#expression(node.right, environment)
            const previous =
                node.left.type === 'Identifier'
                    ? new Set(environment.get(node.left.name)?.values || [])
                    : GerberEvidenceLValue.values(
                          node.left,
                          environment,
                          (value, active) => this.#expression(value, active)
                      )
            GerberEvidenceCollectionState.invalidate(
                environment.collections,
                previous
            )
            if (node.left.type === 'Identifier') {
                environment.assign(
                    node.left.name,
                    GerberEvidenceBinding.create(
                        node.right,
                        values,
                        environment
                    )
                )
            } else if (!isMember(node.left)) {
                for (const entry of GerberPatternAssignment.entries(
                    node.left,
                    node.right
                )) {
                    const entryValues = this.#expression(
                        entry.value,
                        environment
                    )
                    environment.assign(
                        entry.name,
                        GerberEvidenceBinding.create(
                            entry.value,
                            entryValues,
                            environment
                        )
                    )
                }
            }
            return values
        }
        if (node.type === 'ConditionalExpression') {
            const truth = GerberStaticValue.truth(node.test, environment)
            this.#expression(node.test, environment)
            if (truth === true)
                return this.#expression(node.consequent, environment)
            if (truth === false)
                return this.#expression(node.alternate, environment)
            const consequent = environment.fork()
            const alternate = environment.fork()
            const values = intersection(
                this.#expression(node.consequent, consequent),
                this.#expression(node.alternate, alternate)
            )
            environment.mergeFrom([consequent, alternate])
            return values
        }
        if (node.type === 'LogicalExpression') {
            const left = this.#expression(node.left, environment)
            const truth = GerberStaticValue.truth(node.left, environment)
            if (node.operator === '&&' && truth === false) return left
            if (node.operator === '||' && truth === true) return left
            const nullish = GerberStaticValue.nullish(node.left, environment)
            if (node.operator === '??' && nullish === false) return left
            const required =
                (node.operator === '&&' && truth === true) ||
                (node.operator === '||' && truth === false) ||
                (node.operator === '??' && nullish === true)
            if (required) {
                return union(left, this.#expression(node.right, environment))
            }
            const skipped = environment.fork()
            const right = environment.fork()
            const values = intersection(
                left,
                this.#expression(node.right, right)
            )
            environment.mergeFrom([skipped, right])
            return values
        }
        if (node.type === 'SequenceExpression') {
            let values = new Set()
            for (const expression of node.expressions) {
                values = this.#expression(expression, environment)
            }
            return values
        }
        if (node.type === 'TemplateLiteral') {
            for (const expression of node.expressions) {
                this.#expression(expression, environment)
            }
            return new Set()
        }
        if (
            (node.type === 'UnaryExpression' && node.operator === 'delete') ||
            node.type === 'UpdateExpression'
        ) {
            const targets = GerberEvidenceLValue.values(
                node.argument,
                environment,
                (value, active) => this.#expression(value, active)
            )
            GerberEvidenceCollectionState.invalidate(
                environment.collections,
                targets
            )
            return new Set()
        }
        if (node.type === 'UnaryExpression') {
            return this.#expression(node.argument, environment)
        }
        if (node.type === 'BinaryExpression') {
            this.#expression(node.left, environment)
            this.#expression(node.right, environment)
            return new Set()
        }
        if (node.type === 'ArrayExpression') {
            return union(
                ...(node.elements || []).map((element, index) =>
                    element?.type === 'SpreadElement'
                        ? new Set()
                        : indexValues(
                              this.#expression(element, environment),
                              index
                          )
                )
            )
        }
        if (node.type === 'ObjectExpression') {
            for (const property of node.properties) {
                if (property.type === 'SpreadElement') {
                    this.#expression(property.argument, environment)
                } else if (property.type !== 'ObjectMethod') {
                    this.#expression(property.value, environment)
                }
            }
        }
        return new Set()
    }

    /**
     * Resolves and records one member access.
     * @param {Record<string, any>} node Member node.
     * @param {GerberEvidenceEnvironment} environment Lexical environment.
     * @returns {Set<string>} Selected symbolic pairs.
     */
    #member(node, environment) {
        const values = this.#expression(node.object, environment)
        const property = memberName(node)
        if (!property) return values
        if (/^\d+$/u.test(property)) return selectedIndex(values, property)
        const selected = mapValues(values, property)
        for (const value of selected) this.accesses.push(decode(value))
        return selected
    }

    /**
     * Evaluates one call, including reachable callbacks and assertions.
     * @param {Record<string, any>} node Call node.
     * @param {GerberEvidenceEnvironment} environment Lexical environment.
     * @returns {Set<string>} Call result pairs.
     */
    #call(node, environment) {
        this.throwCapture.record(environment)
        const name = callName(node.callee)
        const assertionMethod = GerberEvidenceProvenance.assertionMethod(
            node.callee,
            environment
        )
        const assertion = Boolean(assertionMethod)
        for (const target of GerberEvidenceProvenance.assertedArrays(
            node.callee,
            node.arguments,
            environment
        )) {
            addAll(
                environment.collections,
                this.#expression(target, environment)
            )
        }
        const direct = GerberEvidenceProvenance.directCallable(
            node.callee,
            environment
        )
        if (direct) {
            this.invocations.add(direct)
            for (const argument of node.arguments) {
                this.#expression(argument.expression || argument, environment)
            }
            return new Set([encode(direct, '', `${node.start}:${node.end}`)])
        }
        if (assertion) {
            this.#assertion(node, environment, assertionMethod)
            return new Set()
        }

        if (isMember(node.callee)) {
            const method = memberName(node.callee)
            const receiver = this.#expression(node.callee.object, environment)
            if (
                GerberEvidenceProvenance.isCollectionMethod(method) &&
                !GerberEvidenceCollectionMethod.isOverridden(
                    node.callee.object,
                    receiver,
                    method,
                    environment
                ) &&
                GerberEvidenceProvenance.isCollection(
                    node.callee.object,
                    environment,
                    receiver,
                    environment.collections
                ) &&
                GerberEvidenceCollectionState.callbackReachable(
                    node.callee.object,
                    environment
                )
            ) {
                const firstArgument = node.arguments[0]
                const callbackNode = firstArgument?.expression || firstArgument
                const callbackBinding =
                    callbackNode?.type === 'Identifier'
                        ? environment.get(callbackNode.name)
                        : null
                const callback = isFunction(callbackNode)
                    ? { node: callbackNode, closure: environment }
                    : callbackBinding?.callable
                      ? {
                            node: callbackBinding.callable,
                            closure: callbackBinding.closure
                        }
                      : null
                const callbackArgument = callback ? firstArgument : null
                if (['reduce', 'reduceRight'].includes(method)) {
                    const initialNode =
                        node.arguments[1]?.expression || node.arguments[1]
                    const initial = initialNode
                        ? this.#argument(initialNode, environment)
                        : argument(receiver)
                    const reduced = callback
                        ? this.#execute(callback.node, callback.closure, [
                              initial,
                              argument(receiver)
                          ])
                        : new Set()
                    for (const extra of node.arguments.slice(2)) {
                        this.#expression(extra.expression || extra, environment)
                    }
                    return reduced
                }
                if (['map', 'flatMap'].includes(method) && callback) {
                    return this.#execute(callback.node, callback.closure, [
                        argument(receiver)
                    ])
                }
                if (callback) {
                    this.#execute(callback.node, callback.closure, [
                        argument(receiver)
                    ])
                }
                for (const argument of node.arguments.filter(
                    (candidate) => candidate !== callbackArgument
                )) {
                    this.#expression(
                        argument.expression || argument,
                        environment
                    )
                }
                return ['every', 'some', 'forEach'].includes(method)
                    ? new Set()
                    : receiver
            }
            const objectName = node.callee.object?.name
            const objectBinding = objectName
                ? environment.get(objectName)
                : null
            const objectMethod = objectBinding?.methods?.get(method)
            if (objectMethod) {
                const args = this.#arguments(node.arguments, environment)
                return this.#execute(
                    objectMethod,
                    objectBinding.closure,
                    args,
                    { known: true, value: Object.freeze({}) }
                )
            }
        }
        if (node.callee.type === 'Identifier') {
            const binding = environment.get(node.callee.name)
            if (binding?.callable) {
                const args = this.#arguments(node.arguments, environment)
                return this.#execute(binding.callable, binding.closure, args)
            }
        }
        if (isFunction(node.callee)) {
            const args = this.#arguments(node.arguments, environment)
            return this.#execute(node.callee, environment, args)
        }
        for (const argument of node.arguments) {
            const value = argument.expression || argument
            if (
                isFunction(value) &&
                GerberEvidenceProvenance.executesFrameworkCallback(name) &&
                node.callee.type === 'Identifier' &&
                environment.get(node.callee.name)?.frameworkCallback === true
            ) {
                this.#execute(value, environment, [])
            } else {
                this.#expression(value, environment)
            }
        }
        return new Set()
    }

    /**
     * Evaluates call arguments while preserving missing/default semantics.
     * @param {Record<string, any>[]} argumentsList Call arguments.
     * @param {GerberEvidenceEnvironment} environment Evidence environment.
     * @returns {{ values: Set<string>, undefined: boolean }[]} Arguments.
     */
    #arguments(argumentsList, environment) {
        return (argumentsList || []).map((candidate) =>
            this.#argument(candidate.expression || candidate, environment)
        )
    }

    /**
     * Evaluates one argument and records whether it triggers a default.
     * @param {Record<string, any>} node Argument expression.
     * @param {GerberEvidenceEnvironment} environment Evidence environment.
     * @returns {{ values: Set<string>, undefined: boolean }} Argument record.
     */
    #argument(node, environment) {
        return {
            values: this.#expression(node, environment),
            undefined:
                isUndefinedValue(node) &&
                !(node?.type === 'Identifier' && environment.get(node.name))
        }
    }

    /**
     * Executes a reachable function with symbolic arguments.
     * @param {Record<string, any>} node Function node.
     * @param {GerberEvidenceEnvironment} closure Captured environment.
     * @param {{ values: Set<string>, undefined?: boolean }[]} argumentsList Symbolic arguments.
     * @param {{ known: boolean, value?: any }} [thisValue] Call-site this binding.
     * @returns {Set<string>} Returned symbolic pairs.
     */
    #execute(
        node,
        closure,
        argumentsList,
        thisValue = { known: true, value: undefined }
    ) {
        if (node.generator) return new Set()
        const key = `${node.start}:${node.end}`
        if (this.executing.has(key)) return new Set()
        this.executing.add(key)
        const environment = new GerberEvidenceEnvironment(
            closure,
            node.type === 'ArrowFunctionExpression'
                ? closure.thisValue
                : thisValue
        )
        for (let index = 0; index < (node.params || []).length; index += 1) {
            const parameter = node.params[index]
            const supplied = argumentsList[index]
            const values =
                parameter.type === 'AssignmentPattern' &&
                (!supplied || supplied.undefined)
                    ? this.#expression(parameter.right, environment)
                    : supplied?.values || new Set()
            GerberEvidenceAnalyzerSupport.declarePattern(
                parameter,
                { values },
                environment
            )
        }
        const result =
            node.body.type === 'BlockStatement'
                ? this.#statements(node.body.body, environment).values
                : this.#expression(node.body, environment)
        this.executing.delete(key)
        return result
    }

    /**
     * Records exact literal, delegation, and Object.keys assertions.
     * @param {Record<string, any>} node Assertion call.
     * @param {GerberEvidenceEnvironment} environment Lexical environment.
     * @param {string} assertionMethod Canonical imported assertion method.
     * @returns {void}
     */
    #assertion(node, environment, assertionMethod) {
        const accessStart = this.accesses.length
        const [leftNode, rightNode] = node.arguments.map(
            (argument) => argument.expression || argument
        )
        const left = this.#expression(leftNode, environment)
        const right = this.#expression(rightNode, environment)
        const comparesValues = assertionMethod !== 'ok'
        const negative = new Set()
        if (comparesValues) {
            if (isUndefinedValue(rightNode)) addAll(negative, left)
            if (isUndefinedValue(leftNode)) addAll(negative, right)
            for (const [candidate, expected] of [
                [leftNode, rightNode],
                [rightNode, leftNode]
            ]) {
                const argument =
                    expected?.type === 'BooleanLiteral' && !expected.value
                        ? booleanArgument(candidate)
                        : null
                if (argument) {
                    addAll(negative, this.#expression(argument, environment))
                }
            }
        }
        const added = this.accesses.splice(accessStart)
        const negativePaths = [...negative].map(decode)
        this.accesses.push(
            ...added.filter(
                (access) =>
                    !negativePaths.some(
                        (excluded) =>
                            excluded.origin === access.origin &&
                            (excluded.path === access.path ||
                                excluded.path.startsWith(`${access.path}.`))
                    )
            )
        )
        for (const [candidate, literal] of comparesValues
            ? [
                  [left, rightNode],
                  [right, leftNode]
              ]
            : []) {
            for (const field of literalFields(literal)) {
                for (const value of mapValues(candidate, field)) {
                    this.accesses.push(decode(value))
                }
            }
        }
        for (const leftValue of comparesValues ? left : []) {
            for (const rightValue of right) {
                const leftPair = decode(leftValue)
                const rightPair = decode(rightValue)
                if (
                    leftPair.path ||
                    rightPair.path ||
                    !leftPair.origin ||
                    !rightPair.origin ||
                    leftPair.origin === rightPair.origin
                ) {
                    continue
                }
                addMapped(this.delegations, leftPair.origin, rightPair.origin)
                addMapped(this.delegations, rightPair.origin, leftPair.origin)
            }
        }
        for (const [keysNode, literal] of comparesValues
            ? [
                  [leftNode, rightNode],
                  [rightNode, leftNode]
              ]
            : []) {
            const target = GerberEvidenceAnalyzerSupport.objectKeysTarget(
                keysNode,
                environment,
                (candidate) => this.#expression(candidate, environment)
            )
            const keys = literalStringSet(literal)
            if (!target.size || !keys.size) continue
            for (const value of target) {
                this.keySets.push({ ...decode(value), keys })
            }
        }
    }
}
