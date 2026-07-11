import { parsers } from 'prettier/plugins/babel'

import { GerberSourceAstSupport } from './GerberSourceAstSupport.mjs'
import { GerberSourceExpression } from './GerberSourceExpression.mjs'

const STATIC_BUILT_INS = new Set(['length', 'name', 'prototype'])

/**
 * Describes the complete public class surface without invoking user code.
 */
export class GerberPublicApiSurface {
    /**
     * Lists public own and inherited members visible on one export.
     * @param {unknown} value Exported value.
     * @returns {Record<string, string[]>} Stable member names by category.
     */
    static describe(value) {
        if (typeof value !== 'function') return emptySurface()
        const staticDescriptors = descriptorCatalog(
            constructorChain(value),
            STATIC_BUILT_INS
        )
        const instanceDescriptors = descriptorCatalog(
            prototypeChain(value.prototype),
            new Set(['constructor'])
        )
        const staticFields = namesMatching(
            staticDescriptors,
            (descriptor) =>
                typeof descriptor.value !== 'function' &&
                typeof descriptor.get !== 'function' &&
                typeof descriptor.set !== 'function'
        )
        const instanceFields = new Set()
        for (const owner of constructorChain(value)) {
            for (const name of declaredInstanceFields(owner)) {
                instanceFields.add(name)
            }
        }
        return {
            staticMethods: namesMatching(
                staticDescriptors,
                (descriptor) => typeof descriptor.value === 'function'
            ),
            staticAccessors: namesMatching(
                staticDescriptors,
                (descriptor) =>
                    typeof descriptor.get === 'function' ||
                    typeof descriptor.set === 'function'
            ),
            staticFields,
            instanceMethods: namesMatching(
                instanceDescriptors,
                (descriptor) => typeof descriptor.value === 'function'
            ),
            instanceAccessors: namesMatching(
                instanceDescriptors,
                (descriptor) =>
                    typeof descriptor.get === 'function' ||
                    typeof descriptor.set === 'function'
            ),
            instanceFields: [...instanceFields].sort()
        }
    }

    /**
     * Finds a public descriptor without evaluating an accessor.
     * @param {Function} value Exported class or function.
     * @param {'static' | 'instance'} placement Member placement.
     * @param {string} name Member name.
     * @returns {PropertyDescriptor | undefined} Nearest descriptor.
     */
    static descriptor(value, placement, name) {
        const owners =
            placement === 'static'
                ? constructorChain(value)
                : prototypeChain(value.prototype)
        for (const owner of owners) {
            const descriptor = Object.getOwnPropertyDescriptor(owner, name)
            if (descriptor) return descriptor
        }
        return undefined
    }

    /**
     * Captures async and generator call semantics from callable source.
     * @param {string} source Callable source.
     * @returns {{ async: boolean, generator: boolean, resultKind: string }} Semantics.
     */
    static callableSemantics(source) {
        const { callable } = GerberSourceAstSupport.parseCallable(source, false)
        const async = Boolean(callable.async)
        const generator = Boolean(callable.generator)
        return {
            async,
            generator,
            resultKind: async
                ? generator
                    ? 'async-iterator'
                    : 'promise'
                : generator
                  ? 'iterator'
                  : 'value'
        }
    }
}

/**
 * Creates an empty non-callable surface.
 * @returns {Record<string, string[]>} Empty member catalog.
 */
function emptySurface() {
    return {
        staticMethods: [],
        staticAccessors: [],
        staticFields: [],
        instanceMethods: [],
        instanceAccessors: [],
        instanceFields: []
    }
}

/**
 * Lists an exported constructor and its public class ancestors.
 * @param {Function} value Starting constructor.
 * @returns {Function[]} Constructor chain, nearest first.
 */
function constructorChain(value) {
    const owners = []
    for (
        let current = value;
        typeof current === 'function' && current !== Function.prototype;
        current = Object.getPrototypeOf(current)
    ) {
        owners.push(current)
    }
    return owners
}

/**
 * Lists an exported prototype and its public class ancestors.
 * @param {Record<string, any> | undefined} value Starting prototype.
 * @returns {Record<string, any>[]} Prototype chain, nearest first.
 */
function prototypeChain(value) {
    const owners = []
    for (
        let current = value;
        current && current !== Object.prototype;
        current = Object.getPrototypeOf(current)
    ) {
        owners.push(current)
    }
    return owners
}

/**
 * Builds nearest-wins descriptors for a prototype or constructor chain.
 * @param {object[]} owners Chain owners.
 * @param {Set<string>} excluded Excluded built-in names.
 * @returns {Map<string, PropertyDescriptor>} Descriptors by public name.
 */
function descriptorCatalog(owners, excluded) {
    const descriptors = new Map()
    for (const owner of owners) {
        for (const name of Object.getOwnPropertyNames(owner)) {
            if (excluded.has(name) || name.startsWith('#')) continue
            if (!descriptors.has(name)) {
                descriptors.set(
                    name,
                    Object.getOwnPropertyDescriptor(owner, name)
                )
            }
        }
    }
    return descriptors
}

/**
 * Selects sorted member names by descriptor predicate.
 * @param {Map<string, PropertyDescriptor>} descriptors Member descriptors.
 * @param {(descriptor: PropertyDescriptor) => boolean} predicate Selector.
 * @returns {string[]} Selected names.
 */
function namesMatching(descriptors, predicate) {
    return [...descriptors]
        .filter(([, descriptor]) => predicate(descriptor))
        .map(([name]) => name)
        .sort()
}

/**
 * Parses declared and assigned public instance fields from one class.
 * @param {Function} owner Class constructor.
 * @returns {string[]} Public field names.
 */
function declaredInstanceFields(owner) {
    const source = Function.prototype.toString.call(owner)
    if (!/^class\s/u.test(source)) return []
    const names = new Set()
    try {
        const ast = parsers.babel.parse(`(${source})`, {
            filepath: 'gerber-public-surface.mjs'
        })
        const classNode = ast.program.body[0]?.expression
        for (const member of classNode?.body?.body || []) {
            if (
                !member.static &&
                ['ClassProperty', 'PropertyDefinition'].includes(member.type)
            ) {
                const name = publicKeyName(member)
                if (name) names.add(name)
            }
        }
    } catch {
        return []
    }
    const mask = GerberSourceExpression.codeMask(source)
    for (const match of mask.matchAll(
        /\bthis\.([A-Za-z_$][\w$]*)\s*=(?!=)/gu
    )) {
        names.add(match[1])
    }
    return [...names]
}

/**
 * Resolves a non-private, statically named class property.
 * @param {Record<string, any>} member Class member node.
 * @returns {string} Public name or empty string.
 */
function publicKeyName(member) {
    if (member.key?.type === 'PrivateName') return ''
    if (member.computed && member.key?.type !== 'StringLiteral') return ''
    if (member.key?.type === 'Identifier') return member.key.name
    if (['StringLiteral', 'NumericLiteral'].includes(member.key?.type)) {
        return String(member.key.value)
    }
    return ''
}
