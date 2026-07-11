import {
    ToolkitDiagnostic,
    ToolkitError,
    ToolkitProgress,
    ToolkitAsset
} from 'circuitjson-toolkit/parser'

import { GerberDocumentBuilder } from './GerberDocumentBuilder.mjs'
import { GerberAsyncInputOwnership } from './GerberAsyncInputOwnership.mjs'
import { GerberWorkerClient } from './GerberWorkerClient.mjs'
import { ParserInput } from './ParserInput.mjs'

const ABORTED_GETTER = Object.getOwnPropertyDescriptor(
    AbortSignal.prototype,
    'aborted'
)?.get
const PROGRESS_MESSAGES = {
    detect: 'Detecting Gerber input.',
    decode: 'Decoding Gerber fabrication data.',
    validate: 'Validating canonical CircuitJSON.',
    complete: 'Gerber parsing complete.'
}
const EXTENSION_IDS = new Set(['gerber.native-model'])

/** Parses Gerber and Excellon documents into canonical CircuitJSON envelopes. */
export class Parser {
    /**
     * Parses one input synchronously.
     * @param {Record<string, any>} input Common parser input.
     * @param {Record<string, any>} [options] Common parser options.
     * @returns {Record<string, any>} Canonical document.
     */
    static parse(input, options = {}) {
        try {
            const normalized = ParserInput.normalize(input, options)
            if (normalized.options.worker === true) {
                throw Parser.#error(
                    'Synchronous Gerber parsing cannot use a worker.',
                    'ERR_WORKER_SYNC_UNAVAILABLE',
                    'unsupported',
                    normalized.input.fileName
                )
            }
            Parser.#assertSupported(normalized.input)
            Parser.#assertExtensions(normalized)
            Parser.#assertReports(normalized)
            return GerberDocumentBuilder.build(normalized)
        } catch (error) {
            throw Parser.#parseError(error, input)
        }
    }

    /**
     * Returns a discriminated parse result.
     * @param {Record<string, any>} input Common parser input.
     * @param {Record<string, any>} [options] Common parser options.
     * @returns {Record<string, any>} Parse result.
     */
    static tryParse(input, options = {}) {
        try {
            return { ok: true, value: Parser.parse(input, options) }
        } catch (error) {
            const normalized = Parser.#parseError(error, input)
            return {
                ok: false,
                error: normalized,
                diagnostics: [
                    ToolkitDiagnostic.create({
                        code: normalized.code,
                        severity: 'error',
                        message: normalized.message,
                        source: normalized.source
                    })
                ]
            }
        }
    }

    /**
     * Parses asynchronously with progress, cancellation, and workers.
     * @param {Record<string, any>} input Common parser input.
     * @param {Record<string, any>} [options] Common parser options.
     * @returns {Promise<Record<string, any>>} Canonical document.
     */
    static async parseAsync(input, options = {}) {
        let normalized
        const inputOwned = GerberAsyncInputOwnership.ownsParser(input)
        try {
            normalized = ParserInput.normalize(input, options)
            Parser.#assertSupported(normalized.input)
            Parser.#assertExtensions(normalized)
            Parser.#assertReports(normalized)
            Parser.#assertNotCancelled(normalized)
        } catch (error) {
            throw Parser.#parseError(error, input)
        }
        const useWorker =
            normalized.options.worker === true ||
            (normalized.options.worker === 'auto' &&
                normalized.options.retainSource !== 'reference' &&
                GerberWorkerClient.isAvailable())
        if (useWorker) {
            const attempt = await GerberWorkerClient.parseAttempt(
                normalized.input,
                normalized.options
            )
            if (attempt.ok) return attempt.value
            if (normalized.options.worker !== 'auto' || !attempt.unavailable) {
                throw Parser.#parseError(attempt.error, input)
            }
            GerberWorkerClient.dispose()
        }
        if (!inputOwned) {
            try {
                normalized = Parser.#ownAsyncInput(normalized)
            } catch (error) {
                throw Parser.#parseError(error, input)
            }
        } else {
            normalized = { ...normalized, inputOwned: true }
        }
        let progress = Parser.#progress(normalized, 'detect')
        Parser.#assertNotCancelled(normalized)
        progress = Parser.#progress(normalized, 'decode', progress)
        await Promise.resolve()
        Parser.#assertNotCancelled(normalized)
        let native
        try {
            native = GerberDocumentBuilder.decode(normalized)
        } catch (error) {
            throw Parser.#parseError(error, input)
        }
        Parser.#assertNotCancelled(normalized)
        progress = Parser.#progress(normalized, 'validate', progress)
        Parser.#assertNotCancelled(normalized)
        let document
        try {
            document = GerberDocumentBuilder.build(normalized, native)
        } catch (error) {
            throw Parser.#parseError(error, input)
        }
        Parser.#assertNotCancelled(normalized)
        Parser.#progress(normalized, 'complete', progress)
        Parser.#assertNotCancelled(normalized)
        return document
    }

    /** @param {unknown} input Candidate. @returns {boolean} Support result. */
    static supports(input) {
        return ParserInput.supports(input)
    }

    /**
     * Owns mutable parser bytes and assets before any callback or worker turn.
     * @param {Record<string, any>} normalized Normalized request.
     * @returns {Record<string, any>} Stable async request.
     */
    static #ownAsyncInput(normalized) {
        return {
            ...normalized,
            inputOwned: true,
            input: {
                ...normalized.input,
                data:
                    typeof normalized.input.data === 'string'
                        ? normalized.input.data
                        : ParserInput.bytes(normalized.input.data),
                assets: ToolkitAsset.prepareAll(normalized.input.assets, {
                    mode: normalized.options.decodeAssets
                })
            }
        }
    }

    /** @param {Record<string, any>} normalized Request. @returns {void} */
    static #assertReports(normalized) {
        if (!normalized.options.reports.length) return
        throw Parser.#error(
            `Gerber parser report is unavailable: ${normalized.options.reports[0]}.`,
            'ERR_CAPABILITY_UNAVAILABLE',
            'unsupported',
            normalized.input.fileName,
            { reports: normalized.options.reports }
        )
    }

    /** @param {Record<string, any>} normalized Request. @returns {void} */
    static #assertExtensions(normalized) {
        if (!Array.isArray(normalized.options.extensions)) return
        const unknown = normalized.options.extensions.find(
            (id) => !EXTENSION_IDS.has(id)
        )
        if (!unknown) return
        throw Parser.#error(
            `Gerber parser extension is unavailable: ${unknown}.`,
            'ERR_CAPABILITY_UNAVAILABLE',
            'unsupported',
            normalized.input.fileName,
            { extensions: normalized.options.extensions }
        )
    }

    /** @param {Record<string, any>} input Input. @returns {void} */
    static #assertSupported(input) {
        if (ParserInput.supports(input)) return
        throw Parser.#error(
            `Unsupported Gerber input: ${input.fileName || '(unnamed)'}.`,
            'ERR_FORMAT_UNSUPPORTED',
            'unsupported',
            input.fileName
        )
    }

    /**
     * Emits one monotonic progress row.
     * @param {Record<string, any>} normalized Request.
     * @param {string} stage Stage.
     * @param {Record<string, any> | null} [previous] Previous row.
     * @returns {Record<string, any> | null} Progress row.
     */
    static #progress(normalized, stage, previous = null) {
        if (!normalized.options.onProgress) return previous
        const row = ToolkitProgress.create(
            { stage, message: PROGRESS_MESSAGES[stage] },
            previous
        )
        normalized.options.onProgress(row)
        return row
    }

    /** @param {Record<string, any>} normalized Request. @returns {void} */
    static #assertNotCancelled(normalized) {
        const { signal } = normalized.options
        if (signal === undefined || signal === null) return
        if (!ABORTED_GETTER) throw new TypeError('AbortSignal is unavailable.')
        let aborted
        try {
            aborted = Boolean(Reflect.apply(ABORTED_GETTER, signal, []))
        } catch {
            throw new TypeError('Gerber signal must be an AbortSignal.')
        }
        if (aborted) {
            throw Parser.#error(
                'Gerber parsing was cancelled.',
                'ERR_CANCELLED',
                'cancelled',
                normalized.input.fileName
            )
        }
    }

    /**
     * Normalizes one parser failure.
     * @param {unknown} error Failure.
     * @param {unknown} input Original input.
     * @returns {ToolkitError} Typed error.
     */
    static #parseError(error, input) {
        if (ToolkitError.trustedRecord(error)) return error
        return ToolkitError.from(error, {
            code: 'ERR_GERBER_PARSE',
            category: 'parse',
            format: 'gerber',
            source: ParserInput.fileName(input)
        })
    }

    /**
     * Creates one typed error.
     * @param {string} message Message.
     * @param {string} code Code.
     * @param {string} category Category.
     * @param {string} source Source.
     * @param {Record<string, any>} [details] Details.
     * @returns {ToolkitError} Error.
     */
    static #error(message, code, category, source, details = {}) {
        return new ToolkitError(message, {
            code,
            category,
            format: 'gerber',
            source,
            details
        })
    }
}

Object.freeze(Parser.prototype)
Object.freeze(Parser)
