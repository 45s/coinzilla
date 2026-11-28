import { TestBed } from '@angular/core/testing';
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
  }],
}];

describe('ScenarioRunnerComponent run details', () => {
  let component: ScenarioRunnerComponent;
  let nativeElement: HTMLElement;

  beforeEach(async () => {
    const socket = { close: vi.fn() } as unknown as WebSocket;
    const api = {
      loadCatalog: vi.fn().mockResolvedValue(catalog),
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
    const fixture = TestBed.createComponent(ScenarioRunnerComponent);
    component = fixture.componentInstance;
    nativeElement = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
    await component.selectHistory(runRecord.runId);
    fixture.detectChanges();
  });

  it('explains the fixture without conflating execution, partial order execution, cycle, safety or provenance', () => {
    const text = nativeElement.textContent ?? '';

    expect(text, 'simulation-only execution must be explicit').toContain('SIMULATION ONLY');
    expect(text, 'all passing assertions must be shown as a separate outcome').toContain('16 / 16 passed');
    expect(text, 'the canceled order state must remain visible').toContain('CANCELED');
    expect(text, 'the executed quantity must remain visible').toContain('Executed: 2.5');
    expect(text, 'the unresolved cycle must not be shown as complete').toContain('UNRESOLVED');
    expect(text, 'STOP must block BUY admission').toContain('BUY blocked');
    expect(text, 'STOP must not be described as blocking SELL admission').toContain('SELL permitted');
    expect(text, 'unverified replay provenance must remain explicit').toContain('Unverified');
    expect(text, 'missing build artifact identity must not be implied to exist').toContain('build artifact: unavailable');
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
