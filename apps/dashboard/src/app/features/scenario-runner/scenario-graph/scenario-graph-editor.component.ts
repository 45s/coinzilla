import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import {
  createScenarioGraphEditor,
  createScenarioGraphIdGenerator,
  type ScenarioGraphViewModel,
} from './application/scenario-graph-editor';
import { createRecoverySellerGraph } from './adapters/recovery-seller-graph';
import type { ScenarioGraphNode, ScenarioGraphNodeType } from './domain/scenario-graph';

interface ActiveDrag {
  readonly nodeId: string;
  readonly offsetX: number;
  readonly offsetY: number;
}

@Component({
  selector: 'app-scenario-graph-editor',
  standalone: true,
  templateUrl: './scenario-graph-editor.component.html',
  styleUrl: './scenario-graph-editor.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScenarioGraphEditorComponent {
  private activeDrag: ActiveDrag | null = null;
  private readonly initialGraph = createRecoverySellerGraph();
  readonly graph = signal(this.initialGraph);
  private readonly editor = createScenarioGraphEditor({
    createId: createScenarioGraphIdGenerator({
      reservedIds: [
        ...this.initialGraph.nodes.map((node) => node.id),
        ...this.initialGraph.edges.map((edge) => edge.id),
      ],
    }),
  });
  readonly selectedNodeId = signal<string | null>('start');
  readonly selectedEdgeId = signal<string | null>(null);
  readonly hoveredNodeId = signal<string | null>(null);
  readonly pendingConnection = signal<{ readonly nodeId: string; readonly portId: string } | null>(null);
  readonly addNodeType = signal<ScenarioGraphNodeType>('action');\n  readonly canAddStart = computed(() => !this.graph().nodes.some((node) => node.type === 'start'));
  readonly error = signal<string | null>(null);
  readonly validation = computed(() => this.editor.validate({ graph: this.graph() }));
  readonly viewModel = computed<ScenarioGraphViewModel>(() => this.editor.viewModel({ graph: this.graph() }));
  readonly selectedNode = computed(() => this.graph().nodes.find((node) => node.id === this.selectedNodeId()) ?? null);
  readonly selectedNodePropertiesJson = computed(() => JSON.stringify(this.selectedNode()?.properties ?? {}, null, 2));
  readonly serializedGraph = computed(() => this.editor.serialize({ graph: this.graph() }));

  setNodeType(value: string): void {
    const supported: readonly string[] = ['start', 'action', 'decision', 'wait', 'reconciliation', 'block', 'end'];
    if (supported.includes(value) && (value !== 'start' || this.canAddStart())) {
      this.addNodeType.set(value as ScenarioGraphNodeType);
    }
  }

  addNode(): void {
    try {
      const graph = this.editor.addNode({
        graph: this.graph(),
        node: {
          type: this.addNodeType(),
          label: this.addNodeType() === 'decision' ? 'New condition' : this.addNodeType() === 'start' ? 'Start' : this.addNodeType() === 'end' ? 'New outcome' : 'New step',
          description: 'Draft node. Edit its description before using this graph as documentation.',
          position: this.editor.suggestNodePosition({ graph: this.graph() }),
          properties: {},
        },
      });
      this.graph.set(graph);
      this.selectedNodeId.set(graph.nodes[graph.nodes.length - 1].id);
      this.error.set(null);
    } catch (error) {
      this.showError(error);
    }
  }

  resetExample(): void {
    this.graph.set(createRecoverySellerGraph());
    this.selectedNodeId.set('start');
    this.selectedEdgeId.set(null);
    this.pendingConnection.set(null);
    this.error.set(null);
  }

  selectNode(nodeId: string): void {
    this.selectedNodeId.set(nodeId);
    this.selectedEdgeId.set(null);
  }

  onEdgeKeydown(event: KeyboardEvent, edgeId: string): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.selectEdge(edgeId);
    }
  }

  selectEdge(edgeId: string): void {
    this.selectedEdgeId.set(edgeId);
    this.selectedNodeId.set(null);
  }

  deleteSelectedEdge(): void {
    const edgeId = this.selectedEdgeId();
    if (!edgeId) {
      return;
    }
    try {
      this.graph.set(this.editor.disconnect({ graph: this.graph(), edgeId }));
      this.selectedEdgeId.set(null);
      this.error.set(null);
    } catch (error) {
      this.showError(error);
    }
  }

  onOutputPortKeydown(event: KeyboardEvent, nodeId: string, portId: string): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.pendingConnection.set({ nodeId, portId });
    }
  }

  onInputPortKeydown(event: KeyboardEvent, nodeId: string): void {
    if ((event.key === 'Enter' || event.key === ' ') && this.pendingConnection()) {
      event.preventDefault();
      this.onInputPointerUp(event as unknown as PointerEvent, nodeId);
    }
  }

  onNodeKeydown(event: KeyboardEvent, node: ScenarioGraphNode): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.selectNode(node.id);
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.deleteNode(node.id);
    }
  }

  onNodePointerDown(event: PointerEvent, node: ScenarioGraphNode): void {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    this.selectNode(node.id);
    const point = this.getCanvasPoint(event);
    this.activeDrag = {
      nodeId: node.id,
      offsetX: point.x - node.position.x,
      offsetY: point.y - node.position.y,
    };
    this.capturePointer(event);
  }

  onOutputPointerDown(event: PointerEvent, nodeId: string, portId: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.pendingConnection.set({ nodeId, portId });
  }

  onInputPointerUp(event: PointerEvent, nodeId: string): void {
    event.preventDefault();
    event.stopPropagation();
    const source = this.pendingConnection();
    if (!source) {
      return;
    }
    try {
      this.graph.set(this.editor.connect({
        graph: this.graph(),
        from: source,
        to: { nodeId, portId: 'in' },
      }));
      this.error.set(null);
    } catch (error) {
      this.showError(error);
    } finally {
      this.pendingConnection.set(null);
    }
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.activeDrag) {
      return;
    }
    const point = this.getCanvasPoint(event);
    try {
      this.graph.set(this.editor.moveNode({
        graph: this.graph(),
        nodeId: this.activeDrag.nodeId,
        position: {
          x: Math.max(0, point.x - this.activeDrag.offsetX),
          y: Math.max(0, point.y - this.activeDrag.offsetY),
        },
      }));
    } catch (error) {
      this.showError(error);
    }
  }

  onPointerUp(): void {
    this.activeDrag = null;
    this.pendingConnection.set(null);
  }

  updateSelectedLabel(value: string): void {
    this.updateSelectedNode({ label: value });
  }

  updateSelectedDescription(value: string): void {
    this.updateSelectedNode({ description: value });
  }

  deleteSelectedNode(): void {
    const nodeId = this.selectedNodeId();
    if (nodeId) {
      this.deleteNode(nodeId);
    }
  }

  deleteNode(nodeId: string): void {
    try {
      this.graph.set(this.editor.deleteNode({ graph: this.graph(), nodeId }));
      this.selectedNodeId.set(null);
      this.error.set(null);
    } catch (error) {
      this.showError(error);
    }
  }

  trackNode(_index: number, node: ScenarioGraphNode): string {
    return node.id;
  }

  edgePath(edge: ScenarioGraphViewModel['edges'][number]): string {
    const { start, control1, control2, end } = edge.curve;
    return `M ${start.x} ${start.y} C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${end.x} ${end.y}`;
  }

  trackEdge(_index: number, edge: { readonly id: string }): string {
    return edge.id;
  }

  private updateSelectedNode(changes: { readonly label?: string; readonly description?: string }): void {
    const nodeId = this.selectedNodeId();
    if (!nodeId) {
      return;
    }
    try {
      this.graph.set(this.editor.updateNode({ graph: this.graph(), nodeId, changes }));
      this.error.set(null);
    } catch (error) {
      this.showError(error);
    }
  }

  private capturePointer(event: PointerEvent): void {
    const target = event.currentTarget;
    const svg = target instanceof SVGSVGElement
      ? target
      : target instanceof SVGElement
        ? target.ownerSVGElement
        : target instanceof Element
          ? target.closest('svg') as SVGSVGElement | null
          : null;
    if (svg && typeof svg.setPointerCapture === 'function') {
      svg.setPointerCapture(event.pointerId);
    }
  }

  private getCanvasPoint(event: PointerEvent): { readonly x: number; readonly y: number } {
    const svg = (event.currentTarget as Element).closest('svg');
    const rect = svg?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) {
      return { x: 0, y: 0 };
    }
    const view = this.viewModel();
    return {
      x: (event.clientX - rect.left) * view.width / rect.width,
      y: (event.clientY - rect.top) * view.height / rect.height,
    };
  }

  private showError(error: unknown): void {
    this.error.set(error instanceof Error ? error.message : 'Graph operation failed.');
  }
}
