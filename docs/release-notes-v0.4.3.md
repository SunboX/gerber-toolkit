# gerber-toolkit 0.4.3

Version 0.4.3 corrects plated-via copper and solder-mask semantics in generated
Gerber 3D scenes. The implementation derives the result from fabrication
geometry and applies to every project without archive-, filename-, or
fixture-specific handling.

## Via copper and mask classification

- Plated drill barrels use the largest authored copper flash diameter at their
  position. Drill-only holes retain the physical barrel-wall fallback.
- Vias are tented independently on each surface whenever that surface has a
  solder-mask layer.
- A via surface remains open only when its center lies inside a larger copper
  pad that is itself opened by the same-side solder-mask image. The smaller via
  annulus at the drill position does not classify itself as a host pad.
- Via-in-pad containment is evaluated in pad-local coordinates, preserving
  offset and rotated pad geometry.
- Mask classification runs after drill and barrel construction, so every
  plated via receives the side-specific result.

## Compatibility

- Parser, project, canonical CircuitJSON, and native extension entrypoints are
  unchanged.
- Existing copper, solder-mask, outline, drill, slot, and silkscreen projection
  remains source-driven.
- The 3D scene fields remain additive compatibility data:
  `isTentingTop`, `isTentingBottom`, and the corrected authored via `diameter`.

## Verification

- Tests cover ordinary tented vias, a one-sided via-in-pad opening, authored
  annulus diameter, and rotated offset host-pad containment.
- Release gates include the complete package suite, formatter check, feature
  preservation audit, benchmark contract, and package dry run.
