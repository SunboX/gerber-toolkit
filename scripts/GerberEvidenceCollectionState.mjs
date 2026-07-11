import { GerberSourceCollectionProvenance } from './GerberSourceCollectionProvenance.mjs'

/**
 * Maintains flow-sensitive collection proofs for evidence callbacks.
 */
export class GerberEvidenceCollectionState {
    /**
     * Removes collection proofs invalidated by an assignment target.
     * @param {Set<string>} collections Encoded proven collections.
     * @param {Set<string>} targets Encoded assignment targets.
     * @returns {void}
     */
    static invalidate(collections, targets) {
        for (const proof of [...collections]) {
            const proven = decode(proof)
            if (
                [...targets].some((target) => {
                    const assigned = decode(target)
                    return (
                        assigned.origin === proven.origin &&
                        (assigned.path === proven.path ||
                            proven.path.startsWith(`${assigned.path}.`))
                    )
                })
            ) {
                collections.delete(proof)
            }
        }
    }

    /**
     * Checks whether a proven collection receiver can execute a callback.
     * @param {Record<string, any>} receiver Receiver expression.
     * @param {Record<string, any>} environment Lexical environment.
     * @returns {boolean} Whether the receiver is not definitely empty.
     */
    static callbackReachable(receiver, environment) {
        return GerberSourceCollectionProvenance.mayHaveElements(
            receiver,
            environment
        )
    }
}

/**
 * Decodes one symbolic origin/path value.
 * @param {string} value Encoded pair.
 * @returns {{ origin: string, path: string }} Pair.
 */
function decode(value) {
    const separator = value.indexOf('\u0000')
    return {
        origin: value.slice(0, separator),
        path: value.slice(separator + 1)
    }
}
