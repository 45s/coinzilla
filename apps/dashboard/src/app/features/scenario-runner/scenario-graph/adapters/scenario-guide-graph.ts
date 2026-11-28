import type { ScenarioGuide } from '../../core/scenario-guides';
import { createScenarioGraph, type ScenarioGraphNodeType } from '../domain/scenario-graph';

function nodeType(kind: ScenarioGuide['steps'][number]['kind'], index: number, count: number): ScenarioGraphNodeType {
  if (index === 0 || kind === 'start') {
    return 'start';
  }
  if (index === count - 1) {
    return 'end';
  }
  if (kind === 'injected-failure') {
    return 'block';
  }
  if (kind === 'condition') {
    return 'wait';
  }
  return 'action';
}

/**
 * Projects only the ordered steps published by a scenario's reviewed guide.
 * It deliberately does not invent decision branches: the guide contract has no
 * source-declared branch topology.
 */
export function createScenarioGuideGraph({ scenarioId, guide }: {
  readonly scenarioId: string;
  readonly guide: ScenarioGuide;
}) {
  const nodes = guide.steps.map((step, index) => ({
    id: step.id,
    type: nodeType(step.kind, index, guide.steps.length),
    label: step.label,
    description: step.detail,
    position: { x: 30 + index * 240, y: 210 },
    properties: { guideKind: step.kind },
  }));
  const edges = guide.steps.slice(1).map((step, index) => ({
    id: `${guide.steps[index].id}-to-${step.id}`,
    from: { nodeId: guide.steps[index].id, portId: 'next' },
    to: { nodeId: step.id, portId: 'in' },
  }));

  return createScenarioGraph({
    id: `scenario-guide-${scenarioId}`,
    title: scenarioId,
    description: guide.purpose,
    source: {
      kind: 'scenario-guide',
      reference: `apps/dashboard/src/app/features/scenario-runner/core/scenario-guides.ts#${scenarioId}`,
    },
    limitations: [
      'Expected scenario intent only; this graph is not an execution trace.',
      'The guide publishes ordered steps, not branch topology. No conditional edges are inferred.',
      ...guide.limitations,
    ],
    nodes,
    edges,
  });
}
