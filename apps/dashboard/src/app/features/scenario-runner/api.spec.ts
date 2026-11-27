import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScenarioRunnerApi } from './api';
import type { ScenarioCatalogItem } from './application';
import type { ScenarioRunRecord } from './core/run-contract';

const API_BASE = 'http://127.0.0.1:4201/api/v1/scenario-runner';
const runRecord: ScenarioRunRecord = {
  runId: 'run/1',
  strategyId: 'RS',
  scenarioId: 'RS-RUNTIME-SELL-SUBMISSION-001',
  status: 'Completed',
  createdAt: '2026-11-27T00:00:00Z',
  updatedAt: '2026-11-27T00:00:01Z',
  startedAt: '2026-11-27T00:00:00Z',
  completedAt: '2026-11-27T00:00:01Z',
  input: {},
  output: {
    trace: [{ id: 'step-1', kind: 'decision', label: 'Submitted' }],
    assertions: [{ id: 'assertion-1', passed: true }],
  },
  diagnostics: [],
  transitions: [{ status: 'Completed', at: '2026-11-27T00:00:01Z' }],
};

describe('ScenarioRunnerApi HTTP gateway', () => {
  let api: ScenarioRunnerApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    api = TestBed.inject(ScenarioRunnerApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('loads the server-owned scenario catalogue', async () => {
    const catalog: readonly ScenarioCatalogItem[] = [];
    const response = api.loadCatalog();
    const request = http.expectOne(`${API_BASE}/catalog`);

    expect(request.request.method).toBe('GET');
    request.flush({ ok: true, data: catalog });

    await expect(response).resolves.toEqual(catalog);
  });

  it('submits a validated scenario run', async () => {
    const input = {
      strategyId: 'RS',
      scenarioId: runRecord.scenarioId,
      input: { minProfit: '0.01' },
    };
    const response = api.submit(input);
    const request = http.expectOne(`${API_BASE}/runs`);

    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(input);
    request.flush({ ok: true, data: runRecord });

    await expect(response).resolves.toEqual(runRecord);
  });

  it('loads authoritative run history', async () => {
    const response = api.loadHistory();
    const request = http.expectOne(`${API_BASE}/runs`);

    expect(request.request.method).toBe('GET');
    request.flush({ ok: true, data: [runRecord] });

    await expect(response).resolves.toEqual([runRecord]);
  });

  it('loads authoritative run status using an encoded run identifier', async () => {
    const response = api.getRun('run/1');
    const request = http.expectOne(`${API_BASE}/runs/run%2F1`);

    expect(request.request.method).toBe('GET');
    request.flush({ ok: true, data: runRecord });

    await expect(response).resolves.toEqual(runRecord);
  });

  it('requests cancellation and leaves terminal-state confirmation to status refresh', async () => {
    const response = api.cancel('run/1');
    const request = http.expectOne(`${API_BASE}/runs/run%2F1/cancel`);

    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({});
    request.flush({ ok: true, data: { runId: 'run/1', accepted: true } });

    await expect(response).resolves.toEqual({ runId: 'run/1', accepted: true });
  });

  it('requests exact replay through the server-owned replay gate', async () => {
    const response = api.replay('run/1');
    const request = http.expectOne(`${API_BASE}/runs/run%2F1/replay`);

    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({});
    request.flush({ ok: true, data: { ...runRecord, runId: 'run/2', replayOfRunId: 'run/1' } });

    await expect(response).resolves.toEqual({
      ...runRecord,
      runId: 'run/2',
      replayOfRunId: 'run/1',
    });
  });
});
