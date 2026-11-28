import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  ScenarioCatalogItem,
  ScenarioRunnerGateway,
} from './application';
import type { ScenarioRunRecord } from './core/run-contract';
import { parseGitHubScenarioCatalog } from './core/parse-github-scenario-catalog';

interface ScenarioRunnerEnvelope<T> {
  readonly ok: true;
  readonly data: T;
}

@Injectable({ providedIn: 'root' })
export class ScenarioRunnerApi implements ScenarioRunnerGateway {
  private readonly http = inject(HttpClient);
  private readonly base = 'http://127.0.0.1:4201/api/v1/scenario-runner';
  private readonly wsUrl = 'ws://127.0.0.1:4201/api/v1/trading/events';

  async loadDevelopCatalog(): Promise<{ readonly catalog: readonly ScenarioCatalogItem[]; readonly commitSha: string }> {
    const ref = await firstValueFrom(this.http.get<{ readonly object: { readonly sha: string } }>('https://api.github.com/repos/45s/coinzilla/git/ref/heads/develop'));
    const commitSha = ref.object.sha;
    if (!/^[a-f0-9]{40}$/i.test(commitSha)) {
      throw new TypeError('GitHub develop returned an invalid commit SHA.');
    }
    const sourcePaths = [
      'apps/harvester/src/infrastructure/scenario-runner/rs-scenario-adapter.js',
      'apps/harvester/src/infrastructure/scenario-runner/rs-runtime-scenario.js',
      'apps/harvester/src/infrastructure/scenario-runner/cg-conservative-scenario-catalog.part-one.js',
      'apps/harvester/src/infrastructure/scenario-runner/cg-conservative-scenario-catalog.part-two.js',
      'apps/harvester/src/infrastructure/scenario-runner/cg-conservative-scenario-catalog.part-three.js',
      'apps/harvester/src/infrastructure/scenario-runner/cg-conservative-scenario-catalog.part-four.js',
    ];
    const sources = await Promise.all(sourcePaths.map((path) => firstValueFrom(this.http.get(
      `https://raw.githubusercontent.com/45s/coinzilla/${commitSha}/${path}`,
      { responseType: 'text' },
    ))));
    return parseGitHubScenarioCatalog({ sources, commitSha });
  }

  async loadCatalog(): Promise<readonly ScenarioCatalogItem[]> {
    const response = await firstValueFrom(this.http.get<ScenarioRunnerEnvelope<readonly ScenarioCatalogItem[]>>(`${this.base}/catalog`));
    return response.data;
  }

  async submit(input: {
    strategyId: string;
    scenarioId: string;
    input: unknown;
  }): Promise<ScenarioRunRecord> {
    const response = await firstValueFrom(this.http.post<ScenarioRunnerEnvelope<ScenarioRunRecord>>(`${this.base}/runs`, input));
    return response.data;
  }

  async loadHistory(): Promise<readonly ScenarioRunRecord[]> {
    const response = await firstValueFrom(this.http.get<ScenarioRunnerEnvelope<readonly ScenarioRunRecord[]>>(`${this.base}/runs`));
    return response.data;
  }

  async getRun(runId: string): Promise<ScenarioRunRecord> {
    const response = await firstValueFrom(this.http.get<ScenarioRunnerEnvelope<ScenarioRunRecord>>(`${this.base}/runs/${encodeURIComponent(runId)}`));
    return response.data;
  }

  async cancel(runId: string): Promise<unknown> {
    const response = await firstValueFrom(this.http.post<ScenarioRunnerEnvelope<unknown>>(`${this.base}/runs/${encodeURIComponent(runId)}/cancel`, {}));
    return response.data;
  }

  async replay(runId: string): Promise<ScenarioRunRecord> {
    const response = await firstValueFrom(this.http.post<ScenarioRunnerEnvelope<ScenarioRunRecord>>(`${this.base}/runs/${encodeURIComponent(runId)}/replay`, {}));
    return response.data;
  }

  createEventSocket(): WebSocket {
    return new WebSocket(this.wsUrl);
  }
}
