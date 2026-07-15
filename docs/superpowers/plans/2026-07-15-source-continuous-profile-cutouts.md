# Source-continuous Profile Cutouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent pen-separated mechanical artwork from becoming destructive canonical PCB cutouts while preserving legitimate Gerber profile contours.

**Architecture:** Keep unordered reversible endpoint chaining for discovering outer board profiles. Track a second set of cutout-eligible dark contours: regions, directed source-order-continuous paths, and every closed contour on authoritative X2 Profile layers; nesting classification may emit `pcb_cutout` only from that eligible set. Clear-polarity geometry remains explicitly subtractive.

**Tech Stack:** JavaScript ES modules, Node.js test runner, Gerber RS-274X, CircuitJSON canonical models.

## Global Constraints

- The fix belongs in `gerber-toolkit`; no app-side or viewer-side special case is allowed.
- Tests use only synthetic, obfuscated Gerber text.
- Public canonical model and API shapes remain unchanged.
- Outer fragmented and disjoint board reconstruction must remain supported.
- Legitimate source-continuous, region, clear-polarity, and X2 Profile cutouts must remain supported.

---

### Task 1: Lock down mechanical-stroke cutout semantics

**Files:**
- Modify: `tests/canonical-geometry-and-async-audit.test.mjs`

**Interfaces:**
- Consumes: `ProjectLoader.load([{ name, data }]).documents[0].model`
- Produces: a regression contract over canonical `pcb_board` and `pcb_cutout` rows.

- [ ] **Step 1: Add the failing synthetic test**

Create a Gerber program with a continuous outer 12 mm square, a continuous
2 mm square cutout, and a separate 4 mm frame whose four directed edges require
reordering or reversal to close:

```js
test('pen-separated mechanical frames do not become canonical cutouts', () => {
    const outline = [
        '%FSLAX24Y24*%',
        '%MOMM*%',
        '%ADD10C,0.100*%',
        'D10*',
        'X000000Y000000D02*',
        'X120000Y000000D01*',
        'X120000Y120000D01*',
        'X000000Y120000D01*',
        'X000000Y000000D01*',
        'X010000Y010000D02*',
        'X030000Y010000D01*',
        'X030000Y030000D01*',
        'X010000Y030000D01*',
        'X010000Y010000D01*',
        'X050000Y090000D02*',
        'X090000Y090000D01*',
        'X090000Y050000D02*',
        'X090000Y090000D01*',
        'X050000Y050000D02*',
        'X090000Y050000D01*',
        'X050000Y050000D02*',
        'X050000Y090000D01*',
        'M02*'
    ].join('\n')
    const model = ProjectLoader.load([
        { name: 'mechanical-frame.gm1', data: outline }
    ]).documents[0].model
    const cutouts = model.filter((element) => element.type === 'pcb_cutout')

    assert.equal(
        model.filter((element) => element.type === 'pcb_board').length,
        1
    )
    assert.equal(cutouts.length, 1)
    assert.deepEqual(cutouts[0].points, [
        { x: 1, y: 1 },
        { x: 3, y: 1 },
        { x: 3, y: 3 },
        { x: 1, y: 3 }
    ])
})
```

- [ ] **Step 2: Run the focused test and prove the regression**

Run:

```bash
node --test --test-name-pattern="pen-separated mechanical frames" tests/canonical-geometry-and-async-audit.test.mjs
```

Expected: FAIL because the current projector returns two cutouts.

### Task 2: Make cutout inference source-continuity aware

**Files:**
- Modify: `src/convergence/GerberCircuitJsonOutlineProjector.mjs`
- Test: `tests/canonical-geometry-and-async-audit.test.mjs`

**Interfaces:**
- Consumes: native outline layers and their ordered `primitives` arrays.
- Produces: unchanged `{ boards, cutouts }` return shape from `GerberCircuitJsonOutlineProjector.project(layers)`.

- [ ] **Step 1: Add eligible-contour collection**

Extend `#layer(layer)` to return `eligibleDark` alongside `dark` and `clear`.
Build `dark` with existing unordered chaining, build directed paths with a new
`#sourceClosedChains(segments)` helper, and select eligible paths as follows:

```js
const darkChains = GerberCircuitJsonOutlineProjector.#closedChains(darkSegments)
const eligibleDark = GerberCircuitJsonOutlineProjector.#isExplicitProfile(layer)
    ? [...darkRegions, ...darkChains]
    : [
          ...darkRegions,
          ...GerberCircuitJsonOutlineProjector.#sourceClosedChains(
              darkSegments
          )
      ]
```

`#isExplicitProfile(layer)` reads `layer.attributes.file.FileFunction` and
returns true only when its first token is `Profile`, case-insensitively.

- [ ] **Step 2: Implement directed source-order chaining**

Add `#sourceClosedChains(segments)`. It appends a segment only when the
segment's first point equals the current path's final point; it never reorders
or reverses segments. It flushes a path when it closes or when continuity
breaks, using the existing `#closedPoints()` normalization.

- [ ] **Step 3: Add orientation-independent contour signatures**

Add `#contourKey(points)` that converts every polygon edge into a sorted pair
of quantized endpoint keys, sorts all edge strings, and joins them. This makes
the key independent of polygon rotation and winding while preserving exact
sampled geometry.

- [ ] **Step 4: Gate inferred dark cutouts**

In `project(layers)`, collect `#contourKey(points)` for every `eligibleDark`
path. Keep all dark candidates for board discovery and nesting, but change the
odd-depth filter to:

```js
.filter(
    (row) =>
        row.depth % 2 === 1 &&
        eligibleCutouts.has(
            GerberCircuitJsonOutlineProjector.#contourKey(row.points)
        )
)
```

Leave explicit clear-polarity cutout handling unchanged.

- [ ] **Step 5: Run focused and complete toolkit tests**

Run:

```bash
node --test --test-name-pattern="pen-separated mechanical frames|disjoint profile loops|profile cutouts target|canonical board outline" tests/canonical-geometry-and-async-audit.test.mjs tests/canonical-project-zip-contract.test.mjs
npm test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit the semantic fix**

```bash
git add src/convergence/GerberCircuitJsonOutlineProjector.mjs tests/canonical-geometry-and-async-audit.test.mjs
git commit -m "fix: preserve profile path intent"
```

### Task 3: Verify, document, release, and deploy

**Files:**
- Modify: `README.md`
- Create: `docs/release-notes-v0.4.1.md`
- Modify: `package.json`
- Modify in ECAD Forge: `package.json`, `package-lock.json`, generated structured-data HTML, release notes/docs as required.

**Interfaces:**
- Consumes: released `gerber-toolkit` package and the existing ECAD Forge dependency boundary.
- Produces: a published toolkit patch and an ECAD Forge patch release that consumes it.

- [ ] **Step 1: Verify the reported archive locally without committing it**

Parse the temporary archive and assert canonical and native scene construction
both expose four physical cutouts and no large rectangular cutout. Install the
local toolkit into ECAD Forge without adding an adapter, open the exact local
URL, and confirm the board substrate is intact with zero page or console errors.

- [ ] **Step 2: Update toolkit documentation and version**

Document that inferred mechanical artwork requires directed source continuity
before becoming a cutout, create `docs/release-notes-v0.4.1.md`, and bump
`gerber-toolkit` from `0.4.0` to `0.4.1`.

- [ ] **Step 3: Run toolkit release verification**

Run the repository-owned test, format, package dry-run, and release checks from
the npm release skill. Expected: every gate passes and the tarball contains the
updated source, tests as configured, README, and release notes.

- [ ] **Step 4: Publish and verify gerber-toolkit 0.4.1**

Commit, push `main`, publish to npm, create the GitHub release, and verify the
registry version and `gitHead` match the pushed commit.

- [ ] **Step 5: Update ECAD Forge and run deploy-equivalent gates**

Update the dependency to `gerber-toolkit@0.4.1`, bump the app patch version,
update app documentation/release notes, run `npm run sync:structured-data`,
then run:

```bash
npm test
npm run check:structured-data
npm run build:static
```

Expected: all commands PASS.

- [ ] **Step 6: Release and verify ECAD Forge**

Commit and push `main`, create the GitHub release, watch the exact
`Deploy to FTP (main)` workflow for the pushed SHA to conclusion `success`,
then reload the exact production URL and confirm the visual fix and zero browser
errors.

