import { unzipSync } from 'fflate'
import { GerberParser } from './GerberParser.mjs'
import { GerberLayerRoleResolver } from './GerberLayerRoleResolver.mjs'

/**
 * Loads selected fabrication files into one composite Gerber document.
 */
export class GerberProjectLoader {
    /**
     * Returns true when entries contain Gerber or Excellon fabrication input.
     * @param {{ name: string, bytes?: Uint8Array, buffer?: ArrayBuffer }[]} entries Source entries.
     * @returns {boolean}
     */
    static canLoadEntries(entries) {
        return GerberProjectLoader.#expandEntries(entries).length > 0
    }

    /**
     * Loads selected source entries.
     * @param {{ name: string, bytes?: Uint8Array, buffer?: ArrayBuffer }[]} entries Source entries.
     * @param {object} [options] Loader options.
     * @returns {Promise<{ documents: object[], diagnostics: object[], assets: object[], project: object | null }>}
     */
    static async loadEntries(entries, options = {}) {
        const expandedEntries = GerberProjectLoader.#expandEntries(entries)
        const diagnostics = []
        const layers = []

        for (const entry of expandedEntries) {
            try {
                const document = GerberParser.parseArrayBuffer(
                    entry.name,
                    entry.bytes,
                    options
                )
                layers.push(...(document.pcb?.fabrication?.layers || []))
                diagnostics.push(...(document.diagnostics || []))
            } catch (error) {
                diagnostics.push(
                    GerberProjectLoader.#buildDiagnostic(entry.name, error)
                )
            }
        }

        if (!layers.length) {
            return {
                documents: [],
                diagnostics,
                assets: [],
                project: null
            }
        }

        const documentName = GerberProjectLoader.#documentName(
            entries,
            expandedEntries
        )
        const document = GerberParser.fromLayers(documentName, layers, options)
        document.diagnostics = diagnostics

        return {
            documents: [document],
            diagnostics,
            assets: [],
            project: {
                sourceFormat: 'gerber',
                fileName: documentName,
                documents: layers.map((layer) => ({
                    fileName: layer.fileName,
                    role: layer.role,
                    side: layer.side
                }))
            }
        }
    }

    /**
     * Expands selected entries and ZIP archives into file entries.
     * @param {{ name: string, bytes?: Uint8Array, buffer?: ArrayBuffer }[]} entries Source entries.
     * @returns {{ name: string, bytes: Uint8Array }[]}
     */
    static #expandEntries(entries) {
        return (entries || []).flatMap((entry) => {
            const name = String(entry?.name || '')
            const bytes = GerberProjectLoader.#entryBytes(entry)
            if (!name || !bytes) {
                return []
            }

            if (GerberLayerRoleResolver.isZipFileName(name)) {
                return GerberProjectLoader.#expandZip(name, bytes)
            }

            return GerberLayerRoleResolver.isFabricationFileName(name) ||
                GerberProjectLoader.#looksLikeFabricationText(bytes)
                ? [{ name, bytes }]
                : []
        })
    }

    /**
     * Expands one ZIP archive into fabrication source entries.
     * @param {string} archiveName Archive file name.
     * @param {Uint8Array} bytes Archive bytes.
     * @returns {{ name: string, bytes: Uint8Array }[]}
     */
    static #expandZip(archiveName, bytes) {
        const files = unzipSync(bytes)

        return Object.entries(files)
            .filter(([name]) => GerberProjectLoader.#isVisibleArchiveFile(name))
            .filter(([name, fileBytes]) => {
                return (
                    GerberLayerRoleResolver.isFabricationFileName(name) ||
                    GerberProjectLoader.#looksLikeFabricationText(fileBytes)
                )
            })
            .map(([name, fileBytes]) => ({
                name: archiveName.replace(/\.zip$/iu, '') + '/' + name,
                bytes: fileBytes
            }))
    }

    /**
     * Returns true when an archive entry should be considered.
     * @param {string} name Archive member path.
     * @returns {boolean}
     */
    static #isVisibleArchiveFile(name) {
        const normalized = String(name || '').replace(/\\+/gu, '/')
        return (
            normalized &&
            !normalized.endsWith('/') &&
            !normalized.startsWith('__MACOSX/') &&
            !normalized.split('/').some((part) => part.startsWith('.'))
        )
    }

    /**
     * Returns true when bytes appear to contain Gerber or Excellon text.
     * @param {Uint8Array} bytes Source bytes.
     * @returns {boolean}
     */
    static #looksLikeFabricationText(bytes) {
        const sample = new TextDecoder('utf-8').decode(bytes.slice(0, 1024))
        return /%FS|%MO|%AD|G04|M48|T\d+C[0-9.]+/iu.test(sample)
    }

    /**
     * Reads bytes from one source entry.
     * @param {{ bytes?: Uint8Array, buffer?: ArrayBuffer } | null | undefined} entry Source entry.
     * @returns {Uint8Array | null}
     */
    static #entryBytes(entry) {
        if (entry?.bytes instanceof Uint8Array) {
            return entry.bytes
        }

        if (entry?.buffer instanceof ArrayBuffer) {
            return new Uint8Array(entry.buffer)
        }

        return null
    }

    /**
     * Resolves the composite document name.
     * @param {{ name: string }[]} originalEntries Original selected entries.
     * @param {{ name: string }[]} expandedEntries Expanded source entries.
     * @returns {string}
     */
    static #documentName(originalEntries, expandedEntries) {
        if (originalEntries?.length === 1) {
            return String(originalEntries[0]?.name || 'fabrication')
        }

        const first = String(expandedEntries[0]?.name || 'fabrication')
        return first.includes('/') ? first.split('/')[0] : 'fabrication-package'
    }

    /**
     * Builds one parse diagnostic.
     * @param {string} fileName Source file name.
     * @param {unknown} error Parser error.
     * @returns {{ severity: string, fileName: string, message: string }}
     */
    static #buildDiagnostic(fileName, error) {
        const message =
            error instanceof Error && error.message
                ? error.message
                : 'Unknown parser error.'

        return {
            severity: 'error',
            fileName,
            message: 'Failed to parse ' + fileName + ': ' + message
        }
    }
}
