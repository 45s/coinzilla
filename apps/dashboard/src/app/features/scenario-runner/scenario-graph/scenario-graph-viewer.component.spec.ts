import { describe, expect, it } from 'vitest';
import { createScenarioGuideGraph } from './adapters/scenario-guide-graph';
import { createScenarioGraphViewModel } from './application/scenario-graph-editor';
import { validateScenarioGraph } from './domain/scenario-graph';
import type { ScenarioGuide } from '../core/scenario-guides';

const guide: ScenarioGuide = {
  availability: 'EXECUTABLE',
  purpose: 'Prove the expected scenario path.',
  startingState: 'A seeded state.',
  injectedCondition: 'The broker rejects the order.',
  expectedOutcome: 'The run fails closed.',
  limitations: ['Simulation only.'],
  steps: [
    { id: 'start', kind: 'start', label: 'Seed state', detail: 'Create the isolated state.' },
    { id: 'failure', kind: 'injected-failure', label: 'Broker rejects SELL', detail: 'The simulated broker returns a rejection.' },
    { id: 'outcome', kind: 'outcome', label: 'Fail closed', detail: 'No accepted order is reported.' },
  ],
};

describe('scenario guide graph projection', () => {
  it('builds a scenario-specific read-only graph from published guide steps', () => {
    const graph = createScenarioGuideGraph({ scenarioId: 'RS-EXAMPLE-001', scenarioName: 'Example recovery scenario', guide });
    const view = createScenarioGraphViewModel({ graph });

    expect(graph.id).toBe('scenario-guide-RS-EXAMPLE-001');
    expect(graph.title).toBe('Example recovery scenario');
    expect(graph.nodes.map((node) => node.label)).toEqual(['Seed state', 'Broker rejects SELL', 'Fail closed']);
    expect(graph.nodes.map((node) => node.type)).toEqual(['start', 'block', 'end']);
    expect(graph.edges).toHaveLength(2);
    expect(validateScenarioGraph(graph)).toEqual([]);
    expect(view.nodes).toHaveLength(3);
    expect(graph.source.kind).toBe('scenario-guide');
  });

  it('does not invent decision branches when the guide publishes ordered steps only', () => {
    const graph = createScenarioGuideGraph({ scenarioId: 'RS-EXAMPLE-001', guide });
    expect(graph.edges.some((edge) => edge.label === 'YES' || edge.label === 'NO')).toBe(false);
    expect(graph.limitations).toContain('The guide publishes ordered steps, not branch topology. No conditional edges are inferred.');
  });
});
