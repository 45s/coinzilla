import { describe, expect, it } from 'vitest';
import { createScenarioGraphEditor } from './scenario-graph-editor';
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
  it('adds nodes using an injected deterministic ID generator', () => {
    const editor = createScenarioGraphEditor({ createId: () => 'node-2' });
    const result = editor.addNode({
      graph: createGraph(),
      node: { type: 'action', label: 'Inspect state', position: { x: 120, y: 160 }, properties: {} },
    });
    expect(result.nodes.some((node) => node.id === 'node-2'), 'the application must use its injected ID port').toBe(true);
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

  it('builds renderer-neutral geometry without importing a rendering framework', () => {
    const editor = createScenarioGraphEditor({ createId: () => 'unused' });
    const view = editor.viewModel({ graph: createGraph() });
    expect(view.nodes[0].width, 'the view model must expose node geometry to any renderer').toBeGreaterThan(0);
    expect(view.edges[0].curve.control1, 'the view model must expose renderer-neutral connector control points').toEqual({ x: 226, y: 41 });
  });
});
