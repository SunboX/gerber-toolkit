# gerber-toolkit 0.4.2

Version 0.4.2 supersedes 0.4.1 with complete Gerber draw-run preservation,
material-aware profile nesting, and linear outline-chain assembly. The fix is
derived from RS-274X drawing semantics and applies to every project; it does not
match archive names, source labels, or example geometry.

## Draw-run provenance

- Parsed line and arc primitives expose a stable `sourcePathId`.
- D02 pen-up moves, D03 flashes, polarity transitions, and region boundaries
  end the active draw run.
- Step-repeat expansion assigns a distinct identity to every repeated instance,
  so interleaved expanded primitives reconstruct their own contours.
- Caller-built legacy primitives without provenance retain ordered endpoint
  continuity as a compatibility fallback.

## Physical profile topology

- Unordered reversible chaining remains available for fragmented outer-board
  discovery and authoritative X2 `FileFunction=Profile` contours.
- Ambiguous dark cutouts require a region or one directed, closed draw run.
- Reconstructed contours form a deduplicated containment tree. Roots remain
  boards, eligible descendants toggle solid/void material, and ineligible
  mechanical artwork is transparent while its descendants are still visited.
- Strict contour containment uses an indexed boundary test, so a chord crossing
  the open part of a concave profile cannot be classified from one interior
  vertex alone.
- Explicit clear-polarity geometry remains authoritative and board-owned.

## Performance and robustness

- Ordered paths append in place; unordered paths retain segment chunks and
  flatten once. The projector no longer copies a growing point array for every
  segment or spreads an unbounded chain into function arguments.
- A 140,000-segment synthetic contour projects without argument overflow.
- On the release machine, nested 2k/4k/8k/16k contours measured
  22.1/31.8/48.1/92.8 milliseconds. The reviewed all-pairs containment draft
  took about 1,989.5 milliseconds at 16k.
- The source-continuous 16k profile median improved from about 391.5
  milliseconds in 0.4.1 to about 99.3 milliseconds after chunked chaining.

## API and compatibility

- Canonical CircuitJSON document envelopes, parser and project parameters,
  package entrypoints, and common service return shapes are unchanged.
- Native retained line and arc primitives add the `sourcePathId` property. This
  is intentional provenance for exact Gerber consumers.
- Gerber regions, clear contours, X2 profiles, disjoint boards, fragmented outer
  profiles, drilled holes, and plated slots retain their prior behavior.

## Verification

- The complete package suite passes 361 tests, including ordered D02 frames,
  transparent nesting, step-repeat paths, unordered X2 contours, concave
  crossings, dense scaling, and argument-overflow coverage.
- The exact reported fabrication archive remains outside the repository. Its
  canonical and native projections each expose four physical circular cutouts,
  and no large rectangular cutout is present.
- Release gates include the feature-preservation audit, formatter check,
  benchmark contract, package dry-run, packed-install app tests, local browser
  rendering, registry metadata, and GitHub release verification.
