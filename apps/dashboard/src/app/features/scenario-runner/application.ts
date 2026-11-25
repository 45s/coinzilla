import { createAiDebugPackage } from './core/create-ai-debug-package';
import { createTraceGraph } from './core/create-trace-graph';
import { validateScenarioInput } from './core/validate-scenario-input';
import type { ScenarioGraphModel, ScenarioRunRecord, ScenarioTraceStep } from './core/run-contract';

export interface ScenarioInputSchema {
  readonly type: 'object';
  readonly required: readonly string[];
  readonly additionalProperties: boolean;
  readonly properties: Readonly<Record<string, {
    readonly type: string;
    readonly pattern?: string;
    readonly description?: string;
  }>>;
}

export interface ScenarioCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly layer: string;
  readonly status: string;
  readonly executionStatus: 'PRELIMINARY' | 'EXECUTABLE' | 'BLOCKED';
  readonly executable: boolean;
  readonly inputSchema?: ScenarioInputSchema;
  readonly defaultInput?: unknown;
}

export interface ScenarioCatalogItem {
  readonly strategyId: string;
  readonly strategyName: string;
  readonly scenarios: readonly ScenarioCatalogEntry[];
}

export interface ScenarioRunnerGateway {
  loadCatalog(): Promise<readonly ScenarioCatalogItem[]>;
  loadHistory(): Promise<readonly ScenarioRunRecord[]>;
  submit(input: {
    readonly strategyId: string;
    readonly scenarioId: string;
    readonly input: unknown;
  }): Promise<ScenarioRunRecord>;
  getRun(runId: string): Promise<ScenarioRunRecord>;
  cancel(runId: string): Promise<unknown>;
}

export interface ScenarioRunSnapshot {
  readonly run: ScenarioRunRecord;
  readonly trace: readonly ScenarioTraceStep[];
  readonly graph: ScenarioGraphModel;
  readonly history: readonly ScenarioRunRecord[];
}

export interface ScenarioHistorySnapshot extends ScenarioRunSnapshot {
  readonly inputJson: string;
}

interface RunOutputEvidence {
  readonly trace?: readonly ScenarioTraceStep[];
  readonly expected?: unknown;
  readonly assertions?: unknown;
  readonly source?: unknown;
}

function extractRunTrace({ run }: { run: ScenarioRunRecord }): readonly ScenarioTraceStep[] {
  const output = run.output as RunOutputEvidence | null;
  return output?.trace ?? [];
}

function createRunSnapshot({ run, history }: {
  run: ScenarioRunRecord;
  history: readonly ScenarioRunRecord[];
}): ScenarioRunSnapshot {
  const trace = extractRunTrace({ run });
  return {
    run,
    trace,
    graph: createTraceGraph(trace),
    history,
  };
}

function findScenario({ catalog, strategyId, scenarioId }: {
  catalog: readonly ScenarioCatalogItem[];
  strategyId: string;
  scenarioId: string;
}): ScenarioCatalogEntry | undefined {
  const strategy = catalog.find((item) => item.strategyId === strategyId);
  return strategy?.scenarios.find((item) => item.id === scenarioId);
}

export function createScenarioRunnerApplication({ gateway }: {
  gateway: ScenarioRunnerGateway;
}) {
  let catalog: readonly ScenarioCatalogItem[] = [];
  let catalogLoaded = false;

  async function loadCatalog(): Promise<readonly ScenarioCatalogItem[]> {
    catalog = await gateway.loadCatalog();
    catalogLoaded = true;
    return catalog;
  }

  async function refreshRun({ runId }: { runId: string }): Promise<ScenarioRunSnapshot> {
    const [run, history] = await Promise.all([
      gateway.getRun(runId),
      gateway.loadHistory(),
    ]);
    return createRunSnapshot({ run, history });
  }

  return Object.freeze({
    selectStrategy({ strategyId }: { strategyId: string }) {
      const selectedStrategy = catalog.find((item) => item.strategyId === strategyId);
      const selectedScenario = selectedStrategy?.scenarios[0];
      return {
        scenarioId: selectedScenario?.id ?? '',
        inputJson: JSON.stringify(selectedScenario?.defaultInput ?? {}, null, 2),
      };
    },

    selectScenario({ strategyId, scenarioId }: {
      strategyId: string;
      scenarioId: string;
    }) {
      const selectedScenario = findScenario({ catalog, strategyId, scenarioId });
      return {
        inputJson: JSON.stringify(selectedScenario?.defaultInput ?? {}, null, 2),
      };
    },

    async loadWorkspace() {
      const [loadedCatalog, history] = await Promise.all([
        loadCatalog(),
        gateway.loadHistory(),
      ]);
      return { catalog: loadedCatalog, history };
    },

    async loadHistory() {
      return gateway.loadHistory();
    },

    async submitRun({ strategyId, scenarioId, inputJson }: {
      strategyId: string;
      scenarioId: string;
      inputJson: string;
    }): Promise<ScenarioRunSnapshot> {
      if (!catalogLoaded) {
        await loadCatalog();
      }
      const selectedScenario = findScenario({ catalog, strategyId, scenarioId });
      if (!selectedScenario) {
        throw new Error('The selected scenario is not present in the current strategy catalog.');
      }
      if (selectedScenario.executable !== true || selectedScenario.executionStatus !== 'EXECUTABLE') {
        throw new Error('The selected scenario is not executable.');
      }

      const input: unknown = JSON.parse(inputJson);
      if (selectedScenario.inputSchema) {
        const validation = validateScenarioInput({
          schema: selectedScenario.inputSchema,
          input,
        });
        if (!validation.valid) {
          throw new Error(validation.errors.join('\n'));
        }
      }

      const acceptedRun = await gateway.submit({ strategyId, scenarioId, input });
      return refreshRun({ runId: acceptedRun.runId });
    },

    async refreshRun({ runId }: { runId: string }) {
      return refreshRun({ runId });
    },

    async cancelRun({ runId }: { runId: string }) {
      await gateway.cancel(runId);
      return refreshRun({ runId });
    },

    async loadHistoryRun({ runId }: { runId: string }): Promise<ScenarioHistorySnapshot> {
      const snapshot = await refreshRun({ runId });
      return {
        ...snapshot,
        inputJson: JSON.stringify(snapshot.run.input ?? {}, null, 2),
      };
    },

    createDebugPackage({ run, trace, scenario }: {
      run: ScenarioRunRecord;
      trace: readonly ScenarioTraceStep[];
      scenario?: ScenarioCatalogEntry;
    }): string {
      const output = run.output as RunOutputEvidence | null;
      return createAiDebugPackage({
        run,
        trace,
        expected: output?.expected,
        assertionResults: output?.assertions,
        metadata: {
          executionSource: output?.source,
          codeRevision: 'unavailable',
          scenarioSchema: scenario?.inputSchema,
        },
      });
    },
  });
}
