import { DocumentResult, ToolkitAsset } from 'circuitjson-toolkit/parser'

import { GerberParser } from '../core/gerber/GerberParser.mjs'
import { GerberCircuitJsonProjector } from './GerberCircuitJsonProjector.mjs'
import { ParserInput } from './ParserInput.mjs'

/** Converts native Gerber parses into canonical CircuitJSON envelopes. */
export class GerberDocumentBuilder {
    /**
     * Runs the native parser exactly once.
     * @param {Record<string, any>} normalized Normalized request.
     * @returns {Record<string, any>} Native Gerber document.
     */
    static decode(normalized) {
        return GerberParser.parseArrayBuffer(
            normalized.input.fileName,
            ParserInput.bytes(normalized.input.data)
        )
    }

    /**
     * Builds one validated canonical document.
     * @param {Record<string, any>} normalized Normalized request.
     * @param {Record<string, any> | null} [native] Decoded native document.
     * @returns {Record<string, any>} Canonical document.
     */
    static build(normalized, native = null) {
        return GerberDocumentBuilder.fromNative(
            native || GerberDocumentBuilder.decode(normalized),
            normalized.input.fileName,
            normalized
        )
    }

    /**
     * Builds a canonical document from a native composite model.
     * @param {Record<string, any>} native Native document.
     * @param {string} fileName Source label.
     * @param {Record<string, any>} normalized Normalized request.
     * @returns {Record<string, any>} Canonical document.
     */
    static fromNative(native, fileName, normalized) {
        const model = GerberCircuitJsonProjector.project(native)
        const extension = GerberDocumentBuilder.#extension(
            native,
            normalized.options
        )
        const runtime =
            normalized.options.retainSource === 'reference'
                ? { sourceReference: normalized.sourceReference }
                : {}
        return DocumentResult.createValidated(
            {
                model,
                source: {
                    format: 'gerber',
                    fileName,
                    fileType: GerberDocumentBuilder.#suffix(fileName)
                },
                extensions: extension ? { gerber: extension } : {},
                assets: ToolkitAsset.prepareAll(normalized.input.assets, {
                    mode: normalized.options.decodeAssets
                }),
                diagnostics: native.diagnostics || [],
                statistics: {
                    canonicalElementCount: model.length,
                    nativeLayerCount:
                        native?.pcb?.fabrication?.layers?.length || 0,
                    nativePrimitiveCount:
                        native?.pcb?.fabrication?.layers?.reduce(
                            (count, layer) =>
                                count +
                                (layer.primitives?.length || 0) +
                                (layer.drills?.length || 0),
                            0
                        ) || 0
                }
            },
            runtime
        )
    }

    /**
     * Selects source-native facts under the common extension policy.
     * @param {Record<string, any>} native Native model.
     * @param {Record<string, any>} options Common options.
     * @returns {Record<string, any> | null} Extension payload.
     */
    static #extension(native, options) {
        if (
            options.extensions === 'none' ||
            (Array.isArray(options.extensions) && !options.extensions.length)
        ) {
            return null
        }
        const includeNative =
            options.extensions === 'full' ||
            options.preserveRaw ||
            (Array.isArray(options.extensions) &&
                options.extensions.includes('gerber.native-model'))
        const completeness =
            options.extensions === 'full'
                ? 'full'
                : options.extensions === 'metadata'
                  ? 'metadata'
                  : 'canonical'
        const layers = native?.pcb?.fabrication?.layers || []
        const metadata = {
            $meta: {
                schema: 'ecad-toolkit.extension.v1',
                completeness,
                included: [
                    'gerber.fabrication-summary',
                    ...(includeNative ? ['gerber.native-model'] : [])
                ],
                omitted: []
            },
            summary: {
                layerCount: layers.length,
                roles: [...new Set(layers.map((layer) => String(layer.role)))],
                renderMode: String(
                    native?.pcb?.fabrication?.renderMode || 'composite'
                )
            }
        }
        return includeNative ? { ...metadata, native } : metadata
    }

    /** @param {string} fileName Source name. @returns {string} Suffix. */
    static #suffix(fileName) {
        const name = String(fileName || '')
        const suffix = name.split('.').pop()
        return suffix && suffix !== name ? suffix.toLowerCase() : 'gbr'
    }
}

Object.freeze(GerberDocumentBuilder.prototype)
Object.freeze(GerberDocumentBuilder)
