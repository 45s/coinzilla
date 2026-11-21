import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TradingHistoryApi } from './api';

describe('TradingHistoryApi', () => {
  let api: TradingHistoryApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    api = TestBed.inject(TradingHistoryApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('sends bounded order filters and pagination without credentials to the versioned API', async () => {
    const response = {
      items: [],
      pagination: {
        limit: 25,
        offset: 50,
        total: 0,
        hasMore: false,
      },
    };
    const resultPromise = firstValueFrom(api.listOrders({
      filters: {
        symbol: 'BTCUSDT',
        side: 'BUY',
        status: 'FILLED',
      },
      limit: 25,
      offset: 50,
    }));

    const request = http.expectOne((candidate) =>
      candidate.url.endsWith('/api/v1/trading/orders')
      && candidate.params.get('symbol') === 'BTCUSDT'
      && candidate.params.get('side') === 'BUY'
      && candidate.params.get('status') === 'FILLED'
      && candidate.params.get('limit') === '25'
      && candidate.params.get('offset') === '50',
    );
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({
      ok: true,
      data: response,
    });

    await expect(resultPromise).resolves.toEqual(response);
  });

  it('encodes persisted record identifiers and preserves exact decimal strings and nullable values', async () => {
    const detail = {
      id: 'fill/with reserved chars',
      symbol: 'BTCUSDT',
      executionPrice: '65000.00000000',
      executedBaseQuantity: '0.00012500',
      executedQuoteQuantity: '8.12500000',
      commissions: [
        {
          id: 'commission-1',
          amount: '0.00000013',
          assetCode: 'BNB',
          quoteValueAmount: null,
          quoteValueAssetCode: null,
        },
      ],
    };
    const resultPromise = firstValueFrom(api.getFill(detail.id));
    const request = http.expectOne((candidate) =>
      candidate.url.endsWith('/api/v1/trading/fills/fill%2Fwith%20reserved%20chars'),
    );
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({
      ok: true,
      data: detail,
    });

    await expect(resultPromise).resolves.toEqual(detail);
  });

  it('surfaces API failures without converting them into successful empty pages', async () => {
    const resultPromise = firstValueFrom(api.getMetadata());
    const request = http.expectOne((candidate) =>
      candidate.url.endsWith('/api/v1/trading/metadata'),
    );
    request.flush({
      ok: false,
      error: {
        code: 'HARVESTER_TRADING_HISTORY_API_REQUEST_FAILED',
        message: 'Trading-history API request failed.',
      },
    }, {
      status: 500,
      statusText: 'Server Error',
    });

    await expect(resultPromise).rejects.toBeInstanceOf(HttpErrorResponse);
  });
});
