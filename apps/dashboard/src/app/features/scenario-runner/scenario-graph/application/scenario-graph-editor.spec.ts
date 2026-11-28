import { describe, expect, it } from 'vitest';
import { createScenarioGraphEditor, createScenarioGraphIdGenerator, createScenarioGraphViewModel } from './scenario-graph-editor';
import { createScenarioGraph, type ScenarioGraph } from '../domain/scenario-graph';

function createGraph(): ScenarioGraph {
  return createScenarioGraph({
    id: 'editor-graph',
    title: 'Editor graph',
    source: { kind: 'manual', reference: 'draft' },
    nodes: [
      { id: 'start', type: 'start', label: 'Start', position: { x: 0, y: 0 }, properties: {} },
      { id: 'end', type: 'end', label: 'End', position: { x: 240, y: 0 }, properties: {} },
    ],
    edges: [{ id: 'edge-1', from: { nodeId: 'start', portId: 'next' }, to: { nodeId: 'end', portId: 'in' } }],
  });
}

describe('scenario graph editor application', () => {
  it('creates deterministic IDs while avoiding reserved node and edge identities', () => {
    const createId = createScenarioGraphIdGenerator({ reservedIds: ['draft-1', 'draft-2'] });
    expect(createId(), 'the application ID generator must skip reserved identities').toBe('draft-3');
    expect(createId(), 'the application ID generator must advance deterministically').toBe('draft-4');
  });

  it('adds nodes using an injected deterministic ID generator', () => {
    const editor = createScenarioGraphEditor({ createId: () => 'node-2' });
    const result = editor.addNode({
      graph: createGraph(),
      node: { type: 'action', label: 'Inspect state', position: { x: 120, y: 160 }, properties: {} },
    });
    expect(result.nodes.some((node) => node.id === 'node-2'), 'the application must use its injected ID port').toBe(true);
  });

  it('prevents adding a second start node', () => {
    const editor = createScenarioGraphEditor({ createId: () => 'second-start' });
    expect(() => editor.addNode({
      graph: createGraph(),
      node: { type: 'start', label: 'Another start', position: { x: 0, y: 100 }, properties: {} },
    }), 'the graph must retain exactly one start node').toThrow('SCENARIO_GRAPH_START_COUNT_INVALID');
  });

  it('returns a validated draft and never exposes an execution or persistence operation', () => {
    const editor = createScenarioGraphEditor({ createId: () => 'node-2' });
    const result = editor.validate({ graph: createGraph() });
    expect(result.valid, 'a complete start-to-end graph must validate').toBe(true);
    expect(result.status, 'graph editor output must remain visual-only').toBe('visual-only');
    expect('execute' in editor, 'graph editing must not introduce an execution use case').toBe(false);
    expect('save' in editor, 'graph editing must not introduce persistence implicitly').toBe(false);
  });

  it('rejects duplicate generated identities rather than replacing an existing node', () => {
    const editor = createScenarioGraphEditor({ createId: () => 'start' });
    expect(() => editor.addNode({
      graph: createGraph(),
      node: { type: 'action', label: 'Duplicate', position: { x: 100, y: 100 }, properties: {} },
    }), 'duplicate node IDs must be rejected by the application boundary').toThrow('SCENARIO_GRAPH_NODE_ID_DUPLICATE');
  });

  it('creates connection identities through the injected ID generator', () => {
    const ids = ['extra-node', 'edge-2'];
    const editor = createScenarioGraphEditor({ createId: () => ids.shift() ?? 'unexpected-id' });
    const expanded = editor.addNode({
      graph: createGraph(),
      node: { type: 'action', label: 'Extra step', position: { x: 120, y: 100 }, properties: {} },
    });
    const graph = editor.connect({
      graph: expanded,
      from: { nodeId: 'extra-node', portId: 'next' },
      to: { nodeId: 'end', portId: 'in' },
    });
    expect(graph.edges[1]?.id, 'the application boundary must generate connection identities').toBe('edge-2');
  });

  it('suggests deterministic node positions outside the presentation component', () => {
    const editor = createScenarioGraphEditor({ createId: () => 'unused' });
    expect(editor.suggestNodePosition({ graph: createGraph() }), 'default graph placement belongs to the framework-neutral application').toEqual({ x: 540, y: 80 });
  });

  it('parses and validates node property maps in the application layer', () => {
    const editor = createScenarioGraphEditor({ createId: () => 'unused' });
    const updated = editor.updateNodeProperties({
      graph: createGraph(),
      nodeId: 'start',
      serializedProperties: '{"purpose":"entry","enabled":"yes"}',
    });
    expect(updated.nodes[0].properties, 'the application must map valid string properties into the domain model').toEqual({
      purpose: 'entry',
      enabled: 'yes',
    });
    expect(() => editor.updateNodeProperties({
      graph: createGraph(),
      nodeId: 'start',
      serializedProperties: '{"count":4}',
    }), 'non-string property values must be rejected').toThrow('SCENARIO_GRAPH_PROPERTIES_INVALID');
  });

  it('lays out scenario viewer nodes vertically with readable text and full-height geometry', () => {
    const view = createScenarioGraphViewModel({ graph: createGraph(), orientation: 'vertical' });

    expect(view.width, 'vertical graphs should use a wide canvas').toBe(1240);
    expect(view.height, 'canvas height should grow to contain every node').toBeGreaterThan(500);
    expect(view.nodes[0].position.x, 'nodes should share a centered vertical column').toBe(view.nodes[1].position.x);
    expect(view.nodes[1].position.y, 'each next node should appear below the previous node').toBeGreaterThan(view.nodes[0].position.y);
    expect(view.nodes[0].width, 'vertical nodes should use the available canvas width').toBe(1120);
    expect(view.nodes[0].labelLines, 'node labels should be laid out as readable lines').toEqual(['Start']);
    expect(view.edges[0].curve.start.x, 'vertical edges should leave from the bottom center').toBe(view.nodes[0].position.x + view.nodes[0].width / 2);
    expect(view.edges[0].curve.end.x, 'vertical edges should enter at the top center').toBe(view.nodes[1].position.x + view.nodes[1].width / 2);
    expect(view.edges[0].curve.end.y, 'vertical connectors should point down the canvas').toBeGreaterThan(view.edges[0].curve.start.y);
  });

  it('builds renderer-neutral geometry without importing a rendering framework', () => {
    const editor = createScenarioGraphEditor({ createId: () => 'unused' });
    const view = editor.viewModel({ graph: createGraph() });
    expect(view.nodes[0].width, 'the view model must expose node geometry to any renderer').toBeGreaterThan(0);
    expect(view.edges[0].curve.control1, 'the view model must expose renderer-neutral connector control points').toEqual({ x: 226, y: 41 });
  });
});
