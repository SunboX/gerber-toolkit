# API

## Root contract

`gerber-toolkit` exposes the same exact root names as the other ECAD toolkits:

```js
import {
    BomTableRenderer,
    CircuitJsonDocument,
    CircuitJsonDocumentContext,
    CircuitJsonIndexer,
    CircuitJsonUnits,
    ManufacturingService,
    Parser,
    PcbInteractionIndex,
    PcbScene3dBuilder,
    PcbScene3dPreparator,
    PcbSvgRenderer,
    ProjectLoader,
    QueryService,
    SchematicSvgRenderer,
    SimulationService,
    ToolkitCapabilities,
    ToolkitError
} from 'gerber-toolkit'
```

All source-neutral services operate on canonical CircuitJSON documents or
prepared `CircuitJsonDocumentContext` values and are the same implementations
exported by `circuitjson-toolkit`.

## Parser

```js
import { Parser } from 'gerber-toolkit/parser'
```

### `Parser.parse(input, options)`

Parses one Gerber or Excellon source synchronously. `input` is:

```js
{
    fileName: 'board.gtl',
    data: stringOrArrayBufferOrUint8Array,
    assets: []
}
```

It returns an immutable `ecad-toolkit.document.v1` envelope. The canonical
CircuitJSON array is `document.model`; source facts are in `document.source`,
and Gerber-only information is namespaced under `document.extensions.gerber`.

The convergence builder transfers its newly decoded ordinary CircuitJSON and
native extension graphs into the shared owned-document validator. Eligible
graph nodes retain identity and are deeply frozen in place, avoiding a second
full defensive copy. This is an internal ownership optimization after source
decoding: raw caller data remains untrusted, and every public parser parameter,
validation rule, document field, and return shape is unchanged.

### `Parser.parseAsync(input, options)`

Returns the same envelope asynchronously. Common options are:

- `worker`: `'auto'`, `true`, or `false`
- `signal`: `AbortSignal`
- `onProgress`: receives monotonic progress rows
- `extensions`: `'none'`, `'metadata'`, `'canonical'`, `'full'`, or selected ids
- `preserveRaw`: retains the full native model
- `decodeAssets`: `'none'`, `'metadata'`, or `'full'`
- `retainSource`: `'none'` or `'reference'`
- `transferInput`: permits worker transfer of owned input buffers
- `reports`: requested report ids; unavailable ids fail explicitly

`Parser.tryParse(input, options)` returns `{ ok: true, value }` or
`{ ok: false, error, diagnostics }`. `Parser.supports(input)` performs bounded
filename/content detection and never throws.

## Project loading

```js
import { ProjectLoader } from 'gerber-toolkit/project'
```

`ProjectLoader.load(entries, options)` and `loadAsync(entries, options)` accept
a dense array of descriptor-safe entries:

```js
;[
    { name: 'board-F_Cu.gtl', data: topCopperBytes },
    { name: 'board-PTH.drl', data: drillBytes },
    { name: 'model.step', data: modelBytes }
]
```

A single `{ name: 'board.zip', data: zipBytes }` entry is expanded internally;
callers do not need a ZIP adapter. Supported fabrication members become one
canonical document, while non-fabrication companions and attached assets are
preserved according to `decodeAssets`. `archiveLimits` configures common entry,
expanded-byte, and compression-ratio ceilings.

`ProjectLoader.tryLoad()` returns a discriminated result and
`ProjectLoader.supports()` returns a non-throwing boolean.

## Package layout

| Subpath                                    | Purpose                                                                 |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| `gerber-toolkit/parser`                    | Parser envelope, worker protocol, progress, assets, diagnostics, errors |
| `gerber-toolkit/project`                   | Project loader, archive paths and limits, project envelope              |
| `gerber-toolkit/renderers`                 | Shared CircuitJSON SVG and BOM renderers                                |
| `gerber-toolkit/interaction`               | Shared PCB interaction index                                            |
| `gerber-toolkit/query`                     | Shared document query service                                           |
| `gerber-toolkit/manufacturing`             | Shared manufacturing exporters                                          |
| `gerber-toolkit/simulation`                | Shared injected simulation service                                      |
| `gerber-toolkit/scene3d`                   | Shared CircuitJSON scene builder and preparator                         |
| `gerber-toolkit/capabilities`              | Machine-readable capability inventory                                   |
| `gerber-toolkit/extensions`                | Complete native 0.1.21 API plus shared extension helpers                |
| `gerber-toolkit/testing`                   | Shared contract fixtures and conformance helpers                        |
| `gerber-toolkit/workers/parser.worker.mjs` | Common parser worker protocol endpoint                                  |
| `gerber-toolkit/styles/renderers.css`      | Optional renderer styles                                                |

## Typed failures

Parser and project failures use `ToolkitError` with stable `code`, `category`,
`format`, `source`, and `details` fields. Cancellation is
`ERR_CANCELLED`; unsupported inputs and capabilities fail explicitly rather
than returning partial placeholder results.
