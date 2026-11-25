import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  ScenarioCatalogItem,
  ScenarioRunnerGateway,
} from './application';
import type { ScenarioRunRecord } from './core/run-contract';

@Injectable({ providedIn: 'root' })
export class ScenarioRunnerApi implements ScenarioRunnerGateway {
  private readonly http = inject(HttpClient);
  private readonly base = 'http://127.0.0.1:4201/api/v1/scenario-runner';
  private readonly wsUrl = 'ws://127.0.0.1:4201/api/v1/trading/events';

  async loadCatalog(): Promise<readonly ScenarioCatalogItem[]> {
    const response = await firstValueFrom(this.http.get<{ data: readonly ScenarioCatalogItem[] }>(`${this.base}/catalog`));
    return response.data;
  }

  async submit(input: {
    strategyId: string;
    scenarioId: string;
    input: unknown;
  }): Promise<ScenarioRunRecord> {
    const response = await firstValueFrom(this.http.post<{ data: ScenarioRunRecord }>(`${this.base}/runs`, input));
    return response.data;
  }

  async loadHistory(): Promise<readonly ScenarioRunRecord[]> {
    const response = await firstValueFrom(this.http.get<{ data: readonly ScenarioRunRecord[] }>(`${this.base}/runs`));
    return response.data;
  }

  async getRun(runId: string): Promise<ScenarioRunRecord> {
    const response = await firstValueFrom(this.http.get<{ data: ScenarioRunRecord }>(`${this.base}/runs/${encodeURIComponent(runId)}`));
    return response.data;
  }

  async cancel(runId: string): Promise<unknown> {
    const response = await firstValueFrom(this.http.post<{ data: unknown }>(`${this.base}/runs/${encodeURIComponent(runId)}/cancel`, {}));
    return response.data;
  }

  createEventSocket(): WebSocket {
    return new WebSocket(this.wsUrl);
  }
}
