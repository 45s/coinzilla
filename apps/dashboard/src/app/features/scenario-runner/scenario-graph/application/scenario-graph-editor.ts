import {
  connectGraphNodes,
  createScenarioGraph,
  deleteGraphNode,
  disconnectGraphEdge,
  moveGraphNode,
  serializeScenarioGraph,
  updateGraphNode,
  validateScenarioGraph,
  type ScenarioGraph,
  type ScenarioGraphEdge,
  type ScenarioGraphNode,
  type ScenarioGraphPosition,
} from '../domain/scenario-graph';

export interface ScenarioGraphNodeDraft {
  readonly type: ScenarioGraphNode['type'];
  readonly label: string;
  readonly description?: string;
  readonly position: ScenarioGraphPosition;
  readonly properties: Readonly<Record<string, string>>;
}

export interface ScenarioGraphViewNode extends ScenarioGraphNode {
  readonly width: number;
  readonly height: number;
  readonly input: { readonly x: number; readonly y: number } | null;
  readonly outputs: readonly { readonly id: string; readonly x: number; readonly y: number; readonly label: string | null }[];
}

export interface ScenarioGraphViewEdge extends ScenarioGraphEdge {
  readonly curve: {
    readonly start: { readonly x: number; readonly y: number };
    readonly control1: { readonly x: number; readonly y: number };
    readonly control2: { readonly x: number; readonly y: number };
    readonly end: { readonly x: number; readonly y: number };
  };
  readonly labelPosition: { readonly x: number; readonly y: number };
}

export interface ScenarioGraphViewModel {
  readonly width: number;
  readonly height: number;
  readonly nodes: readonly ScenarioGraphViewNode[];
  readonly edges: readonly ScenarioGraphViewEdge[];
}

export function createScenarioGraphViewModel({ graph }: { readonly graph: ScenarioGraph }): ScenarioGraphViewModel {
  const width = 190;
  const height = 82;
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const nodes = graph.nodes.map((node): ScenarioGraphViewNode => ({
    ...node,
    width,
    height,
    input: node.type === 'start' ? null : { x: node.position.x, y: node.position.y + height / 2 },
    outputs: node.type === 'end'
      ? []
      : node.type === 'decision'
        ? [
          { id: 'yes', x: node.position.x + width, y: node.position.y + 24, label: 'YES' },
          { id: 'no', x: node.position.x + width, y: node.position.y + 60, label: 'NO' },
        ]
        : [{ id: 'next', x: node.position.x + width, y: node.position.y + height / 2, label: null }],
  }));
  const edges = graph.edges.flatMap((edge): ScenarioGraphViewEdge[] => {
    const source = nodeById.get(edge.from.nodeId);
    const target = nodeById.get(edge.to.nodeId);
    if (!source || !target) {
      return [];
    }
    const sourceY = source.type === 'decision'
      ? source.position.y + (edge.from.portId === 'yes' ? 24 : 60)
      : source.position.y + height / 2;
    const targetY = target.position.y + height / 2;
    const startX = source.position.x + width;
    const endX = target.position.x;
    const controlX = startX + Math.max(36, (endX - startX) / 2);
    return [{
      ...edge,
      curve: {
        start: { x: startX, y: sourceY },
        control1: { x: controlX, y: sourceY },
        control2: { x: controlX, y: targetY },
        end: { x: endX, y: targetY },
      },
      labelPosition: { x: (startX + endX) / 2, y: (sourceY + targetY) / 2 - 10 },
    }];
  });
  const maxX = Math.max(900, ...nodes.map((node) => node.position.x + width + 40));
  const maxY = Math.max(520, ...nodes.map((node) => node.position.y + height + 40));
  return { width: maxX, height: maxY, nodes, edges };
}

export function createScenarioGraphIdGenerator({ reservedIds = [], prefix = 'draft' }: {
  readonly reservedIds?: readonly string[];
  readonly prefix?: string;
} = {}): () => string {
  let sequence = 1;
  const reserved = new Set(reservedIds);
  return () => {
    let id = `${prefix}-${sequence++}`;
    while (reserved.has(id)) {
      id = `${prefix}-${sequence++}`;
    }
    reserved.add(id);
    return id;
  };
}

export function createScenarioGraphEditor({ createId }: {
  readonly createId: () => string;
}) {
  return Object.freeze({
    suggestNodePosition({ graph }: { readonly graph: ScenarioGraph }): ScenarioGraphPosition {
      const index = graph.nodes.length;
      return { x: 80 + (index % 4) * 230, y: 80 + Math.floor(index / 4) * 130 };
    },

    addNode({ graph, node }: { readonly graph: ScenarioGraph; readonly node: ScenarioGraphNodeDraft }): ScenarioGraph {
      if (node.type === 'start' && graph.nodes.some((existing) => existing.type === 'start')) {
        throw new Error('SCENARIO_GRAPH_START_COUNT_INVALID');
      }
      const id = createId();
      if (graph.nodes.some((existing) => existing.id === id) || graph.edges.some((existing) => existing.id === id)) {
        throw new Error('SCENARIO_GRAPH_NODE_ID_DUPLICATE');
      }
      return createScenarioGraph({
        ...graph,
        nodes: [...graph.nodes, { ...node, id }],
      });
    },

    moveNode({ graph, nodeId, position }: {
      readonly graph: ScenarioGraph;
      readonly nodeId: string;
      readonly position: ScenarioGraphPosition;
    }): ScenarioGraph {
      return moveGraphNode(graph, nodeId, position);
    },

    connect({ graph, from, to, label }: { readonly graph: ScenarioGraph; readonly from: ScenarioGraphEdge['from']; readonly to: ScenarioGraphEdge['to']; readonly label?: string }): ScenarioGraph {
      return connectGraphNodes(graph, { id: createId(), from, to, label });
    },

    disconnect({ graph, edgeId }: { readonly graph: ScenarioGraph; readonly edgeId: string }): ScenarioGraph {
      return disconnectGraphEdge(graph, edgeId);
    },

    deleteNode({ graph, nodeId }: { readonly graph: ScenarioGraph; readonly nodeId: string }): ScenarioGraph {
      return deleteGraphNode(graph, nodeId);
    },

    updateNode({ graph, nodeId, changes }: {
      readonly graph: ScenarioGraph;
      readonly nodeId: string;
      readonly changes: { readonly label?: string; readonly description?: string; readonly properties?: Readonly<Record<string, string>> };
    }): ScenarioGraph {
      return updateGraphNode(graph, nodeId, changes);
    },

    updateNodeProperties({ graph, nodeId, serializedProperties }: {
      readonly graph: ScenarioGraph;
      readonly nodeId: string;
      readonly serializedProperties: string;
    }): ScenarioGraph {
      let parsed: unknown;
      try {
        parsed = JSON.parse(serializedProperties) as unknown;
      } catch {
        throw new Error('SCENARIO_GRAPH_PROPERTIES_JSON_INVALID');
      }
      if (
        parsed === null
        || typeof parsed !== 'object'
        || Array.isArray(parsed)
        || Object.values(parsed).some((value) => typeof value !== 'string')
      ) {
        throw new Error('SCENARIO_GRAPH_PROPERTIES_INVALID');
      }
      return updateGraphNode(graph, nodeId, { properties: parsed as Readonly<Record<string, string>> });
    },

    validate({ graph }: { readonly graph: ScenarioGraph }) {
      const issues = validateScenarioGraph(graph);
      return { valid: issues.length === 0, status: graph.status, issues };
    },

    serialize({ graph }: { readonly graph: ScenarioGraph }): string {
      return serializeScenarioGraph(graph);
    },

    viewModel({ graph }: { readonly graph: ScenarioGraph }): ScenarioGraphViewModel {
      return createScenarioGraphViewModel({ graph });
    },
  });
}
