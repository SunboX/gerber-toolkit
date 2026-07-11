import { GerberSourceExpression } from './GerberSourceExpression.mjs'

/**
 * Resolves own public keys and values of returned object literals.
 */
export class GerberResultObjectAnalysis {
    /**
     * Adds one object literal body to an abstract result shape.
     * @param {{ source: string, prefix: string, state: Record<string, any>, shape: Record<string, any>, resolving: Set<string>, position: number, analyze: Function }} options Analysis inputs.
     * @returns {void}
     */
    static analyze(options) {
        for (const part of GerberSourceExpression.splitTopLevel(
            options.source
        )) {
            const trimmed = part.trim()
            if (trimmed.startsWith('...')) {
                options.analyze(
                    trimmed.slice(3),
                    options.prefix,
                    options.state,
                    options.shape,
                    options.resolving,
                    options.position
                )
                continue
            }
            const member = objectMember(trimmed)
            if (!member.name) continue
            const path = GerberSourceExpression.path(
                options.prefix,
                member.name
            )
            options.shape.fields.add(path)
            if (member.value) {
                options.analyze(
                    member.value,
                    path,
                    options.state,
                    options.shape,
                    options.resolving,
                    options.position
                )
            }
        }
    }
}

/**
 * Parses one static object member without entering method/accessor bodies.
 * @param {string} source Member source.
 * @returns {{ name: string, value: string }} Member contract.
 */
function objectMember(source) {
    const colon = GerberSourceExpression.topLevelToken(source, ':')
    if (colon >= 0) {
        const key = source.slice(0, colon).trim()
        return {
            name: staticKey(key),
            value: source.slice(colon + 1).trim()
        }
    }
    const callable =
        /^(?:(?:async|get|set)\s+)?(?:\*\s*)?([A-Za-z_$][\w$]*)\s*\(/u.exec(
            source
        )
    if (callable) return { name: callable[1], value: '' }
    const shorthand = /^([A-Za-z_$][\w$]*)$/u.exec(source)
    return shorthand
        ? { name: shorthand[1], value: shorthand[1] }
        : { name: '', value: '' }
}

/**
 * Resolves an identifier or literal property key.
 * @param {string} source Property key source.
 * @returns {string} Static key or empty string.
 */
function staticKey(source) {
    const identifier = /^([A-Za-z_$][\w$]*)\??$/u.exec(source)
    if (identifier) return identifier[1]
    const literal = /^(?:\[)?(['"])(.*?)\1(?:\])?$/u.exec(source)
    return literal?.[2] || ''
}
