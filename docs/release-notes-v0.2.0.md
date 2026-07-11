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
- Existing names and return shapes may change incompatibly in this coordinated
  release; the native 0.1.21 surface remains at `/extensions`.

## Feature preservation

- Preserved every 0.1.21 native parser, renderer, interaction, and 3D export at
  `gerber-toolkit/extensions`.
- Kept exact Gerber aperture, macro, attribute, polarity, transform, drill, and
  routed-slot data in opt-in native extensions.
- Added standards-correct modal D operations, combined G01/G02/G03 commands,
  G74 center-sign resolution, multi-contour/curved regions, standard aperture
  holes, square-ended macro vector lines, macro/block transform bounds, and
  Excellon G85 plus M71/M72 handling.
- Preserved immutable TF attributes and definition-time TA attribute lifetime;
  object-scoped TD no longer erases file attributes.
- Added a migration guide for intentional root name and return-shape changes.

## CircuitJSON and performance

- Projected representable Gerber/Excellon geometry once into CircuitJSON, which
  is used directly by the shared viewer and services.
- Added disjoint exact boards/cutouts, plated/non-plated holes and rotated slots,
  paste and legend rows, complex BREP apertures, ordered dark/clear composition,
  mask-covered/exposed copper, X2 `FilePolarity`, and legacy `IPNEG`.
- Added document-wide X2 `TO.C`/`TO.P`/`TO.N` component, port, net, and trace
  ownership without guessing facts that are absent from the fabrication data.
- Kept ordinary pads/traces as compact canonical rows; polygon booleans are
  batched and used only when geometry actually requires composition.
- Avoided app-side format adapters and repeated native parsing.
- Added owned async byte/asset snapshots, worker execution, exact arc bounds,
  bounded archive preflight/CRC verification, linear companion classification,
  and absolute plus relative benchmark regression gates.

See [Migration from 0.1.21](migration.md) for exact import changes.
