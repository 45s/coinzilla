import { JsonPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ScenarioRunnerApi, type ScenarioCatalogItem } from './api';
import { createTraceGraph } from './core/create-trace-graph';
import { createAiDebugPackage } from './core/create-ai-debug-package';
import { validateScenarioInput } from './core/validate-scenario-input';
import type { ScenarioRunRecord, ScenarioTraceStep } from './core/run-contract';

interface RunOutputEvidence {
  readonly trace?: readonly ScenarioTraceStep[];
  readonly expected?: unknown;
  readonly assertions?: unknown;
  readonly source?: unknown;
}

@Component({
  selector: 'app-scenario-runner',
  standalone: true,
  imports: [JsonPipe],
  templateUrl: './page.html',
  styleUrl: './page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScenarioRunnerComponent {
  private readonly api = inject(ScenarioRunnerApi);
  private socket?: WebSocket;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectDelayMs = 1000;
  private destroyed = false;

  readonly catalog = signal<readonly ScenarioCatalogItem[]>([]);
  readonly history = signal<readonly ScenarioRunRecord[]>([]);
  readonly strategyId = signal('RS');
  readonly scenarioId = signal('');
  readonly run = signal<ScenarioRunRecord | null>(null);
  readonly trace = signal<readonly ScenarioTraceStep[]>([]);
  readonly inputJson = signal('{}');
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);
  readonly graph = signal(createTraceGraph([]));
  readonly copied = signal(false);

  constructor() {
    void this.loadCatalog();
    this.connectEventSocket();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.socket?.close();
  }

  private connectEventSocket(): void {
    if (this.destroyed) {
      return;
    }
    try {
      const socket = this.api.createEventSocket();
      this.socket = socket;
      socket.onopen = () => {
        this.reconnectDelayMs = 1000;
      };
      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(String(message.data)) as {
            type?: string;
            data?: { runId?: string };
          };
          const runId = event.data?.runId;
          if (event.type === 'scenario-runner.update' && runId && runId === this.run()?.runId) {
            void this.refresh(runId);
          }
        } catch {
          // REST remains authoritative; ignore unrelated stream data.
        }
      };

      socket.onclose = () => this.scheduleReconnect();
      socket.onerror = () => socket.close();
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer) {
      return;
    }
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 30_000)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connectEventSocket();
      const current = this.run();
      if (current) {
        void this.refresh(current.runId);
      }
    }, delay);
  }

  async loadCatalog(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await firstValueFrom(this.api.catalog());
      this.catalog.set(result.data);
      const selected = result.data.find((item) => item.strategyId === this.strategyId());
      const firstScenario = selected?.scenarios[0];
      this.scenarioId.set(firstScenario?.id ?? '');
      this.inputJson.set(JSON.stringify(firstScenario?.defaultInput ?? {}, null, 2));
      await this.refreshHistory();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Scenario catalog unavailable.');
    } finally {
      this.loading.set(false);
    }
  }

  async refreshHistory(): Promise<void> {
    try {
      const result = await firstValueFrom(this.api.history());
      this.history.set(result.data as readonly ScenarioRunRecord[]);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Run history unavailable.');
    }
  }

  selectStrategy(value: string): void {
    this.strategyId.set(value);
    const selected = this.catalog().find((item) => item.strategyId === value);
    const firstScenario = selected?.scenarios[0];
    this.scenarioId.set(firstScenario?.id ?? '');
    this.inputJson.set(JSON.stringify(firstScenario?.defaultInput ?? {}, null, 2));
  }

  selectScenario(value: string): void {
    this.scenarioId.set(value);
    const selectedScenario = this.scenarios.find((item) => item.id === value);
    this.inputJson.set(JSON.stringify(selectedScenario?.defaultInput ?? {}, null, 2));
  }

  updateInput(value: string): void {
    this.inputJson.set(value);
  }

  async execute(): Promise<void> {
    this.error.set(null);
    if (this.selectedScenario?.executable !== true) {
      this.error.set('This scenario is mapped to tests but has no complete production-flow simulation adapter yet.');
      return;
    }
    this.loading.set(true);
    try {
      const input = JSON.parse(this.inputJson());
      const schema = this.selectedScenario?.inputSchema;
      if (schema) {
        const validation = validateScenarioInput({ schema, input });
        if (!validation.valid) {
          this.error.set(validation.errors.join('\n'));
          return;
        }
      }
      const accepted = await firstValueFrom(this.api.submit({
        strategyId: this.strategyId(),
        scenarioId: this.scenarioId(),
        input,
      }))
      const acceptedRun = accepted.data as ScenarioRunRecord;
      this.run.set(acceptedRun);
      await this.refresh(acceptedRun.runId);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Scenario execution failed.');
    } finally {
      this.loading.set(false);
    }
  }

  async refresh(runId = this.run()?.runId): Promise<void> {
    if (!runId) {
      return;
    }
    try {
      const result = await firstValueFrom(this.api.getRun(runId));
      const run = result.data as ScenarioRunRecord;
      const output = run.output as RunOutputEvidence | null;
      const trace = output?.trace ?? [];
      this.run.set(run);
      this.trace.set(trace);
      this.graph.set(createTraceGraph(trace));
      await this.refreshHistory();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Run status refresh failed.');
    }
  }

  async selectHistory(runId: string): Promise<void> {
    try {
      const result = await firstValueFrom(this.api.getRun(runId))
      const run = result.data as ScenarioRunRecord
      this.strategyId.set(run.strategyId)
      this.scenarioId.set(run.scenarioId)
      this.inputJson.set(JSON.stringify(run.input ?? {}, null, 2))
      await this.refresh(runId)
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : "Recorded run inputs could not be loaded.")
    }
  }

  async cancel(): Promise<void> {
    const runId = this.run()?.runId;
    if (!runId) {
      return;
    }
    try {
      await firstValueFrom(this.api.cancel(runId));
      await this.refresh(runId);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Cancellation failed.');
    }
  }

  async copyDebugPackage(): Promise<void> {
    const current = this.run();
    if (!current) {
      return;
    }
    this.copied.set(false);
    try {
      const output = current.output as RunOutputEvidence | null;
      const packageText = createAiDebugPackage({
        run: current,
        trace: this.trace(),
        expected: output?.expected,
        assertionResults: output?.assertions,
        metadata: { executionSource: output?.source, codeRevision: 'unavailable', scenarioSchema: this.selectedScenario?.inputSchema },
      });
      await navigator.clipboard.writeText(packageText);
      this.copied.set(true);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Debug package could not be generated.');
    }
  }

  get strategy(): ScenarioCatalogItem | undefined {
    return this.catalog().find((item) => item.strategyId === this.strategyId());
  }

  get selectedScenario(): ScenarioCatalogItem['scenarios'][number] | undefined {
    return this.scenarios.find((item) => item.id === this.scenarioId());
  }


  get scenarios(): ScenarioCatalogItem['scenarios'] {
    return this.strategy?.scenarios ?? [];
  }

  get debugText(): string {
    const current = this.run();
    const output = current?.output as RunOutputEvidence | null;
    return current ? createAiDebugPackage({
      run: current,
      trace: this.trace(),
      expected: output?.expected,
      assertionResults: output?.assertions,
      metadata: {
        executionSource: output?.source,
        codeRevision: 'unavailable',
        scenarioSchema: this.selectedScenario?.inputSchema,
      },
    }) : '';
  }
}
