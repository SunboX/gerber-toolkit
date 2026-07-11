# Migration from 0.1.21 to 0.2.0

Version 0.2.0 adopts the common ECAD toolkit contract. Existing names and return
shapes may change incompatibly at the root and common subpaths; no native
Gerber feature was deleted.

## Common replacements

| 0.1.21                                                      | 0.2.0 common API                                               |
| ----------------------------------------------------------- | -------------------------------------------------------------- |
| `GerberParser.parseArrayBuffer(fileName, data)`             | `Parser.parse({ fileName, data })`                             |
| `GerberProjectLoader.loadEntries(entries)` with `{ bytes }` | `ProjectLoader.load(entries)` with `{ data }`                  |
| Native document returned directly                           | `document.model` CircuitJSON plus `document.extensions.gerber` |
| `GerberPcbSvgRenderer.render(nativeDocument)`               | `PcbSvgRenderer.render(documentOrContext)`                     |
| `PcbInteractionIndex.build(nativeDocument)`                 | `PcbInteractionIndex.create(documentOrContext)`                |
| Native `PcbScene3dBuilder.build(nativeDocument)`            | Shared `PcbScene3dBuilder.build(documentOrContext)`            |

The new project loader accepts `{ name, data }` consistently with the other
toolkits and expands a ZIP entry itself. Rename app entry fields from `bytes` to
`data`; do not add a format-specific app adapter.

## Native compatibility

Move unchanged native imports to `gerber-toolkit/extensions`:

```js
import {
    GerberParser,
    GerberProjectLoader,
    GerberPcbSvgRenderer,
    PcbInteractionIndex,
    PcbInteractionLayerModel,
    PcbScene3dBuilder,
    PcbScene3dModelRegistry,
    PcbScene3dScenePreparator
} from 'gerber-toolkit/extensions'
```

These exports preserve the 0.1.21 names, parameters, native return shapes, and
behavior. The common root intentionally reserves source-neutral names, so
`PcbInteractionIndex` and `PcbScene3dBuilder` at the root now refer to the shared
CircuitJSON implementations.

## Native data inside a common result

When a consumer needs both APIs, retain the native model explicitly:

```js
const document = Parser.parse(input, {
    extensions: ['gerber.native-model']
})
const nativeDocument = document.extensions.gerber.native
```

This avoids reparsing while keeping common consumers independent of the native
layout.
