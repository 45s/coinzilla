import { JsonPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ScenarioRunnerApi } from './api';
import { createScenarioRunnerApplication, type ScenarioCatalogItem, type ScenarioRunSnapshot } from './application';
import type { ScenarioGraphModel, ScenarioRunRecord, ScenarioTraceStep } from './core/run-contract';

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
  private readonly application = createScenarioRunnerApplication({ gateway: this.api });
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
  readonly graph = signal<ScenarioGraphModel>({ nodes: [], edges: [] });
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
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 30_000);
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
      const workspace = await this.application.loadWorkspace();
      this.catalog.set(workspace.catalog);
      this.history.set(workspace.history);
      const selection = this.application.selectStrategy({ strategyId: this.strategyId() });
      this.scenarioId.set(selection.scenarioId);
      this.inputJson.set(selection.inputJson);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Scenario catalog unavailable.');
    } finally {
      this.loading.set(false);
    }
  }

  async refreshHistory(): Promise<void> {
    try {
      this.history.set(await this.application.loadHistory());
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Run history unavailable.');
    }
  }

  selectStrategy(value: string): void {
    this.strategyId.set(value);
    const selection = this.application.selectStrategy({ strategyId: value });
    this.scenarioId.set(selection.scenarioId);
    this.inputJson.set(selection.inputJson);
  }

  selectScenario(value: string): void {
    this.scenarioId.set(value);
    const selection = this.application.selectScenario({
      strategyId: this.strategyId(),
      scenarioId: value,
    });
    this.inputJson.set(selection.inputJson);
  }

  updateInput(value: string): void {
    this.inputJson.set(value);
  }

  async execute(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    try {
      const snapshot = await this.application.submitRun({
        strategyId: this.strategyId(),
        scenarioId: this.scenarioId(),
        inputJson: this.inputJson(),
      });
      this.applyRunSnapshot(snapshot);
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
      this.applyRunSnapshot(await this.application.refreshRun({ runId }));
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Run status refresh failed.');
    }
  }

  async selectHistory(runId: string): Promise<void> {
    try {
      const snapshot = await this.application.loadHistoryRun({ runId });
      this.strategyId.set(snapshot.run.strategyId);
      this.scenarioId.set(snapshot.run.scenarioId);
      this.inputJson.set(snapshot.inputJson);
      this.applyRunSnapshot(snapshot);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Recorded run inputs could not be loaded.');
    }
  }

  async cancel(): Promise<void> {
    const runId = this.run()?.runId;
    if (!runId) {
      return;
    }
    try {
      this.applyRunSnapshot(await this.application.cancelRun({ runId }));
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
      const packageText = this.application.createDebugPackage({
        run: current,
        trace: this.trace(),
        scenario: this.selectedScenario,
      });
      await navigator.clipboard.writeText(packageText);
      this.copied.set(true);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Debug package could not be generated.');
    }
  }

  private applyRunSnapshot(snapshot: ScenarioRunSnapshot): void {
    this.run.set(snapshot.run);
    this.trace.set(snapshot.trace);
    this.graph.set(snapshot.graph);
    this.history.set(snapshot.history);
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
    return current ? this.application.createDebugPackage({
      run: current,
      trace: this.trace(),
      scenario: this.selectedScenario,
    }) : '';
  }
}
