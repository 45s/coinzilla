import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

export interface OperatorEnvelope<T> {
  readonly ok: true;
  readonly data: T;
}

export interface OperatorCommand {
  readonly command: 'pause' | 'unpause' | 'pauseallbuys' | 'resumeallbuys';
  readonly symbol?: string;
  readonly requestId: string;
}

@Injectable({ providedIn: 'root' })
export class OperatorApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = 'http://127.0.0.1:4201/api/v1/trading/operator';

  getStatus(): Observable<OperatorEnvelope<unknown>> {
    return this.http.get<OperatorEnvelope<unknown>>(`${this.baseUrl}/status`);
  }

  getMarkets(): Observable<OperatorEnvelope<unknown>> {
    return this.http.get<OperatorEnvelope<unknown>>(`${this.baseUrl}/markets`);
  }

  getPositions(): Observable<OperatorEnvelope<unknown>> {
    return this.http.get<OperatorEnvelope<unknown>>(`${this.baseUrl}/positions`);
  }

  getOrders(): Observable<OperatorEnvelope<unknown>> {
    return this.http.get<OperatorEnvelope<unknown>>(`${this.baseUrl}/orders`);
  }

  getBalances(): Observable<OperatorEnvelope<unknown>> {
    return this.http.get<OperatorEnvelope<unknown>>(`${this.baseUrl}/balances`);
  }

  execute(command: OperatorCommand): Observable<OperatorEnvelope<unknown>> {
    return this.http.post<OperatorEnvelope<unknown>>(`${this.baseUrl}/commands`, command);
  }
}
