import polygonClipping from 'polygon-clipping'

import { GerberCircuitJsonApertureHoleProjector } from './GerberCircuitJsonApertureHoleProjector.mjs'
import { GerberCircuitJsonArcSampler } from './GerberCircuitJsonArcSampler.mjs'
import { GerberCircuitJsonSquareStroke } from './GerberCircuitJsonSquareStroke.mjs'

const CURVE_SEGMENTS = 32

/** Composites ordered Gerber copper artwork into canonical BREP geometry. */
export class GerberCircuitJsonCopperImageProjector {
    /**
     * Returns the ordered image geometry for other canonical artwork families.
     * @param {Record<string, any>[]} primitives Native primitives.
     * @returns {number[][][][]} MultiPolygon image.
     */
    static compose(primitives) {
        return GerberCircuitJsonCopperImageProjector.#compose(primitives)
    }

    /**
     * Returns one primitive's polygon image without unrelated composition.
     * @param {Record<string, any>} primitive Native primitive.
     * @returns {number[][][][]} MultiPolygon geometry.
     */
    static primitiveGeometry(primitive) {
        return GerberCircuitJsonCopperImageProjector.#geometry(primitive)
    }

    /**
     * Emits canonical copper BREP rows from already composed geometry.
     * @param {number[][][][]} image MultiPolygon image.
     * @param {string} layer Canonical copper layer.
     * @param {string} prefix Stable id prefix.
     * @param {boolean | undefined} [coveredWithSolderMask] Mask coverage.
     * @returns {Record<string, any>[]} Canonical rows.
     */
    static rows(image, layer, prefix, coveredWithSolderMask = undefined) {
        return GerberCircuitJsonCopperImageProjector.#rows(
            image,
            layer,
            prefix,
            coveredWithSolderMask
        )
    }

    /**
     * Returns whether a layer needs ordered image composition for fidelity.
     * @param {Record<string, any>[]} primitives Native primitives.
     * @returns {boolean} Whether simple trace/pad projection is insufficient.
     */
    static requiresComposition(primitives) {
        return primitives.some((primitive) => primitive?.polarity === 'clear')
    }

    /**
     * Applies every dark/clear exposure in source order and emits BREP pours.
     * @param {Record<string, any>[]} primitives Native primitives.
     * @param {string} layer Canonical copper layer.
     * @param {number} layerIndex Stable layer index.
     * @returns {Record<string, any>[]} Canonical copper image rows.
     */
    static project(primitives, layer, layerIndex) {
        const image = GerberCircuitJsonCopperImageProjector.#compose(primitives)
        return GerberCircuitJsonCopperImageProjector.#rows(
            image,
            layer,
            `gerber_image_${layerIndex}`
        )
    }

    /**
     * Projects one complex dark flash without composing unrelated primitives.
     * @param {Record<string, any>} primitive Native primitive.
     * @param {string} layer Canonical copper layer.
     * @param {string} id Stable source suffix.
     * @returns {Record<string, any>[]} Canonical BREP rows.
     */
    static projectPrimitive(primitive, layer, id) {
        return GerberCircuitJsonCopperImageProjector.#rows(
            GerberCircuitJsonCopperImageProjector.#geometry(primitive),
            layer,
            `gerber_complex_${id}`
        )
    }

    /**
     * Converts one MultiPolygon image to canonical BREP rows.
     * @param {number[][][][]} image MultiPolygon image.
     * @param {string} layer Canonical copper layer.
     * @param {string} prefix Stable id prefix.
     * @param {boolean | undefined} [coveredWithSolderMask] Mask coverage.
     * @returns {Record<string, any>[]} Canonical rows.
     */
    static #rows(image, layer, prefix, coveredWithSolderMask = undefined) {
        const rows = []
        for (let index = 0; index < image.length; index += 1) {
            const polygon = image[index]
            const rings = polygon
                .map((ring) =>
                    GerberCircuitJsonCopperImageProjector.#circuitRing(ring)
                )
                .filter((ring) => ring.length >= 3)
            if (!rings.length) continue
            rows.push({
                type: 'pcb_copper_pour',
                pcb_copper_pour_id: `${prefix}_${index}`,
                shape: 'brep',
                brep_shape: {
                    outer_ring: { vertices: rings[0] },
                    inner_rings: rings
                        .slice(1)
                        .map((vertices) => ({ vertices }))
                },
                layer,
                ...(coveredWithSolderMask === undefined
                    ? {}
                    : { covered_with_solder_mask: coveredWithSolderMask })
            })
        }
        return rows
    }

    /**
     * Composites one ordered primitive list into a polygon-clipping image.
     * @param {Record<string, any>[]} primitives Native primitives.
     * @returns {number[][][][]} MultiPolygon image.
     */
    static #compose(primitives) {
        let image = []
        let batch = []
        let polarity = null
        const flush = () => {
            if (!batch.length) return
            const geometry =
                GerberCircuitJsonCopperImageProjector.#unionMany(batch)
            image = GerberCircuitJsonCopperImageProjector.#apply(
                image,
                geometry,
                polarity
            )
            batch = []
        }
        for (const primitive of primitives) {
            const geometry =
                GerberCircuitJsonCopperImageProjector.#geometry(primitive)
            if (!geometry.length) continue
            const nextPolarity =
                primitive?.polarity || primitive?.exposure || 'dark'
            if (polarity !== null && nextPolarity !== polarity) flush()
            polarity = nextPolarity
            batch.push(geometry)
        }
        flush()
        return image
    }

    /**
     * Unions an operand batch in bounded chunks to avoid argument ceilings.
     * @param {number[][][][][]} operands MultiPolygon operands.
     * @returns {number[][][][]} Unioned geometry.
     */
    static #unionMany(operands) {
        let merged = []
        for (let offset = 0; offset < operands.length; offset += 256) {
            const chunk = polygonClipping.union(
                ...operands.slice(offset, offset + 256)
            )
            merged = merged.length
                ? polygonClipping.union(merged, chunk)
                : chunk
        }
        return merged
    }

    /**
     * Applies one polygon operand to the accumulated Gerber image.
     * @param {number[][][][]} image Current image.
     * @param {number[][][][]} geometry Operand geometry.
     * @param {string} polarity Dark or clear polarity.
     * @returns {number[][][][]} Updated image.
     */
    static #apply(image, geometry, polarity) {
        if (polarity === 'clear') {
            return image.length
                ? polygonClipping.difference(image, geometry)
                : []
        }
        return image.length ? polygonClipping.union(image, geometry) : geometry
    }

    /**
     * Converts one native primitive into a MultiPolygon operand.
     * @param {Record<string, any>} primitive Native primitive.
     * @returns {number[][][][]} Geometry.
     */
    static #geometry(primitive) {
        if (primitive?.type === 'region') {
            return GerberCircuitJsonCopperImageProjector.#polygon(
                primitive.points
            )
        }
        if (primitive?.type === 'line' || primitive?.type === 'arc') {
            const points =
                primitive.type === 'arc'
                    ? GerberCircuitJsonArcSampler.points(primitive)
                    : [
                          { x: primitive.x1, y: primitive.y1 },
                          { x: primitive.x2, y: primitive.y2 }
                      ]
            return GerberCircuitJsonCopperImageProjector.#polygon(
                GerberCircuitJsonCopperImageProjector.#stroke(
                    points,
                    GerberCircuitJsonCopperImageProjector.#positive(
                        primitive.width
                    )
                )
            )
        }
        if (primitive?.type !== 'flash') return []
        return GerberCircuitJsonCopperImageProjector.#flash(primitive)
    }

    /**
     * Converts one flash, including macro and aperture-block shapes.
     * @param {Record<string, any>} primitive Native flash.
     * @returns {number[][][][]} Flash geometry.
     */
    static #flash(primitive) {
        if (primitive.shape === 'macro') {
            const local = GerberCircuitJsonCopperImageProjector.#macro(
                primitive.primitives || []
            )
            return GerberCircuitJsonCopperImageProjector.#transform(
                local,
                primitive.transform,
                primitive.x,
                primitive.y
            )
        }
        if (primitive.shape === 'block') {
            const geometry = GerberCircuitJsonCopperImageProjector.#compose(
                primitive.primitives || []
            )
            return GerberCircuitJsonCopperImageProjector.#transformAround(
                geometry,
                primitive.transform,
                primitive.x,
                primitive.y,
                true
            )
        }
        const x = GerberCircuitJsonCopperImageProjector.#number(primitive.x)
        const y = GerberCircuitJsonCopperImageProjector.#number(primitive.y)
        const rotation = GerberCircuitJsonCopperImageProjector.#number(
            primitive.rotation ?? primitive.transform?.rotation
        )
        if (primitive.shape === 'circle') {
            const radius =
                GerberCircuitJsonCopperImageProjector.#positive(
                    primitive.diameter
                ) / 2
            const geometry = GerberCircuitJsonCopperImageProjector.#polygon(
                GerberCircuitJsonCopperImageProjector.#ellipse(
                    x,
                    y,
                    radius,
                    radius,
                    0
                )
            )
            return GerberCircuitJsonApertureHoleProjector.subtract(
                GerberCircuitJsonCopperImageProjector.#transformAround(
                    geometry,
                    primitive.transform,
                    x,
                    y,
                    false
                ),
                primitive
            )
        }
        if (primitive.shape === 'rect') {
            const geometry = GerberCircuitJsonCopperImageProjector.#polygon(
                GerberCircuitJsonCopperImageProjector.#rectangle(
                    x,
                    y,
                    GerberCircuitJsonCopperImageProjector.#positive(
                        primitive.width
                    ),
                    GerberCircuitJsonCopperImageProjector.#positive(
                        primitive.height
                    ),
                    0
                )
            )
            return GerberCircuitJsonApertureHoleProjector.subtract(
                GerberCircuitJsonCopperImageProjector.#transformAround(
                    geometry,
                    primitive.transform,
                    x,
                    y,
                    false
                ),
                primitive
            )
        }
        if (primitive.shape === 'obround') {
            const geometry = GerberCircuitJsonCopperImageProjector.#polygon(
                GerberCircuitJsonCopperImageProjector.#capsule(
                    x,
                    y,
                    GerberCircuitJsonCopperImageProjector.#positive(
                        primitive.width
                    ),
                    GerberCircuitJsonCopperImageProjector.#positive(
                        primitive.height
                    ),
                    0
                )
            )
            return GerberCircuitJsonApertureHoleProjector.subtract(
                GerberCircuitJsonCopperImageProjector.#transformAround(
                    geometry,
                    primitive.transform,
                    x,
                    y,
                    false
                ),
                primitive
            )
        }
        if (primitive.shape === 'polygon') {
            const geometry = GerberCircuitJsonCopperImageProjector.#polygon(
                GerberCircuitJsonCopperImageProjector.#regularPolygon(
                    x,
                    y,
                    GerberCircuitJsonCopperImageProjector.#positive(
                        primitive.diameter
                    ) / 2,
                    primitive.vertices,
                    rotation
                )
            )
            return GerberCircuitJsonApertureHoleProjector.subtract(
                GerberCircuitJsonCopperImageProjector.#transformAround(
                    geometry,
                    primitive.transform,
                    x,
                    y,
                    false
                ),
                primitive
            )
        }
        return []
    }

    /**
     * Composites aperture-macro child exposures in local coordinates.
     * @param {Record<string, any>[]} primitives Macro children.
     * @returns {number[][][][]} Local macro geometry.
     */
    static #macro(primitives) {
        let image = []
        for (const primitive of primitives) {
            const geometry =
                GerberCircuitJsonCopperImageProjector.#macroGeometry(primitive)
            if (!geometry.length) continue
            image = GerberCircuitJsonCopperImageProjector.#apply(
                image,
                geometry,
                primitive.exposure || 'dark'
            )
        }
        return image
    }

    /**
     * Converts one macro child primitive.
     * @param {Record<string, any>} primitive Macro child.
     * @returns {number[][][][]} Local geometry.
     */
    static #macroGeometry(primitive) {
        const x = GerberCircuitJsonCopperImageProjector.#number(primitive.x)
        const y = GerberCircuitJsonCopperImageProjector.#number(primitive.y)
        const rotation = GerberCircuitJsonCopperImageProjector.#number(
            primitive.rotation
        )
        if (primitive.type === 'circle') {
            const radius =
                GerberCircuitJsonCopperImageProjector.#positive(
                    primitive.diameter
                ) / 2
            return GerberCircuitJsonCopperImageProjector.#polygon(
                GerberCircuitJsonCopperImageProjector.#ellipse(
                    x,
                    y,
                    radius,
                    radius,
                    0
                )
            )
        }
        if (primitive.type === 'line') {
            const geometry = GerberCircuitJsonCopperImageProjector.#polygon(
                GerberCircuitJsonSquareStroke.points(
                    [
                        { x: primitive.x1, y: primitive.y1 },
                        { x: primitive.x2, y: primitive.y2 }
                    ],
                    GerberCircuitJsonCopperImageProjector.#positive(
                        primitive.width
                    )
                )
            )
            return GerberCircuitJsonCopperImageProjector.#rotate(
                geometry,
                rotation,
                0,
                0
            )
        }
        if (primitive.type === 'rect') {
            return GerberCircuitJsonCopperImageProjector.#polygon(
                GerberCircuitJsonCopperImageProjector.#rectangle(
                    x,
                    y,
                    GerberCircuitJsonCopperImageProjector.#positive(
                        primitive.width
                    ),
                    GerberCircuitJsonCopperImageProjector.#positive(
                        primitive.height
                    ),
                    rotation
                )
            )
        }
        if (primitive.type === 'region') {
            return GerberCircuitJsonCopperImageProjector.#rotate(
                GerberCircuitJsonCopperImageProjector.#polygon(
                    primitive.points
                ),
                rotation,
                0,
                0
            )
        }
        if (primitive.type === 'polygon') {
            return GerberCircuitJsonCopperImageProjector.#polygon(
                GerberCircuitJsonCopperImageProjector.#regularPolygon(
                    x,
                    y,
                    GerberCircuitJsonCopperImageProjector.#positive(
                        primitive.diameter
                    ) / 2,
                    primitive.vertices,
                    rotation
                )
            )
        }
        if (primitive.type === 'moire') {
            return GerberCircuitJsonCopperImageProjector.#moire(primitive)
        }
        if (primitive.type === 'thermal') {
            return GerberCircuitJsonCopperImageProjector.#thermal(primitive)
        }
        return []
    }

    /**
     * Builds approximate standard moire rings plus crosshairs.
     * @param {Record<string, any>} primitive Macro moire.
     * @returns {number[][][][]} Moire geometry.
     */
    static #moire(primitive) {
        const x = GerberCircuitJsonCopperImageProjector.#number(primitive.x)
        const y = GerberCircuitJsonCopperImageProjector.#number(primitive.y)
        const thickness = GerberCircuitJsonCopperImageProjector.#positive(
            primitive.ringThickness
        )
        const gap = Math.max(
            0,
            GerberCircuitJsonCopperImageProjector.#number(primitive.ringGap)
        )
        const count = Math.max(0, Math.trunc(Number(primitive.ringCount) || 0))
        let image = []
        let diameter = GerberCircuitJsonCopperImageProjector.#positive(
            primitive.outerDiameter
        )
        for (let index = 0; index < count && diameter > 0; index += 1) {
            const outer = GerberCircuitJsonCopperImageProjector.#polygon(
                GerberCircuitJsonCopperImageProjector.#ellipse(
                    x,
                    y,
                    diameter / 2,
                    diameter / 2,
                    0
                )
            )
            const innerDiameter = Math.max(0, diameter - thickness * 2)
            const ring = innerDiameter
                ? polygonClipping.difference(
                      outer,
                      GerberCircuitJsonCopperImageProjector.#polygon(
                          GerberCircuitJsonCopperImageProjector.#ellipse(
                              x,
                              y,
                              innerDiameter / 2,
                              innerDiameter / 2,
                              0
                          )
                      )
                  )
                : outer
            image = image.length ? polygonClipping.union(image, ring) : ring
            diameter -= (thickness + gap) * 2
        }
        const crossLength = GerberCircuitJsonCopperImageProjector.#positive(
            primitive.crosshairLength
        )
        const crossWidth = GerberCircuitJsonCopperImageProjector.#positive(
            primitive.crosshairThickness
        )
        const cross = polygonClipping.union(
            GerberCircuitJsonCopperImageProjector.#polygon(
                GerberCircuitJsonCopperImageProjector.#rectangle(
                    x,
                    y,
                    crossLength,
                    crossWidth,
                    0
                )
            ),
            GerberCircuitJsonCopperImageProjector.#polygon(
                GerberCircuitJsonCopperImageProjector.#rectangle(
                    x,
                    y,
                    crossWidth,
                    crossLength,
                    0
                )
            )
        )
        const combined = image.length
            ? polygonClipping.union(image, cross)
            : cross
        return GerberCircuitJsonCopperImageProjector.#rotate(
            combined,
            primitive.rotation,
            0,
            0
        )
    }

    /**
     * Builds a thermal annulus with two orthogonal clearance bars.
     * @param {Record<string, any>} primitive Macro thermal.
     * @returns {number[][][][]} Thermal geometry.
     */
    static #thermal(primitive) {
        const x = GerberCircuitJsonCopperImageProjector.#number(primitive.x)
        const y = GerberCircuitJsonCopperImageProjector.#number(primitive.y)
        const outerDiameter = GerberCircuitJsonCopperImageProjector.#positive(
            primitive.outerDiameter
        )
        const innerDiameter = Math.max(
            0,
            GerberCircuitJsonCopperImageProjector.#number(
                primitive.innerDiameter
            )
        )
        const outer = GerberCircuitJsonCopperImageProjector.#polygon(
            GerberCircuitJsonCopperImageProjector.#ellipse(
                x,
                y,
                outerDiameter / 2,
                outerDiameter / 2,
                0
            )
        )
        let image = innerDiameter
            ? polygonClipping.difference(
                  outer,
                  GerberCircuitJsonCopperImageProjector.#polygon(
                      GerberCircuitJsonCopperImageProjector.#ellipse(
                          x,
                          y,
                          innerDiameter / 2,
                          innerDiameter / 2,
                          0
                      )
                  )
              )
            : outer
        const gap = GerberCircuitJsonCopperImageProjector.#positive(
            primitive.gap
        )
        const clear = polygonClipping.union(
            GerberCircuitJsonCopperImageProjector.#polygon(
                GerberCircuitJsonCopperImageProjector.#rectangle(
                    x,
                    y,
                    outerDiameter * 2,
                    gap,
                    0
                )
            ),
            GerberCircuitJsonCopperImageProjector.#polygon(
                GerberCircuitJsonCopperImageProjector.#rectangle(
                    x,
                    y,
                    gap,
                    outerDiameter * 2,
                    0
                )
            )
        )
        image = polygonClipping.difference(image, clear)
        return GerberCircuitJsonCopperImageProjector.#rotate(
            image,
            primitive.rotation,
            0,
            0
        )
    }

    /**
     * Creates one MultiPolygon from a point ring.
     * @param {unknown} points Point sequence.
     * @returns {number[][][][]} MultiPolygon.
     */
    static #polygon(points) {
        if (!Array.isArray(points)) return []
        const ring = points
            .map((point) => [Number(point?.x), Number(point?.y)])
            .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
        if (ring.length < 3) return []
        const first = ring[0]
        const last = ring.at(-1)
        if (first[0] !== last[0] || first[1] !== last[1]) {
            ring.push([...first])
        }
        return [[ring]]
    }

    /**
     * Builds a round-ended stroke envelope for a sampled centerline.
     * @param {{ x: number, y: number }[]} points Centerline.
     * @param {number} width Width.
     * @returns {{ x: number, y: number }[]} Stroke polygon.
     */
    static #stroke(points, width) {
        if (points.length < 2) return []
        const left = []
        const right = []
        for (let index = 0; index < points.length; index += 1) {
            const previous = points[Math.max(0, index - 1)]
            const next = points[Math.min(points.length - 1, index + 1)]
            const length = Math.hypot(next.x - previous.x, next.y - previous.y)
            if (!length) continue
            const nx = (-(next.y - previous.y) / length) * (width / 2)
            const ny = ((next.x - previous.x) / length) * (width / 2)
            left.push({
                x: Number(points[index].x) + nx,
                y: Number(points[index].y) + ny
            })
            right.push({
                x: Number(points[index].x) - nx,
                y: Number(points[index].y) - ny
            })
        }
        if (!left.length) return []
        const end = points.at(-1)
        const start = points[0]
        const endAngle = Math.atan2(
            points.at(-1).y - points.at(-2).y,
            points.at(-1).x - points.at(-2).x
        )
        const startAngle = Math.atan2(
            points[1].y - points[0].y,
            points[1].x - points[0].x
        )
        const endCap = GerberCircuitJsonCopperImageProjector.#arcPoints(
            end,
            width / 2,
            endAngle + Math.PI / 2,
            endAngle - Math.PI / 2
        )
        const startCap = GerberCircuitJsonCopperImageProjector.#arcPoints(
            start,
            width / 2,
            startAngle - Math.PI / 2,
            startAngle + Math.PI / 2
        )
        return [...left, ...endCap, ...right.reverse(), ...startCap]
    }

    /**
     * Samples one directed semicircle.
     * @param {{ x: number, y: number }} center Center.
     * @param {number} radius Radius.
     * @param {number} start Start radians.
     * @param {number} end End radians.
     * @returns {{ x: number, y: number }[]} Points.
     */
    static #arcPoints(center, radius, start, end) {
        let delta = end - start
        while (delta <= 0) delta += Math.PI * 2
        return Array.from({ length: CURVE_SEGMENTS / 2 }, (_, index) => {
            const angle = start + (delta * (index + 1)) / (CURVE_SEGMENTS / 2)
            return {
                x: Number(center.x) + Math.cos(angle) * radius,
                y: Number(center.y) + Math.sin(angle) * radius
            }
        })
    }

    /**
     * Builds a true rotated capsule outline.
     * @param {number} x Center X.
     * @param {number} y Center Y.
     * @param {number} width Width.
     * @param {number} height Height.
     * @param {number} rotation Rotation degrees.
     * @returns {{ x: number, y: number }[]} Capsule points.
     */
    static #capsule(x, y, width, height, rotation) {
        const horizontal = width >= height
        const diameter = Math.min(width, height)
        const span = Math.max(width, height) - diameter
        const points = horizontal
            ? GerberCircuitJsonCopperImageProjector.#stroke(
                  [
                      { x: x - span / 2, y },
                      { x: x + span / 2, y }
                  ],
                  diameter
              )
            : GerberCircuitJsonCopperImageProjector.#stroke(
                  [
                      { x, y: y - span / 2 },
                      { x, y: y + span / 2 }
                  ],
                  diameter
              )
        return GerberCircuitJsonCopperImageProjector.#rotatePoints(
            points,
            rotation,
            x,
            y
        )
    }

    /**
     * Samples a rotated ellipse.
     * @param {number} x Center X.
     * @param {number} y Center Y.
     * @param {number} radiusX X radius.
     * @param {number} radiusY Y radius.
     * @param {number} rotation Rotation degrees.
     * @returns {{ x: number, y: number }[]} Points.
     */
    static #ellipse(x, y, radiusX, radiusY, rotation) {
        return GerberCircuitJsonCopperImageProjector.#rotatePoints(
            Array.from({ length: CURVE_SEGMENTS }, (_, index) => {
                const angle = (index / CURVE_SEGMENTS) * Math.PI * 2
                return {
                    x: x + Math.cos(angle) * radiusX,
                    y: y + Math.sin(angle) * radiusY
                }
            }),
            rotation,
            x,
            y
        )
    }

    /**
     * Builds rotated rectangle vertices.
     * @param {number} x Center X.
     * @param {number} y Center Y.
     * @param {number} width Width.
     * @param {number} height Height.
     * @param {number} rotation Rotation degrees.
     * @returns {{ x: number, y: number }[]} Vertices.
     */
    static #rectangle(x, y, width, height, rotation) {
        return GerberCircuitJsonCopperImageProjector.#rotatePoints(
            [
                { x: x - width / 2, y: y - height / 2 },
                { x: x + width / 2, y: y - height / 2 },
                { x: x + width / 2, y: y + height / 2 },
                { x: x - width / 2, y: y + height / 2 }
            ],
            rotation,
            x,
            y
        )
    }

    /**
     * Builds a regular polygon.
     * @param {number} x Center X.
     * @param {number} y Center Y.
     * @param {number} radius Radius.
     * @param {unknown} count Vertex count.
     * @param {number} rotation Rotation degrees.
     * @returns {{ x: number, y: number }[]} Vertices.
     */
    static #regularPolygon(x, y, radius, count, rotation) {
        const vertices = Math.max(3, Math.trunc(Number(count) || 3))
        const offset = (rotation * Math.PI) / 180
        return Array.from({ length: vertices }, (_, index) => {
            const angle = (index / vertices) * Math.PI * 2 + offset
            return {
                x: x + Math.cos(angle) * radius,
                y: y + Math.sin(angle) * radius
            }
        })
    }

    /**
     * Applies aperture mirror/scale/rotation and flash translation.
     * @param {number[][][][]} geometry Local geometry.
     * @param {Record<string, any>} transform Aperture transform.
     * @param {unknown} translateX Flash X.
     * @param {unknown} translateY Flash Y.
     * @returns {number[][][][]} Transformed geometry.
     */
    static #transform(
        geometry,
        transform = {},
        translateX = 0,
        translateY = 0
    ) {
        const mirror = String(transform?.mirror || 'none')
        const scale = GerberCircuitJsonCopperImageProjector.#number(
            transform?.scale,
            1
        )
        const scaleX = (mirror === 'x' || mirror === 'xy' ? -1 : 1) * scale
        const scaleY = (mirror === 'y' || mirror === 'xy' ? -1 : 1) * scale
        const radians =
            (GerberCircuitJsonCopperImageProjector.#number(
                transform?.rotation
            ) *
                Math.PI) /
            180
        const cosine = Math.cos(radians)
        const sine = Math.sin(radians)
        const dx = GerberCircuitJsonCopperImageProjector.#number(translateX)
        const dy = GerberCircuitJsonCopperImageProjector.#number(translateY)
        return geometry.map((polygon) =>
            polygon.map((ring) =>
                ring.map(([x, y]) => {
                    const scaledX = x * scaleX
                    const scaledY = y * scaleY
                    return [
                        dx + scaledX * cosine - scaledY * sine,
                        dy + scaledX * sine + scaledY * cosine
                    ]
                })
            )
        )
    }

    /**
     * Applies an aperture transform around an already positioned flash center.
     * Standard aperture dimensions are pre-scaled by the native parser, while
     * macro/block child coordinates still require the explicit scale.
     * @param {number[][][][]} geometry Positioned geometry.
     * @param {Record<string, any>} transform Aperture transform.
     * @param {unknown} pivotX Flash center X.
     * @param {unknown} pivotY Flash center Y.
     * @param {boolean} applyScale Whether to apply LS to child coordinates.
     * @returns {number[][][][]} Transformed geometry.
     */
    static #transformAround(
        geometry,
        transform = {},
        pivotX = 0,
        pivotY = 0,
        applyScale
    ) {
        const mirror = String(transform?.mirror || 'none')
        const scale = applyScale
            ? GerberCircuitJsonCopperImageProjector.#number(transform?.scale, 1)
            : 1
        const scaleX = (mirror === 'x' || mirror === 'xy' ? -1 : 1) * scale
        const scaleY = (mirror === 'y' || mirror === 'xy' ? -1 : 1) * scale
        const radians =
            (GerberCircuitJsonCopperImageProjector.#number(
                transform?.rotation
            ) *
                Math.PI) /
            180
        const cosine = Math.cos(radians)
        const sine = Math.sin(radians)
        const x = GerberCircuitJsonCopperImageProjector.#number(pivotX)
        const y = GerberCircuitJsonCopperImageProjector.#number(pivotY)
        return geometry.map((polygon) =>
            polygon.map((ring) =>
                ring.map(([pointX, pointY]) => {
                    const localX = (pointX - x) * scaleX
                    const localY = (pointY - y) * scaleY
                    return [
                        x + localX * cosine - localY * sine,
                        y + localX * sine + localY * cosine
                    ]
                })
            )
        )
    }

    /**
     * Rotates a MultiPolygon around one point.
     * @param {number[][][][]} geometry Geometry.
     * @param {unknown} rotation Rotation degrees.
     * @param {number} x Pivot X.
     * @param {number} y Pivot Y.
     * @returns {number[][][][]} Rotated geometry.
     */
    static #rotate(geometry, rotation, x, y) {
        return geometry.map((polygon) =>
            polygon.map((ring) =>
                GerberCircuitJsonCopperImageProjector.#rotatePoints(
                    ring.map(([pointX, pointY]) => ({
                        x: pointX,
                        y: pointY
                    })),
                    GerberCircuitJsonCopperImageProjector.#number(rotation),
                    x,
                    y
                ).map((point) => [point.x, point.y])
            )
        )
    }

    /**
     * Rotates point records around one pivot.
     * @param {{ x: number, y: number }[]} points Points.
     * @param {number} rotation Rotation degrees.
     * @param {number} x Pivot X.
     * @param {number} y Pivot Y.
     * @returns {{ x: number, y: number }[]} Rotated points.
     */
    static #rotatePoints(points, rotation, x, y) {
        if (!rotation) return points
        const radians = (rotation * Math.PI) / 180
        const cosine = Math.cos(radians)
        const sine = Math.sin(radians)
        return points.map((point) => {
            const localX = point.x - x
            const localY = point.y - y
            return {
                x: x + localX * cosine - localY * sine,
                y: y + localX * sine + localY * cosine
            }
        })
    }

    /**
     * Converts a clipping ring to CircuitJSON vertices without closure repeat.
     * @param {number[][]} ring Clipping ring.
     * @returns {{ x: number, y: number }[]} CircuitJSON ring.
     */
    static #circuitRing(ring) {
        const points = ring.map(([x, y]) => ({ x, y }))
        if (
            points.length > 1 &&
            points[0].x === points.at(-1).x &&
            points[0].y === points.at(-1).y
        ) {
            points.pop()
        }
        return points
    }

    /** @param {unknown} value Candidate. @param {number} [fallback] Fallback. @returns {number} Finite number. */
    static #number(value, fallback = 0) {
        const number = Number(value)
        return Number.isFinite(number) ? number : fallback
    }

    /** @param {unknown} value Candidate. @returns {number} Positive number. */
    static #positive(value) {
        return Math.max(
            GerberCircuitJsonCopperImageProjector.#number(value),
            0.000001
        )
    }
}

Object.freeze(GerberCircuitJsonCopperImageProjector.prototype)
Object.freeze(GerberCircuitJsonCopperImageProjector)
