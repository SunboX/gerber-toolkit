import { readdir } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Loads source-owned classes referenced by public contracts but not exported.
 */
export class GerberApiSupportingClassLoader {
    /**
     * Loads uniquely named supporting classes reachable through static calls.
     * @param {{ api: Record<string, any> }[]} entrypointApis Entrypoint modules.
     * @param {string | undefined} sourceRoot Extracted package root.
     * @returns {Promise<Map<string, Function>>} Supporting classes by name.
     */
    static async load(entrypointApis, sourceRoot) {
        if (!sourceRoot) return new Map()
        const exportedNames = new Set(
            entrypointApis.flatMap((entry) => Object.keys(entry.api))
        )
        const filesByClass = await GerberApiSupportingClassLoader.#fileIndex(
            resolve(sourceRoot, 'src')
        )
        const queue = entrypointApis.flatMap((entry) =>
            Object.values(entry.api).flatMap((value) =>
                GerberApiSupportingClassLoader.#referencedClasses(value)
            )
        )
        const loaded = new Map()
        const visited = new Set()
        while (queue.length) {
            const className = queue.shift()
            if (visited.has(className) || exportedNames.has(className)) continue
            visited.add(className)
            const path = filesByClass.get(className)
            if (!path) continue
            const api = await import(pathToFileURL(path).href)
            const value = api[className]
            if (typeof value !== 'function') continue
            loaded.set(className, value)
            queue.push(
                ...GerberApiSupportingClassLoader.#referencedClasses(value)
            )
        }
        return loaded
    }

    /**
     * Indexes unique CamelCase module basenames below one source directory.
     * @param {string} directory Source directory.
     * @returns {Promise<Map<string, string>>} Class name to module path.
     */
    static async #fileIndex(directory) {
        const candidates = new Map()
        for (const path of await GerberApiSupportingClassLoader.#moduleFiles(
            directory
        )) {
            const className = basename(path, '.mjs')
            if (!/^[A-Z][A-Za-z0-9_$]*$/u.test(className)) continue
            const paths = candidates.get(className) || []
            paths.push(path)
            candidates.set(className, paths)
        }
        return new Map(
            [...candidates]
                .filter(([, paths]) => paths.length === 1)
                .map(([className, paths]) => [className, paths[0]])
        )
    }

    /**
     * Recursively lists JavaScript modules below one directory.
     * @param {string} directory Source directory.
     * @returns {Promise<string[]>} Absolute module paths.
     */
    static async #moduleFiles(directory) {
        const paths = []
        let entries
        try {
            entries = await readdir(directory, { withFileTypes: true })
        } catch (error) {
            if (error?.code === 'ENOENT') return []
            throw error
        }
        for (const entry of entries) {
            const path = join(directory, entry.name)
            if (entry.isDirectory()) {
                paths.push(
                    ...(await GerberApiSupportingClassLoader.#moduleFiles(path))
                )
            } else if (entry.isFile() && entry.name.endsWith('.mjs')) {
                paths.push(path)
            }
        }
        return paths
    }

    /**
     * Finds class-like static call owners in one callable's source.
     * @param {unknown} value Callable candidate.
     * @returns {string[]} Referenced class names.
     */
    static #referencedClasses(value) {
        if (typeof value !== 'function') return []
        const names = new Set()
        const source = Function.prototype.toString.call(value)
        for (const match of source.matchAll(
            /\b([A-Z][A-Za-z0-9_$]*)\.(?:#?[A-Za-z_$][\w$]*)\s*\(/gu
        )) {
            names.add(match[1])
        }
        return [...names]
    }
}
