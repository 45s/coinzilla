import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { map, type Observable } from 'rxjs';

export interface ExchangeAccountMetadata {
  readonly providerInstanceId: string;
  readonly providerType: string;
  readonly accountId: string;
  readonly environment: 'testnet' | 'live';
  readonly connected: boolean;
}

export interface ExchangeAccountData extends ExchangeAccountMetadata {
  readonly accountSnapshot: {
    readonly sourceTime: string | number;
    readonly balances: readonly unknown[];
  };
  readonly openOrders: readonly unknown[];
  readonly observedAt: string;
}

interface ApiEnvelope<T> {
  readonly ok: true;
  readonly data: T;
}

@Injectable({ providedIn: 'root' })
export class ExchangesApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = 'http://127.0.0.1:4201/api/v1/exchanges';

  listAccounts(): Observable<readonly ExchangeAccountMetadata[]> {
    return this.http.get<ApiEnvelope<readonly ExchangeAccountMetadata[]>>(
      `${this.baseUrl}/accounts`,
    ).pipe(map((response) => response.data));
  }

  getAccount(providerInstanceId: string): Observable<ExchangeAccountData> {
    return this.http.get<ApiEnvelope<ExchangeAccountData>>(
      `${this.baseUrl}/accounts/${encodeURIComponent(providerInstanceId)}`,
    ).pipe(map((response) => response.data));
  }

  createEventSocket(): WebSocket {
    return new WebSocket('ws://127.0.0.1:4201/api/v1/trading/events');
  }
}
