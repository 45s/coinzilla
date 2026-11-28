import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ScenarioGraphEditorComponent } from './scenario-graph-editor.component';

describe('ScenarioGraphEditorComponent', () => {
  it('renders a source-grounded visual-only RS graph without execution controls', async () => {
    await TestBed.configureTestingModule({ imports: [ScenarioGraphEditorComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ScenarioGraphEditorComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelectorAll('.graph-node').length, 'the editor must render the complete RS lifecycle graph').toBe(13);
    expect(element.textContent, 'the editor must disclose that its graph is not executable').toContain('VISUAL-ONLY');
    expect(element.textContent, 'the editor must expose the source-derived sole SELL invariant').toContain('Submit the sole cycle SELL');
    expect(element.querySelector('button[aria-label="Run scenario"]'), 'the visual editor must not provide an execution action').toBeNull();
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
