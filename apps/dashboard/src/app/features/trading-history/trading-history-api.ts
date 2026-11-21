import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { map, type Observable } from 'rxjs';

export type TradingEnvironment = 'testnet' | 'live';
export type TradingHistoryResource = 'orders' | 'fills' | 'commissions';

export interface TradingHistoryPagination {
  readonly limit: number;
  readonly offset: number;
  readonly total: number;
  readonly hasMore: boolean;
}

export interface TradingHistoryPage<T> {
  readonly items: readonly T[];
  readonly pagination: TradingHistoryPagination;
}

export interface TradingHistoryMetadata {
  readonly environment: TradingEnvironment;
  readonly records: {
    readonly orders: number;
    readonly fills: number;
    readonly commissions: number;
  };
}

export interface OrderRecord {
  readonly id: string;
  readonly environment: TradingEnvironment;
  readonly providerType: string;
  readonly providerInstanceId: string | null;
  readonly accountId: string | null;
  readonly marketId: string | null;
  readonly marketVenue: string | null;
  readonly symbol: string;
  readonly baseAssetId: string | null;
  readonly baseAssetCode: string | null;
  readonly quoteAssetId: string | null;
  readonly quoteAssetCode: string | null;
  readonly exchangeOrderId: string | null;
  readonly clientOrderId: string | null;
  readonly strategyId: string | null;
  readonly positionId: string | null;
  readonly ownershipPurpose: string | null;
  readonly cycleId: string | null;
  readonly side: 'BUY' | 'SELL';
  readonly orderType: string;
  readonly limitPrice: string | null;
  readonly averageExecutionPrice: string | null;
  readonly originalQuantity: string | null;
  readonly executedQuantity: string | null;
  readonly cumulativeQuoteQuantity: string | null;
  readonly remainingQuantity: string | null;
  readonly status: string;
  readonly exchangeCreatedAt: string | null;
  readonly exchangeAcknowledgedAt: string | null;
  readonly exchangeUpdatedAt: string | null;
  readonly exchangeCompletedAt: string | null;
  readonly exchangeTransactionAt: string | null;
  readonly localFirstObservedAt: string | null;
  readonly firstSourceEventId: string | null;
  readonly lastSourceEventId: string | null;
  readonly lastSourceEventName: string | null;
  readonly lastSourceEventSource: string | null;
  readonly lastSourceEventTimestamp: string | null;
  readonly localLastObservedAt: string | null;
  readonly sourceKind: string | null;
  readonly lastObservedSourceKind: string | null;
  readonly sourceRecordId: string | null;
  readonly migratedAt: string | null;
  readonly lastExecutionType: string | null;
  readonly ingestionSource: string | null;
  readonly lastIngestionSource: string | null;
}

export interface FillCommission {
  readonly id: string;
  readonly amount: string;
  readonly assetId: string | null;
  readonly assetCode: string | null;
  readonly quoteValueAmount: string | null;
  readonly quoteValueAssetId: string | null;
  readonly quoteValueAssetCode: string | null;
}

export interface FillRecord {
  readonly id: string;
  readonly canonicalFillId: string | null;
  readonly providerType: string;
  readonly providerInstanceId: string | null;
  readonly accountId: string | null;
  readonly environment: TradingEnvironment;
  readonly marketId: string | null;
  readonly symbol: string;
  readonly exchangeTradeId: string | null;
  readonly exchangeOrderId: string | null;
  readonly clientOrderId: string | null;
  readonly orderId: string | null;
  readonly strategyId: string | null;
  readonly positionId: string | null;
  readonly cycleId: string | null;
  readonly side: 'BUY' | 'SELL';
  readonly executionPrice: string;
  readonly executedBaseQuantity: string;
  readonly executedQuoteQuantity: string;
  readonly liquidityRole: string | null;
  readonly commissionStatus: string;
  readonly exchangeExecutedAt: string | null;
  readonly localObservedAt: string | null;
  readonly lastObservedAt: string | null;
  readonly sourceKind: string | null;
  readonly sourceEventId: string | null;
  readonly lastSourceEventId: string | null;
  readonly sourceEventName: string | null;
  readonly sourceEventSource: string | null;
  readonly sourceEventTimestamp: string | null;
  readonly ingestionSource: string | null;
  readonly lastIngestionSource: string | null;
}

export interface FillDetail extends FillRecord {
  readonly commissions: readonly FillCommission[];
}

export interface CommissionRecord {
  readonly id: string;
  readonly fillId: string;
  readonly amount: string;
  readonly assetId: string | null;
  readonly assetCode: string | null;
  readonly quoteValueAmount: string | null;
  readonly quoteValueAssetId: string | null;
  readonly quoteValueAssetCode: string | null;
  readonly environment: TradingEnvironment;
  readonly providerType: string;
  readonly providerInstanceId: string | null;
  readonly accountId: string | null;
  readonly symbol: string;
  readonly side: 'BUY' | 'SELL';
  readonly exchangeTradeId: string | null;
  readonly exchangeOrderId: string | null;
  readonly strategyId: string | null;
  readonly exchangeExecutedAt: string | null;
}

export type TradingHistoryRecord = OrderRecord | FillRecord | CommissionRecord;
export type TradingHistoryDetail = OrderRecord | FillDetail | CommissionRecord;

interface ApiEnvelope<T> {
  readonly ok: true;
  readonly data: T;
}

interface ListQuery {
  readonly filters?: Readonly<Record<string, string>>;
  readonly limit: number;
  readonly offset: number;
}

export const TRADING_HISTORY_SESSION_TOKEN_KEY = 'coinzilla.trading-history.api-token';

@Injectable({ providedIn: 'root' })
export class TradingHistorySession {
  getToken(): string | null {
    try {
      return sessionStorage.getItem(TRADING_HISTORY_SESSION_TOKEN_KEY);
    } catch {
      return null;
    }
  }

  setToken(token: string): void {
    const normalized = token.trim();
    if (!normalized) {
      this.clearToken();
      return;
    }
    try {
      sessionStorage.setItem(TRADING_HISTORY_SESSION_TOKEN_KEY, normalized);
    } catch {
      // A blocked session store leaves the client disconnected rather than persisting a secret elsewhere.
    }
  }

  clearToken(): void {
    try {
      sessionStorage.removeItem(TRADING_HISTORY_SESSION_TOKEN_KEY);
    } catch {
      // The client remains disconnected even when the browser denies storage access.
    }
  }
}

@Injectable({ providedIn: 'root' })
export class TradingHistoryApi {
  private readonly http = inject(HttpClient);
  private readonly session = inject(TradingHistorySession);
  private readonly baseUrl = 'http://127.0.0.1:4201/api/v1/trading';

  getMetadata(): Observable<TradingHistoryMetadata> {
    return this.get<TradingHistoryMetadata>('/metadata');
  }

  listOrders(query: ListQuery): Observable<TradingHistoryPage<OrderRecord>> {
    return this.list<OrderRecord>('/orders', query);
  }

  getOrder(id: string): Observable<OrderRecord> {
    return this.get<OrderRecord>(`/orders/${encodeURIComponent(id)}`);
  }

  listFills(query: ListQuery): Observable<TradingHistoryPage<FillRecord>> {
    return this.list<FillRecord>('/fills', query);
  }

  getFill(id: string): Observable<FillDetail> {
    return this.get<FillDetail>(`/fills/${encodeURIComponent(id)}`);
  }

  listCommissions(query: ListQuery): Observable<TradingHistoryPage<CommissionRecord>> {
    return this.list<CommissionRecord>('/commissions', query);
  }

  private list<T>(path: string, query: ListQuery): Observable<TradingHistoryPage<T>> {
    let params = new HttpParams()
      .set('limit', query.limit)
      .set('offset', query.offset);
    for (const [key, value] of Object.entries(query.filters ?? {})) {
      if (value) {
        params = params.set(key, value);
      }
    }
    return this.get<TradingHistoryPage<T>>(path, params);
  }

  private get<T>(path: string, params?: HttpParams): Observable<T> {
    const token = this.session.getToken();
    const headers = token
      ? new HttpHeaders({ Authorization: `Bearer ${token}` })
      : new HttpHeaders();
    return this.http.get<ApiEnvelope<T>>(`${this.baseUrl}${path}`, {
      headers,
      params,
    }).pipe(map((response) => response.data));
  }
}
