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
import { GerberAsyncInputOwnership } from './GerberAsyncInputOwnership.mjs'
import { GerberWorkerClient } from './GerberWorkerClient.mjs'
import { GerberProjectArchive } from './GerberProjectArchive.mjs'
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
const OWNED_PROJECT_ENTRIES = new WeakSet()

/** Loads app-shaped fabrication entries into one canonical Gerber project. */
export class ProjectLoader {
    /**
     * Loads one project synchronously.
     * @param {Record<string, any>[]} entries App-shaped entries.
     * @param {Record<string, any>} [options] Common options.
     * @returns {Record<string, any>} Canonical project.
     */
    static load(entries, options = {}) {
        try {
            const normalized = ProjectLoader.#normalizeOptions(options)
            if (normalized.worker === true) {
                throw ProjectLoader.#error(
                    'Synchronous Gerber project loading cannot use a worker.',
                    'ERR_WORKER_SYNC_UNAVAILABLE',
                    'unsupported'
                )
            }
            ProjectLoader.#assertNotCancelled(normalized.signal)
            const snapshot = ProjectLoader.#snapshotEntries(
                entries,
                normalized.archiveLimits.maxEntries,
                normalized.decodeAssets
            )
            const classified = ProjectLoader.#classify(snapshot, normalized)
            ProjectLoader.#assertNotCancelled(normalized.signal)
            return ProjectLoader.#build(classified, normalized, entries)
        } catch (error) {
            throw ProjectLoader.#inputError(error)
        }
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
        let normalized
        const entriesOwned = GerberAsyncInputOwnership.ownsProject(entries)
        try {
            normalized = ProjectLoader.#normalizeOptions(options)
            ProjectLoader.#assertNotCancelled(normalized.signal)
        } catch (error) {
            throw ProjectLoader.#inputError(error)
        }
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
        let snapshot
        try {
            snapshot = entriesOwned
                ? ProjectLoader.#markReceiverEntries(
                      entries,
                      normalized.archiveLimits.maxEntries
                  )
                : ProjectLoader.#snapshotEntries(
                      entries,
                      normalized.archiveLimits.maxEntries,
                      normalized.decodeAssets
                  )
        } catch (error) {
            throw ProjectLoader.#inputError(error)
        }
        let progress = ProjectLoader.#progress(normalized, {
            stage: 'detect',
            completed: 0,
            total: 0,
            message: 'Detecting Gerber project entries.'
        })
        await ProjectLoader.#yieldTurn()
        ProjectLoader.#assertNotCancelled(normalized.signal)
        let classified
        try {
            classified = ProjectLoader.#classify(snapshot, normalized)
        } catch (error) {
            throw ProjectLoader.#inputError(error)
        }
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
        const state = ProjectLoader.#buildState()
        for (let index = 0; index < classified.candidates.length; index += 1) {
            await ProjectLoader.#yieldTurn()
            ProjectLoader.#assertNotCancelled(normalized.signal)
            ProjectLoader.#parseCandidate(
                classified.candidates[index],
                normalized,
                state
            )
            progress = ProjectLoader.#progress(
                normalized,
                {
                    stage: 'project',
                    completed: index + 1,
                    total: classified.candidates.length,
                    detail: classified.candidates[index].name,
                    message: 'Loaded Gerber project entry.'
                },
                progress
            )
        }
        const project = ProjectLoader.#finish(
            classified,
            normalized,
            entries,
            state
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
            const descriptors = ProjectLoader.#entryArray(entries)
            const count = descriptors.length.value
            ProjectLoader.#assertLimit(
                'maxEntries',
                options.archiveLimits.maxEntries,
                count
            )
            const names = []
            let supported = false
            for (let index = 0; index < count; index += 1) {
                const fields = ParserInput.plainFields(
                    descriptors[String(index)].value,
                    'Gerber project entry must be a plain object.'
                )
                const name = ArchiveEntryPath.normalize(fields.name)
                names.push(name)
                if (!ParserInput.isData(fields.data)) return false
                if (!name.toLowerCase().endsWith('.zip')) {
                    if (
                        Parser.supports({ fileName: name, data: fields.data })
                    ) {
                        supported = true
                    }
                    continue
                }
                const archiveBytes = ParserInput.bytes(fields.data)
                if (
                    GerberProjectArchive.supports(
                        name,
                        archiveBytes,
                        options.archiveLimits
                    )
                ) {
                    supported = true
                }
            }
            ArchiveEntryPath.unique(names)
            return supported
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
     * Owns project bytes and assets before callbacks, workers, or parsing.
     * @param {unknown} entries Caller entries.
     * @param {number} maximumEntries Configured entry ceiling.
     * @param {'none' | 'metadata' | 'full'} assetMode Asset ownership mode.
     * @returns {Record<string, any>[]} Stable entry snapshots.
     */
    static #snapshotEntries(entries, maximumEntries, assetMode) {
        const descriptors = ProjectLoader.#entryArray(entries)
        const count = descriptors.length.value
        ProjectLoader.#assertLimit('maxEntries', maximumEntries, count)
        const snapshot = new Array(count)
        for (let index = 0; index < count; index += 1) {
            const fields = ParserInput.plainFields(
                descriptors[String(index)].value,
                'Gerber project entry must be a plain object.'
            )
            let assetBytes = 0
            const preparedAssets = ToolkitAsset.prepareAll(
                fields.assets || [],
                {
                    mode: assetMode,
                    acceptPayload: (byteLength) => {
                        assetBytes += byteLength
                    }
                }
            )
            const entry = {
                name: fields.name,
                data:
                    typeof fields.data === 'string'
                        ? fields.data
                        : ParserInput.bytes(fields.data),
                assets: preparedAssets,
                assetBytes
            }
            OWNED_PROJECT_ENTRIES.add(entry)
            snapshot[index] = entry
        }
        return snapshot
    }

    /**
     * Marks structured-cloned worker entries as receiver-owned without copying.
     * @param {unknown} entries Worker-received entries.
     * @param {number} maximumEntries Configured entry ceiling.
     * @returns {Record<string, any>[]} Same dense entry array.
     */
    static #markReceiverEntries(entries, maximumEntries) {
        const descriptors = ProjectLoader.#entryArray(entries)
        const count = descriptors.length.value
        ProjectLoader.#assertLimit('maxEntries', maximumEntries, count)
        for (let index = 0; index < count; index += 1) {
            const entry = descriptors[String(index)].value
            ParserInput.plainFields(
                entry,
                'Gerber project entry must be a plain object.'
            )
            OWNED_PROJECT_ENTRIES.add(entry)
        }
        return entries
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
        const originalNames = []
        let totalBytes = 0
        let accountedBytes = 0
        let expandedBytes = 0
        let archiveExpanded = false
        for (let index = 0; index < count; index += 1) {
            const entry = descriptors[String(index)].value
            const fields = ParserInput.plainFields(
                entry,
                'Gerber project entry must be a plain object.'
            )
            const name = ArchiveEntryPath.normalize(fields.name)
            originalNames.push(name)
            if (!ParserInput.isData(fields.data)) {
                throw ProjectLoader.#inputError(
                    new TypeError('Gerber project entry data is invalid.'),
                    name
                )
            }
            const bytes =
                OWNED_PROJECT_ENTRIES.has(entry) &&
                fields.data instanceof Uint8Array
                    ? fields.data
                    : ParserInput.bytes(fields.data)
            ProjectLoader.#assertLimit(
                'maxEntryBytes',
                options.archiveLimits.maxEntryBytes,
                bytes.byteLength,
                name
            )
            totalBytes += bytes.byteLength
            accountedBytes += bytes.byteLength
            ProjectLoader.#assertLimit(
                'maxTotalBytes',
                options.archiveLimits.maxTotalBytes,
                accountedBytes,
                name
            )
            let entryBytes = bytes.byteLength
            if (
                OWNED_PROJECT_ENTRIES.has(entry) &&
                Number.isSafeInteger(fields.assetBytes)
            ) {
                entryBytes += fields.assetBytes
                totalBytes += fields.assetBytes
                accountedBytes += fields.assetBytes
                attachedAssets.push(...(fields.assets || []))
                ProjectLoader.#assertLimit(
                    'maxEntryBytes',
                    options.archiveLimits.maxEntryBytes,
                    entryBytes,
                    name
                )
                ProjectLoader.#assertLimit(
                    'maxTotalBytes',
                    options.archiveLimits.maxTotalBytes,
                    accountedBytes,
                    name
                )
            } else {
                try {
                    attachedAssets.push(
                        ...ToolkitAsset.prepareAll(fields.assets || [], {
                            mode: options.decodeAssets,
                            acceptPayload: (byteLength) => {
                                entryBytes += byteLength
                                totalBytes += byteLength
                                accountedBytes += byteLength
                                ProjectLoader.#assertLimit(
                                    'maxEntryBytes',
                                    options.archiveLimits.maxEntryBytes,
                                    entryBytes,
                                    name
                                )
                                ProjectLoader.#assertLimit(
                                    'maxTotalBytes',
                                    options.archiveLimits.maxTotalBytes,
                                    accountedBytes,
                                    name
                                )
                            }
                        })
                    )
                } catch (error) {
                    throw ProjectLoader.#inputError(error, name)
                }
            }
            if (name.toLowerCase().endsWith('.zip')) {
                archiveExpanded = true
                const extracted = GerberProjectArchive.expand(
                    name,
                    bytes,
                    options.archiveLimits,
                    {
                        baseEntryCount: expanded.length,
                        baseTotalBytes: accountedBytes
                    }
                )
                for (const member of extracted) {
                    accountedBytes += member.bytes.byteLength
                    expandedBytes += member.bytes.byteLength
                    ProjectLoader.#assertLimit(
                        'maxTotalBytes',
                        options.archiveLimits.maxTotalBytes,
                        accountedBytes,
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
            originalNames,
            entries: expanded,
            candidates,
            companions: expanded.filter(
                (entry) => !candidateEntries.has(entry)
            ),
            entryNames: names,
            attachedAssets,
            totalBytes,
            expandedBytes,
            archiveExpanded
        }
    }

    /**
     * Parses all layers and builds one composite canonical document/project.
     * @param {Record<string, any>} classified Classified entries.
     * @param {Record<string, any>} options Normalized options.
     * @param {unknown} sourceReference Caller entries.
     * @returns {Record<string, any>} Canonical project.
     */
    static #build(classified, options, sourceReference) {
        const state = ProjectLoader.#buildState()
        for (const entry of classified.candidates) {
            ProjectLoader.#assertNotCancelled(options.signal)
            ProjectLoader.#parseCandidate(entry, options, state)
        }
        return ProjectLoader.#finish(
            classified,
            options,
            sourceReference,
            state
        )
    }

    /**
     * Creates mutable state shared by sync and incremental project loading.
     * @returns {{ layers: object[], diagnostics: object[], failureCount: number, successfulCandidateCount: number }} Build state.
     */
    static #buildState() {
        return {
            layers: [],
            diagnostics: [],
            failureCount: 0,
            successfulCandidateCount: 0
        }
    }

    /**
     * Parses one fabrication candidate with deterministic partial success.
     * @param {{ name: string, bytes: Uint8Array }} entry Candidate entry.
     * @param {Record<string, any>} options Normalized options.
     * @param {ReturnType<ProjectLoader['#buildState']>} state Build state.
     * @returns {void}
     */
    static #parseCandidate(entry, options, state) {
        ProjectLoader.#assertNotCancelled(options.signal)
        try {
            const native = GerberParser.parseArrayBuffer(
                entry.name,
                entry.bytes
            )
            state.successfulCandidateCount += 1
            state.layers.push(...(native.pcb?.fabrication?.layers || []))
            state.diagnostics.push(...(native.diagnostics || []))
        } catch (error) {
            state.failureCount += 1
            const normalized = ProjectLoader.#loadError(error, entry.name)
            state.diagnostics.push(
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

    /**
     * Materializes one canonical composite after candidate parsing completes.
     * @param {Record<string, any>} classified Classified entries.
     * @param {Record<string, any>} options Normalized options.
     * @param {unknown} sourceReference Original caller entries.
     * @param {{ layers: object[], diagnostics: object[], failureCount: number, successfulCandidateCount: number }} state Build state.
     * @returns {Record<string, any>} Canonical project.
     */
    static #finish(classified, options, sourceReference, state) {
        if (!state.successfulCandidateCount) {
            throw ProjectLoader.#error(
                'Gerber project could not parse any supported fabrication entries.',
                'ERR_GERBER_PROJECT',
                'parse',
                '',
                { failureCount: state.failureCount }
            )
        }
        const documentName = ProjectLoader.#documentName(classified)
        const native = GerberParser.fromLayers(documentName, state.layers)
        native.diagnostics = state.diagnostics
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
        const extension = ProjectLoader.#extension(classified, options)
        return ProjectResult.create({
            source: {
                format: 'gerber',
                entryNames: classified.originalNames
            },
            documents: [document],
            project: {
                name: documentName,
                format: 'gerber',
                relationships: []
            },
            extensions: extension ? { gerber: extension } : {},
            assets,
            diagnostics: state.diagnostics,
            statistics: {
                entryCount: classified.originalCount,
                candidateCount: classified.candidates.length,
                documentCount: 1,
                failureCount: state.failureCount,
                totalBytes: classified.totalBytes,
                inputEntryCount: classified.originalCount,
                expandedEntryCount: classified.entries.length,
                expandedBytes: classified.expandedBytes,
                loadedLayerCount: state.layers.length,
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
        if (none) return null
        const selected = Array.isArray(options.extensions)
            ? options.extensions
            : ['gerber.entry-order', 'gerber.archive']
        const included = none
            ? []
            : selected.filter((id) => id !== 'gerber.native-model')
        return {
            $meta: {
                schema: 'ecad-toolkit.extension.v1',
                completeness: Array.isArray(options.extensions)
                    ? 'canonical'
                    : options.extensions,
                included,
                omitted: []
            },
            entryNames: classified.entryNames,
            expandedEntryNames: classified.entryNames,
            archiveExpanded: classified.archiveExpanded
        }
    }

    /** @param {Record<string, any>} classified Entries. @returns {string} Project name. */
    static #documentName(classified) {
        if (classified.originalCount === 1 && classified.archiveExpanded) {
            return (
                classified.originalNames[0]
                    ?.split('/')
                    .at(-1)
                    ?.replace(/\.zip$/iu, '') || 'fabrication'
            )
        }
        if (classified.originalCount === 1) return classified.originalNames[0]
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
