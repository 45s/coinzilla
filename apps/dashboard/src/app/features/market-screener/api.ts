import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { map, type Observable } from 'rxjs';

export type MarketSource =
  | 'bitunix-futures'
  | 'bitunix-spot'
  | 'binance-futures'
  | 'binance-spot';

export interface MarketScreenerRow {
  readonly symbol: string;
  readonly base: string | null;
  readonly quote: string | null;
  readonly symbolStatus: string | null;
  readonly isApiSupported: boolean | null;
  readonly maxLeverage: number | null;
  readonly lastPrice: string | null;
  readonly markPrice: string | null;
  readonly open: string | null;
  readonly high: string | null;
  readonly low: string | null;
  readonly quoteVol: string | null;
  readonly baseVol: string | null;
  readonly change5m: string | null;
  readonly change1h: string | null;
  readonly change4h: string | null;
  readonly change24h: string | null;
}

export interface MarketScreenerSnapshot {
  readonly provider: 'bitunix';
  readonly marketType: 'futures';
  readonly observedAt: string;
  readonly markets: readonly MarketScreenerRow[];
}

interface MarketScreenerResponse {
  readonly ok: true;
  readonly data: MarketScreenerSnapshot;
}

const MARKET_SCREENER_URL = 'http://127.0.0.1:4201/api/v1/markets/bitunix/futures';

@Injectable({ providedIn: 'root' })
export class MarketScreenerApi {
  private readonly http = inject(HttpClient);

  getBitunixFuturesMarkets(): Observable<MarketScreenerSnapshot> {
    return this.http.get<MarketScreenerResponse>(MARKET_SCREENER_URL).pipe(
      map((response) => response.data),
    );
  }
}
