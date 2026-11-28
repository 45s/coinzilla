export const SCENARIO_GRAPH_SCHEMA_VERSION = 1 as const;

export type ScenarioGraphNodeType =
  | 'start'
  | 'action'
  | 'decision'
  | 'wait'
  | 'reconciliation'
  | 'block'
  | 'end';

export interface ScenarioGraphPosition {
  readonly x: number;
  readonly y: number;
}

export interface ScenarioGraphNode {
  readonly id: string;
  readonly type: ScenarioGraphNodeType;
  readonly label: string;
  readonly description?: string;
  readonly position: ScenarioGraphPosition;
  readonly properties: Readonly<Record<string, string>>;
}

export interface ScenarioGraphEndpoint {
  readonly nodeId: string;
  readonly portId: string;
}

export interface ScenarioGraphEdge {
  readonly id: string;
  readonly from: ScenarioGraphEndpoint;
  readonly to: ScenarioGraphEndpoint;
  readonly label?: string;
}

export interface ScenarioGraphSource {
  readonly kind: 'manual' | 'rs-domain-specification';
  readonly reference: string;
}

export interface ScenarioGraph {
  readonly schemaVersion: typeof SCENARIO_GRAPH_SCHEMA_VERSION;
  readonly status: 'visual-only';
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly source: ScenarioGraphSource;
  readonly nodes: readonly ScenarioGraphNode[];
  readonly edges: readonly ScenarioGraphEdge[];
}

export interface ScenarioGraphIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

const NODE_PORTS: Readonly<Record<ScenarioGraphNodeType, {
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
}>> = Object.freeze({
  start: { inputs: [], outputs: ['next'] },
  action: { inputs: ['in'], outputs: ['next'] },
  decision: { inputs: ['in'], outputs: ['yes', 'no'] },
  wait: { inputs: ['in'], outputs: ['next'] },
  reconciliation: { inputs: ['in'], outputs: ['next'] },
  block: { inputs: ['in'], outputs: ['next'] },
  end: { inputs: ['in'], outputs: [] },
});

function freezeGraph(graph: ScenarioGraph): ScenarioGraph {
  for (const node of graph.nodes) {
    Object.freeze(node.position);
    Object.freeze(node.properties);
    Object.freeze(node);
  }
  for (const edge of graph.edges) {
    Object.freeze(edge.from);
    Object.freeze(edge.to);
    Object.freeze(edge);
  }
  Object.freeze(graph.source);
  Object.freeze(graph.nodes);
  Object.freeze(graph.edges);
  return Object.freeze(graph);
}

function copyGraph(graph: ScenarioGraph, changes: Partial<Pick<ScenarioGraph, 'nodes' | 'edges'>>): ScenarioGraph {
  return freezeGraph({ ...graph, ...changes });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertGraphShape(value: unknown): asserts value is ScenarioGraph {
  if (!isRecord(value) || value['schemaVersion'] !== SCENARIO_GRAPH_SCHEMA_VERSION) {
    throw new Error('SCENARIO_GRAPH_SCHEMA_VERSION_UNSUPPORTED');
  }
  if (
    value['status'] !== 'visual-only'
    || typeof value['id'] !== 'string'
    || typeof value['title'] !== 'string'
    || !isRecord(value['source'])
    || !Array.isArray(value['nodes'])
    || !Array.isArray(value['edges'])
  ) {
    throw new Error('SCENARIO_GRAPH_DOCUMENT_INVALID');
  }
  const source = value['source'];
  if (
    (source['kind'] !== 'manual' && source['kind'] !== 'rs-domain-specification')
    || typeof source['reference'] !== 'string'
  ) {
    throw new Error('SCENARIO_GRAPH_SOURCE_INVALID');
  }
  for (const node of value['nodes']) {
    if (
      !isRecord(node)
      || typeof node['id'] !== 'string'
      || typeof node['type'] !== 'string'
      || !(node['type'] in NODE_PORTS)
      || typeof node['label'] !== 'string'
      || !isRecord(node['position'])
      || typeof node['position']['x'] !== 'number'
      || typeof node['position']['y'] !== 'number'
      || !isRecord(node['properties'])
      || Object.values(node['properties']).some((item) => typeof item !== 'string')
    ) {
      throw new Error('SCENARIO_GRAPH_NODE_INVALID');
    }
  }
  for (const edge of value['edges']) {
    if (
      !isRecord(edge)
      || typeof edge['id'] !== 'string'
      || !isRecord(edge['from'])
      || typeof edge['from']['nodeId'] !== 'string'
      || typeof edge['from']['portId'] !== 'string'
      || !isRecord(edge['to'])
      || typeof edge['to']['nodeId'] !== 'string'
      || typeof edge['to']['portId'] !== 'string'
      || (edge['label'] !== undefined && typeof edge['label'] !== 'string')
    ) {
      throw new Error('SCENARIO_GRAPH_EDGE_INVALID');
    }
  }
}

export function createScenarioGraph(input: {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly source: ScenarioGraphSource;
  readonly nodes: readonly ScenarioGraphNode[];
  readonly edges: readonly ScenarioGraphEdge[];
}): ScenarioGraph {
  return freezeGraph({
    schemaVersion: SCENARIO_GRAPH_SCHEMA_VERSION,
    status: 'visual-only',
    ...input,
    nodes: input.nodes.map((node) => ({
      ...node,
      position: { ...node.position },
      properties: { ...node.properties },
    })),
    edges: input.edges.map((edge) => ({
      ...edge,
      from: { ...edge.from },
      to: { ...edge.to },
    })),
    source: { ...input.source },
  });
}

export function getScenarioGraphPorts(type: ScenarioGraphNodeType): {
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
} {
  return NODE_PORTS[type];
}

export function moveGraphNode(
  graph: ScenarioGraph,
  nodeId: string,
  position: ScenarioGraphPosition,
): ScenarioGraph {
  if (!graph.nodes.some((node) => node.id === nodeId)) {
    throw new Error('SCENARIO_GRAPH_NODE_NOT_FOUND');
  }
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || position.x < 0 || position.y < 0) {
    throw new Error('SCENARIO_GRAPH_POSITION_INVALID');
  }
  return copyGraph(graph, {
    nodes: graph.nodes.map((node) => node.id === nodeId
      ? { ...node, position: { ...position } }
      : node),
  });
}

export function connectGraphNodes(graph: ScenarioGraph, edge: ScenarioGraphEdge): ScenarioGraph {
  if (graph.edges.some((existing) => existing.id === edge.id)) {
    throw new Error('SCENARIO_GRAPH_EDGE_ID_DUPLICATE');
  }
  const source = graph.nodes.find((node) => node.id === edge.from.nodeId);
  const target = graph.nodes.find((node) => node.id === edge.to.nodeId);
  if (!source || !target) {
    throw new Error('SCENARIO_GRAPH_ENDPOINT_NOT_FOUND');
  }
  const sourcePorts = NODE_PORTS[source.type];
  const targetPorts = NODE_PORTS[target.type];
  if (!sourcePorts.outputs.includes(edge.from.portId) || !targetPorts.inputs.includes(edge.to.portId)) {
    throw new Error('SCENARIO_GRAPH_PORT_INVALID');
  }
  if (graph.edges.some((existing) => existing.from.nodeId === edge.from.nodeId && existing.from.portId === edge.from.portId)) {
    throw new Error('SCENARIO_GRAPH_OUTPUT_ALREADY_CONNECTED');
  }
  const label = source.type === 'decision'
    ? edge.from.portId.toUpperCase()
    : edge.label;
  return copyGraph(graph, {
    edges: [...graph.edges, { ...edge, label, from: { ...edge.from }, to: { ...edge.to } }],
  });
}

export function deleteGraphNode(graph: ScenarioGraph, nodeId: string): ScenarioGraph {
  if (!graph.nodes.some((node) => node.id === nodeId)) {
    throw new Error('SCENARIO_GRAPH_NODE_NOT_FOUND');
  }
  return copyGraph(graph, {
    nodes: graph.nodes.filter((node) => node.id !== nodeId),
    edges: graph.edges.filter((edge) => edge.from.nodeId !== nodeId && edge.to.nodeId !== nodeId),
  });
}

export function updateGraphNode(
  graph: ScenarioGraph,
  nodeId: string,
  changes: { readonly label?: string; readonly description?: string; readonly properties?: Readonly<Record<string, string>> },
): ScenarioGraph {
  if (!graph.nodes.some((node) => node.id === nodeId)) {
    throw new Error('SCENARIO_GRAPH_NODE_NOT_FOUND');
  }
  if (changes.label !== undefined && changes.label.trim().length === 0) {
    throw new Error('SCENARIO_GRAPH_LABEL_INVALID');
  }
  return copyGraph(graph, {
    nodes: graph.nodes.map((node) => node.id === nodeId
      ? { ...node, ...changes, properties: changes.properties ? { ...changes.properties } : node.properties }
      : node),
  });
}

export function validateScenarioGraph(graph: ScenarioGraph): readonly ScenarioGraphIssue[] {
  const issues: ScenarioGraphIssue[] = [];
  const nodeById = new Map<string, ScenarioGraphNode>();
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  const usedOutputs = new Set<string>();
  const startNodes = graph.nodes.filter((node) => node.type === 'start');
  const endNodes = graph.nodes.filter((node) => node.type === 'end');

  if (startNodes.length !== 1) {
    issues.push({ code: 'SCENARIO_GRAPH_START_COUNT_INVALID', path: 'nodes', message: 'A graph must contain exactly one start node.' });
  }
  if (endNodes.length === 0) {
    issues.push({ code: 'SCENARIO_GRAPH_END_MISSING', path: 'nodes', message: 'A graph must contain at least one end node.' });
  }

  graph.nodes.forEach((node, index) => {
    if (nodeIds.has(node.id)) {
      issues.push({ code: 'SCENARIO_GRAPH_NODE_ID_DUPLICATE', path: `nodes[${index}].id`, message: `Node ID ${node.id} is duplicated.` });
    }
    nodeIds.add(node.id);
    nodeById.set(node.id, node);
    if (!Number.isFinite(node.position.x) || !Number.isFinite(node.position.y) || node.position.x < 0 || node.position.y < 0) {
      issues.push({ code: 'SCENARIO_GRAPH_POSITION_INVALID', path: `nodes[${index}].position`, message: 'Node coordinates must be finite non-negative numbers.' });
    }
    if (!node.label.trim()) {
      issues.push({ code: 'SCENARIO_GRAPH_LABEL_INVALID', path: `nodes[${index}].label`, message: 'Node labels cannot be empty.' });
    }
    outgoing.set(node.id, []);
    incoming.set(node.id, 0);
  });

  graph.edges.forEach((edge, index) => {
    if (edgeIds.has(edge.id)) {
      issues.push({ code: 'SCENARIO_GRAPH_EDGE_ID_DUPLICATE', path: `edges[${index}].id`, message: `Edge ID ${edge.id} is duplicated.` });
    }
    edgeIds.add(edge.id);
    const source = nodeById.get(edge.from.nodeId);
    const target = nodeById.get(edge.to.nodeId);
    if (!source || !target) {
      issues.push({ code: 'SCENARIO_GRAPH_ENDPOINT_NOT_FOUND', path: `edges[${index}]`, message: 'Every edge must reference existing source and target nodes.' });
      return;
    }
    if (!NODE_PORTS[source.type].outputs.includes(edge.from.portId) || !NODE_PORTS[target.type].inputs.includes(edge.to.portId)) {
      issues.push({ code: 'SCENARIO_GRAPH_PORT_INVALID', path: `edges[${index}]`, message: 'Edge endpoints must use compatible declared ports.' });
      return;
    }
    const outputKey = `${source.id}:${edge.from.portId}`;
    if (usedOutputs.has(outputKey)) {
      issues.push({ code: 'SCENARIO_GRAPH_OUTPUT_ALREADY_CONNECTED', path: `edges[${index}].from`, message: 'An output port may have only one outgoing connection.' });
    }
    usedOutputs.add(outputKey);
    if (source.type === 'decision' && edge.label !== edge.from.portId.toUpperCase()) {
      issues.push({ code: 'SCENARIO_GRAPH_BRANCH_LABEL_INVALID', path: `edges[${index}].label`, message: 'Decision branches must be labelled YES or NO to match their output port.' });
    }
    outgoing.get(source.id)?.push(target.id);
    incoming.set(target.id, (incoming.get(target.id) ?? 0) + 1);
  });

  for (const node of graph.nodes) {
    if (node.type === 'decision') {
      for (const port of NODE_PORTS.decision.outputs) {
        if (!usedOutputs.has(`${node.id}:${port}`)) {
          issues.push({ code: 'SCENARIO_GRAPH_BRANCH_MISSING', path: `nodes.${node.id}.ports.${port}`, message: `Decision node is missing its ${port.toUpperCase()} branch.` });
        }
      }
    }
    if (node.type === 'start' && (incoming.get(node.id) ?? 0) > 0) {
      issues.push({ code: 'SCENARIO_GRAPH_START_HAS_INPUT', path: `nodes.${node.id}`, message: 'The start node cannot have incoming edges.' });
    }
    if (node.type === 'end' && (outgoing.get(node.id)?.length ?? 0) > 0) {
      issues.push({ code: 'SCENARIO_GRAPH_END_HAS_OUTPUT', path: `nodes.${node.id}`, message: 'The end node cannot have outgoing edges.' });
    }
  }

  if (startNodes.length === 1) {
    const reachable = new Set<string>();
    const queue = [startNodes[0].id];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      if (reachable.has(current)) {
        continue;
      }
      reachable.add(current);
      queue.push(...(outgoing.get(current) ?? []));
    }
    graph.nodes.forEach((node, index) => {
      if (!reachable.has(node.id)) {
        issues.push({ code: 'SCENARIO_GRAPH_NODE_UNREACHABLE', path: `nodes[${index}]`, message: `Node ${node.id} is not reachable from the start node.` });
      }
    });
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (nodeId: string): boolean => {
      if (visiting.has(nodeId)) {
        return true;
      }
      if (visited.has(nodeId)) {
        return false;
      }
      visiting.add(nodeId);
      for (const targetId of outgoing.get(nodeId) ?? []) {
        if (visit(targetId)) {
          return true;
        }
      }
      visiting.delete(nodeId);
      visited.add(nodeId);
      return false;
    };
    if (visit(startNodes[0].id)) {
      issues.push({ code: 'SCENARIO_GRAPH_CYCLE_UNSUPPORTED', path: 'edges', message: 'Cycles are not supported by this graph schema.' });
    }
  }

  return issues;
}

export function serializeScenarioGraph(graph: ScenarioGraph): string {
  return JSON.stringify(graph, null, 2);
}

export function deserializeScenarioGraph(serialized: string): ScenarioGraph {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch {
    throw new Error('SCENARIO_GRAPH_JSON_INVALID');
  }
  assertGraphShape(parsed);
  return createScenarioGraph(parsed);
}
