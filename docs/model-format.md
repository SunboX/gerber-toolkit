# Model Format

Parsed documents use the same broad document shape expected by ECAD Forge:

```js
{
    sourceFormat: 'gerber',
    kind: 'pcb',
    fileName: 'fabrication.zip',
    pcb: {
        bounds: { minX: 0, minY: 0, maxX: 10, maxY: 8 },
        fabrication: {
            renderMode: 'composite',
            layers: []
        }
    },
    bom: [],
    diagnostics: []
}
```

Each fabrication layer contains:

- `id`: stable layer id derived from the source path
- `fileName`: original or archive-expanded source path
- `role`: inferred fabrication role such as `top-copper`, `board-outline`, or `plated-drill`
- `side`: `top`, `bottom`, or `both`
- `primitives`: normalized Gerber draw, flash, arc, and region items
- `drills`: normalized Excellon drill hits and routed slots
- `attributes`: parsed file, aperture, and object attributes
- `bounds`: layer bounds in millimeters

Gerber coordinates are normalized to millimeters. The renderer treats documentation layers, such as drill-map artwork, as available source layers without drawing them in the default composite stack.

`PcbScene3dBuilder.build(documentModel)` derives a bare-board 3D scene from the
same fabrication layers. The scene converts millimeters to mils, maps board
outline primitives into `board.segments`, maps copper draws into
`detail.tracks` and `detail.arcs`, maps flashed apertures into `detail.pads`,
and carries Excellon holes into pad drill fields so the shared 3D viewer can
cut the board body. Gerber fabrication packages do not carry component bodies,
so the derived scene keeps `components` empty.

Flash primitives may use `shape: 'circle'`, `rect`, `obround`, `polygon`,
`macro`, or `block`. Macro flashes keep their expanded child primitives under
`primitives`. Aperture-block flashes keep their child primitives translated to
the flashed location. Primitives include `polarity` and may include a
`transform` object with `mirror`, `rotation`, and `scale`.

Excellon slots use this shape:

```js
{
    type: 'slot',
    x1: 1,
    y1: 1,
    x2: 3,
    y2: 1,
    diameter: 0.6,
    plated: true,
    tool: 'T01'
}
```
