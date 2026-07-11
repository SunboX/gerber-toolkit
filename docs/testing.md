# Testing and Performance

Run the complete package gates with:

```bash
npm test
npm run check:features -- --strict
npm run benchmark
npm run check:format
```

The tests cover the shared parser/project behavior contract, direct ZIP input,
archive safety and limits, immutable CircuitJSON envelopes, progress,
cancellation, workers, typed errors, the native compatibility API, renderer and
3D behavior, packed-install conformance, and provenance-bound feature evidence.
Fidelity regressions cover ordered polarity, physical board domains,
solder-mask coverage, X2 ownership, aperture/macro/block geometry, modal Gerber
operations, arc extrema, Excellon units/slots, descriptor-safe inputs, and
worker/direct byte ownership.

`npm run benchmark` compares production canonical parsing, project loading,
interaction lookup, rendering, and cloning workloads against the immutable
0.1.21 baseline. It enforces both relative regression limits and absolute time
ceilings, so a slow implementation cannot pass merely because its baseline is
also slow.

Tests use synthetic Gerber, Excellon, and ZIP payloads generated in code.
Production fabrication packages and source-derived fixture names must not be
committed.

The published runtime is held below a 700 kB unpacked package envelope. That
budget includes the browser-safe ordered polygon compositor and the shared
CircuitJSON convergence surface; tests, benchmark fixtures, scripts, and frozen
development baselines remain excluded from the tarball.
