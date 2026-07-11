import { GerberArcSampler } from '../core/gerber/GerberArcSampler.mjs'

/** CircuitJSON-facing alias for the shared native Gerber arc sampler. */
export class GerberCircuitJsonArcSampler extends GerberArcSampler {}

Object.freeze(GerberCircuitJsonArcSampler.prototype)
Object.freeze(GerberCircuitJsonArcSampler)
