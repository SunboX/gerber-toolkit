import { unzipSync } from 'fflate'
import {
    ToolkitAsset,
    ToolkitDiagnostic,
    ToolkitError,
    ToolkitProgress
} from 'circuitjson-toolkit/parser'
import {
    ArchiveEntryPath,
    ArchiveLimits,
    ProjectResult
} from 'circuitjson-toolkit/project'

import { GerberParser } from '../core/gerber/GerberParser.mjs'
import { GerberDocumentBuilder } from './GerberDocumentBuilder.mjs'
import { GerberWorkerClient } from './GerberWorkerClient.mjs'
import { Parser } from './Parser.mjs'
import { ParserInput } from './ParserInput.mjs'

const ABORTED_GETTER = Object.getOwnPropertyDescriptor(
    AbortSignal.prototype,
    'aborted'
)?.get
const PARSER_OPTION_KEYS = [
    'preserveRaw',
    'decodeAssets',
    'extensions',
    'reports',
    'retainSource',
    'worker',
    'transferInput',
    'signal',
    'onProgress'
]
const EXTENSION_IDS = new Set([
    'gerber.native-model',
    'gerber.entry-order',
    'gerber.archive'
])

/** Loads app-shaped fabrication entries into one canonical Gerber project. */
export class ProjectLoader {
    /**
     * Loads one project synchronously.
     * @param {Record<string, any>[]} entries App-shaped entries.
     * @param {Record<string, any>} [options] Common options.
     * @returns {Record<string, any>} Canonical project.
     */
    static load(entries, options = {}) {
        const normalized = ProjectLoader.#normalizeOptions(options)
        if (normalized.worker === true) {
            throw ProjectLoader.#error(
                'Synchronous Gerber project loading cannot use a worker.',
                'ERR_WORKER_SYNC_UNAVAILABLE',
                'unsupported'
            )
        }
        ProjectLoader.#assertNotCancelled(normalized.signal)
        const classified = ProjectLoader.#classify(entries, normalized)
        ProjectLoader.#assertNotCancelled(normalized.signal)
        return ProjectLoader.#build(classified, normalized, entries)
    }

    /**
     * Returns a discriminated load result.
     * @param {Record<string, any>[]} entries Entries.
     * @param {Record<string, any>} [options] Options.
     * @returns {Record<string, any>} Load result.
     */
    static tryLoad(entries, options = {}) {
        try {
            return { ok: true, value: ProjectLoader.load(entries, options) }
        } catch (error) {
            const normalized = ProjectLoader.#loadError(error)
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
     * Loads asynchronously with worker, progress, and cancellation support.
     * @param {Record<string, any>[]} entries Entries.
     * @param {Record<string, any>} [options] Options.
     * @returns {Promise<Record<string, any>>} Canonical project.
     */
    static async loadAsync(entries, options = {}) {
        const normalized = ProjectLoader.#normalizeOptions(options)
        ProjectLoader.#assertNotCancelled(normalized.signal)
        const useWorker =
            normalized.worker === true ||
            (normalized.worker === 'auto' &&
                normalized.retainSource !== 'reference' &&
                GerberWorkerClient.isAvailable())
        if (useWorker) {
            const attempt = await GerberWorkerClient.loadProjectAttempt(
                entries,
                normalized
            )
            if (attempt.ok) return attempt.value
            if (normalized.worker !== 'auto' || !attempt.unavailable) {
                throw ProjectLoader.#loadError(attempt.error)
            }
            GerberWorkerClient.dispose()
        }
        let progress = ProjectLoader.#progress(normalized, {
            stage: 'detect',
            completed: 0,
            total: 0,
            message: 'Detecting Gerber project entries.'
        })
        await ProjectLoader.#yieldTurn()
        ProjectLoader.#assertNotCancelled(normalized.signal)
        const classified = ProjectLoader.#classify(entries, normalized)
        progress = ProjectLoader.#progress(
            normalized,
            {
                stage: 'project',
                completed: 0,
                total: classified.candidates.length,
                message: 'Loading Gerber project entries.'
            },
            progress
        )
        await ProjectLoader.#yieldTurn()
        ProjectLoader.#assertNotCancelled(normalized.signal)
        const project = ProjectLoader.#build(classified, normalized, entries)
        progress = ProjectLoader.#progress(
            normalized,
            {
                stage: 'project',
                completed: classified.candidates.length,
                total: classified.candidates.length,
                message: 'Loaded Gerber project entries.'
            },
            progress
        )
        ProjectLoader.#progress(
            normalized,
            {
                stage: 'complete',
                completed: classified.candidates.length,
                total: classified.candidates.length,
                message: 'Gerber project loading complete.'
            },
            progress
        )
        ProjectLoader.#assertNotCancelled(normalized.signal)
        return project
    }

    /** @param {unknown} entries Candidate entries. @returns {boolean} Support. */
    static supports(entries) {
        try {
            const options = ProjectLoader.#normalizeOptions({
                worker: false,
                decodeAssets: 'none',
                extensions: 'none'
            })
            return (
                ProjectLoader.#classify(entries, options).candidates.length > 0
            )
        } catch {
            return false
        }
    }

    /**
     * Normalizes project and parser options once.
     * @param {unknown} options Options candidate.
     * @returns {Record<string, any>} Normalized options.
     */
    static #normalizeOptions(options) {
        try {
            const fields = ParserInput.plainFields(
                options,
                'Gerber project options must be a plain object.'
            )
            const parserOptions = {}
            for (const key of PARSER_OPTION_KEYS) {
                if (Object.hasOwn(fields, key)) parserOptions[key] = fields[key]
            }
            const normalized = ParserInput.normalize(
                { fileName: 'project.gbr', data: '' },
                parserOptions
            ).options
            ProjectLoader.#assertExtensions(normalized.extensions)
            if (normalized.signal !== undefined && normalized.signal !== null) {
                ProjectLoader.#signalState(normalized.signal)
            }
            return {
                ...normalized,
                archiveLimits: ArchiveLimits.normalize(fields.archiveLimits)
            }
        } catch (error) {
            throw ProjectLoader.#inputError(error)
        }
    }

    /**
     * Validates, expands, and classifies all entries.
     * @param {unknown} entries Entry candidates.
     * @param {Record<string, any>} options Normalized options.
     * @returns {Record<string, any>} Classified entries.
     */
    static #classify(entries, options) {
        const descriptors = ProjectLoader.#entryArray(entries)
        const count = descriptors.length.value
        if (!count) {
            throw ProjectLoader.#inputError(
                new TypeError('Gerber project entries must be nonempty.')
            )
        }
        ProjectLoader.#assertLimit(
            'maxEntries',
            options.archiveLimits.maxEntries,
            count
        )
        const expanded = []
        const attachedAssets = []
        let totalBytes = 0
        let archiveExpanded = false
        for (let index = 0; index < count; index += 1) {
            const entry = descriptors[String(index)].value
            const fields = ParserInput.plainFields(
                entry,
                'Gerber project entry must be a plain object.'
            )
            const name = ArchiveEntryPath.normalize(fields.name)
            if (!ParserInput.isData(fields.data)) {
                throw ProjectLoader.#inputError(
                    new TypeError('Gerber project entry data is invalid.'),
                    name
                )
            }
            const bytes = ParserInput.bytes(fields.data)
            ProjectLoader.#assertLimit(
                'maxEntryBytes',
                options.archiveLimits.maxEntryBytes,
                bytes.byteLength,
                name
            )
            totalBytes += bytes.byteLength
            ProjectLoader.#assertLimit(
                'maxTotalBytes',
                options.archiveLimits.maxTotalBytes,
                totalBytes,
                name
            )
            let entryBytes = bytes.byteLength
            try {
                attachedAssets.push(
                    ...ToolkitAsset.prepareAll(fields.assets || [], {
                        mode: options.decodeAssets,
                        acceptPayload: (byteLength) => {
                            entryBytes += byteLength
                            totalBytes += byteLength
                            ProjectLoader.#assertLimit(
                                'maxEntryBytes',
                                options.archiveLimits.maxEntryBytes,
                                entryBytes,
                                name
                            )
                            ProjectLoader.#assertLimit(
                                'maxTotalBytes',
                                options.archiveLimits.maxTotalBytes,
                                totalBytes,
                                name
                            )
                        }
                    })
                )
            } catch (error) {
                throw ProjectLoader.#inputError(error, name)
            }
            if (name.toLowerCase().endsWith('.zip')) {
                archiveExpanded = true
                const extracted = ProjectLoader.#expandZip(
                    name,
                    bytes,
                    options.archiveLimits
                )
                for (const member of extracted) {
                    totalBytes += member.bytes.byteLength
                    ProjectLoader.#assertLimit(
                        'maxTotalBytes',
                        options.archiveLimits.maxTotalBytes,
                        totalBytes,
                        member.name
                    )
                    expanded.push(member)
                }
            } else {
                expanded.push({
                    name,
                    bytes,
                    assets: fields.assets || [],
                    archiveDepth: 0
                })
            }
        }
        ProjectLoader.#assertLimit(
            'maxEntries',
            options.archiveLimits.maxEntries,
            expanded.length
        )
        const names = ArchiveEntryPath.unique(
            expanded.map((entry) => entry.name)
        )
        for (let index = 0; index < names.length; index += 1) {
            expanded[index].name = names[index]
        }
        const candidates = expanded.filter((entry) =>
            Parser.supports({ fileName: entry.name, data: entry.bytes })
        )
        if (!candidates.length) {
            throw ProjectLoader.#error(
                'Gerber project contains no supported fabrication entries.',
                'ERR_FORMAT_UNSUPPORTED',
                'unsupported'
            )
        }
        const candidateEntries = new Set(candidates)
        return {
            originalCount: count,
            entries: expanded,
            candidates,
            companions: expanded.filter(
                (entry) => !candidateEntries.has(entry)
            ),
            entryNames: names,
            attachedAssets,
            totalBytes,
            archiveExpanded
        }
    }

    /**
     * Expands one ZIP archive with hard size and ratio ceilings.
     * @param {string} archiveName Archive name.
     * @param {Uint8Array} bytes Archive bytes.
     * @param {Record<string, number>} limits Limits.
     * @returns {Record<string, any>[]} Expanded entries.
     */
    static #expandZip(archiveName, bytes, limits) {
        let files
        try {
            files = unzipSync(bytes)
        } catch (error) {
            throw ProjectLoader.#inputError(error, archiveName)
        }
        const prefix = archiveName.replace(/\.zip$/iu, '')
        const result = []
        let uncompressedBytes = 0
        for (const [memberName, memberBytes] of Object.entries(files)) {
            const normalizedMember = String(memberName).replaceAll('\\', '/')
            if (!normalizedMember || normalizedMember.endsWith('/')) {
                continue
            }
            const safeMember = ArchiveEntryPath.normalize(normalizedMember)
            if (
                safeMember.startsWith('__MACOSX/') ||
                safeMember.split('/').some((part) => part.startsWith('.'))
            ) {
                continue
            }
            if (safeMember.toLowerCase().endsWith('.zip')) {
                throw ProjectLoader.#limitError(
                    'maxArchiveDepth',
                    limits.maxArchiveDepth,
                    2,
                    safeMember
                )
            }
            ProjectLoader.#assertLimit(
                'maxEntryBytes',
                limits.maxEntryBytes,
                memberBytes.byteLength,
                safeMember
            )
            uncompressedBytes += memberBytes.byteLength
            result.push({
                name: ArchiveEntryPath.normalize(`${prefix}/${safeMember}`),
                bytes: memberBytes,
                assets: [],
                archiveDepth: 1
            })
        }
        const ratio = uncompressedBytes / Math.max(bytes.byteLength, 1)
        if (ratio > limits.maxCompressionRatio) {
            throw ProjectLoader.#limitError(
                'maxCompressionRatio',
                limits.maxCompressionRatio,
                ratio,
                archiveName
            )
        }
        return result
    }

    /**
     * Parses all layers and builds one composite canonical document/project.
     * @param {Record<string, any>} classified Classified entries.
     * @param {Record<string, any>} options Normalized options.
     * @param {unknown} sourceReference Caller entries.
     * @returns {Record<string, any>} Canonical project.
     */
    static #build(classified, options, sourceReference) {
        const layers = []
        const diagnostics = []
        for (const entry of classified.candidates) {
            ProjectLoader.#assertNotCancelled(options.signal)
            try {
                const native = GerberParser.parseArrayBuffer(
                    entry.name,
                    entry.bytes
                )
                layers.push(...(native.pcb?.fabrication?.layers || []))
                diagnostics.push(...(native.diagnostics || []))
            } catch (error) {
                const normalized = ProjectLoader.#loadError(error, entry.name)
                diagnostics.push(
                    ToolkitDiagnostic.create({
                        code: normalized.code,
                        severity: 'error',
                        message: normalized.message,
                        source: entry.name,
                        details: {
                            category: normalized.category,
                            format: normalized.format
                        }
                    })
                )
            }
        }
        const documentName = ProjectLoader.#documentName(classified)
        const native = GerberParser.fromLayers(documentName, layers)
        native.diagnostics = diagnostics
        const documentRequest = {
            input: { fileName: documentName, data: '', assets: [] },
            sourceReference,
            options: { ...options, worker: false, onProgress: undefined }
        }
        const document = GerberDocumentBuilder.fromNative(
            native,
            documentName,
            documentRequest
        )
        const companionAssets = ToolkitAsset.prepareAll(
            classified.companions.map((entry) => ({
                name: entry.name,
                data: entry.bytes,
                kind: 'companion'
            })),
            { mode: options.decodeAssets }
        )
        const assets = [...classified.attachedAssets, ...companionAssets]
        return ProjectResult.create({
            source: {
                format: 'gerber',
                entryNames: classified.entryNames
            },
            documents: [document],
            project: {
                name: documentName,
                format: 'gerber',
                relationships: []
            },
            extensions: {
                gerber: ProjectLoader.#extension(classified, options)
            },
            assets,
            diagnostics,
            statistics: {
                inputEntryCount: classified.originalCount,
                expandedEntryCount: classified.entries.length,
                loadedLayerCount: layers.length,
                documentCount: 1,
                assetCount: assets.length,
                byteLength: classified.totalBytes
            }
        })
    }

    /**
     * Builds project extension metadata.
     * @param {Record<string, any>} classified Classified entries.
     * @param {Record<string, any>} options Options.
     * @returns {Record<string, any>} Extension payload.
     */
    static #extension(classified, options) {
        const none =
            options.extensions === 'none' ||
            (Array.isArray(options.extensions) && !options.extensions.length)
        const selected = Array.isArray(options.extensions)
            ? options.extensions
            : ['gerber.entry-order', 'gerber.archive']
        const included = none
            ? []
            : selected.filter((id) => id !== 'gerber.native-model')
        return {
            $meta: {
                schema: 'ecad-toolkit.extension.v1',
                completeness: none
                    ? 'none'
                    : Array.isArray(options.extensions)
                      ? 'canonical'
                      : options.extensions,
                included,
                omitted: []
            },
            entryNames: classified.entryNames,
            archiveExpanded: classified.archiveExpanded
        }
    }

    /** @param {Record<string, any>} classified Entries. @returns {string} Project name. */
    static #documentName(classified) {
        if (classified.originalCount === 1 && classified.archiveExpanded) {
            return classified.entryNames[0]?.split('/')[0] || 'fabrication'
        }
        if (classified.originalCount === 1) return classified.entryNames[0]
        return 'fabrication-package'
    }

    /** @param {unknown} value Entries. @returns {Record<string, PropertyDescriptor>} Descriptors. */
    static #entryArray(value) {
        if (!Array.isArray(value)) {
            throw ProjectLoader.#inputError(
                new TypeError('Gerber project entries must be a dense array.')
            )
        }
        let prototype
        let descriptors
        try {
            prototype = Object.getPrototypeOf(value)
            descriptors = Object.getOwnPropertyDescriptors(value)
        } catch {
            throw ProjectLoader.#inputError(
                new TypeError('Gerber project entries could not be inspected.')
            )
        }
        const length = descriptors.length?.value
        if (
            prototype !== Array.prototype ||
            !Number.isSafeInteger(length) ||
            length < 0 ||
            Reflect.ownKeys(descriptors).length !== length + 1
        ) {
            throw ProjectLoader.#inputError(
                new TypeError('Gerber project entries must be a dense array.')
            )
        }
        for (let index = 0; index < length; index += 1) {
            const descriptor = descriptors[String(index)]
            if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
                throw ProjectLoader.#inputError(
                    new TypeError(
                        'Gerber project entries must use data properties.'
                    )
                )
            }
        }
        if (Object.hasOwn(descriptors, Symbol.iterator)) {
            throw ProjectLoader.#inputError(
                new TypeError(
                    'Gerber project entries must use standard iteration.'
                )
            )
        }
        return descriptors
    }

    /** @param {string | string[]} extensions Selection. @returns {void} */
    static #assertExtensions(extensions) {
        if (!Array.isArray(extensions)) return
        const unknown = extensions.find((id) => !EXTENSION_IDS.has(id))
        if (!unknown) return
        throw ProjectLoader.#error(
            `Gerber project extension is unavailable: ${unknown}.`,
            'ERR_CAPABILITY_UNAVAILABLE',
            'unsupported',
            '',
            { extensions }
        )
    }

    /** @param {string} limit Limit. @param {number} maximum Max. @param {number} actual Actual. @param {string} [source] Source. @returns {void} */
    static #assertLimit(limit, maximum, actual, source = '') {
        if (actual <= maximum) return
        throw ProjectLoader.#limitError(limit, maximum, actual, source)
    }

    /** @param {string} limit Limit. @param {number} maximum Max. @param {number} actual Actual. @param {string} source Source. @returns {ToolkitError} Error. */
    static #limitError(limit, maximum, actual, source) {
        return ProjectLoader.#error(
            `Gerber archive limit exceeded: ${limit}.`,
            'ERR_ARCHIVE_LIMIT_EXCEEDED',
            'validation',
            source,
            { limit, maximum, actual }
        )
    }

    /** @param {Record<string, any>} options Options. @param {Record<string, any>} fields Fields. @param {Record<string, any> | null} [previous] Previous. @returns {Record<string, any> | null} Row. */
    static #progress(options, fields, previous = null) {
        if (!options.onProgress) return previous
        const row = ToolkitProgress.create(fields, previous)
        options.onProgress(row)
        return row
    }

    /** @returns {Promise<void>} Host turn. */
    static async #yieldTurn() {
        if (typeof MessageChannel === 'function') {
            await new Promise((resolve) => {
                const channel = new MessageChannel()
                channel.port1.onmessage = () => {
                    channel.port1.close()
                    channel.port2.close()
                    resolve()
                }
                channel.port2.postMessage(null)
            })
            return
        }
        await new Promise((resolve) => setTimeout(resolve, 0))
    }

    /** @param {unknown} signal Signal. @returns {boolean} Aborted. */
    static #signalState(signal) {
        if (!ABORTED_GETTER) throw new TypeError('AbortSignal is unavailable.')
        try {
            return Boolean(Reflect.apply(ABORTED_GETTER, signal, []))
        } catch {
            throw new TypeError('Gerber signal must be an AbortSignal.')
        }
    }

    /** @param {unknown} signal Signal. @returns {void} */
    static #assertNotCancelled(signal) {
        if (signal === undefined || signal === null) return
        if (!ProjectLoader.#signalState(signal)) return
        throw ProjectLoader.#error(
            'Gerber project loading was cancelled.',
            'ERR_CANCELLED',
            'cancelled'
        )
    }

    /** @param {unknown} error Failure. @param {string} [source] Source. @returns {ToolkitError} Error. */
    static #inputError(error, source = '') {
        if (ToolkitError.trustedRecord(error)) return error
        return ToolkitError.from(error, {
            code: 'ERR_PROJECT_INPUT',
            category: 'validation',
            format: 'gerber',
            source
        })
    }

    /** @param {unknown} error Failure. @param {string} [source] Source. @returns {ToolkitError} Error. */
    static #loadError(error, source = '') {
        if (ToolkitError.trustedRecord(error)) return error
        return ToolkitError.from(error, {
            code: 'ERR_GERBER_PROJECT',
            category: 'parse',
            format: 'gerber',
            source
        })
    }

    /** @param {string} message Message. @param {string} code Code. @param {string} category Category. @param {string} [source] Source. @param {object} [details] Details. @returns {ToolkitError} Error. */
    static #error(message, code, category, source = '', details = {}) {
        return new ToolkitError(message, {
            code,
            category,
            format: 'gerber',
            source,
            details
        })
    }
}

Object.freeze(ProjectLoader.prototype)
Object.freeze(ProjectLoader)
