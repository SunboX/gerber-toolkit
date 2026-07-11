# gerber-toolkit

Browser-safe Gerber and Excellon parsing into immutable CircuitJSON document
envelopes, plus the shared ECAD rendering, interaction, query, manufacturing,
simulation, and 3D scene APIs.

## Breaking API convergence

Version 0.2.0 intentionally changes root names, parameters, return shapes, and
package subpaths. The root now exposes the same 17-class API as
`circuitjson-toolkit`, `altium-toolkit`, and `kicad-toolkit`. `Parser.parse()`
returns an `ecad-toolkit.document.v1` envelope whose `model` is CircuitJSON,
and `ProjectLoader.load()` returns an `ecad-toolkit.project.v1` envelope.

No Gerber functionality was removed. The complete 0.1.21 parser, renderer,
interaction, and native 3D APIs remain available from
`gerber-toolkit/extensions`. See the [migration guide](docs/migration.md).

## Features

- Parses RS-274X Gerber and Excellon sources in browsers and Node.js.
- Projects representable board, copper, documentation, and drill geometry into
  CircuitJSON without inventing nets, components, or assembly semantics.
- Loads `{ name, data }` entry arrays and expands a single ZIP entry internally
  with bounded entry, byte, compression-ratio, and path checks.
- Uses one common parser/project contract with progress, cancellation, workers,
  assets, source retention, typed errors, and discriminated `try*` results.
- Uses the shared CircuitJSON context, SVG/BOM renderers, interaction indexes,
  queries, manufacturing exports, injected simulation, and 3D scene services.
- Retains exact native fabrication geometry on request through the Gerber
  extension namespace.
- Runs locally; parsing does not send source data over the network.

## Install

```bash
npm install gerber-toolkit
```

## Usage

```js
import {
    CircuitJsonDocumentContext,
    Parser,
    PcbInteractionIndex,
    PcbScene3dBuilder,
    PcbSvgRenderer,
    QueryService
} from 'gerber-toolkit'

const document = await Parser.parseAsync(
    { fileName: file.name, data: await file.arrayBuffer() },
    { worker: 'auto' }
)
const context = CircuitJsonDocumentContext.prepare(document, {
    indexes: ['elements', 'relations', 'connectivity', 'spatial']
})

const svg = PcbSvgRenderer.render(context)
const hits = PcbInteractionIndex.create(context).hitTest({ x: 10, y: 5 })
const components = QueryService.create(context).query({
    select: 'components'
})
const scene = PcbScene3dBuilder.build(context)

console.log(document.model, svg, hits, components.items, scene)
```

Load several fabrication files, or one ZIP blob, without an app adapter:

```js
import { ProjectLoader } from 'gerber-toolkit/project'

const project = await ProjectLoader.loadAsync([
    { name: 'board.zip', data: zipArrayBuffer }
])

console.log(project.documents[0].model)
```

Optional renderer CSS is available through:

```js
import 'gerber-toolkit/styles/renderers.css'
```

Use the exact native API deliberately when it is required:

```js
import {
    GerberParser,
    GerberPcbSvgRenderer,
    PcbScene3dBuilder
} from 'gerber-toolkit/extensions'

const nativeDocument = GerberParser.parseArrayBuffer(file.name, arrayBuffer)
const nativeSvg = GerberPcbSvgRenderer.render(nativeDocument)
const nativeScene = PcbScene3dBuilder.build(nativeDocument)
```

## Documentation

- [API](docs/api.md)
- [Capabilities](docs/capabilities.md)
- [Migration from 0.1.21](docs/migration.md)
- [0.2.0 release notes](docs/release-notes-v0.2.0.md)
- [Model format](docs/model-format.md)
- [Testing and performance](docs/testing.md)
- [Library scope](spec/library-scope.md)

## Development

```bash
npm install
npm test
npm run check:features -- --strict
npm run benchmark
npm run check:format
```

## License

The software is available under GPL-3.0-or-later or a separate commercial
license. Documentation and non-code text are licensed under CC-BY-SA-4.0 unless
otherwise marked. See [LICENSE](LICENSE),
[COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md), and [NOTICE.md](NOTICE.md).
