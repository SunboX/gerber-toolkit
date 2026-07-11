import polygonClipping from 'polygon-clipping'

import { GerberCircuitJsonCopperImageProjector } from './GerberCircuitJsonCopperImageProjector.mjs'

/** Interprets an X2 file image inside the finite physical board domain. */
export class GerberCircuitJsonPhysicalImage {
    /**
     * Builds the union of board outlines minus every owned cutout.
     * @param {Record<string, any>} profile Projected board profile.
     * @param {Record<string, any>} document Native Gerber document.
     * @returns {{ image: number[][][][], fallback: boolean }} Finite domain.
     */
    static domain(profile, document) {
        const boards = (profile?.boards || [])
            .map((board) =>
                GerberCircuitJsonPhysicalImage.#polygon(board.outline)
            )
            .filter((image) => image.length)
        let image = GerberCircuitJsonPhysicalImage.#union(boards)
        const fallback = !image.length
        if (fallback) {
            image = GerberCircuitJsonPhysicalImage.#boundsDomain(
                document?.pcb?.bounds
            )
        }
        const cutouts = (profile?.cutouts || [])
            .map((cutout) =>
                GerberCircuitJsonPhysicalImage.#polygon(cutout.points)
            )
            .filter((cutout) => cutout.length)
        if (image.length && cutouts.length) {
            image = polygonClipping.difference(
                image,
                GerberCircuitJsonPhysicalImage.#union(cutouts)
            )
        }
        return { image, fallback }
    }

    /**
     * Reads explicit X2 material polarity without changing LP composition.
     * @param {Record<string, any>} layer Native layer.
     * @returns {'negative' | 'positive' | null} Explicit material polarity.
     */
    static filePolarity(layer) {
        const value = layer?.attributes?.file?.FilePolarity
        const token = String(Array.isArray(value) ? value[0] : value || '')
            .trim()
            .toLowerCase()
        if (token === 'negative') return 'negative'
        if (token === 'positive') return 'positive'
        return null
    }

    /**
     * Resolves material-present copper from a fully composed file image.
     * @param {Record<string, any>[]} primitives Native primitives.
     * @param {number[][][][]} domain Finite board domain.
     * @param {'negative' | 'positive'} polarity X2 material polarity.
     * @param {'negative' | 'positive' | undefined} imagePolarity Legacy image polarity.
     * @returns {number[][][][]} Physical copper material.
     */
    static copper(primitives, domain, polarity, imagePolarity) {
        const image = GerberCircuitJsonPhysicalImage.generatedImage(
            primitives,
            domain,
            imagePolarity
        )
        if (!domain.length) return polarity === 'negative' ? [] : image
        return polarity === 'negative'
            ? polygonClipping.difference(domain, image)
            : image.length
              ? polygonClipping.intersection(image, domain)
              : []
    }

    /**
     * Resolves solder-mask openings from a fully composed file image.
     * @param {Record<string, any>[]} primitives Native primitives.
     * @param {number[][][][]} domain Finite board domain.
     * @param {'negative' | 'positive' | null} polarity X2 material polarity.
     * @param {'negative' | 'positive' | undefined} imagePolarity Legacy image polarity.
     * @returns {number[][][][]} Physical mask openings.
     */
    static maskOpenings(primitives, domain, polarity, imagePolarity) {
        const image = GerberCircuitJsonPhysicalImage.generatedImage(
            primitives,
            domain,
            imagePolarity
        )
        if (!polarity) return image
        if (!domain.length) return polarity === 'negative' ? image : []
        return polarity === 'negative'
            ? image.length
                ? polygonClipping.intersection(image, domain)
                : []
            : polygonClipping.difference(domain, image)
    }

    /**
     * Unions physical images without imposing an argument-count ceiling.
     * @param {number[][][][][]} images MultiPolygon images.
     * @returns {number[][][][]} Unioned image.
     */
    static union(images) {
        return GerberCircuitJsonPhysicalImage.#union(images)
    }

    /**
     * Resolves the generated image, including deprecated IPNEG reversal.
     * @param {Record<string, any>[]} primitives Native primitives.
     * @param {number[][][][]} domain Finite board domain.
     * @param {'negative' | 'positive' | undefined} imagePolarity Legacy image polarity.
     * @returns {number[][][][]} Generated image.
     */
    static generatedImage(primitives, domain, imagePolarity) {
        const image = GerberCircuitJsonCopperImageProjector.compose(primitives)
        return imagePolarity === 'negative' && domain.length
            ? polygonClipping.difference(domain, image)
            : image
    }

    /**
     * Resolves physical material for non-mask fabrication artwork.
     * @param {Record<string, any>[]} primitives Native primitives.
     * @param {number[][][][]} domain Finite board domain.
     * @param {'negative' | 'positive'} filePolarity X2 material polarity.
     * @param {'negative' | 'positive' | undefined} imagePolarity Legacy image polarity.
     * @returns {number[][][][]} Physical material image.
     */
    static material(primitives, domain, filePolarity, imagePolarity) {
        const image = GerberCircuitJsonPhysicalImage.generatedImage(
            primitives,
            domain,
            imagePolarity
        )
        if (!domain.length) return filePolarity === 'negative' ? [] : image
        return filePolarity === 'negative'
            ? polygonClipping.difference(domain, image)
            : image.length
              ? polygonClipping.intersection(image, domain)
              : []
    }

    /**
     * Tests whether an image is already wholly inside the board domain.
     * @param {number[][][][]} image Candidate image.
     * @param {number[][][][]} domain Board domain.
     * @returns {boolean} Whether clipping would preserve it exactly.
     */
    static isWithin(image, domain) {
        return (
            !image.length ||
            !domain.length ||
            polygonClipping.difference(image, domain).length === 0
        )
    }

    /**
     * Builds one MultiPolygon from a point ring.
     * @param {unknown} points Point sequence.
     * @returns {number[][][][]} MultiPolygon.
     */
    static #polygon(points) {
        if (!Array.isArray(points)) return []
        const ring = points
            .map((point) => [Number(point?.x), Number(point?.y)])
            .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
        if (ring.length < 3) return []
        if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) {
            ring.push([...ring[0]])
        }
        return [[ring]]
    }

    /**
     * Builds a rectangle domain from finite native aggregate bounds.
     * @param {Record<string, any>} bounds Native bounds.
     * @returns {number[][][][]} Rectangle image.
     */
    static #boundsDomain(bounds = {}) {
        const minX = Number(bounds.minX)
        const minY = Number(bounds.minY)
        const maxX = Number(bounds.maxX)
        const maxY = Number(bounds.maxY)
        if (![minX, minY, maxX, maxY].every(Number.isFinite)) return []
        const right = maxX > minX ? maxX : minX + 0.000001
        const top = maxY > minY ? maxY : minY + 0.000001
        return [
            [
                [
                    [minX, minY],
                    [right, minY],
                    [right, top],
                    [minX, top],
                    [minX, minY]
                ]
            ]
        ]
    }

    /**
     * Unions a bounded list in chunks.
     * @param {number[][][][][]} images MultiPolygon images.
     * @returns {number[][][][]} Unioned image.
     */
    static #union(images) {
        let merged = []
        const filtered = images.filter((image) => image.length)
        for (let offset = 0; offset < filtered.length; offset += 256) {
            const chunk = polygonClipping.union(
                ...filtered.slice(offset, offset + 256)
            )
            merged = merged.length
                ? polygonClipping.union(merged, chunk)
                : chunk
        }
        return merged
    }
}

Object.freeze(GerberCircuitJsonPhysicalImage.prototype)
Object.freeze(GerberCircuitJsonPhysicalImage)
