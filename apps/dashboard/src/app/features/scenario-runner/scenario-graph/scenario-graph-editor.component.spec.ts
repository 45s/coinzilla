import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { ScenarioGraphEditorComponent } from './scenario-graph-editor.component';

describe('ScenarioGraphEditorComponent', () => {
  it('renders a source-grounded visual-only RS graph without execution controls', async () => {
    await TestBed.configureTestingModule({ imports: [ScenarioGraphEditorComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ScenarioGraphEditorComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelectorAll('.graph-node').length, 'the editor must render the complete RS lifecycle graph').toBe(16);
    expect(element.textContent, 'the editor must disclose that its graph is not executable').toContain('VISUAL-ONLY');
    expect(element.textContent, 'the editor must expose the source-derived sole SELL invariant').toContain('Submit the sole cycle SELL');
    expect(element.querySelector('button[aria-label="Run scenario"]'), 'the visual editor must not provide an execution action').toBeNull();
  });

  it('supports hover, selection and pointer-based node dragging', async () => {
    await TestBed.configureTestingModule({ imports: [ScenarioGraphEditorComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ScenarioGraphEditorComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const svg = fixture.nativeElement.querySelector('svg') as SVGSVGElement;
    const view = component.viewModel();
    Object.defineProperty(svg, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: view.width, height: view.height }),
    });
    const nodeElement = fixture.nativeElement.querySelector('.graph-node[data-kind="action"]') as SVGGElement;
    const node = component.graph().nodes.find((item) => item.type === 'action');
    if (!node) {
      throw new Error('The RS graph must contain an action node for the drag interaction test.');
    }
    nodeElement.dispatchEvent(new Event('pointerenter'));
    expect(component.hoveredNodeId(), 'hovering a node must update the presentation hover state').toBe(node.id);
    nodeElement.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(component.selectedNodeId(), 'clicking a node must select it for inspection').toBe(node.id);

    nodeElement.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientX: node.position.x + 50,
      clientY: node.position.y + 40,
    }));
    svg.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true,
      clientX: node.position.x + 100,
      clientY: node.position.y + 100,
    }));
    svg.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));

    const moved = component.graph().nodes.find((item) => item.id === node.id);
    expect(moved?.position, 'dragging a node must update its framework-neutral graph position').toEqual({
      x: node.position.x + 50,
      y: node.position.y + 60,
    });
  });

  it('supports selecting and editing node properties through the inspector', async () => {
    await TestBed.configureTestingModule({ imports: [ScenarioGraphEditorComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ScenarioGraphEditorComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectNode('sell');
    fixture.detectChanges();

    const label = fixture.nativeElement.querySelector('.node-inspector input') as HTMLInputElement;
    label.value = 'Submit one authorized SELL';
    label.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(component.selectedNode()?.label, 'the inspector must delegate property edits to the graph application').toBe('Submit one authorized SELL');
    expect(fixture.nativeElement.textContent, 'the updated label must render on the canvas').toContain('Submit one authorized SELL');
  });

  it('offers terminal outcome nodes while preventing a second start node', async () => {
    await TestBed.configureTestingModule({ imports: [ScenarioGraphEditorComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ScenarioGraphEditorComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    expect(component.canAddStart(), 'the sample graph already has its single start node').toBe(false);
    component.setNodeType('start');
    expect(component.addNodeType(), 'a second start node must not be selectable').toBe('action');
    component.setNodeType('end');
    component.addNode();
    expect(component.selectedNode()?.type, 'additional terminal outcome nodes must be supported').toBe('end');
  });

  it('edits typed node properties through the application boundary', async () => {
    await TestBed.configureTestingModule({ imports: [ScenarioGraphEditorComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ScenarioGraphEditorComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectNode('sell');
    component.updateSelectedProperties('{"invariant":"one SELL lifecycle"}');

    expect(component.selectedNode()?.properties, 'the inspector must update the graph through the application use case').toEqual({
      invariant: 'one SELL lifecycle',
    });
    component.updateSelectedProperties('{"quantity":10}');
    expect(component.error(), 'invalid property value types must be surfaced without mutating the graph').toBe('SCENARIO_GRAPH_PROPERTIES_INVALID');
    expect(component.selectedNode()?.properties, 'invalid JSON maps must not replace valid graph properties').toEqual({
      invariant: 'one SELL lifecycle',
    });
  });

  it('adds a node using the selected palette type and keeps the document visual-only', async () => {
    await TestBed.configureTestingModule({ imports: [ScenarioGraphEditorComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ScenarioGraphEditorComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const before = component.graph().nodes.length;

    component.setNodeType('decision');
    component.addNode();
    fixture.detectChanges();

    expect(component.graph().nodes.length, 'adding a node must extend the graph document').toBe(before + 1);
    expect(component.selectedNode()?.type, 'the palette selection must determine the new node type').toBe('decision');
    expect(component.graph().status, 'adding nodes must not make a draft executable').toBe('visual-only');
  });

  it('supports keyboard selection of a connection', async () => {
    await TestBed.configureTestingModule({ imports: [ScenarioGraphEditorComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ScenarioGraphEditorComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.onEdgeKeydown(new KeyboardEvent('keydown', { key: 'Enter' }), 'e-start-legacy');
    expect(component.selectedEdgeId(), 'keyboard activation must select the focused graph connection').toBe('e-start-legacy');
    expect(component.selectedNodeId(), 'selecting a connection must clear node selection').toBeNull();
  });

  it('allows a selected connection to be removed without deleting its nodes', async () => {
    await TestBed.configureTestingModule({ imports: [ScenarioGraphEditorComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ScenarioGraphEditorComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const originalNodeCount = component.graph().nodes.length;
    component.selectEdge('e-start-legacy');
    component.deleteSelectedEdge();
    expect(component.graph().edges.some((edge) => edge.id === 'e-start-legacy'), 'the selected edge must be disconnected').toBe(false);
    expect(component.graph().nodes.length, 'disconnecting an edge must not delete either endpoint').toBe(originalNodeCount);
  });

  it('connects compatible output and input ports through the application boundary', async () => {
    await TestBed.configureTestingModule({ imports: [ScenarioGraphEditorComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ScenarioGraphEditorComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.addNode();
    const firstId = component.selectedNodeId() as string;
    component.addNode();
    const secondId = component.selectedNodeId() as string;

    component.onOutputPointerDown(new Event('pointerdown') as PointerEvent, firstId, 'next');
    component.onInputPointerUp(new Event('pointerup') as PointerEvent, secondId);

    expect(component.graph().edges.some((edge) => edge.from.nodeId === firstId && edge.to.nodeId === secondId), 'the output-to-input gesture must create a graph edge').toBe(true);
    expect(component.pendingConnection(), 'a completed connection gesture must clear its pending source').toBeNull();
  });
});
