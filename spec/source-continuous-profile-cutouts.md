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

The parser assigns every line and arc a stable `sourcePathId`. Pen-up moves,
flashes, polarity transitions, and region boundaries end the active path.
Step-repeat expansion derives a distinct identity per repeat instance. The
outline projector therefore receives the draw-run evidence that coordinate
endpoints alone cannot preserve.

The outline projector continues to reconstruct unordered, reversible profile
fragments for outer board discovery. This preserves fragmented and disjoint
board outlines. Directed cutout eligibility additionally requires matching
source-path identity, so endpoint-compatible strokes separated by D02 commands
cannot become one physical contour.

Nested dark contours are eligible to become physical cutouts only when at least
one of these conditions holds:

- the contour is a Gerber region;
- its directed drawing segments form a source-order-continuous closed path;
- the layer has authoritative X2 `FileFunction=Profile` semantics.

Clear-polarity closed geometry remains an explicit cutout. Ambiguous mechanical
layers may still supply the board perimeter, but pen-separated interior artwork
will remain non-destructive.

Dark contours form a containment tree. Every root remains a discoverable board.
Eligible descendants toggle the material state, while ineligible descendants
are transparent: they emit no board or cutout and do not toggle material, but
their descendants are still traversed. This prevents suppressed artwork from
changing the parity of a legitimate nested cutout.

The canonical model and public entrypoint signatures do not change. Native
parsed line and arc primitives gain `sourcePathId` provenance. The correction
removes `pcb_cutout` rows inferred without sufficient source semantics and
retains legitimate contours nested inside non-physical artwork.

## Verification

A synthetic regression sample contains:

- one continuous outer board contour;
- one continuous nested contour that must remain a cutout;
- one endpoint-compatible inner frame whose four edges each start after a
  pen-up move and must not become a cutout.

Additional regressions cover an endpoint-ordered frame with D02 before every
edge, a legitimate cutout inside a suppressed frame, unordered X2 profile
geometry, repeated draw runs, fragmented outer roots, and dense profiles whose
chain assembly must scale without cumulative array copying.

Existing tests must continue to cover connected and fragmented outlines,
disjoint boards, nested profile cutouts, region outlines, clear-polarity
geometry, and cutout ownership. The exact reported archive is used only for
local visual verification and is never committed as a fixture.

## Acceptance criteria

- Canonical Gerber projection agrees with the native contour resolver about the
  number of physical cutouts for pen-separated mechanical artwork.
- Legitimate continuous, region-based, clear-polarity, and authoritative X2
  profile cutouts remain supported.
- Ineligible contours do not alter the material state of eligible descendants.
- Step-repeat instances retain independent draw-run identity.
- Doubling a dense profile from 8,000 to 16,000 segments stays below the
  repository's bounded scaling ratio.
- No application-side or viewer-side special case is added.
- Toolkit tests, ECAD Forge tests, static build checks, and local visual
  verification pass before release.
