import { describe, expect, it } from 'vitest';
import { createRecoverySellerGraph } from './recovery-seller-graph';
import { validateScenarioGraph } from '../domain/scenario-graph';

describe('Recovery Seller scenario graph adapter', () => {
  it('maps the documented recovery cycle into a valid visual-only graph', () => {
    const graph = createRecoverySellerGraph();
    const issues = validateScenarioGraph(graph);

    expect(issues, 'every sample graph node and connection must satisfy the graph contract').toEqual([]);
    expect(graph.status, 'the source-derived graph must never be executable').toBe('visual-only');
    expect(graph.source.reference, 'the graph must retain its canonical RS specification source').toContain('recovery-seller-domain-specification.md');
    expect(graph.limitations.length, 'the graph must disclose the limits of the represented RS behavior').toBeGreaterThan(0);
  });

  it('preserves the one-SELL-per-cycle and investment-only STOP invariants', () => {
    const graph = createRecoverySellerGraph();
    const sellNode = graph.nodes.find((node) => node.id === 'sell');
    const stopNode = graph.nodes.find((node) => node.id === 'blocked');

    expect(sellNode?.description, 'the SELL action must explicitly preserve the sole SELL lifecycle invariant').toContain('One SELL order lifecycle per recovery cycle');
    expect(stopNode?.description, 'STOP must not be presented as a blanket prohibition on a valid first recovery SELL').toContain('blocks additional BUY spending only');
  });
});
