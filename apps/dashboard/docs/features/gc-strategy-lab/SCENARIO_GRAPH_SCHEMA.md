# Scenario Graph Schema

**Status:** version 1, visual-authoring contract  
**Owner:** Dashboard / Scenario Runner  
**Tracking:** [Issue #1992](https://github.com/45s/coinzilla/issues/1992)

## Purpose and trust boundary

This schema describes a graph for human authoring and explanation. It is deliberately separate from the Harvester executable scenario catalogue and input schema.

Every document has `status: "visual-only"`. The graph editor has no execution, persistence, or promotion-to-executable operation. A graph being structurally valid means only that its visual topology is internally consistent; it does not mean that it is an approved or executable test scenario.

The graph contains declarative node metadata only. It cannot contain JavaScript, expressions, shell commands, callbacks, dynamic imports, or other executable payloads. Do not evaluate graph data.

## Version 1 document

| Field | Type | Meaning |
| --- | --- | --- |
| `schemaVersion` | `1` | Explicit schema version; unknown versions are rejected. |
| `status` | `"visual-only"` | Mandatory trust state. |
| `id` | string | Stable graph identity. |
| `title` | string | Human-readable title. |
| `description` | string, optional | Graph-level explanation. |
| `source` | object | `kind` and source `reference`. |
| `limitations` | string array | Explicit behavior not represented or not proven by the graph. |
| `nodes` | node array | Visual nodes and positions. |
| `edges` | edge array | Directed connections between declared ports. |

### Node types and ports

| Node type | Input ports | Output ports | Intended meaning |
| --- | --- | --- | --- |
| `start` | none | `next` | One graph entry point. |
| `action` | `in` | `next` | Descriptive action/use-case step. |
| `decision` | `in` | `yes`, `no` | Explicit two-way decision. |
| `wait` | `in` | `next` | Wait or deferred observation. |
| `reconciliation` | `in` | `next` | Reconcile authoritative order/fill/accounting facts. |
| `block` | `in` | `next` | Block, unresolved or STOP explanation. |
| `end` | `in` | none | Terminal graph outcome. |

Each node has `id`, `type`, `label`, `position: { x, y }`, and string-valued `properties`; `description` is optional. Coordinates are non-negative canvas units. Node IDs are unique.

An edge has `id`, `from: { nodeId, portId }`, `to: { nodeId, portId }`, and optional `label`. Edge IDs are unique. Edges must connect an existing output port to an existing input port. An output port can have at most one outgoing edge. Decision output ports are labelled automatically as `YES` and `NO`, and both branches are required for a structurally valid graph.

## Structural validation

Version 1 validation reports stable issue codes and paths for:

- exactly one start node and at least one end node;
- duplicate node/edge IDs;
- invalid coordinates and empty labels;
- missing edge endpoints or incompatible ports;
- duplicate outgoing connections;
- missing or incorrectly labelled decision branches;
- start nodes with incoming edges and end nodes with outgoing edges;
- nodes unreachable from the start;
- directed cycles (not supported in version 1).

Validation is deterministic and framework-independent. It does not infer business behavior, strategy readiness, exchange authorization, profitability, or scenario executability.

## Example

```json
{
  "schemaVersion": 1,
  "status": "visual-only",
  "id": "example",
  "title": "Example flow",
  "source": { "kind": "manual", "reference": "local-draft" },
  "limitations": ["This graph is not an executable scenario."],
  "nodes": [
    {
      "id": "start",
      "type": "start",
      "label": "Start",
      "position": { "x": 20, "y": 20 },
      "properties": {}
    },
    {
      "id": "finish",
      "type": "end",
      "label": "Finish",
      "position": { "x": 260, "y": 20 },
      "properties": {}
    }
  ],
  "edges": [
    {
      "id": "start-finish",
      "from": { "nodeId": "start", "portId": "next" },
      "to": { "nodeId": "finish", "portId": "in" }
    }
  ]
}
```

Unknown fields and unsupported schema versions are rejected rather than silently dropped or reinterpreted. Deserialization validates the document shape; graph topology is then checked by the domain validator.

## Recovery Seller example provenance

The Dashboard's built-in RS graph is a read-only source adapter over the current [Recovery Seller Domain Specification](../../../../../apps/harvester/docs/domain/recovery-seller-domain-specification.md). It preserves the documented one-SELL-lifecycle-per-cycle rule, canonical fill/commission reconciliation barrier, independent profitability gates, and the investment-only STOP distinction.

The example is explanatory, not an executable scenario. It does not authorize exchange operations, infer wallet custody, prove production execution, or invent retry/replacement behavior. Its limitations are carried in the graph document itself.
