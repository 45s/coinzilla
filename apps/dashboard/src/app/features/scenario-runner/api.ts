import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

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

export type ScenarioExecutionStatus = 'PRELIMINARY' | 'EXECUTABLE' | 'BLOCKED';

export interface ScenarioCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly layer: string;
  readonly status: string;
  readonly executionStatus: ScenarioExecutionStatus;
  readonly executable: boolean;
  readonly inputSchema?: ScenarioInputSchema;
  readonly defaultInput?: unknown;
}

export interface ScenarioCatalogItem {
  readonly strategyId: string;
  readonly strategyName: string;
  readonly scenarios: readonly ScenarioCatalogEntry[];
}

export interface ScenarioRunnerEnvelope<T> {
  readonly ok: true;
  readonly data: T;
}

@Injectable({ providedIn: 'root' })
export class ScenarioRunnerApi {
  private readonly http = inject(HttpClient);
  private readonly base = 'http://127.0.0.1:4201/api/v1/scenario-runner';
  private readonly wsUrl = 'ws://127.0.0.1:4201/api/v1/trading/events';

  catalog(): Observable<ScenarioRunnerEnvelope<readonly ScenarioCatalogItem[]>> {
    return this.http.get<ScenarioRunnerEnvelope<readonly ScenarioCatalogItem[]>>(`${this.base}/catalog`);
  }

  submit(input: {
    strategyId: string;
    scenarioId: string;
    input: unknown;
  }): Observable<ScenarioRunnerEnvelope<unknown>> {
    return this.http.post<ScenarioRunnerEnvelope<unknown>>(`${this.base}/runs`, {
      strategyId: input.strategyId,
      scenarioId: input.scenarioId,
      input: input.input,
    });
  }

  history(): Observable<ScenarioRunnerEnvelope<readonly unknown[]>> {
    return this.http.get<ScenarioRunnerEnvelope<readonly unknown[]>>(`${this.base}/runs`);
  }

  getRun(runId: string): Observable<ScenarioRunnerEnvelope<unknown>> {
    return this.http.get<ScenarioRunnerEnvelope<unknown>>(`${this.base}/runs/${encodeURIComponent(runId)}`);
  }

  cancel(runId: string): Observable<ScenarioRunnerEnvelope<unknown>> {
    return this.http.post<ScenarioRunnerEnvelope<unknown>>(`${this.base}/runs/${encodeURIComponent(runId)}/cancel`, {});
  }

  createEventSocket(): WebSocket {
    return new WebSocket(this.wsUrl);
  }
}
