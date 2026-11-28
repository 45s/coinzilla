import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createScenarioRunnerApplication, type ScenarioRunnerGateway } from './application';
import type { ScenarioRunRecord } from './core/run-contract';

const scenario = {
  id: 'RS-001-001',
  name: 'Executable scenario',
  layer: 'domain',
  status: 'TEST-MAPPED',
  executionStatus: 'EXECUTABLE' as const,
  executable: true,
  inputSchema: {
    type: 'object' as const,
    required: ['minProfit'],
    additionalProperties: false,
    properties: {
      minProfit: { type: 'string', pattern: '^[0-9]+(?:[.][0-9]+)?$' },
    },
  },
  defaultInput: { minProfit: '0.01' },
};

const preliminaryScenario = {
  ...scenario,
  id: 'RS-004-011',
  executionStatus: 'PRELIMINARY' as const,
  executable: false,
};

const run = (overrides: Partial<ScenarioRunRecord> = {}): ScenarioRunRecord => ({
  runId: 'run-1',
  strategyId: 'RS',
  scenarioId: scenario.id,
  status: 'Completed',
  createdAt: '2026-11-25T00:00:00Z',
  updatedAt: '2026-11-25T00:00:01Z',
  startedAt: '2026-11-25T00:00:00Z',
  completedAt: '2026-11-25T00:00:01Z',
  input: { minProfit: '0.01' },
  output: {
    trace: [{ id: 'step-1', kind: 'decision', label: 'Production decision' }],
  },
  diagnostics: [],
  transitions: [{ status: 'Completed', at: '2026-11-25T00:00:01Z' }],
  ...overrides,
});

function createGateway() {
  const gateway: ScenarioRunnerGateway = {
    loadDevelopCatalog: vi.fn().mockResolvedValue({ commitSha: 'a'.repeat(40), catalog: [{ strategyId: 'RS', strategyName: 'Recovery Seller', scenarios: [{ ...scenario, id: 'RS-REMOTE-001', executionStatus: 'BLOCKED' as const, executable: false }] }] }),
    loadCatalog: vi.fn().mockResolvedValue([{
      strategyId: 'RS',
      strategyName: 'Recovery Seller',
      scenarios: [scenario, preliminaryScenario],
    }]),
    loadHistory: vi.fn().mockResolvedValue([run()]),
    submit: vi.fn().mockResolvedValue(run({ status: 'Accepted', output: null })),
    getRun: vi.fn().mockResolvedValue(run()),
    cancel: vi.fn().mockResolvedValue(undefined),
    replay: vi.fn().mockResolvedValue(run({ runId: 'run-2', replayOfRunId: 'run-1' })),
  };
  return gateway;
}

describe('framework-independent Scenario Runner application', () => {
  let gateway: ReturnType<typeof createGateway>;
  let application: ReturnType<typeof createScenarioRunnerApplication>;

  beforeEach(() => {
    gateway = createGateway();
    application = createScenarioRunnerApplication({ gateway });
  });

  it('loads catalog and run history through application ports', async () => {
    const workspace = await application.loadWorkspace();

    expect(gateway.loadCatalog).toHaveBeenCalledOnce();
    expect(gateway.loadHistory).toHaveBeenCalledOnce();
    expect(workspace.catalog[0].strategyId).toBe('RS');
    expect(workspace.history[0].runId).toBe('run-1');
  });

  it('loads and selects the read-only GitHub develop catalogue through the application port', async () => {
    const remote = await application.loadDevelopCatalog();
    expect(remote.commitSha).toBe('a'.repeat(40));
    expect(remote.catalog[0].strategyId).toBe('RS');
    expect(gateway.loadDevelopCatalog).toHaveBeenCalledOnce();
    await expect(application.submitRun({ strategyId: 'RS', scenarioId: 'RS-REMOTE-001', inputJson: '{}' })).rejects.toThrow(/not executable/i);
    expect(gateway.submit).not.toHaveBeenCalled();
  });

  it('keeps the scenario catalogue available when run history is temporarily unavailable', async () => {
    gateway.loadHistory = vi.fn().mockRejectedValue(new Error('History service unavailable'));

    const workspace = await application.loadWorkspace();

    expect(workspace.catalog[0].strategyId).toBe('RS');
    expect(workspace.history).toEqual([]);
    expect(workspace.historyError).toBe('History service unavailable');
  });

  it('returns authoritative run details and cached history when a refresh fails', async () => {
    await application.loadWorkspace();
    gateway.loadHistory = vi.fn().mockRejectedValue(new Error('History service unavailable'));

    const snapshot = await application.refreshRun({ runId: 'run-1' });

    expect(snapshot.run.runId).toBe('run-1');
    expect(snapshot.history).toEqual([run()]);
    expect(snapshot.historyError).toBe('History service unavailable');
  });

  it('selects the first scenario and its defaults without framework state', async () => {
    await application.loadWorkspace();

    expect(application.selectStrategy({ strategyId: 'RS' })).toEqual({
      scenarioId: scenario.id,
      inputJson: JSON.stringify(scenario.defaultInput, null, 2),
    });
  });

  it('loads selected scenario defaults from the strategy-owned catalogue', async () => {
    await application.loadWorkspace();

    expect(application.selectScenario({
      strategyId: 'RS',
      scenarioId: preliminaryScenario.id,
    })).toEqual({
      inputJson: JSON.stringify(preliminaryScenario.defaultInput, null, 2),
    });
  });

  it('fails closed for preliminary scenarios without submitting a run', async () => {
    await expect(application.submitRun({
      strategyId: 'RS',
      scenarioId: preliminaryScenario.id,
      inputJson: JSON.stringify(preliminaryScenario.defaultInput),
    })).rejects.toThrow(/not executable/i);

    expect(gateway.submit).not.toHaveBeenCalled();
  });

  it('validates parsed input before submitting and reports schema violations', async () => {
    await expect(application.submitRun({
      strategyId: 'RS',
      scenarioId: scenario.id,
      inputJson: JSON.stringify({ minProfit: '-1', unexpected: true }),
    })).rejects.toThrow(/Unknown input field: unexpected/);

    expect(gateway.submit).not.toHaveBeenCalled();
  });

  it('submits validated input then retrieves authoritative run, trace, graph and history', async () => {
    const snapshot = await application.submitRun({
      strategyId: 'RS',
      scenarioId: scenario.id,
      inputJson: JSON.stringify({ minProfit: '0.02' }),
    });

    expect(gateway.submit).toHaveBeenCalledWith({
      strategyId: 'RS',
      scenarioId: scenario.id,
      input: { minProfit: '0.02' },
    });
    expect(gateway.getRun).toHaveBeenCalledWith('run-1');
    expect(snapshot.run.status).toBe('Completed');
    expect(snapshot.trace).toEqual([{ id: 'step-1', kind: 'decision', label: 'Production decision' }]);
    expect(snapshot.graph.nodes).toHaveLength(1);
    expect(snapshot.history).toHaveLength(1);
  });

  it('refreshes the selected run and history for a matching WebSocket update', async () => {
    const update = await application.refreshAfterEvent({
      runId: 'run-1',
      activeRunId: 'run-1',
    });

    if (update.kind !== 'run') {
      throw new Error('A matching active-run update must refresh run details.');
    }
    expect(gateway.getRun).toHaveBeenCalledWith('run-1');
    expect(update.snapshot.run.runId).toBe('run-1');
    expect(update.snapshot.history).toHaveLength(1);
  });

  it('refreshes history for background-run updates without replacing the selected run', async () => {
    const update = await application.refreshAfterEvent({
      runId: 'run-background',
      activeRunId: 'run-selected',
    });

    if (update.kind !== 'history') {
      throw new Error('A background-run update must refresh history only.');
    }
    expect(gateway.getRun).not.toHaveBeenCalled();
    expect(update.history).toHaveLength(1);
  });

  it('cancels through the gateway and then reads authoritative run state', async () => {
    const snapshot = await application.cancelRun({ runId: 'run-1' });

    expect(gateway.cancel).toHaveBeenCalledWith('run-1');
    expect(gateway.getRun).toHaveBeenCalledWith('run-1');
    expect(snapshot.run.status).toBe('Completed');
  });

  it('loads historical inputs without claiming that the operation is replay', async () => {
    const snapshot = await application.loadHistoryRun({ runId: 'run-1' });

    expect(snapshot.run.runId).toBe('run-1');
    expect(snapshot.inputJson).toBe(JSON.stringify({ minProfit: '0.01' }, null, 2));
    expect(snapshot.trace).toHaveLength(1);
  });

  it('rejects malformed JSON before making an API request', async () => {
    await expect(application.submitRun({
      strategyId: 'RS',
      scenarioId: scenario.id,
      inputJson: '{invalid',
    })).rejects.toThrow();

    expect(gateway.submit).not.toHaveBeenCalled();
  });

  it('replays a terminal run through the gateway and refreshes the replay record', async () => {
    const replayRecord = run({
      runId: 'run-2',
      replayOfRunId: 'run-1',
      status: 'Starting',
      output: null,
    });
    gateway.replay = vi.fn().mockResolvedValue(replayRecord);
    gateway.getRun = vi.fn().mockResolvedValue(run({
      runId: 'run-2',
      replayOfRunId: 'run-1',
      status: 'Completed',
    }));

    const snapshot = await application.replayRun({ runId: 'run-1' });

    expect(gateway.replay).toHaveBeenCalledWith('run-1');
    expect(gateway.getRun).toHaveBeenCalledWith('run-2');
    expect(snapshot.run.runId).toBe('run-2');
    expect(snapshot.run.replayOfRunId).toBe('run-1');
  });

});
