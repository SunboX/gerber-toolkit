import { GerberControlFlow } from './GerberControlFlow.mjs'
import { GerberLoopIterationReachability } from './GerberLoopIterationReachability.mjs'
import { GerberOptionalChain } from './GerberOptionalChain.mjs'
import { GerberPatternAssignment } from './GerberPatternAssignment.mjs'
import { GerberSourceAstSupport } from './GerberSourceAstSupport.mjs'
import { GerberSourceBindingJoin } from './GerberSourceBindingJoin.mjs'
import { GerberSourceCollectionProvenance } from './GerberSourceCollectionProvenance.mjs'
import { GerberSourceCollectionGuard } from './GerberSourceCollectionGuard.mjs'
import { GerberSourceExpressionFlow } from './GerberSourceExpressionFlow.mjs'
import { GerberSourceLoopFlow } from './GerberSourceLoopFlow.mjs'
import { GerberSourceScope as CallableScope } from './GerberSourceScope.mjs'
import { GerberSourceSwitchFlow } from './GerberSourceSwitchFlow.mjs'
import { GerberSourceThrowCapture } from './GerberSourceThrowCapture.mjs'
import { GerberSourceTryFlow } from './GerberSourceTryFlow.mjs'
import { GerberStaticValue } from './GerberStaticValue.mjs'
import { GerberSourceDeclaration } from './GerberSourceDeclaration.mjs'

const expressionChildren = GerberSourceAstSupport.expressionChildren
const isCall = GerberSourceAstSupport.isCall
const isFunction = GerberSourceAstSupport.isFunction
const isMember = GerberSourceAstSupport.isMember
const memberTarget = GerberSourceAstSupport.memberTarget
const mergeFlows = GerberSourceAstSupport.mergeFlows
const parseCallable = GerberSourceAstSupport.parseCallable
const staticName = GerberSourceAstSupport.staticName

const COLLECTION_CALLBACK_METHODS = new Set([
    'every',
    'filter',
    'find',
    'findLast',
    'flatMap',
    'forEach',
    'map',
    'reduce',
    'reduceRight',
    'some'
])
const FLOW_OPEN = 'open'
const FLOW_RETURN = 'return'
const FLOW_THROW = 'throw'
const FLOW_ABRUPT = 'abrupt'

export { GerberSourceAst } from './GerberSourceAstFacade.mjs'

/**
 * Reachability-aware callable AST walker.
 */
export class GerberCallableAstAnalyzer {
    /**
     * @param {string} source Callable source.
     * @param {boolean} bodyOnly Whether source is only a body fragment.
     * @param {Map<string, Map<string, number>>} collectionParameters Structural collection paths.
     */
    constructor(source, bodyOnly, collectionParameters) {
        this.source = source
        const parsed = parseCallable(source, bodyOnly)
        this.callable = parsed.callable
        this.offset = parsed.offset
        this.bindings = []
        this.assignments = new Map()
        this.calls = []
        this.accesses = []
        this.mutations = []
        this.returns = []
        this.collectionGuards = []
        this.executing = new Set()
        this.abruptExits = []
        this.throwCapture = new GerberSourceThrowCapture(this.bindings)
        this.collectionParameters = collectionParameters
    }

    /**
     * Walks the outer callable and returns all normalized facts.
     * @returns {Record<string, any>} Callable facts.
     */
    analyze() {
        const body = this.callable.body
        const root = new CallableScope(
            null,
            this.#position(body.start),
            this.#position(body.end),
            { known: true, value: Object.freeze({}) }
        )
        for (const rawParameter of this.callable.params || []) {
            const parameter =
                rawParameter.type === 'AssignmentPattern'
                    ? rawParameter.left
                    : rawParameter
            if (rawParameter.type === 'AssignmentPattern') {
                this.#expression(rawParameter.right, root)
            }
            if (parameter.type === 'Identifier') {
                const collectionPaths =
                    this.collectionParameters.get(parameter.name) || new Map()
                root.declarations.set(parameter.name, {
                    parameter: true,
                    initializer:
                        rawParameter.type === 'AssignmentPattern'
                            ? rawParameter.right
                            : null,
                    collectionDepth: collectionPaths.get('') || 0,
                    collectionPaths,
                    scope: root
                })
            }
        }
        this.#statements(body.body || [], root, true)
        return {
            bindings: this.bindings,
            assignments: this.assignments,
            calls: this.calls,
            accesses: this.accesses,
            mutations: this.mutations,
            returns: this.returns,
            collectionGuards: this.collectionGuards
        }
    }

    /** Executes statements until an unconditional terminator. */
    #statements(statements, scope, outer) {
        for (const statement of statements || []) {
            if (statement.type !== 'FunctionDeclaration') continue
            this.#declare(
                statement.id,
                statement,
                scope,
                scope.start,
                'declaration'
            )
        }
        for (const statement of statements || []) {
            const flow = this.#statement(statement, scope, outer)
            if (flow !== FLOW_OPEN) return flow
        }
        return FLOW_OPEN
    }

    /** Executes one reachable statement. */
    #statement(node, scope, outer, controlLabel = '') {
        if (!node) return FLOW_OPEN
        if (node.type === 'BlockStatement') {
            return this.#statements(
                node.body,
                new CallableScope(
                    scope,
                    this.#position(node.start),
                    this.#position(node.end)
                ),
                outer
            )
        }
        if (node.type === 'VariableDeclaration') {
            for (const declaration of node.declarations) {
                this.#expression(declaration.init, scope)
                this.#declare(
                    declaration.id,
                    declaration.init,
                    scope,
                    this.#position(declaration.end)
                )
            }
            return FLOW_OPEN
        }
        if (node.type === 'FunctionDeclaration') {
            return FLOW_OPEN
        }
        if (node.type === 'ExpressionStatement') {
            this.#expression(node.expression, scope)
            return FLOW_OPEN
        }
        if (node.type === 'ReturnStatement') {
            this.#expression(node.argument, scope)
            if (outer && node.argument) {
                this.returns.push({
                    expression: this.#text(node.argument),
                    index: this.#position(node.argument.start),
                    bindings: this.#visibleBindings(scope)
                })
            }
            return FLOW_RETURN
        }
        if (node.type === 'ThrowStatement') {
            this.#expression(node.argument, scope)
            return FLOW_THROW
        }
        if (node.type === 'BreakStatement')
            return GerberControlFlow.encode('break', node)
        if (node.type === 'ContinueStatement')
            return GerberControlFlow.encode('continue', node)
        if (node.type === 'IfStatement') {
            this.#expression(node.test, scope)
            const truth = GerberStaticValue.truth(node.test, scope)
            const collectionGuard = !scope.get('Array')
                ? GerberSourceCollectionGuard.target(node.test)
                : null
            const consequentScope = collectionGuard
                ? this.#guardedScope(scope, node.consequent, collectionGuard)
                : scope
            if (truth === true)
                return this.#statement(node.consequent, consequentScope, outer)
            if (truth === false)
                return this.#statement(node.alternate, scope, outer)
            const baselineCount = this.bindings.length
            const baselineScope = GerberSourceBindingJoin.snapshot(scope)
            const leftInputs = GerberSourceBindingJoin.selectAlternatives(
                scope,
                node.test,
                true,
                (test, active) => GerberStaticValue.truth(test, active)
            )
            const rightInputs = GerberSourceBindingJoin.selectAlternatives(
                scope,
                node.test,
                false,
                (test, active) => GerberStaticValue.truth(test, active)
            )
            GerberSourceBindingJoin.mergeScopes(baselineScope, leftInputs)
            const left = this.#statement(
                node.consequent,
                consequentScope,
                outer
            )
            const leftRecords = this.bindings.slice(baselineCount)
            const leftScope = GerberSourceBindingJoin.snapshot(scope)
            GerberSourceBindingJoin.restore(baselineScope)
            GerberSourceBindingJoin.mergeScopes(baselineScope, rightInputs)
            const rightStart = this.bindings.length
            const right = this.#statement(node.alternate, scope, outer)
            const rightRecords = this.bindings.slice(rightStart)
            const rightScope = GerberSourceBindingJoin.snapshot(scope)
            this.#recordAbruptExit(left, leftRecords, leftScope, right)
            this.#recordAbruptExit(right, rightRecords, rightScope, left)
            const alternatives = []
            const scopeAlternatives = []
            if (left === FLOW_OPEN) {
                alternatives.push(leftRecords)
                scopeAlternatives.push(leftScope)
            }
            if (right === FLOW_OPEN) {
                alternatives.push(rightRecords)
                scopeAlternatives.push(rightScope)
            }
            GerberSourceBindingJoin.mergeScopes(
                baselineScope,
                scopeAlternatives
            )
            GerberSourceBindingJoin.mergeRecords(
                this.bindings,
                baselineCount,
                alternatives,
                this.#position(node.end)
            )
            return mergeFlows(left, right, Boolean(node.alternate))
        }
        if (node.type === 'ForOfStatement' || node.type === 'ForInStatement') {
            this.#expression(node.right, scope)
            if (
                GerberLoopIterationReachability.mayIterate(
                    node.type,
                    node.right,
                    scope
                ) === false
            ) {
                return FLOW_OPEN
            }
            const baselineCount = this.bindings.length
            const baselineScope = GerberSourceBindingJoin.snapshot(scope)
            const loop = new CallableScope(
                scope,
                this.#position(node.body.start),
                this.#position(node.body.end)
            )
            if (node.left.type === 'VariableDeclaration') {
                for (const declaration of node.left.declarations) {
                    this.#declare(
                        declaration.id,
                        node.right,
                        loop,
                        this.#position(node.body.start),
                        'iteration'
                    )
                }
            } else {
                this.#expression(node.left, loop)
            }
            const bodyStart = this.bindings.length
            const exitStart = this.abruptExits.length
            const bodyFlow = this.#statement(node.body, loop, outer)
            const loopExits = this.#consumeLoopExits(exitStart, controlLabel)
            const bodyRecords = this.bindings.slice(bodyStart)
            const bodyScope = GerberSourceBindingJoin.snapshot(scope)
            const consumed = GerberControlFlow.consumedByLoop(
                bodyFlow,
                controlLabel
            )
            const bodyReachesExit = bodyFlow === FLOW_OPEN || consumed
            GerberSourceBindingJoin.mergeScopes(baselineScope, [
                baselineScope,
                ...(bodyReachesExit ? [bodyScope] : []),
                ...loopExits.map((exit) => exit.scope)
            ])
            GerberSourceBindingJoin.mergeRecords(
                this.bindings,
                baselineCount,
                [
                    [],
                    ...(bodyReachesExit ? [bodyRecords] : []),
                    ...loopExits.map((exit) => exit.records)
                ],
                this.#position(node.end)
            )
            if (consumed || loopExits.length) {
                return FLOW_OPEN
            }
            return FLOW_OPEN
        }
        if (
            ['ForStatement', 'WhileStatement', 'DoWhileStatement'].includes(
                node.type
            )
        ) {
            const loop = new CallableScope(
                scope,
                this.#position(node.body.start),
                this.#position(node.body.end)
            )
            if (node.init?.type === 'VariableDeclaration') {
                this.#statement(node.init, loop, outer)
            } else {
                this.#expression(node.init, loop)
            }
            if (node.type !== 'DoWhileStatement') {
                this.#expression(node.test, loop)
            }
            const truth =
                node.type === 'DoWhileStatement'
                    ? true
                    : node.test
                      ? GerberStaticValue.truth(node.test, loop)
                      : true
            const guaranteedEntry =
                node.type === 'DoWhileStatement' || truth === true
            const baselineCount = this.bindings.length
            const baselineScope = GerberSourceBindingJoin.snapshot(scope)
            const bodyStart = this.bindings.length
            let bodyFlow = FLOW_OPEN
            let consumed = false
            let bodyReachesExit = false
            let nextTruth = truth
            const loopExits = []
            let iterations = 0
            while (
                ((node.type === 'DoWhileStatement' && iterations === 0) ||
                    nextTruth !== false) &&
                iterations < 8
            ) {
                const exitStart = this.abruptExits.length
                bodyFlow = this.#statement(node.body, loop, outer)
                const iterationExits = this.#consumeLoopExits(
                    exitStart,
                    controlLabel
                )
                loopExits.push(...iterationExits)
                const iterationConsumed = GerberControlFlow.consumedByLoop(
                    bodyFlow,
                    controlLabel
                )
                consumed = consumed || iterationConsumed
                bodyReachesExit =
                    bodyReachesExit ||
                    bodyFlow === FLOW_OPEN ||
                    iterationConsumed
                const kind = GerberControlFlow.kind(bodyFlow)
                const continues =
                    bodyFlow === FLOW_OPEN ||
                    (iterationConsumed && kind === 'continue') ||
                    iterationExits.some(
                        (exit) =>
                            GerberControlFlow.kind(exit.flow) === 'continue'
                    )
                if (continues) {
                    this.#expression(node.update, loop)
                    this.#expression(node.test, loop)
                }
                nextTruth = node.test
                    ? GerberStaticValue.truth(node.test, loop)
                    : true
                iterations += 1
                if (!continues || nextTruth !== true) break
            }
            const bodyRecords = this.bindings.slice(bodyStart)
            const bodyScope = GerberSourceBindingJoin.snapshot(scope)
            const alternatives = []
            const scopeAlternatives = []
            if (!guaranteedEntry || truth === false) {
                alternatives.push([])
                scopeAlternatives.push(baselineScope)
            }
            if (truth !== false && bodyReachesExit) {
                alternatives.push(bodyRecords)
                scopeAlternatives.push(bodyScope)
            }
            for (const exit of loopExits) {
                alternatives.push(exit.records)
                scopeAlternatives.push(exit.scope)
            }
            GerberSourceBindingJoin.mergeScopes(
                baselineScope,
                scopeAlternatives
            )
            GerberSourceBindingJoin.mergeRecords(
                this.bindings,
                baselineCount,
                alternatives,
                this.#position(node.end)
            )
            return GerberSourceLoopFlow.completion({
                bodyFlow,
                consumed,
                loopExits,
                guaranteedEntry,
                nextTruth
            })
        }
        if (node.type === 'TryStatement') {
            return GerberSourceTryFlow.analyze({
                node,
                scope,
                outer,
                bindings: this.bindings,
                returns: this.returns,
                abruptExits: this.abruptExits,
                position: (value) => this.#position(value),
                executeTry: (statement, activeScope, activeOuter, start) =>
                    this.throwCapture.run(start, () =>
                        this.#statement(statement, activeScope, activeOuter)
                    ),
                executeHandler: (
                    handler,
                    initializer,
                    activeScope,
                    activeOuter
                ) => {
                    const handlerScope = new CallableScope(
                        activeScope,
                        this.#position(handler.body.start),
                        this.#position(handler.body.end)
                    )
                    this.#declare(
                        handler.param,
                        initializer,
                        handlerScope,
                        this.#position(handler.body.start)
                    )
                    return this.#statements(
                        handler.body.body,
                        handlerScope,
                        activeOuter
                    )
                }
            })
        }
        if (node.type === 'SwitchStatement') {
            const switchScope = new CallableScope(
                scope,
                this.#position(node.start),
                this.#position(node.end)
            )
            return GerberSourceSwitchFlow.analyze({
                node,
                scope: switchScope,
                outer,
                bindings: this.bindings,
                position: (value) => this.#position(value),
                evaluate: (expression, activeScope) =>
                    this.#expression(expression, activeScope),
                executeStatements: (statements, activeScope, activeOuter) =>
                    this.#statements(statements, activeScope, activeOuter)
            })
        }
        if (node.type === 'LabeledStatement') {
            const label = node.label?.name || ''
            const baselineCount = this.bindings.length
            const baselineScope = GerberSourceBindingJoin.snapshot(scope)
            const exitStart = this.abruptExits.length
            const flow = this.#statement(node.body, scope, outer, label)
            const candidates = this.abruptExits.splice(exitStart)
            const consumed = candidates.filter((exit) =>
                GerberControlFlow.consumedByLabel(exit.flow, label)
            )
            this.abruptExits.push(
                ...candidates.filter((exit) => !consumed.includes(exit))
            )
            const direct = GerberControlFlow.consumedByLabel(flow, label)
            if (direct || consumed.length) {
                GerberSourceBindingJoin.mergeScopes(baselineScope, [
                    ...(flow === FLOW_OPEN || direct
                        ? [GerberSourceBindingJoin.snapshot(scope)]
                        : []),
                    ...consumed.map((exit) => exit.scope)
                ])
                GerberSourceBindingJoin.mergeRecords(
                    this.bindings,
                    baselineCount,
                    [
                        ...(flow === FLOW_OPEN || direct
                            ? [this.bindings.slice(baselineCount)]
                            : []),
                        ...consumed.map((exit) => exit.records)
                    ],
                    this.#position(node.end)
                )
                return FLOW_OPEN
            }
            return flow
        }
        return FLOW_OPEN
    }

    /** Retains one mixed break/continue path while its sibling stays open. */
    #recordAbruptExit(flow, records, scope, siblingFlow) {
        void siblingFlow
        if (flow !== FLOW_OPEN) {
            this.abruptExits.push({ flow, records, scope })
        }
    }

    /** Captures exact visible initializer sources at one completion point. */
    #visibleBindings(scope) {
        const bindings = new Map()
        for (let current = scope; current; current = current.parent) {
            for (const [name, binding] of current.declarations) {
                if (!bindings.has(name) && binding?.initializer) {
                    bindings.set(name, this.#text(binding.initializer))
                }
            }
        }
        return bindings
    }

    /** Removes mixed exits consumed by the active loop. */
    #consumeLoopExits(start, controlLabel) {
        const candidates = this.abruptExits.splice(start)
        const consumed = candidates.filter((exit) =>
            GerberControlFlow.consumedByLoop(exit.flow, controlLabel)
        )
        this.abruptExits.push(
            ...candidates.filter((exit) => !consumed.includes(exit))
        )
        return consumed
    }

    /** Creates a consequent scope carrying one exact Array member proof. */
    #guardedScope(scope, consequent, guard) {
        const start = this.#position(consequent.start)
        const end = this.#position(consequent.end)
        const guarded = new CallableScope(scope, start, end)
        const inherited = scope.get(guard.root) || {}
        const collectionPaths = new Map(inherited.collectionPaths || [])
        collectionPaths.set(guard.path, 1)
        guarded.declarations.set(guard.root, {
            ...inherited,
            collectionDepth:
                guard.path === ''
                    ? Math.max(1, inherited.collectionDepth || 0)
                    : inherited.collectionDepth || 0,
            collectionPaths
        })
        this.collectionGuards.push({ ...guard, start, end, depth: 1 })
        return guarded
    }

    /** Walks one reachable expression and records its side effects. */
    #expression(node, scope) {
        if (!node) return
        if (node.type === 'UnaryExpression' && node.operator === 'delete') {
            const target = memberTarget(node.argument)
            if (target?.path) {
                this.mutations.push({
                    type: 'delete',
                    ...target,
                    arguments: [],
                    index: this.#position(node.start)
                })
            }
            this.#expression(node.argument, scope)
            return
        }
        if (isCall(node)) {
            if (GerberOptionalChain.skipsCall(node, scope)) {
                this.#expression(node.callee, scope)
                return
            }
            this.#call(node, scope)
            return
        }
        if (node.type === 'AssignmentExpression') {
            if (node.operator !== '=') {
                this.#expression(node.left, scope)
                const truth = GerberStaticValue.truth(node.left, scope)
                const nullish = GerberStaticValue.nullish(node.left, scope)
                const skipped =
                    (node.operator === '&&=' && truth === false) ||
                    (node.operator === '||=' && truth === true) ||
                    (node.operator === '??=' && nullish === false)
                if (skipped) return
                const required =
                    (node.operator === '&&=' && truth === true) ||
                    (node.operator === '||=' && truth === false) ||
                    (node.operator === '??=' && nullish === true)
                const assignment = { ...node, operator: '=' }
                if (!required) {
                    GerberSourceExpressionFlow.join({
                        alternatives: [null, assignment],
                        scope,
                        bindings: this.bindings,
                        position: this.#position(node.end),
                        evaluate: (value, active) =>
                            this.#expression(value, active)
                    })
                    return
                }
            }
            this.#expression(node.right, scope)
            if (node.left.type === 'Identifier') {
                const owner = scope.owner(node.left.name) || scope
                this.#recordBinding(
                    node.left.name,
                    node.right,
                    owner,
                    this.#position(node.end),
                    'assignment'
                )
            } else if (isMember(node.left)) {
                const target = memberTarget(node.left)
                if (target) {
                    const values = this.assignments.get(target.root) || []
                    const assignment = {
                        index: this.#position(node.start),
                        path: target.path,
                        expression: this.#text(node.right)
                    }
                    values.push(assignment)
                    this.assignments.set(target.root, values)
                    this.mutations.push({
                        type: 'assignment',
                        root: target.root,
                        path: target.path,
                        arguments: [assignment.expression],
                        index: assignment.index
                    })
                }
                this.#recordAccess(node.left)
                this.#expression(node.left.object, scope)
                if (node.left.computed) {
                    this.#expression(node.left.property, scope)
                }
            } else {
                for (const entry of GerberPatternAssignment.entries(
                    node.left,
                    node.right
                )) {
                    const owner = scope.owner(entry.name) || scope
                    this.#recordBinding(
                        entry.name,
                        entry.value,
                        owner,
                        this.#position(node.end),
                        'assignment'
                    )
                }
            }
            return
        }
        if (node.type === 'LogicalExpression') {
            this.#expression(node.left, scope)
            const truth = GerberStaticValue.truth(node.left, scope)
            if (node.operator === '&&' && truth === false) return
            if (node.operator === '||' && truth === true) return
            const nullish = GerberStaticValue.nullish(node.left, scope)
            if (node.operator === '??' && nullish === false) return
            const required =
                (node.operator === '&&' && truth === true) ||
                (node.operator === '||' && truth === false) ||
                (node.operator === '??' && nullish === true)
            if (required) this.#expression(node.right, scope)
            else {
                GerberSourceExpressionFlow.join({
                    alternatives: [null, node.right],
                    scope,
                    bindings: this.bindings,
                    position: this.#position(node.end),
                    evaluate: (value, active) => this.#expression(value, active)
                })
            }
            return
        }
        if (node.type === 'ConditionalExpression') {
            this.#expression(node.test, scope)
            const truth = GerberStaticValue.truth(node.test, scope)
            if (truth === true) this.#expression(node.consequent, scope)
            else if (truth === false) this.#expression(node.alternate, scope)
            else {
                GerberSourceExpressionFlow.join({
                    alternatives: [node.consequent, node.alternate],
                    scope,
                    bindings: this.bindings,
                    position: this.#position(node.end),
                    evaluate: (value, active) => this.#expression(value, active)
                })
            }
            return
        }
        if (isMember(node)) {
            this.#expression(node.object, scope)
            if (GerberOptionalChain.skipsMember(node, scope)) return
            this.#recordAccess(node)
            if (node.computed) this.#expression(node.property, scope)
            return
        }
        if (isFunction(node) || node.type === 'ObjectMethod') return
        if (node.type === 'ObjectExpression') {
            for (const property of node.properties) {
                if (property.type === 'SpreadElement') {
                    this.#expression(property.argument, scope)
                } else if (property.type !== 'ObjectMethod') {
                    this.#expression(property.value, scope)
                }
            }
            return
        }
        if (node.type === 'TemplateLiteral') {
            for (const expression of node.expressions) {
                this.#expression(expression, scope)
            }
            return
        }
        for (const child of expressionChildren(node)) {
            this.#expression(child, scope)
        }
    }

    /** Records one call and executes proven synchronous callbacks. */
    #call(node, scope) {
        this.throwCapture.record(scope)
        const callee = node.callee
        const argumentsList = node.arguments.map((argument) =>
            this.#text(argument.expression || argument)
        )
        if (isMember(callee)) {
            this.#recordAccess(callee)
            const methodName = staticName(callee)
            const receiver = this.#text(callee.object)
            if (
                /^[A-Za-z_$][\w$]*(?:(?:\?\.|\.)[A-Za-z_$][\w$]*)*$/u.test(
                    receiver
                )
            ) {
                this.calls.push({
                    receiver,
                    methodName,
                    arguments: argumentsList,
                    index: this.#position(node.start)
                })
            }
            const target = memberTarget(callee.object)
            if (methodName === 'push' && target) {
                this.mutations.push({
                    type: 'push',
                    ...target,
                    arguments: argumentsList,
                    index: this.#position(node.start)
                })
            } else if (methodName === 'splice' && target) {
                this.mutations.push({
                    type: 'splice',
                    ...target,
                    arguments: argumentsList,
                    index: this.#position(node.start)
                })
            } else if (methodName === 'set' && target) {
                this.mutations.push({
                    type: 'set',
                    ...target,
                    arguments: argumentsList.slice(1, 2),
                    index: this.#position(node.start)
                })
            } else if (
                receiver === 'Object' &&
                methodName === 'assign' &&
                !scope.get('Object')
            ) {
                const assigned = memberTarget(node.arguments[0])
                if (assigned) {
                    this.mutations.push({
                        type: 'assign',
                        ...assigned,
                        arguments: argumentsList.slice(1),
                        index: this.#position(node.start)
                    })
                }
            }
            const collectionDepth = GerberSourceCollectionProvenance.depth(
                callee.object,
                scope
            )
            if (
                COLLECTION_CALLBACK_METHODS.has(methodName) &&
                collectionDepth > 0 &&
                GerberSourceCollectionProvenance.mayHaveElements(
                    callee.object,
                    scope
                )
            ) {
                const callbackIndex = node.arguments.findIndex(isFunction)
                if (callbackIndex >= 0) {
                    const callbackArguments = [
                        'reduce',
                        'reduceRight'
                    ].includes(methodName)
                        ? [argumentsList[1] || '', receiver]
                        : [receiver]
                    const callbackDepths = ['reduce', 'reduceRight'].includes(
                        methodName
                    )
                        ? [0, Math.max(0, collectionDepth - 1)]
                        : [Math.max(0, collectionDepth - 1)]
                    this.#execute(
                        node.arguments[callbackIndex],
                        scope,
                        callbackArguments,
                        callbackDepths
                    )
                }
            }
            const objectName = callee.object?.name
            const local = objectName ? scope.get(objectName) : null
            const method = local?.objectMethods?.get(methodName)
            if (method) {
                this.#execute(method, local.scope, argumentsList, [], {
                    known: true,
                    value: Object.freeze({})
                })
            }
            this.#expression(callee.object, scope)
        } else if (callee.type === 'Identifier') {
            const local = scope.get(callee.name)
            if (local?.callable) {
                this.#execute(local.callable, local.scope, argumentsList)
            }
        } else if (isFunction(callee)) {
            this.#execute(callee, scope, argumentsList)
        }
        for (const argument of node.arguments) {
            const value = argument.expression || argument
            if (!isFunction(value)) this.#expression(value, scope)
        }
    }

    /** Records one reachable static member-access path. */
    #recordAccess(node) {
        const target = memberTarget(node)
        if (!target?.path) return
        this.accesses.push({ ...target, index: this.#position(node.start) })
    }

    /** Executes one reachable nested callback. */
    #execute(
        node,
        parent,
        argumentsList,
        argumentDepths = [],
        thisValue = { known: true, value: undefined }
    ) {
        const key = `${node.start}:${node.end}`
        if (this.executing.has(key)) return
        this.executing.add(key)
        const body = node.body
        const scope = new CallableScope(
            parent,
            this.#position(body.start),
            this.#position(body.end),
            node.type === 'ArrowFunctionExpression'
                ? parent.thisValue
                : thisValue
        )
        for (let index = 0; index < (node.params || []).length; index += 1) {
            const argument = argumentsList[index] || ''
            const expression = argument
                ? { start: this.offset, end: this.offset }
                : null
            this.#declareSource(
                node.params[index],
                argument,
                expression,
                scope,
                this.#position(body.start),
                'callback',
                argumentDepths[index] || 0
            )
        }
        if (body.type === 'BlockStatement') {
            this.#statements(body.body, scope, false)
        } else {
            this.#expression(body, scope)
        }
        this.executing.delete(key)
    }

    /** Declares a binding pattern from an AST initializer. */
    #declare(pattern, initializer, scope, start, kind = 'declaration') {
        GerberSourceDeclaration.declare({
            pattern,
            initializer,
            scope,
            start,
            kind,
            bindings: this.bindings,
            accesses: this.accesses,
            position: (value) => this.#position(value),
            text: (node) => this.#text(node)
        })
    }

    /** Declares a binding pattern from explicit source text. */
    #declareSource(
        pattern,
        expression,
        initializer,
        scope,
        start,
        kind,
        collectionDepth = 0
    ) {
        GerberSourceDeclaration.declareSource({
            pattern,
            expression,
            initializer,
            scope,
            start,
            kind,
            collectionDepth,
            bindings: this.bindings
        })
    }

    /** Records one AST-backed lexical binding. */
    #recordBinding(name, initializer, scope, start, kind) {
        GerberSourceDeclaration.recordBinding({
            name,
            initializer,
            scope,
            start,
            kind,
            bindings: this.bindings,
            text: (node) => this.#text(node)
        })
    }

    /** Converts parser coordinates to callable-source coordinates. */
    #position(value) {
        return Math.max(0, Number(value || 0) - this.offset)
    }

    /** Slices one AST node from the original callable source. */
    #text(node) {
        return this.source.slice(
            this.#position(node.start),
            this.#position(node.end)
        )
    }
}
