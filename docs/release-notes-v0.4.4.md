# gerber-toolkit 0.4.4

Version 0.4.4 improves large Gerber image composition, corrects a solder-mask
edge case for via-owned copper, and exposes the shared self-adjusting
computation runtime. The changes are structural and apply to every supported
Gerber project without source-specific rules.

## Scalable copper composition

- Large copper operand batches are partitioned into transitive spatial
  components before polygon union, so disjoint artwork no longer accumulates
  through one ever-growing intermediate geometry.
- Bounds discovery preserves source order, treats touching bounds as connected,
  and retains conservative behavior when an operand cannot be classified.
- A bounded sweep-work budget falls back to the established chunked union for
  dense overlap instead of allowing quadratic partition work.
- Final geometry remains normalized through `polygon-clipping`, including
  closed rings and the library's existing malformed-input behavior.

## Via mask semantics

- A copper flash whose area matches a drilled via is marked as via-owned on the
  corresponding surface and cannot open that surface by itself.
- A genuinely larger, opened host pad still exposes a via-in-pad surface.
- Side-specific tenting and authored solder-mask behavior remain unchanged.

## Shared incremental runtime

- The root entrypoint re-exports `SelfAdjustingComputation` from
  `circuitjson-toolkit` 1.4.1.
- Consumers can retain dependency traces across edits while continuing to use
  the same parser, project, rendering, interaction, and scene contracts.

## Verification

- Tests cover transitive overlap partitioning, stable disjoint components,
  large-batch normalization, dense-sweep fallback, malformed geometry,
  via-owned flash masking, and canonical runtime identity.
- Release gates include the complete package suite, formatter check, feature
  preservation audit, benchmark contract, and npm package dry run.
