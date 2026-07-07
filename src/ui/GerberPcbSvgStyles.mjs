/**
 * Provides self-contained Gerber PCB SVG paint rules.
 */
export class GerberPcbSvgStyles {
    /**
     * Renders the SVG-local stylesheet.
     * @returns {string}
     */
    static render() {
        return [
            '.gerber-board-background{fill:none;}',
            '.gerber-board-fill{fill:var(--pcb-board-fill,#d8e8e4);stroke:var(--pcb-board-stroke,#0f746c);stroke-width:.54;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke;}',
            '.gerber-layer{isolation:isolate;}',
            '.gerber-primitive,.gerber-macro-primitive{fill:var(--pcb-footprint-fill,rgba(66,93,112,0.1));stroke:var(--pcb-footprint-track-color,rgba(66,93,112,0.72));}',
            '.gerber-role-board-outline .gerber-primitive{fill:none;stroke:var(--pcb-board-stroke,#0f746c);stroke-width:.54;stroke-linecap:round;stroke-linejoin:round;}',
            '.pcb-copper--surface .gerber-line,.pcb-copper--surface .gerber-arc,.pcb-copper--surface .gerber-macro-line{fill:none;stroke:var(--pcb-surface-track-color,rgba(199,82,45,0.92));opacity:.94;}',
            '.pcb-copper--surface .gerber-region,.pcb-copper--surface .gerber-macro-region{fill:var(--pcb-copper-solid-fill,rgba(196,118,70,0.68));stroke:none;opacity:1;}',
            '.pcb-copper--surface .gerber-flash,.pcb-copper--surface .gerber-macro-circle,.pcb-copper--surface .gerber-macro-rect,.pcb-copper--surface .gerber-macro-polygon,.pcb-copper--surface .gerber-macro-moire,.pcb-copper--surface .gerber-macro-thermal{fill:var(--pcb-copper-solid-fill,rgba(196,118,70,0.68));stroke:var(--pcb-surface-track-color,rgba(199,82,45,0.92));opacity:.96;}',
            '.pcb-copper--surface .pcb-copper--mask-covered.gerber-line,.pcb-copper--surface .pcb-copper--mask-covered.gerber-arc,.pcb-copper--surface .pcb-copper--mask-covered .gerber-macro-line{stroke:var(--pcb-mask-covered-track-color,rgba(42,95,39,.78));opacity:.88;}',
            '.pcb-copper--surface .pcb-copper--mask-covered.gerber-region,.pcb-copper--surface .pcb-copper--mask-covered .gerber-macro-region{fill:var(--pcb-mask-covered-fill,var(--pcb-copper-solid-fill,rgba(196,118,70,0.68)));stroke:none;opacity:1;}',
            '.pcb-copper--surface .pcb-copper--mask-covered.gerber-flash,.pcb-copper--surface .pcb-copper--mask-covered .gerber-macro-circle,.pcb-copper--surface .pcb-copper--mask-covered .gerber-macro-rect,.pcb-copper--surface .pcb-copper--mask-covered .gerber-macro-polygon,.pcb-copper--surface .pcb-copper--mask-covered .gerber-macro-moire,.pcb-copper--surface .pcb-copper--mask-covered .gerber-macro-thermal{fill:var(--pcb-mask-covered-pad-fill,rgba(42,95,39,.62));stroke:var(--pcb-mask-covered-track-color,rgba(42,95,39,.78));opacity:.9;}',
            '.pcb-copper--surface .pcb-copper--mask-open.gerber-line,.pcb-copper--surface .pcb-copper--mask-open.gerber-arc,.pcb-copper--surface .pcb-copper--mask-open .gerber-macro-line{stroke:var(--pcb-exposed-copper-fill,rgba(217,166,29,.95));opacity:.96;}',
            '.pcb-copper--surface .pcb-copper--mask-open.gerber-region,.pcb-copper--surface .pcb-copper--mask-open .gerber-macro-region,.pcb-copper--surface .pcb-copper--mask-open.gerber-flash,.pcb-copper--surface .pcb-copper--mask-open .gerber-macro-circle,.pcb-copper--surface .pcb-copper--mask-open .gerber-macro-rect,.pcb-copper--surface .pcb-copper--mask-open .gerber-macro-polygon,.pcb-copper--surface .pcb-copper--mask-open .gerber-macro-moire,.pcb-copper--surface .pcb-copper--mask-open .gerber-macro-thermal{fill:var(--pcb-exposed-copper-fill,rgba(217,166,29,.95));stroke:var(--pcb-exposed-copper-stroke,rgba(154,122,27,.96));opacity:.96;}',
            '.pcb-copper--subsurface .gerber-line,.pcb-copper--subsurface .gerber-arc,.pcb-copper--subsurface .gerber-macro-line{fill:none;stroke:var(--pcb-subsurface-track-color,rgba(15,116,108,0.56));opacity:.78;}',
            '.pcb-copper--subsurface .gerber-region,.pcb-copper--subsurface .gerber-macro-region{fill:var(--pcb-subsurface-fill,rgba(15,116,108,0.07));stroke:none;}',
            '.pcb-copper--subsurface .gerber-flash,.pcb-copper--subsurface .gerber-macro-circle,.pcb-copper--subsurface .gerber-macro-rect,.pcb-copper--subsurface .gerber-macro-polygon,.pcb-copper--subsurface .gerber-macro-moire,.pcb-copper--subsurface .gerber-macro-thermal{fill:var(--pcb-subsurface-track-color,rgba(15,116,108,0.56));stroke:var(--pcb-subsurface-track-color,rgba(15,116,108,0.56));opacity:.72;}',
            '.pcb-copper .pcb-via{fill:var(--pcb-via-ring-fill,rgba(232,236,233,0.92));stroke:var(--pcb-surface-track-color,rgba(199,82,45,0.92));opacity:1;}',
            '.gerber-role-top-silkscreen .gerber-primitive,.gerber-role-bottom-silkscreen .gerber-primitive{fill:var(--pcb-footprint-fill,rgba(66,93,112,0.1));stroke:var(--pcb-footprint-track-color,rgba(66,93,112,0.72));opacity:.82;}',
            '.gerber-role-fabrication-layer .gerber-primitive,.gerber-role-drill-map .gerber-primitive{fill:var(--pcb-footprint-fill,rgba(66,93,112,0.1));stroke:var(--pcb-footprint-track-color,rgba(66,93,112,0.72));opacity:.72;}',
            '.gerber-layer .gerber-line,.gerber-layer .gerber-arc,.gerber-layer .gerber-macro-line{fill:none;stroke-linecap:round;stroke-linejoin:round;}',
            '.gerber-layer .gerber-flash,.gerber-layer .gerber-region,.gerber-layer .gerber-macro-circle,.gerber-layer .gerber-macro-rect,.gerber-layer .gerber-macro-polygon,.gerber-layer .gerber-macro-region,.gerber-layer .gerber-macro-moire,.gerber-layer .gerber-macro-thermal{stroke-width:0;}',
            '.gerber-polarity-clear,.gerber-exposure-clear{fill:var(--canvas,#f8f5ef);stroke:var(--canvas,#f8f5ef);}',
            '.gerber-clear-mask .gerber-primitive,.gerber-clear-mask .gerber-macro-primitive{fill:#000;stroke:#000;opacity:1;}',
            '.gerber-clear-mask .gerber-line,.gerber-clear-mask .gerber-arc,.gerber-clear-mask .gerber-macro-line{fill:none;stroke:#000;opacity:1;}',
            '.gerber-clear-mask .gerber-flash,.gerber-clear-mask .gerber-region,.gerber-clear-mask .gerber-macro-circle,.gerber-clear-mask .gerber-macro-rect,.gerber-clear-mask .gerber-macro-polygon,.gerber-clear-mask .gerber-macro-region,.gerber-clear-mask .gerber-macro-moire,.gerber-clear-mask .gerber-macro-thermal{fill:#000;stroke:#000;opacity:1;}',
            '.gerber-drill{fill:var(--pcb-via-hole-fill,#0f746c);stroke:rgba(255,255,255,.72);stroke-width:.08;vector-effect:non-scaling-stroke;}',
            '.gerber-slot{fill:none;stroke:var(--pcb-via-hole-fill,#0f746c);stroke-linecap:round;stroke-linejoin:round;}'
        ].join('')
    }
}
