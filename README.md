# gerber-toolkit

Browser-safe Gerber and Excellon parsing plus deterministic SVG rendering for fabrication package inspection.

## Features

- Parses RS-274X Gerber layer files.
- Parses Excellon drill files.
- Expands standard apertures, aperture macros, and aperture blocks.
- Applies step-repeat, polarity, aperture transforms, and Gerber attributes.
- Preserves Excellon drill hits and routed slots.
- Expands ZIP fabrication bundles with `fflate`.
- Groups selected fabrication sources into one composite PCB document.
- Keeps per-source layer metadata for separated layer inspection.
- Renders deterministic SVG through an ESM API.
- Builds bare-board 3D scene descriptions from outline, copper, pad, and drill fabrication geometry.

## Install

```bash
npm install gerber-toolkit
```

## Usage

```js
import { GerberProjectLoader } from 'gerber-toolkit/parser'
import { GerberPcbSvgRenderer } from 'gerber-toolkit/renderers'
import { PcbScene3dBuilder } from 'gerber-toolkit/scene3d'

const result = await GerberProjectLoader.loadEntries([
    { name: 'board-F_Cu.gtl', bytes: topCopperBytes },
    { name: 'board-PTH.drl', bytes: drillBytes }
])
const svg = GerberPcbSvgRenderer.render(result.documents[0])
const scene = PcbScene3dBuilder.build(result.documents[0])
```

Use separated rendering when inspecting one source layer:

```js
const svg = GerberPcbSvgRenderer.render(documentModel, {
    renderMode: 'separated',
    layerId: documentModel.pcb.fabrication.layers[0].id
})
```

## Development

```bash
npm install
npm test
```
