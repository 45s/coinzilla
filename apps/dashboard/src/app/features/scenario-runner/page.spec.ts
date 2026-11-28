import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fixtureData from './core/fixtures/rs-runtime-sell-partial-cancel.debug.json';
import { ScenarioRunnerApi } from './api';
import type { ScenarioCatalogItem } from './application';
import type { ScenarioRunRecord } from './core/run-contract';
import { ScenarioRunnerComponent } from './page';

const source = fixtureData as unknown as Record<string, unknown>;
const sourceRun = source['run'] as ScenarioRunRecord;
const runRecord = {
  ...sourceRun,
  executionMode: source['executionMode'],
  execution: source['execution'],
  scenarioCatalogSnapshot: source['scenarioCatalogSnapshot'],
  scenarioCatalogSnapshotProvenance: source['scenarioCatalogSnapshotProvenance'],
  assertionResults: source['assertionResults'],
  trace: source['trace'],
  traceCompleteness: source['traceCompleteness'],
} as ScenarioRunRecord;

const catalog: readonly ScenarioCatalogItem[] = [{
  strategyId: 'RS',
  strategyName: 'Recovery Seller',
  scenarios: [{
    id: runRecord.scenarioId,
    name: 'Runtime partial canceled SELL',
    layer: 'APPLICATION',
    status: 'PARTIAL',
    executionStatus: 'EXECUTABLE',
    executable: true,
    defaultInput: runRecord.input,
  }, {
    id: 'RS-RUNTIME-SELL-SUBMISSION-001',
    name: 'Runtime SELL submission',
    layer: 'APPLICATION',
    status: 'PARTIAL',
    executionStatus: 'EXECUTABLE',
    executable: true,
    defaultInput: {},
  }],
}];

describe('ScenarioRunnerComponent run details', () => {
  let component: ScenarioRunnerComponent;
  let nativeElement: HTMLElement;
  let fixture: ComponentFixture<ScenarioRunnerComponent>;

  beforeEach(async () => {
    const socket = { close: vi.fn() } as unknown as WebSocket;
    const api = {
      loadCatalog: vi.fn().mockResolvedValue(catalog),
      loadDevelopCatalog: vi.fn().mockResolvedValue({ catalog: [{ strategyId: 'RS', strategyName: 'Recovery Seller', scenarios: [{ id: 'RS-NEW-001', name: 'New remote scenario', layer: 'APPLICATION', status: 'PARTIAL', executionStatus: 'BLOCKED', executable: false }] }], commitSha: 'a'.repeat(40) }),
      loadHistory: vi.fn().mockResolvedValue([runRecord]),
      submit: vi.fn().mockResolvedValue(runRecord),
      getRun: vi.fn().mockResolvedValue(runRecord),
      cancel: vi.fn().mockResolvedValue(undefined),
      replay: vi.fn().mockResolvedValue(runRecord),
      createEventSocket: vi.fn().mockReturnValue(socket),
    };
    TestBed.configureTestingModule({
      imports: [ScenarioRunnerComponent],
      providers: [{ provide: ScenarioRunnerApi, useValue: api }],
    });
    fixture = TestBed.createComponent(ScenarioRunnerComponent);
    component = fixture.componentInstance;
    nativeElement = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
    await component.selectHistory(runRecord.runId);
    fixture.detectChanges();
  });

  it('exposes the GitHub develop checkbox and switches to a pinned read-only scenario snapshot', async () => {
    const checkbox = nativeElement.querySelector<HTMLInputElement>('.catalog-source-toggle input');
    expect(checkbox).not.toBeNull();
    if (!checkbox) throw new Error('GitHub catalogue checkbox is missing');
    checkbox.checked = true;
    await component.setGitHubCatalogSource(true);
    expect(component.catalog()[0].scenarios[0].id).toBe('RS-NEW-001');
    expect(component.catalogSourceRevision()).toBe('a'.repeat(40));
    expect(component.catalog()[0].scenarios[0].executable).toBe(false);
  });

  it('explains the fixture without conflating execution, partial order execution, cycle, safety or provenance', () => {
    const text = nativeElement.textContent ?? '';

    expect(text, 'scenario intent must be explained before the run trace').toContain('What this scenario does');
    expect(text, 'the selected partial-cancel scenario purpose must be readable').toContain('partially executed SELL which later becomes CANCELED');
    expect(text, 'the deliberate partial-fill condition must be visible in the diagram').toContain('Partial fill, then terminal CANCELED');
    expect(text, 'scenario intent must be distinguished from observed execution evidence').toContain('NOT EXECUTION EVIDENCE');
    expect(text, 'scenario limitations must distinguish simulation from production proof').toContain('does not prove real exchange behavior');
    expect(text, 'simulation-only execution must be explicit').toContain('SIMULATION ONLY');
    expect(text, 'all passing assertions must be shown as a separate outcome').toContain('16 / 16 passed');
    expect(text, 'the canceled order state must remain visible').toContain('CANCELED');
    expect(text, 'the executed quantity must remain visible').toContain('Executed: 2.5');
    expect(text, 'the unresolved cycle must not be shown as complete').toContain('UNRESOLVED');
    expect(text, 'STOP must block BUY admission').toContain('BUY blocked');
    expect(text, 'STOP must not be described as blocking SELL admission').toContain('SELL permitted');
    expect(text, 'unverified replay provenance must remain explicit').toContain('Unverified');
    expect(text, 'assertion names must remain visible for review').toContain('production RS transition selects a SELL action');
    expect(text, 'assertion expected values must remain visible').toContain('Expected:');
    expect(text, 'assertion actual values must remain visible').toContain('Actual:');
    expect(text, 'order cards must expose their exact source submission and terminal evidence').toContain('Inspect exact submission and lifecycle evidence');
    expect(text, 'decision cards must expose original decision calculations').toContain('Inspect decision calculations and original evidence');
    expect(text, 'missing build artifact identity must not be implied to exist').toContain('build artifact: unavailable');
  });


  it('renders the selected scenario guide instead of a static Recovery Seller graph', () => {
    expect(nativeElement.querySelector('app-scenario-graph-editor')).toBeNull();
    expect(nativeElement.querySelector('app-scenario-graph-viewer')).not.toBeNull();
    expect(nativeElement.querySelectorAll('.graph-node')).toHaveLength(7);
    expect(nativeElement.textContent).toContain('Partial fill, then terminal CANCELED');

    component.selectScenario('RS-RUNTIME-SELL-SUBMISSION-001');
    fixture.detectChanges();

    expect(nativeElement.textContent).toContain('Persist intent → broker ACK → persist outcome → reserve cycle');
    expect(nativeElement.querySelector('app-scenario-graph-viewer')).not.toBeNull();
    expect(nativeElement.querySelectorAll('.graph-node')).toHaveLength(5);
    expect(nativeElement.textContent).not.toContain('Partial fill, then terminal CANCELED');
    expect(nativeElement.textContent).toContain('not the currently selected scenario');
    expect(nativeElement.querySelector('.editor-toolbar')).toBeNull();
    expect(nativeElement.querySelector('.node-inspector')).toBeNull();
  });

  it('lets an operator select a source step and inspect its exact trace evidence', () => {
    const steps = Array.from(nativeElement.querySelectorAll<HTMLButtonElement>('.timeline-step'));

    expect(steps).toHaveLength(6);
    expect(steps[0].getAttribute('aria-pressed')).toBe('true');
    steps[4].click();

    const selected = component.selectedStep;
    expect(selected?.id, 'selection must resolve to the chosen source trace step').toBe('terminal-1');
    expect(nativeElement.textContent, 'the inspector must show the selected lifecycle step').toContain(
      'Reconcile a terminal SELL through production order-event and accounting workflows',
    );
    expect(component.selectedStepJson, 'the selected step must expose its original inputs and outputs').toContain('"orderStatus": "CANCELED"');
  });

  it('keeps the complete source payload searchable and exposes structured field inspection', () => {
    component.rawSearch.set('RECOVERY_SELL');
    expect(component.rawSearchMatches, 'search must cover JSON values as well as field names').toBeGreaterThan(0);
    expect(nativeElement.querySelector('app-json-tree'), 'technical inspection must expose the recursive JSON tree').not.toBeNull();
    expect(JSON.parse(component.rawJson), 'export source must preserve the complete run record data').toEqual(runRecord);
    expect(nativeElement.querySelector('.raw-json'), 'the full JSON fallback must remain available').not.toBeNull();
  });
});
