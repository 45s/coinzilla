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
  readonly path: string;
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
      path: `M ${startX} ${sourceY} C ${controlX} ${sourceY}, ${controlX} ${targetY}, ${endX} ${targetY}`,
      labelPosition: { x: (startX + endX) / 2, y: (sourceY + targetY) / 2 - 10 },
    }];
  });
  const maxX = Math.max(900, ...nodes.map((node) => node.position.x + width + 40));
  const maxY = Math.max(520, ...nodes.map((node) => node.position.y + height + 40));
  return { width: maxX, height: maxY, nodes, edges };
}

export function createScenarioGraphEditor({ createId }: {
  readonly createId: () => string;
}) {
  return Object.freeze({
    addNode({ graph, node }: { readonly graph: ScenarioGraph; readonly node: ScenarioGraphNodeDraft }): ScenarioGraph {
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

    connect({ graph, edge }: { readonly graph: ScenarioGraph; readonly edge: ScenarioGraphEdge }): ScenarioGraph {
      return connectGraphNodes(graph, edge);
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
