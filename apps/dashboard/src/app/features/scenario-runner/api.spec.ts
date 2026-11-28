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

  it('loads the GitHub develop catalogue from one immutable commit snapshot', async () => {
    const response = api.loadDevelopCatalog();
    const ref = http.expectOne('https://api.github.com/repos/45s/coinzilla/git/ref/heads/develop');
    ref.flush({ object: { sha: 'a'.repeat(40) } });
    await Promise.resolve();
    const sourcePaths = [
      'apps/harvester/src/infrastructure/scenario-runner/rs-scenario-adapter.js',
      'apps/harvester/src/infrastructure/scenario-runner/rs-runtime-scenario.js',
      'apps/harvester/src/infrastructure/scenario-runner/cg-conservative-scenario-catalog.part-one.js',
      'apps/harvester/src/infrastructure/scenario-runner/cg-conservative-scenario-catalog.part-two.js',
      'apps/harvester/src/infrastructure/scenario-runner/cg-conservative-scenario-catalog.part-three.js',
      'apps/harvester/src/infrastructure/scenario-runner/cg-conservative-scenario-catalog.part-four.js',
    ];
    for (const path of sourcePaths) {
      const request = http.expectOne(`https://raw.githubusercontent.com/45s/coinzilla/${'a'.repeat(40)}/${path}`);
      expect(request.request.responseType).toBe('text');
      if (path.endsWith('rs-runtime-scenario.js')) {
        request.flush('Object.freeze({ id: "RS-001-002", name: "Second scenario", layer: "APPLICATION", status: "PARTIAL", executionStatus: "EXECUTABLE" })');
      } else if (path.endsWith('rs-scenario-adapter.js')) {
        request.flush('Object.freeze({ id: "RS-001-001", name: "Test scenario", layer: "APPLICATION", status: "PARTIAL", executionStatus: "EXECUTABLE" })');
      } else {
        const partName = path.endsWith('part-one.js') ? 'ONE'
          : path.endsWith('part-two.js') ? 'TWO'
            : path.endsWith('part-three.js') ? 'THREE' : 'FOUR';
        const records = partName === 'ONE'
          ? [{ id: 'CON-BUY-001', title: 'Conservative BUY lifecycle', coverageStatus: 'TEST-MAPPED', inputEvents: [{ type: 'BUY_FILLED', sequence: 1 }] }]
          : [];
        request.flush('export const CG_CONSERVATIVE_SCENARIO_DETAILS_PART_' + partName + ' = ' + JSON.stringify(records));
      }
    }
    await expect(response).resolves.toMatchObject({
      commitSha: 'a'.repeat(40),
      catalog: [
        { strategyId: 'RS', scenarios: [
          { id: 'RS-001-001', executable: false, executionStatus: 'BLOCKED' },
          { id: 'RS-001-002', executable: false, executionStatus: 'BLOCKED' },
        ] },
        { strategyId: 'CG-conservative', strategyName: 'Conservative', scenarios: [{
          id: 'CON-BUY-001',
          status: 'TEST-MAPPED',
          executable: false,
          executionStatus: 'BLOCKED',
          details: { expectedAccounting: {}, inputEvents: [{ type: 'BUY_FILLED', sequence: 1 }] },
        }] },
      ],
    });
  });

  it('rejects an invalid GitHub ref SHA before requesting source files', async () => {
    const response = api.loadDevelopCatalog();
    http.expectOne('https://api.github.com/repos/45s/coinzilla/git/ref/heads/develop').flush({ object: { sha: 'develop' } });
    await expect(response).rejects.toThrow(/invalid commit SHA/i);
    http.expectNone((request) => request.url.startsWith('https://raw.githubusercontent.com/'));
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
