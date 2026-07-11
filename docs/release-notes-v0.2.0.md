# gerber-toolkit 0.2.0

This is the breaking API-convergence release coordinated with
`circuitjson-toolkit`, `altium-toolkit`, `kicad-toolkit`, `pcb-scene3d-viewer`,
and ECAD Forge.

## API changes

- Replaced the root with the exact 17-class common toolkit API.
- Added the common parser, project, renderer, interaction, query,
  manufacturing, simulation, 3D, capability, extension, testing, worker, and
  renderer-style subpaths.
- Changed parsing to `Parser.parse({ fileName, data }, options)` and an immutable
  `ecad-toolkit.document.v1` return envelope containing CircuitJSON in `model`.
- Changed project loading to dense `{ name, data }` entries and an
  `ecad-toolkit.project.v1` return envelope.
- Added direct single-ZIP project input, common archive limits, path traversal
  rejection, companion assets, progress, cancellation, typed errors, and worker
  fallback behavior.
- Added `ToolkitCapabilities.inventory()` with the shared nine-field row shape.

## Feature preservation

- Preserved every 0.1.21 native parser, renderer, interaction, and 3D export at
  `gerber-toolkit/extensions`.
- Kept exact Gerber aperture, macro, attribute, polarity, transform, drill, and
  routed-slot data in opt-in native extensions.
- Added a migration guide for intentional root name and return-shape changes.

## CircuitJSON and performance

- Projected representable Gerber/Excellon geometry once into CircuitJSON, which
  is used directly by the shared viewer and services.
- Avoided app-side format adapters and repeated native parsing.
- Added worker execution, bounded arc projection, linear companion
  classification, and absolute plus relative benchmark regression gates.

See [Migration from 0.1.21](migration.md) for exact import changes.
