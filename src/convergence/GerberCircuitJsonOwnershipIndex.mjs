import { GerberCircuitJsonCopperImageProjector } from './GerberCircuitJsonCopperImageProjector.mjs'
import { GerberCircuitJsonLayerSemantics } from './GerberCircuitJsonLayerSemantics.mjs'

/** Maps X2 object attributes to document-wide CircuitJSON ownership rows. */
export class GerberCircuitJsonOwnershipIndex {
    #facts = new Map()
    #components = new Map()
    #ports = new Map()
    #nets = new Map()
    #traces = []
    #diagnostics = []
    #primitiveOrdinal = 0

    /**
     * Builds an ownership index across every fabrication layer.
     * @param {Record<string, any>[]} layers Native layers.
     * @returns {GerberCircuitJsonOwnershipIndex} Ownership index.
     */
    static build(layers) {
        const index = new GerberCircuitJsonOwnershipIndex()
        for (const layer of layers) index.#addLayer(layer)
        return index
    }

    /** @returns {Record<string, any>[]} Canonical ownership rows. */
    get rows() {
        return [
            ...this.#componentRows(),
            ...this.#portRows(),
            ...this.#netRows(),
            ...this.#traces.map((trace) => trace.row)
        ]
    }

    /** @returns {Record<string, any>[]} Ownership diagnostics. */
    get diagnostics() {
        return this.#diagnostics.map((diagnostic) => ({ ...diagnostic }))
    }

    /**
     * Returns canonical ownership IDs for one native primitive.
     * @param {Record<string, any>} primitive Native primitive.
     * @returns {Record<string, any>} Ownership facts.
     */
    facts(primitive) {
        return this.#facts.get(primitive) || {}
    }

    /**
     * Returns a component id only when every owned primitive agrees.
     * @param {Record<string, any>[]} primitives Native primitives.
     * @returns {string} Common component id or an empty string.
     */
    commonComponentId(primitives) {
        if (!primitives.length) return ''
        const owners = primitives.map(
            (primitive) => this.facts(primitive).pcbComponentId || ''
        )
        if (owners.some((owner) => !owner)) return ''
        const values = new Set(owners)
        return values.size === 1 ? [...values][0] : ''
    }

    /**
     * Indexes one layer in authored primitive order.
     * @param {Record<string, any>} layer Native layer.
     * @returns {void}
     */
    #addLayer(layer) {
        const semantics = GerberCircuitJsonLayerSemantics.resolve(layer)
        const circuitLayer = semantics.circuitLayer
        for (const primitive of layer?.primitives || []) {
            this.#addPrimitive(
                primitive,
                circuitLayer,
                semantics.kind,
                layer.fileName
            )
        }
    }

    /**
     * Indexes one primitive's TO.C, TO.P, and TO.N facts.
     * @param {Record<string, any>} primitive Native primitive.
     * @param {string} layer Canonical layer.
     * @param {string} kind Layer semantic kind.
     * @param {string} fileName Source filename.
     * @returns {void}
     */
    #addPrimitive(primitive, layer, kind, fileName) {
        const ordinal = this.#primitiveOrdinal++
        const object = primitive?.attributes?.object || {}
        const componentValues = this.#values(object.C)
        const portValues = this.#values(object.P)
        const netValues = this.#values(object.N)
        const hasNetAttribute = Object.hasOwn(object, 'N')
        const componentRef = String(componentValues[0] || '').trim()
        const portRef = String(portValues[0] || '').trim()
        const pin = String(portValues[1] || '').trim()
        const ownerRef = portRef || componentRef
        if (portRef && componentRef && portRef !== componentRef) {
            this.#diagnostics.push({
                code: 'GERBER_X2_COMPONENT_OWNERSHIP_CONFLICT',
                severity: 'warning',
                fileName,
                message: `X2 TO.P component ${portRef} conflicts with TO.C component ${componentRef}; TO.P owns this object.`
            })
        }
        const component = ownerRef
            ? this.#component(ownerRef, primitive, layer, object)
            : null
        const port =
            component && portRef && pin
                ? this.#port(component, pin, portValues[2], primitive, layer)
                : null
        const apertureFunction = String(
            this.#values(primitive?.attributes?.aperture?.AperFunction)[0] || ''
        ).toLowerCase()
        const isElectrical =
            kind === 'copper' || apertureFunction === 'componentpin'
        const nets = isElectrical
            ? netValues
                  .map((name) => String(name).trim())
                  .filter(Boolean)
                  .map((name) => this.#net(name, ordinal, port?.sourceId))
            : []
        const trace =
            isElectrical && (nets.length || (port && hasNetAttribute))
                ? this.#trace(ordinal, nets, port, primitive)
                : null
        this.#facts.set(primitive, {
            ...(component
                ? {
                      sourceComponentId: component.sourceId,
                      pcbComponentId: component.pcbId
                  }
                : {}),
            ...(port
                ? {
                      sourcePortId: port.sourceId,
                      pcbPortId: port.pcbId
                  }
                : {}),
            ...(trace ? { sourceTraceId: trace.sourceTraceId } : {}),
            sourceNetIds: nets.map((net) => net.sourceId)
        })
    }

    /**
     * Returns or creates one component record and expands its geometry bounds.
     * @param {string} refdes Exact reference designator.
     * @param {Record<string, any>} primitive Native primitive.
     * @param {string} layer Canonical layer.
     * @param {Record<string, any>} object X2 object attributes.
     * @returns {Record<string, any>} Component record.
     */
    #component(refdes, primitive, layer, object) {
        let component = this.#components.get(refdes)
        if (!component) {
            const index = this.#components.size
            component = {
                refdes,
                sourceId: `gerber_source_component_${index}`,
                pcbId: `gerber_pcb_component_${index}`,
                layers: new Set(),
                bounds: null,
                main: null,
                manufacturerPartNumber: '',
                value: ''
            }
            this.#components.set(refdes, component)
        }
        component.layers.add(layer)
        component.bounds = this.#mergeBounds(
            component.bounds,
            this.#primitiveBounds(primitive)
        )
        const apertureFunction = this.#values(
            primitive?.attributes?.aperture?.AperFunction
        )[0]
        if (
            primitive?.type === 'flash' &&
            String(apertureFunction || '').toLowerCase() === 'componentmain'
        ) {
            component.main = {
                x: this.#number(primitive.x),
                y: this.#number(primitive.y),
                rotation: this.#number(
                    this.#values(object.CRot)[0] ??
                        primitive.rotation ??
                        primitive.transform?.rotation
                )
            }
        }
        component.manufacturerPartNumber ||= String(
            this.#values(object.CMPN)[0] || ''
        )
        component.value ||= String(this.#values(object.CVal)[0] || '')
        return component
    }

    /**
     * Returns or creates one refdes/pin port record.
     * @param {Record<string, any>} component Owning component.
     * @param {string} pin Pin identifier.
     * @param {unknown} functionName Optional pin function.
     * @param {Record<string, any>} primitive Native primitive.
     * @param {string} layer Canonical layer.
     * @returns {Record<string, any>} Port record.
     */
    #port(component, pin, functionName, primitive, layer) {
        const key = `${component.refdes}\0${pin}`
        let port = this.#ports.get(key)
        if (!port) {
            const index = this.#ports.size
            const point = this.#primitiveCenter(primitive)
            port = {
                sourceId: `gerber_source_port_${index}`,
                pcbId: `gerber_pcb_port_${index}`,
                component,
                pin,
                name: String(functionName || pin),
                point,
                layers: new Set()
            }
            this.#ports.set(key, port)
        }
        port.layers.add(layer)
        return port
    }

    /**
     * Returns or creates a named net. N/C is intentionally occurrence-local.
     * @param {string} name Exact X2 net name.
     * @param {number} ordinal Primitive ordinal.
     * @param {string | undefined} portId Connected port id.
     * @returns {Record<string, any>} Net record.
     */
    #net(name, ordinal, portId) {
        const key =
            name.toUpperCase() === 'N/C'
                ? `${name}\0${portId || ordinal}`
                : name
        let net = this.#nets.get(key)
        if (!net) {
            const index = this.#nets.size
            net = {
                name,
                sourceId: `gerber_source_net_${index}`,
                pcbId: `gerber_pcb_net_${index}`
            }
            this.#nets.set(key, net)
        }
        return net
    }

    /**
     * Creates connectivity for one attributed conductive object.
     * @param {number} ordinal Primitive ordinal.
     * @param {Record<string, any>[]} nets Connected nets.
     * @param {Record<string, any> | null} port Connected port.
     * @param {Record<string, any>} primitive Native primitive.
     * @returns {Record<string, any>} Trace record.
     */
    #trace(ordinal, nets, port, primitive) {
        const sourceTraceId = `gerber_source_trace_${ordinal}`
        const trace = {
            sourceTraceId,
            primitive,
            row: {
                type: 'source_trace',
                source_trace_id: sourceTraceId,
                connected_source_net_ids: nets.map((net) => net.sourceId),
                connected_source_port_ids: port ? [port.sourceId] : []
            }
        }
        this.#traces.push(trace)
        return trace
    }

    /** @returns {Record<string, any>[]} Component source/PCB rows. */
    #componentRows() {
        const rows = []
        for (const component of this.#components.values()) {
            const bounds = component.bounds || {
                minX: 0,
                minY: 0,
                maxX: 0.000001,
                maxY: 0.000001
            }
            const center = component.main || {
                x: (bounds.minX + bounds.maxX) / 2,
                y: (bounds.minY + bounds.maxY) / 2,
                rotation: 0
            }
            rows.push(
                {
                    type: 'source_component',
                    source_component_id: component.sourceId,
                    ftype: 'simple_chip',
                    name: component.refdes,
                    display_name: component.refdes,
                    ...(component.manufacturerPartNumber
                        ? {
                              manufacturer_part_number:
                                  component.manufacturerPartNumber
                          }
                        : {}),
                    ...(component.value
                        ? { display_value: component.value }
                        : {})
                },
                {
                    type: 'pcb_component',
                    pcb_component_id: component.pcbId,
                    source_component_id: component.sourceId,
                    center: { x: center.x, y: center.y },
                    width: Math.max(bounds.maxX - bounds.minX, 0.000001),
                    height: Math.max(bounds.maxY - bounds.minY, 0.000001),
                    rotation: center.rotation,
                    layer: component.layers.values().next().value || 'top'
                }
            )
        }
        return rows
    }

    /** @returns {Record<string, any>[]} Source/PCB port rows. */
    #portRows() {
        const rows = []
        for (const port of this.#ports.values()) {
            const pinNumber = Number(port.pin)
            rows.push(
                {
                    type: 'source_port',
                    source_port_id: port.sourceId,
                    source_component_id: port.component.sourceId,
                    name: port.name,
                    port_hints: [port.pin],
                    ...(Number.isFinite(pinNumber)
                        ? { pin_number: pinNumber }
                        : {})
                },
                {
                    type: 'pcb_port',
                    pcb_port_id: port.pcbId,
                    source_port_id: port.sourceId,
                    pcb_component_id: port.component.pcbId,
                    x: port.point.x,
                    y: port.point.y,
                    layers: [...port.layers]
                }
            )
        }
        return rows
    }

    /** @returns {Record<string, any>[]} Source/PCB net rows. */
    #netRows() {
        const rows = []
        for (const net of this.#nets.values()) {
            rows.push(
                {
                    type: 'source_net',
                    source_net_id: net.sourceId,
                    name: net.name,
                    member_source_group_ids: []
                },
                {
                    type: 'pcb_net',
                    pcb_net_id: net.pcbId,
                    source_net_id: net.sourceId
                }
            )
        }
        return rows
    }

    /**
     * Computes one primitive's polygonal bounds.
     * @param {Record<string, any>} primitive Native primitive.
     * @returns {Record<string, number>} Bounds.
     */
    #primitiveBounds(primitive) {
        const simple = this.#simplePrimitiveBounds(primitive)
        if (simple) return simple
        const geometry =
            GerberCircuitJsonCopperImageProjector.primitiveGeometry(primitive)
        const points = geometry
            .flat(2)
            .filter(
                (point) =>
                    Array.isArray(point) &&
                    Number.isFinite(Number(point[0])) &&
                    Number.isFinite(Number(point[1]))
            )
        if (points.length) {
            const xs = points.map((point) => Number(point[0]))
            const ys = points.map((point) => Number(point[1]))
            return {
                minX: Math.min(...xs),
                minY: Math.min(...ys),
                maxX: Math.max(...xs),
                maxY: Math.max(...ys)
            }
        }
        const point = this.#primitiveCenter(primitive)
        return { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y }
    }

    /**
     * Computes allocation-free bounds for common attributed primitives.
     * @param {Record<string, any>} primitive Native primitive.
     * @returns {Record<string, number> | null} Bounds or null for complex shapes.
     */
    #simplePrimitiveBounds(primitive) {
        if (primitive?.type === 'line') {
            const radius = Math.max(this.#number(primitive.width), 0) / 2
            return {
                minX: Math.min(primitive.x1, primitive.x2) - radius,
                minY: Math.min(primitive.y1, primitive.y2) - radius,
                maxX: Math.max(primitive.x1, primitive.x2) + radius,
                maxY: Math.max(primitive.y1, primitive.y2) + radius
            }
        }
        if (primitive?.type === 'region') {
            const points = (primitive.points || []).filter(
                (point) =>
                    Number.isFinite(Number(point?.x)) &&
                    Number.isFinite(Number(point?.y))
            )
            if (!points.length) return null
            return {
                minX: Math.min(...points.map((point) => Number(point.x))),
                minY: Math.min(...points.map((point) => Number(point.y))),
                maxX: Math.max(...points.map((point) => Number(point.x))),
                maxY: Math.max(...points.map((point) => Number(point.y)))
            }
        }
        if (primitive?.type !== 'flash') return null
        const x = this.#number(primitive.x)
        const y = this.#number(primitive.y)
        if (primitive.shape === 'circle' || primitive.shape === 'polygon') {
            const radius =
                Math.max(this.#number(primitive.diameter), 0.000001) / 2
            return {
                minX: x - radius,
                minY: y - radius,
                maxX: x + radius,
                maxY: y + radius
            }
        }
        if (primitive.shape !== 'rect' && primitive.shape !== 'obround') {
            return null
        }
        const width = Math.max(this.#number(primitive.width), 0.000001)
        const height = Math.max(this.#number(primitive.height), 0.000001)
        const radians =
            (this.#number(primitive.rotation ?? primitive.transform?.rotation) *
                Math.PI) /
            180
        const halfX =
            (Math.abs(Math.cos(radians)) * width +
                Math.abs(Math.sin(radians)) * height) /
            2
        const halfY =
            (Math.abs(Math.sin(radians)) * width +
                Math.abs(Math.cos(radians)) * height) /
            2
        return {
            minX: x - halfX,
            minY: y - halfY,
            maxX: x + halfX,
            maxY: y + halfY
        }
    }

    /**
     * Computes one stable representative point.
     * @param {Record<string, any>} primitive Native primitive.
     * @returns {{ x: number, y: number }} Center point.
     */
    #primitiveCenter(primitive) {
        if (primitive?.x !== undefined || primitive?.y !== undefined) {
            return {
                x: this.#number(primitive.x),
                y: this.#number(primitive.y)
            }
        }
        if (primitive?.x1 !== undefined || primitive?.y1 !== undefined) {
            return {
                x:
                    (this.#number(primitive.x1) + this.#number(primitive.x2)) /
                    2,
                y: (this.#number(primitive.y1) + this.#number(primitive.y2)) / 2
            }
        }
        const points = Array.isArray(primitive?.points) ? primitive.points : []
        if (!points.length) return { x: 0, y: 0 }
        return {
            x:
                points.reduce((sum, point) => sum + this.#number(point.x), 0) /
                points.length,
            y:
                points.reduce((sum, point) => sum + this.#number(point.y), 0) /
                points.length
        }
    }

    /**
     * Merges two finite bounds.
     * @param {Record<string, number> | null} current Current bounds.
     * @param {Record<string, number>} next New bounds.
     * @returns {Record<string, number>} Merged bounds.
     */
    #mergeBounds(current, next) {
        if (!current) return { ...next }
        return {
            minX: Math.min(current.minX, next.minX),
            minY: Math.min(current.minY, next.minY),
            maxX: Math.max(current.maxX, next.maxX),
            maxY: Math.max(current.maxY, next.maxY)
        }
    }

    /** @param {unknown} value Attribute value. @returns {unknown[]} Values. */
    #values(value) {
        if (Array.isArray(value)) return value
        return value === undefined || value === null ? [] : [value]
    }

    /** @param {unknown} value Candidate. @returns {number} Finite value. */
    #number(value) {
        const number = Number(value)
        return Number.isFinite(number) ? number : 0
    }
}

Object.freeze(GerberCircuitJsonOwnershipIndex.prototype)
