# Source-continuous profile cutouts

## Problem

Canonical Gerber projection currently reconnects every endpoint-compatible
profile stroke, including strokes separated by pen-up moves. On mechanical
layers without authoritative X2 profile metadata, unrelated drawing frames can
therefore become destructive `pcb_cutout` elements.

## Considered approaches

1. Filter suspicious holes in ECAD Forge. This would duplicate Gerber semantics
   in the application and leave every other consumer with incorrect
   CircuitJSON.
2. Filter suspicious holes in the 3D viewer. The viewer cannot distinguish a
   legitimate canonical cutout from a parser mistake without violating its
   format-independent contract.
3. Preserve path intent during canonical Gerber projection. This fixes the
   semantic source and keeps downstream consumers simple. This is the selected
   approach.

## Design

The outline projector continues to reconstruct unordered, reversible profile
fragments for outer board discovery. This preserves fragmented and disjoint
board outlines.

Nested dark contours are eligible to become physical cutouts only when at least
one of these conditions holds:

- the contour is a Gerber region;
- its directed drawing segments form a source-order-continuous closed path;
- the layer has authoritative X2 `FileFunction=Profile` semantics.

Clear-polarity closed geometry remains an explicit cutout. Ambiguous mechanical
layers may still supply the board perimeter, but pen-separated interior artwork
will remain non-destructive.

The canonical model and public API shapes do not change. The correction only
removes `pcb_cutout` rows that were inferred without sufficient source
semantics.

## Verification

A synthetic regression sample contains:

- one continuous outer board contour;
- one continuous nested contour that must remain a cutout;
- one endpoint-compatible inner frame whose four edges each start after a
  pen-up move and must not become a cutout.

Existing tests must continue to cover connected and fragmented outlines,
disjoint boards, nested profile cutouts, region outlines, clear-polarity
geometry, and cutout ownership. The exact reported archive is used only for
local visual verification and is never committed as a fixture.

## Acceptance criteria

- Canonical Gerber projection agrees with the native contour resolver about the
  number of physical cutouts for pen-separated mechanical artwork.
- Legitimate continuous, region-based, clear-polarity, and authoritative X2
  profile cutouts remain supported.
- No application-side or viewer-side special case is added.
- Toolkit tests, ECAD Forge tests, static build checks, and local visual
  verification pass before release.
