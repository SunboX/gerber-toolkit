# Profile Containment Hardening Plan

> **For agentic workers:** Execute with subagent-driven development and review
> every task before release.

**Goal:** Close the draw-run, nesting-parity, and scaling gaps found during the
0.4.1 whole-release review without adding downstream compatibility code.

**Architecture:** Preserve parser-owned draw-run provenance on native line and
arc primitives. Reconstruct physical topology as a deduplicated containment
tree: roots are boards, eligible descendants toggle material, and ineligible
descendants are transparent. Assemble ordered and unordered chains from chunks
instead of copying the growing point array for every segment.

## Task 1: Prove the review findings

- Add synthetic tests for an ordered D02-separated frame and for an eligible
  cutout nested inside an ineligible frame.
- Add parser coverage for draw-run boundaries and step-repeat instance ids.
- Retain explicit X2 unordered contours and fragmented unordered roots.
- Add a dense-profile scaling regression that fails the quadratic release
  candidate.

## Task 2: Preserve source semantics

- Assign stable `sourcePathId` values to parsed lines and arcs.
- Break the active path on D02, D03, polarity changes, and region boundaries.
- Derive a distinct source-path identity for each step-repeat instance.
- Keep legacy endpoint-continuity behavior for caller-built primitives without
  parser provenance.

## Task 3: Resolve physical topology

- Deduplicate reconstructed dark contours with orientation-independent keys.
- Build the immediate-parent containment forest.
- Emit every root as a board.
- Toggle material only for eligible descendants; traverse ineligible
  descendants without emitting or toggling.
- Keep explicit clear-polarity cutouts authoritative.

## Task 4: Remove cumulative copying

- Group directed segments by source-path identity while retaining source order.
- Append ordered points in place and flatten unordered chain chunks once.
- Verify the 8,000/16,000-segment scaling gate and compare fresh medians with
  the reviewed 0.4.1 candidate.

## Task 5: Release and consume

- Run the complete toolkit suite, format check, feature audit, package dry-run,
  exact archive projection audit, and local ECAD Forge visual check.
- Publish Gerber Toolkit 0.4.2 and mark 0.4.1 as superseded.
- Update ECAD Forge 1.13.1 to the registry 0.4.2 release, rerun app deployment
  gates, push `main`, watch the exact deployment workflow, and verify the
  reported production URL.
