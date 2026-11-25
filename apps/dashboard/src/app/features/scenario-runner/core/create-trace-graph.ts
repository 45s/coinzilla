import type { ScenarioGraphModel, ScenarioTraceStep } from './run-contract';

export function createTraceGraph(trace: readonly ScenarioTraceStep[]): ScenarioGraphModel {
  if (!Array.isArray(trace)) {
    throw new TypeError('Scenario trace must be an ordered array.');
  }
  const ids = new Set<string>();
  const nodes = trace.map((step, index) => {
    if (!step || typeof step.id !== 'string' || !step.id.trim() ||
        typeof step.kind !== 'string' || typeof step.label !== 'string') {
      throw new TypeError(`Scenario trace step ${index} is malformed.`);
    }
    if (ids.has(step.id)) {
      throw new Error(`Scenario trace contains duplicate step ID "${step.id}".`);
    }
    ids.add(step.id);
    return Object.freeze({ id: step.id, label: step.label, kind: step.kind, step });
  });
  const edges = nodes.slice(1).map((node, index) => Object.freeze({
    from: nodes[index].id,
    to: node.id,
  }));
  return Object.freeze({
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
  });
}
