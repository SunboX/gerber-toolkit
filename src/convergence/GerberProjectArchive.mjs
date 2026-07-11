import { unzipSync } from 'fflate'
import { ToolkitError } from 'circuitjson-toolkit/parser'
import {
    ArchiveEntryPath,
    ZipArchiveInspector
} from 'circuitjson-toolkit/project'

import { Parser } from './Parser.mjs'

/** Owns bounded Gerber ZIP detection, inflation, and integrity checks. */
export class GerberProjectArchive {
    /**
     * Detects a real fabrication member without claiming unrelated archives.
     * @param {string} archiveName Normalized archive name.
     * @param {Uint8Array} bytes Owned ZIP bytes.
     * @param {Record<string, number>} limits Archive limits.
     * @returns {boolean} Whether a Gerber/Excellon member is present.
     */
    static supports(archiveName, bytes, limits) {
        const report = ZipArchiveInspector.inspect(bytes, {
            archiveName,
            limits
        })
        if (GerberProjectArchive.#nested(report)) return false
        const visible = GerberProjectArchive.#visible(report)
        if (
            visible.some((entry) =>
                Parser.supports({
                    fileName: entry.name,
                    data: new Uint8Array()
                })
            )
        ) {
            return true
        }
        const expected = new Map(visible.map((entry) => [entry.name, entry]))
        const files = unzipSync(bytes, {
            filter: (entry) =>
                expected.has(ArchiveEntryPath.normalize(entry.name))
        })
        for (const [memberName, memberBytes] of Object.entries(files)) {
            const name = ArchiveEntryPath.normalize(memberName)
            const inspected = expected.get(name)
            if (!inspected) continue
            ZipArchiveInspector.verifyExtractedBytes(inspected, memberBytes)
            if (Parser.supports({ fileName: name, data: memberBytes })) {
                return true
            }
        }
        return false
    }

    /**
     * Inflates safe visible members after complete central-directory preflight.
     * @param {string} archiveName Normalized archive name.
     * @param {Uint8Array} bytes Owned ZIP bytes.
     * @param {Record<string, number>} limits Archive limits.
     * @param {{ baseEntryCount: number, baseTotalBytes: number }} accounting Request accounting.
     * @returns {{ name: string, bytes: Uint8Array, assets: object[], archiveDepth: number }[]} Members.
     */
    static expand(archiveName, bytes, limits, accounting) {
        const report = ZipArchiveInspector.inspect(bytes, {
            archiveName,
            archiveDepth: 1,
            baseEntryCount: accounting.baseEntryCount,
            baseTotalBytes: accounting.baseTotalBytes,
            limits
        })
        const nested = GerberProjectArchive.#nested(report)
        if (nested) {
            throw GerberProjectArchive.#limitError(
                limits.maxArchiveDepth,
                nested.name
            )
        }
        const expected = new Map(
            GerberProjectArchive.#visible(report).map((entry) => [
                entry.name,
                entry
            ])
        )
        let files
        try {
            files = unzipSync(bytes, {
                filter: (entry) =>
                    expected.has(ArchiveEntryPath.normalize(entry.name))
            })
        } catch (error) {
            if (ToolkitError.trustedRecord(error)) throw error
            throw ToolkitError.from(error, {
                code: 'ERR_PROJECT_INPUT',
                category: 'validation',
                format: 'gerber',
                source: archiveName
            })
        }
        const prefix = archiveName.replace(/\.zip$/iu, '')
        const result = []
        for (const [memberName, memberBytes] of Object.entries(files)) {
            const safeMember = ArchiveEntryPath.normalize(memberName)
            const inspected = expected.get(safeMember)
            if (!inspected) throw GerberProjectArchive.#invalid(safeMember)
            ZipArchiveInspector.verifyExtractedBytes(inspected, memberBytes)
            expected.delete(safeMember)
            result.push({
                name: ArchiveEntryPath.normalize(`${prefix}/${safeMember}`),
                bytes: memberBytes,
                assets: [],
                archiveDepth: 1
            })
        }
        if (expected.size) throw GerberProjectArchive.#invalid(archiveName)
        return result
    }

    /** @param {Record<string, any>} report Inspection report. @returns {Record<string, any> | undefined} Nested member. */
    static #nested(report) {
        return report.entries.find(
            (entry) =>
                !entry.directory && entry.name.toLowerCase().endsWith('.zip')
        )
    }

    /** @param {Record<string, any>} report Inspection report. @returns {Record<string, any>[]} Visible files. */
    static #visible(report) {
        return report.entries.filter(
            (entry) =>
                !entry.directory && !GerberProjectArchive.#hidden(entry.name)
        )
    }

    /** @param {string} name Member path. @returns {boolean} Hidden metadata. */
    static #hidden(name) {
        return (
            name.startsWith('__MACOSX/') ||
            name.split('/').some((part) => part.startsWith('.'))
        )
    }

    /** @param {string} source Source name. @returns {ToolkitError} Integrity error. */
    static #invalid(source) {
        return new ToolkitError(
            'ZIP output differs from its inspected central directory.',
            {
                code: 'ERR_ARCHIVE_INVALID',
                category: 'validation',
                format: 'gerber',
                source,
                details: {}
            }
        )
    }

    /** @param {number} maximum Maximum depth. @param {string} source Nested member. @returns {ToolkitError} Limit error. */
    static #limitError(maximum, source) {
        return new ToolkitError(
            'Gerber archive limit exceeded: maxArchiveDepth.',
            {
                code: 'ERR_ARCHIVE_LIMIT_EXCEEDED',
                category: 'validation',
                format: 'gerber',
                source,
                details: {
                    limit: 'maxArchiveDepth',
                    maximum,
                    actual: 2
                }
            }
        )
    }
}

Object.freeze(GerberProjectArchive.prototype)
Object.freeze(GerberProjectArchive)
