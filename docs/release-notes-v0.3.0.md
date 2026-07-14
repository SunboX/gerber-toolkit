# gerber-toolkit 0.3.0

This coordinated minor release consumes the CircuitJSON Toolkit 1.2 canonical
PCB contract and hardens performance verification across development and CI
hardware.

## API and compatibility

- The `circuitjson-toolkit` runtime baseline is now `^1.2.0`, so Gerber
  documents interoperate directly with the same validated PCB text, rotated
  drilled-pad geometry, and primitive metadata accepted by the other source
  toolkits and the 3D viewer.
- Existing Gerber root exports, package subpaths, parser parameters, document
  envelopes, and extension APIs are unchanged from 0.2.0.
- All CircuitJSON 1.2 additions are additive; no Gerber feature is removed.

## Release performance

- Comparable benchmark thresholds now account for the executing hardware while
  retaining the established absolute and relative regression requirements.
- Different environments continue to enforce deterministic result, clone,
  fixture, structural, metadata, warmup, sample, median, and retained-heap
  contracts without comparing non-equivalent wall-clock timings.
- The release checks exercise the comparable timing threshold explicitly,
  preventing a fast reference machine from producing false failures on
  different CI hardware.
