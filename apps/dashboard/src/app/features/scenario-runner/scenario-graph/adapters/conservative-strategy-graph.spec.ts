import { describe, expect, it } from 'vitest';
import { createConservativeStrategyGraph } from './conservative-strategy-graph';
import { validateScenarioGraph } from '../domain/scenario-graph';
import { createScenarioGraphViewModel } from '../application/scenario-graph-editor';

describe('CG Conservative strategy graph adapter', () => {
  it('maps the canonical recovery algorithm into a valid branched visual-only flow', () => {
    const graph = createConservativeStrategyGraph();
    expect(validateScenarioGraph(graph), 'every declared branch and outcome must satisfy the graph contract').toEqual([]);
    expect(graph.status, 'the strategy flow is a visual explanation, not an executor').toBe('visual-only');
    expect(graph.source.reference, 'the graph must identify the sole Conservative behavior authority').toContain('CONSERVATIVE_DOMAIN_SPECIFICATION.md#9');
    expect(graph.nodes.filter((node) => node.type === 'decision').length, 'the flow should show real policy and lifecycle decisions').toBeGreaterThanOrEqual(9);
    expect(graph.edges.filter((edge) => edge.from.nodeId === 'active-sell'), 'active SELL admission must have YES and NO branches').toHaveLength(2);
    expect(graph.nodes.some((node) => node.label.startsWith('Declared event')), 'scenario metadata events must not be rendered as flow conditions').toBe(false);
  });

  it('uses the branched tree layout for YES and NO paths', () => {
    const graph = createConservativeStrategyGraph();
    const view = createScenarioGraphViewModel({ graph, orientation: 'tree' });
    const decision = view.nodes.find((node) => node.id === 'active-sell');
    const yesPath = view.nodes.find((node) => node.id === 'cancel-active-sell');
    const noPath = view.nodes.find((node) => node.id === 'plan-initial-sell');
    const branches = view.edges.filter((edge) => edge.from.nodeId === 'active-sell');

    expect(view.width, 'tree canvas must fit three branch lanes').toBe(1120);
    expect(yesPath?.position.x, 'the YES branch occupies the left lane').toBeLessThan(decision?.position.x ?? 0);
    expect(noPath?.position.x, 'the NO branch occupies the right lane').toBeGreaterThan(decision?.position.x ?? 0);
    expect(branches.map((edge) => edge.label).sort(), 'branch labels must remain attached to their source decisions').toEqual(['NO', 'YES']);
    expect(view.height, 'the canvas must include the full Conservative flow').toBeGreaterThan(4500);
  });
});
