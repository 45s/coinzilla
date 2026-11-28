import { describe, expect, it } from 'vitest';
import {
  connectGraphNodes,
  createScenarioGraph,
  deleteGraphNode,
  deserializeScenarioGraph,
  moveGraphNode,
  serializeScenarioGraph,
  validateScenarioGraph,
  type ScenarioGraph,
} from './scenario-graph';

function createValidGraph(): ScenarioGraph {
  return createScenarioGraph({
    id: 'graph-1',
    title: 'Test graph',
    source: { kind: 'manual', reference: 'local-draft' },
    nodes: [
      { id: 'start', type: 'start', label: 'Start', position: { x: 20, y: 20 }, properties: {} },
      { id: 'decision', type: 'decision', label: 'Eligible?', position: { x: 260, y: 20 }, properties: {} },
      { id: 'yes', type: 'action', label: 'Continue', position: { x: 520, y: 0 }, properties: {} },
      { id: 'no', type: 'block', label: 'Wait', position: { x: 520, y: 180 }, properties: {} },
      { id: 'end', type: 'end', label: 'End', position: { x: 780, y: 80 }, properties: {} },
    ],
    edges: [
      { id: 'e1', from: { nodeId: 'start', portId: 'next' }, to: { nodeId: 'decision', portId: 'in' } },
      { id: 'e2', from: { nodeId: 'decision', portId: 'yes' }, to: { nodeId: 'yes', portId: 'in' }, label: 'YES' },
      { id: 'e3', from: { nodeId: 'decision', portId: 'no' }, to: { nodeId: 'no', portId: 'in' }, label: 'NO' },
      { id: 'e4', from: { nodeId: 'yes', portId: 'next' }, to: { nodeId: 'end', portId: 'in' } },
      { id: 'e5', from: { nodeId: 'no', portId: 'next' }, to: { nodeId: 'end', portId: 'in' } },
    ],
  });
}

describe('scenario graph domain', () => {
  it('creates immutable visual-only graph documents with a versioned schema', () => {
    const graph = createValidGraph();
    expect(graph.schemaVersion, 'new graph documents must declare the current schema version').toBe(1);
    expect(graph.status, 'authored graphs must never be implicitly executable').toBe('visual-only');
    expect(Object.isFrozen(graph), 'domain graph documents must be immutable').toBe(true);
  });

  it('moves one node without changing graph topology or mutating the source graph', () => {
    const graph = createValidGraph();
    const moved = moveGraphNode(graph, 'decision', { x: 300, y: 90 });
    expect(moved.nodes.find((node) => node.id === 'decision')?.position, 'the selected node must move to the requested coordinates').toEqual({ x: 300, y: 90 });
    expect(graph.nodes.find((node) => node.id === 'decision')?.position, 'moving a node must not mutate the previous graph snapshot').toEqual({ x: 260, y: 20 });
    expect(moved.edges, 'moving nodes must preserve every connection').toEqual(graph.edges);
  });

  it('rejects moves for unknown node identities', () => {
    expect(() => moveGraphNode(createValidGraph(), 'missing', { x: 0, y: 0 }), 'unknown node references must fail explicitly').toThrow('SCENARIO_GRAPH_NODE_NOT_FOUND');
  });

  it('connects compatible ports and preserves explicit decision branch labels', () => {
    const graph = createValidGraph();
    const connected = connectGraphNodes(graph, {
      id: 'e6',
      from: { nodeId: 'yes', portId: 'next' },
      to: { nodeId: 'no', portId: 'in' },
    });
    expect(connected.edges.some((edge) => edge.id === 'e6'), 'a valid output-to-input edge must be added').toBe(true);
    expect(() => connectGraphNodes(graph, {
      id: 'invalid',
      from: { nodeId: 'decision', portId: 'next' },
      to: { nodeId: 'yes', portId: 'in' },
    }), 'decision nodes must connect through declared yes/no ports only').toThrow('SCENARIO_GRAPH_PORT_INVALID');
  });

  it('deletes a node and all incident edges', () => {
    const graph = createValidGraph();
    const updated = deleteGraphNode(graph, 'decision');
    expect(updated.nodes.some((node) => node.id === 'decision'), 'the requested node must be removed').toBe(false);
    expect(updated.edges.some((edge) => edge.from.nodeId === 'decision' || edge.to.nodeId === 'decision'), 'deleting a node must remove its incident edges').toBe(false);
  });

  it('reports missing structure, unreachable nodes and incomplete decision branches', () => {
    const graph = createScenarioGraph({
      id: 'invalid',
      title: 'Invalid',
      source: { kind: 'manual', reference: 'draft' },
      nodes: [
        { id: 'start', type: 'start', label: 'Start', position: { x: 0, y: 0 }, properties: {} },
        { id: 'decision', type: 'decision', label: 'Decision', position: { x: 200, y: 0 }, properties: {} },
        { id: 'orphan', type: 'end', label: 'Orphan', position: { x: 400, y: 0 }, properties: {} },
      ],
      edges: [{ id: 'e1', from: { nodeId: 'start', portId: 'next' }, to: { nodeId: 'decision', portId: 'in' } }],
    });
    const issues = validateScenarioGraph(graph);
    expect(issues.map((issue) => issue.code), 'validation must report absent decision branches and unreachable nodes').toEqual(expect.arrayContaining([
      'SCENARIO_GRAPH_BRANCH_MISSING',
      'SCENARIO_GRAPH_NODE_UNREACHABLE',
    ]));
  });

  it('round-trips the versioned JSON schema without losing graph data', () => {
    const graph = createValidGraph();
    const restored = deserializeScenarioGraph(serializeScenarioGraph(graph));
    expect(restored, 'serialized graph documents must round-trip exactly').toEqual(graph);
  });

  it('rejects unsupported schema versions instead of silently reinterpreting them', () => {
    const graph = createValidGraph();
    const serialized = JSON.stringify({ ...graph, schemaVersion: 99 });
    expect(() => deserializeScenarioGraph(serialized), 'unknown schema versions must fail closed').toThrow('SCENARIO_GRAPH_SCHEMA_VERSION_UNSUPPORTED');
  });
});
