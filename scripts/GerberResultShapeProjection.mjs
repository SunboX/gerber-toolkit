import { GerberSourceExpression } from './GerberSourceExpression.mjs'

/**
 * Projects abstract result shapes through member selections and output prefixes.
 */
export class GerberResultShapeProjection {
    /**
     * Copies one abstract shape through a member selection and output prefix.
     * @param {Record<string, any>} destination Destination shape.
     * @param {Record<string, any>} source Source shape.
     * @param {string} select Selected member path.
     * @param {string} prefix Output prefix.
     * @returns {void}
     */
    static copy(destination, source, select, prefix) {
        for (const field of source.fields) {
            const mapped = GerberResultShapeProjection.#mappedField(field, {
                prefix,
                select
            })
            if (mapped) destination.fields.add(mapped)
        }
        for (const [field, className] of source.types) {
            const mapped = GerberResultShapeProjection.#mappedField(field, {
                prefix,
                select
            })
            if (mapped !== null) destination.types.set(mapped, className)
        }
        for (const key of ['references', 'parameters', 'locals']) {
            for (const candidate of source[key]) {
                const mapped = GerberResultShapeProjection.#copySource(
                    candidate,
                    select,
                    prefix
                )
                if (mapped) destination[key].push(mapped)
            }
        }
    }

    /**
     * Applies one optional member selection and output prefix.
     * @param {string} field Source field.
     * @param {{ prefix?: string, select?: string }} source Shape source.
     * @returns {string | null} Mapped field or null outside the selection.
     */
    static #mappedField(field, source) {
        let mapped = field
        if (source.select) {
            if (mapped === source.select) mapped = ''
            else if (mapped.startsWith(`${source.select}.`)) {
                mapped = mapped.slice(source.select.length + 1)
            } else return null
        }
        return GerberSourceExpression.path(source.prefix || '', mapped)
    }

    /**
     * Composes a symbolic source with one member selection and prefix.
     * @param {Record<string, any>} source Symbolic source.
     * @param {string} select Selected member path.
     * @param {string} prefix Output prefix.
     * @returns {Record<string, any> | null} Composed source.
     */
    static #copySource(source, select, prefix) {
        const sourcePrefix = source.prefix || ''
        const sourceSelect = source.select || ''
        if (!select) {
            return {
                ...source,
                prefix: GerberSourceExpression.path(prefix, sourcePrefix)
            }
        }
        if (!sourcePrefix) {
            return {
                ...source,
                prefix,
                select: GerberSourceExpression.path(sourceSelect, select)
            }
        }
        if (select === sourcePrefix) {
            return { ...source, prefix, select: sourceSelect }
        }
        if (select.startsWith(`${sourcePrefix}.`)) {
            return {
                ...source,
                prefix,
                select: GerberSourceExpression.path(
                    sourceSelect,
                    select.slice(sourcePrefix.length + 1)
                )
            }
        }
        if (sourcePrefix.startsWith(`${select}.`)) {
            return {
                ...source,
                prefix: GerberSourceExpression.path(
                    prefix,
                    sourcePrefix.slice(select.length + 1)
                ),
                select: sourceSelect
            }
        }
        return null
    }
}
