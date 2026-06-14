# API

## Parser

```js
import { GerberParser, GerberProjectLoader } from 'gerber-toolkit/parser'
```

### `GerberParser.parseArrayBuffer(fileName, buffer, options)`

Parses one Gerber or Excellon source file and returns a normalized PCB document.
Gerber parsing covers common RS-274X drawing commands, standard apertures,
aperture macros, aperture blocks, step-repeat, polarity, aperture transforms,
file/aperture/object attributes, regions, lines, arcs, and flashes. Excellon
parsing covers tool definitions, drill hits, and routed slots.

### `GerberProjectLoader.loadEntries(entries, options)`

Loads selected fabrication entries into one composite Gerber PCB document. Entries use this shape:

```js
{ name: 'board-F_Cu.gtl', bytes: Uint8Array }
```

ZIP entries are expanded in memory. Fabrication files inside the archive are parsed and grouped into one document.

## Renderers

```js
import {
    GerberPcbSvgRenderer,
    PcbInteractionIndex,
    PcbInteractionLayerModel
} from 'gerber-toolkit/renderers'
```

### `GerberPcbSvgRenderer.render(documentModel, options)`

Renders a Gerber PCB document to SVG. The default render mode is `composite`.

```js
GerberPcbSvgRenderer.render(documentModel)
GerberPcbSvgRenderer.render(documentModel, {
    renderMode: 'separated',
    layerId: 'gerber-board-f-cu-gtl'
})
```

### `PcbInteractionIndex.build(documentModel, options)`

Builds simple interaction bounds for rendered primitives, drill hits, and drill
slots.

### `PcbInteractionLayerModel.resolve(documentModel)`

Returns source-layer metadata for PCB layer controls.

## Scene 3D

```js
import {
    PcbScene3dBuilder,
    PcbScene3dScenePreparator
} from 'gerber-toolkit/scene3d'
```

### `PcbScene3dBuilder.build(documentModel, options)`

Builds a data-only bare-board scene description for the interactive 3D PCB
runtime. Parsed Gerber coordinates stay millimeter-based in the document model;
the scene builder converts board, copper, pad, and drill geometry to mils for
the shared 3D viewer contract. Fabrication files do not contain component body
models, so Gerber scenes emit an empty `components` list.

### `PcbScene3dScenePreparator.prepare(documentModel, options)`

Async facade matching the shared toolkit scene preparation API.
