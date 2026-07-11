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

The projection emits only semantics established by fabrication geometry or
explicit X2 attributes:

- one `pcb_board` per disjoint closed profile, with nested/clear contours as
  board-owned `pcb_cutout` rows; aggregate bounds are a documented fallback
  when no closed profile exists
- `pcb_trace`, `pcb_smtpad`, and `pcb_copper_pour` for copper strokes, flashes,
  regions, standard aperture holes, polygons, macros, and aperture blocks
- ordered BREP composition when clear exposures, file/image polarity, partial
  solder-mask coverage, or complex apertures cannot remain simple rows
- `pcb_silkscreen_*` for X2 Legend artwork, `pcb_solder_paste` for directly
  representable paste flashes, and neutral `pcb_note_*` rows for unsupported or
  ambiguous nonconductive artwork
- `pcb_hole` and `pcb_plated_hole` for non-plated/plated round hits and straight
  routed slots, including pill rotation and outer dimensions
- `source_component`/`pcb_component`, `source_port`/`pcb_port`,
  `source_net`/`pcb_net`, and `source_trace` only when X2 `TO.C`, `TO.P`, and
  `TO.N` establish those facts

X2 ownership is indexed document-wide, so repeated pad flashes share the same
refdes/pin identity and cross-layer component facts deduplicate. `TO.P` owns a
pad when it conflicts with `TO.C`, and the document reports a diagnostic.
Missing net attributes remain unknown, explicit empty net attributes remain
unconnected, and multi-name `TO.N` connectivity is never collapsed to one
arbitrary name.

Gerber image generation is composed before physical interpretation. X2
`FilePolarity` is interpreted once inside the finite union of board profiles
minus cutouts; deprecated `IPNEG` reverses image generation first. Solder-mask
files become physical opening images, and partially intersected copper is split
into covered and exposed BREP rows. If polarity needs a domain but no profile is
available, aggregate fabrication bounds are used with an explicit diagnostic.

The adapter does not infer components, nets, pins, schematics, or assembly
models when the source omits the corresponding facts. Native details that have
no lossless CircuitJSON representation remain available in the Gerber
extension.

## Native extension

The default `extensions: 'canonical'` stores compact fabrication summary
metadata. The exact prior native document is included when callers select
`extensions: 'full'`, `preserveRaw: true`, or
`extensions: ['gerber.native-model']`:

```js
const document = Parser.parse(input, { extensions: 'full' })
const native = document.extensions.gerber.native
```

Native layers retain original roles, immutable file attributes,
definition-bound aperture attributes, object attributes, aperture-expanded
primitives, drills, slots, `FilePolarity`/`IPNEG`, transforms, exact arc-aware
bounds, and diagnostics. This keeps CAM inspection available without making
native layout a hidden dependency of common consumers.

## Project envelope

`ProjectLoader` returns `ecad-toolkit.project.v1`. Its `documents` contain the
same document envelopes, and `assets` contains decoded or metadata-only attached
and companion files. Archive member paths are normalized before extraction.
