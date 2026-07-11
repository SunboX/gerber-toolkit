import { GerberApertureMacro } from './GerberApertureMacro.mjs'

/** Builds standard and macro aperture definitions in normalized millimeters. */
export class GerberApertureBuilder {
    /**
     * Builds an aperture model from a template.
     * @param {string} template Aperture template.
     * @param {number[]} values Aperture values.
     * @param {Map<string, object>} macros Defined aperture macros.
     * @param {string} unit Source unit.
     * @returns {object} Aperture model.
     */
    static build(template, values, macros, unit) {
        const macro = macros.get(template)
        if (macro) {
            return {
                shape: 'macro',
                name: template,
                primitives: GerberApertureMacro.expand(macro, values).map(
                    (primitive) =>
                        GerberApertureBuilder.#scaleMacroPrimitive(
                            primitive,
                            unit
                        )
                )
            }
        }
        if (template === 'R' || template === 'O') {
            return {
                shape: template === 'R' ? 'rect' : 'obround',
                width: GerberApertureBuilder.#unitValue(values[0], unit),
                height: GerberApertureBuilder.#unitValue(
                    values[1] || values[0],
                    unit
                ),
                ...GerberApertureBuilder.#hole(values, 2, unit)
            }
        }
        if (template === 'P') {
            return {
                shape: 'polygon',
                diameter: GerberApertureBuilder.#unitValue(values[0], unit),
                vertices: Number(values[1] || 3),
                rotation: Number(values[2] || 0),
                ...GerberApertureBuilder.#hole(values, 3, unit)
            }
        }
        return {
            shape: 'circle',
            diameter: GerberApertureBuilder.#unitValue(values[0], unit),
            ...GerberApertureBuilder.#hole(values, 1, unit)
        }
    }

    /**
     * Preserves an optional round or rectangular standard aperture hole.
     * @param {number[]} values Aperture modifiers.
     * @param {number} offset First hole modifier index.
     * @param {string} unit Source unit.
     * @returns {Record<string, any>} Optional hole payload.
     */
    static #hole(values, offset, unit) {
        const first = Number(values[offset])
        if (!Number.isFinite(first) || first <= 0) return {}
        const second = Number(values[offset + 1])
        return Number.isFinite(second) && second > 0
            ? {
                  hole: {
                      shape: 'rect',
                      width: GerberApertureBuilder.#unitValue(first, unit),
                      height: GerberApertureBuilder.#unitValue(second, unit)
                  }
              }
            : {
                  hole: {
                      shape: 'circle',
                      diameter: GerberApertureBuilder.#unitValue(first, unit)
                  }
              }
    }

    /**
     * Converts one expanded macro primitive from source units to millimeters.
     * @param {object} primitive Macro primitive.
     * @param {string} unit Source unit.
     * @returns {object} Scaled primitive.
     */
    static #scaleMacroPrimitive(primitive, unit) {
        const scaled = { ...primitive }
        for (const key of GerberApertureBuilder.#macroLengthKeys(primitive)) {
            scaled[key] = GerberApertureBuilder.#unitValue(primitive[key], unit)
        }
        if (Array.isArray(primitive.points)) {
            scaled.points = primitive.points.map((point) => ({
                x: GerberApertureBuilder.#unitValue(point.x, unit),
                y: GerberApertureBuilder.#unitValue(point.y, unit)
            }))
        }
        return scaled
    }

    /** @param {object} primitive Macro primitive. @returns {string[]} Length keys. */
    static #macroLengthKeys(primitive) {
        const keys = ['x', 'y']
        if (primitive.type === 'circle' || primitive.type === 'polygon') {
            keys.push('diameter')
        }
        if (primitive.type === 'line')
            keys.push('width', 'x1', 'y1', 'x2', 'y2')
        if (primitive.type === 'rect') keys.push('width', 'height')
        if (primitive.type === 'moire') {
            keys.push(
                'outerDiameter',
                'ringThickness',
                'ringGap',
                'crosshairThickness',
                'crosshairLength'
            )
        }
        if (primitive.type === 'thermal') {
            keys.push('outerDiameter', 'innerDiameter', 'gap')
        }
        return keys.filter((key) => primitive[key] !== undefined)
    }

    /** @param {unknown} value Source value. @param {string} unit Unit. @returns {number} Millimeters. */
    static #unitValue(value, unit) {
        const number = Number.parseFloat(String(value || '0'))
        return GerberApertureBuilder.#round(
            unit === 'inch' ? number * 25.4 : number
        )
    }

    /** @param {number} value Numeric value. @returns {number} Rounded value. */
    static #round(value) {
        return Number(Number(value || 0).toFixed(6))
    }
}

Object.freeze(GerberApertureBuilder.prototype)
Object.freeze(GerberApertureBuilder)
