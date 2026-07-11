# Model Format

The common parser returns an immutable document envelope:

```js
{
    schema: 'ecad-toolkit.document.v1',
    model: [
        {
            type: 'pcb_board',
            pcb_board_id: 'gerber_board_0',
            center: { x: 5, y: 4 },
            width: 10,
            height: 8,
            num_layers: 2
        }
    ],
    source: {
        format: 'gerber',
        fileName: 'board.gtl',
        fileType: 'gtl'
    },
    extensions: { gerber: {} },
    assets: [],
    diagnostics: [],
    statistics: {}
}
```

`model` is CircuitJSON and is the only representation consumed by the common
rendering, interaction, query, manufacturing, simulation, and scene services.
Gerber coordinates are normalized to millimeters.

The projection emits only semantics that fabrication data can establish:

- `pcb_board` from aggregate bounds
- `pcb_trace` from copper lines and bounded arc samples
- `pcb_smtpad` from supported circular, rectangular, and obround flashes
- `pcb_copper_pour` from filled copper regions
- `pcb_hole` from Excellon hits and routed slots
- `pcb_note_line` and `pcb_note_path` from representable documentation artwork

It does not invent components, nets, pin connectivity, source schematics, or
assembly models. Clear-polarity geometry and native aperture/macro details that
cannot be represented losslessly stay in the Gerber extension namespace.

## Native extension

The default `extensions: 'canonical'` stores compact fabrication summary
metadata. The exact prior native document is included when callers select
`extensions: 'full'`, `preserveRaw: true`, or
`extensions: ['gerber.native-model']`:

```js
const document = Parser.parse(input, { extensions: 'full' })
const native = document.extensions.gerber.native
```

Native layers retain original roles, attributes, aperture-expanded primitives,
drills, slots, polarity, transforms, and bounds. This keeps exact CAM inspection
available without making native layout a hidden dependency of common consumers.

## Project envelope

`ProjectLoader` returns `ecad-toolkit.project.v1`. Its `documents` contain the
same document envelopes, and `assets` contains decoded or metadata-only attached
and companion files. Archive member paths are normalized before extraction.
