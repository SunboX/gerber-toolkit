# gerber-toolkit 0.4.0

Version 0.4.0 adopts parser-owned CircuitJSON and retained native extension
graphs through the CircuitJSON Toolkit 1.4 ownership boundary. It removes a
redundant defensive graph copy from successful document construction without
changing fabrication geometry, validation, or immutability.

## Owned convergence graphs

- The Gerber convergence builder uses
  `DocumentResult.createValidatedOwned(fields, runtime?)` for graphs it has
  just constructed and exclusively owns.
- Ordinary CircuitJSON model and native extension nodes retain their identities
  and are deeply frozen in place. Binary properties continue through the
  shared defensive binary boundary.
- Raw Gerber and Excellon input remains untrusted and is parsed normally. The
  owned path is applied only after the format adapter has produced a new
  standard local graph.

## API and compatibility

- Parser and project input, options, progress, cancellation, worker, asset, and
  source-retention contracts are unchanged.
- Successful parsing returns the same `ecad-toolkit.document.v1` envelope with
  the same `model`, `source`, `extensions`, `assets`, `diagnostics`, and
  `statistics` fields.
- Canonical fabrication geometry, retained native data, package subpaths, and
  shared renderer and scene-service inputs retain their existing shapes.
- No class, method, parameter, package subpath, native extension, or renderer
  behavior is removed or renamed.

## Performance verification

The shared ownership regressions verify retained identity, deep freeze,
bounded extension sealing, mutation isolation, binary protection, and direct
and worker result parity. Gerber performance gates continue to require
deterministic result, clone, structural, size, and retained-heap contracts,
with comparable-environment timing thresholds applied where appropriate.
