# gerber-toolkit 0.4.1

Version 0.4.1 corrects mechanical-profile projection so pen-separated artwork
on an ambiguous mechanical layer is not inferred to be a destructive physical
cutout. Board discovery still accepts fragmented profile strokes, while
cutouts now require the stronger source semantics described below.

## Mechanical-profile cutouts

- Unordered, reversible endpoint chaining remains available for discovering
  outer board profiles, including fragmented and disjoint outlines.
- A nested dark contour becomes an inferred cutout only when it is a Gerber
  region, its directed segments form a source-order-continuous closed path, or
  the layer has authoritative X2 `FileFunction=Profile` metadata.
- Clear-polarity closed geometry remains explicitly subtractive.
- Drawing frames assembled from pen-separated strokes remain non-destructive,
  while legitimate continuous, region-based, clear-polarity, and explicit X2
  profile cutouts retain their existing behavior.

## API and compatibility

- No class, method, parameter, package subpath, parser input, or project input
  is added, removed, or renamed.
- Canonical document envelopes and the outline projector's return shape are
  unchanged. The correction only suppresses `pcb_cutout` rows that lack
  sufficient source semantics.
- Native retained geometry and shared renderer and scene-service inputs retain
  their existing shapes.

## Performance normalization

- Profile chaining stops as soon as quantized endpoints prove that a path is
  closed, avoiding repeated full-path normalization during path growth.
- Line and sampled-arc points are normalized once when they enter outline
  projection, so source-continuity checks reuse the same finite point data.
- These changes preserve the corrected geometry semantics without adding an
  example-specific filter or downstream application workaround.

## Verification

- Synthetic regressions cover pen-separated mechanical frames, legitimate
  source-continuous cutouts, closed contours followed by shared-vertex strokes,
  and quantized-degenerate sampled arcs alongside the existing profile suite.
- A provided fabrication archive was validated locally without being committed:
  canonical and native scene construction each exposed four physical cutouts,
  and neither exposed the spurious large rectangular cutout.
- Release gates are `npm test`, `npm run check:format`, and an inspected
  `npm publish --dry-run` using an isolated cache under `/private/tmp`.
