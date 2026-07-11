# Capabilities

`ToolkitCapabilities.inventory()` returns fresh clone-safe rows in stable id
order. Each row has `id`, `category`, `operation`, `status`, `entrypoint`,
`summary`, `reason`, `tested`, and `documented`.

Gerber uses these status meanings:

- `native`: Gerber owns the decoder, project loader, worker, or native extension.
- `shared`: the operation runs on canonical CircuitJSON through
  `circuitjson-toolkit`.
- `unavailable`: the operation cannot be represented honestly and fails with
  `ERR_CAPABILITY_UNAVAILABLE`.

| Capability id          | Gerber implementation                | Entrypoint                                 |
| ---------------------- | ------------------------------------ | ------------------------------------------ |
| `parse.document`       | Native Gerber/Excellon adapter       | `Parser`                                   |
| `project.load`         | Native fabrication/ZIP loader        | `ProjectLoader`                            |
| `worker.parse`         | Native adapter using common protocol | `gerber-toolkit/workers/parser.worker.mjs` |
| `worker.load-project`  | Native adapter using common protocol | `gerber-toolkit/workers/parser.worker.mjs` |
| `validation.document`  | Shared CircuitJSON                   | `DocumentResult`                           |
| `metadata.normalize`   | Shared CircuitJSON                   | `DocumentResult`                           |
| `units.convert`        | Shared CircuitJSON                   | `CircuitJsonUnits`                         |
| `render.pcb`           | Shared CircuitJSON                   | `PcbSvgRenderer`                           |
| `render.schematic`     | Shared CircuitJSON                   | `SchematicSvgRenderer`                     |
| `bom.build`            | Shared CircuitJSON                   | `BomTableRenderer`                         |
| `interaction.pcb`      | Shared CircuitJSON                   | `PcbInteractionIndex`                      |
| `query.document`       | Shared CircuitJSON                   | `QueryService`                             |
| `manufacturing.export` | Shared CircuitJSON                   | `ManufacturingService`                     |
| `simulation.spice`     | Shared CircuitJSON                   | `SimulationService`                        |
| `scene3d.build`        | Shared CircuitJSON                   | `PcbScene3dBuilder`                        |
| `scene3d.prepare`      | Shared CircuitJSON                   | `PcbScene3dPreparator`                     |

The inventory also retains historical Gerber capability ids and points them to
the shared implementation or `gerber-toolkit/extensions`. Exact source-native
functionality is not duplicated into unrelated format packages; functionality
that truthfully operates on CircuitJSON is supplied to every toolkit through
the shared services.

## Canonical fidelity

The native adapter performs one projection into CircuitJSON before shared
services run. Simple dark traces and pads stay simple. Ordered polygon
composition is reserved for clear exposures, macros/blocks, standard aperture
holes, physical file/image polarity, and partial solder-mask intersections.
Closed profiles define finite physical domains, including multiple boards and
cutouts. Explicit X2 object attributes supply component, port, net, and trace
ownership; absent attributes never produce guessed connectivity.

Project ZIP input is inspected before inflation, enforces entry/depth/byte and
compression-ratio limits, normalizes member paths, verifies metadata and CRC,
and retains non-fabrication companions according to `decodeAssets`.

```js
import { ToolkitCapabilities } from 'gerber-toolkit/capabilities'

const parsing = ToolkitCapabilities.inventory().find(
    (row) => row.id === 'parse.document'
)
console.log(parsing.status, parsing.entrypoint)
```
