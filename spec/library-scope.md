# Library Scope

`gerber-toolkit` is the Gerber/Excellon source adapter in the common ECAD toolkit
family. Its default boundary is a canonical CircuitJSON document or project
envelope; exact fabrication details remain available through explicit native
extensions.

## In scope

- RS-274X Gerber and Excellon parsing.
- Standard apertures, macros, aperture blocks, step-repeat, polarity,
  transforms, and attributes.
- Drill hits and routed slots.
- `{ name, data }` project entries and bounded ZIP expansion.
- Canonical CircuitJSON projection for representable PCB geometry.
- Common immutable envelopes, assets, diagnostics, errors, progress,
  cancellation, archive limits, workers, and capability discovery.
- Shared CircuitJSON rendering, interaction, query, manufacturing, simulation,
  and 3D scene services.
- Exact 0.1.21 native parser/rendering/scene compatibility at `/extensions`.
- Provenance-bound feature-preservation and performance regression gates.

## Out of scope

- CAM editing or manufacturing-rule certification.
- Inventing connectivity, component, schematic, or assembly semantics absent
  from fabrication files.
- Component-body reconstruction from Gerber packages alone.
- Server-native binaries, native GUI bindings, or network parsing services.

Unsupported operations must be reported as unavailable capabilities or typed
errors; they must not return fabricated placeholders.
