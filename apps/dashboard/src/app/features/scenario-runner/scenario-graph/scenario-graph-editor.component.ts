import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import {
  createScenarioGraphEditor,
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
  private nextId = 1;
  private activeDrag: ActiveDrag | null = null;
  private readonly editor = createScenarioGraphEditor({
    createId: () => `draft-node-${this.nextId++}`,
  });

  readonly graph = signal(createRecoverySellerGraph());
  readonly selectedNodeId = signal<string | null>('start');
  readonly hoveredNodeId = signal<string | null>(null);
  readonly pendingConnection = signal<{ readonly nodeId: string; readonly portId: string } | null>(null);
  readonly addNodeType = signal<ScenarioGraphNodeType>('action');
  readonly error = signal<string | null>(null);
  readonly validation = computed(() => this.editor.validate({ graph: this.graph() }));
  readonly viewModel = computed<ScenarioGraphViewModel>(() => this.editor.viewModel({ graph: this.graph() }));
  readonly selectedNode = computed(() => this.graph().nodes.find((node) => node.id === this.selectedNodeId()) ?? null);
  readonly serializedGraph = computed(() => this.editor.serialize({ graph: this.graph() }));

  setNodeType(value: string): void {
    const supported: readonly string[] = ['action', 'decision', 'wait', 'reconciliation', 'block'];
    if (supported.includes(value)) {
      this.addNodeType.set(value as ScenarioGraphNodeType);
    }
  }

  addNode(): void {
    const index = this.nextId;
    try {
      const graph = this.editor.addNode({
        graph: this.graph(),
        node: {
          type: this.addNodeType(),
          label: this.addNodeType() === 'decision' ? 'New condition' : 'New step',
          description: 'Draft node. Edit its description before using this graph as documentation.',
          position: { x: 80 + (index % 4) * 230, y: 80 + Math.floor(index / 4) * 130 },
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
    this.pendingConnection.set(null);
    this.error.set(null);
  }

  selectNode(nodeId: string): void {
    this.selectedNodeId.set(nodeId);
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
      const edgeCount = this.graph().edges.length + 1;
      this.graph.set(this.editor.connect({
        graph: this.graph(),
        edge: {
          id: `draft-edge-${edgeCount}`,
          from: source,
          to: { nodeId, portId: 'in' },
        },
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
    if (target instanceof SVGElement) {
      target.ownerSVGElement?.setPointerCapture(event.pointerId);
    } else if (target instanceof Element) {
      target.closest('svg')?.setPointerCapture(event.pointerId);
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
