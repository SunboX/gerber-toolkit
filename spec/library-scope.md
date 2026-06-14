# Library Scope

`gerber-toolkit` provides browser-safe parsing and rendering helpers for fabrication package inspection.

## In Scope

- RS-274X Gerber layer parsing.
- Standard apertures, aperture macros, and aperture blocks.
- Step-repeat, polarity, aperture transforms, and Gerber attributes.
- Excellon drill parsing.
- Excellon routed slot parsing.
- ZIP fabrication package expansion.
- Composite PCB document creation.
- Separated source-layer rendering.
- Deterministic SVG output.
- Bare-board 3D scene description generation from fabrication geometry.
- Simple interaction metadata for PCB view integration.

## Out of Scope

- Manufacturing validation.
- CAM editing.
- Netlist reconstruction.
- Component-body or assembly reconstruction from fabrication-only packages.
- Server-side native binaries.
- Native GUI bindings or native image/export pipelines.
