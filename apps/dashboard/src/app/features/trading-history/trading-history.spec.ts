import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TradingHistorySession } from './trading-history-api';
import { TradingHistoryComponent } from './trading-history';

const API_TOKEN = 'a-session-only-token-that-is-long-enough-for-tests';

function createPage(items: readonly object[], total: number, offset = 0, limit = 25) {
  return {
    items,
    pagination: {
      limit,
      offset,
      total,
      hasMore: offset + items.length < total,
    },
  };
}

function createOrder(id: string) {
  return {
    id,
    environment: 'testnet',
    providerType: 'binance',
    providerInstanceId: 'binanceTestnet',
    accountId: 'binance-primary',
    symbol: 'BTCUSDT',
    exchangeOrderId: '12345',
    clientOrderId: null,
    strategyId: null,
    positionId: null,
    cycleId: null,
    side: 'BUY',
    orderType: 'LIMIT',
    limitPrice: '65000.00000000',
    averageExecutionPrice: null,
    originalQuantity: '0.01000000',
    executedQuantity: '0.00400000',
    cumulativeQuoteQuantity: '260.00000000',
    remainingQuantity: '0.00600000',
    status: 'PARTIALLY_FILLED',
    exchangeCreatedAt: '2026-11-20T10:00:00.000Z',
    exchangeCompletedAt: null,
  };
}

describe('TradingHistoryComponent', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<TradingHistoryComponent>>;
  let http: HttpTestingController;
  let session: TradingHistorySession;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TradingHistoryComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    session = TestBed.inject(TradingHistorySession);
    fixture = TestBed.createComponent(TradingHistoryComponent);
  });

  afterEach(() => {
    http.verify();
    session.clearToken();
  });

  it('shows an explicit connection form when no session token is available', () => {
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Connect to Harvester');
    expect(fixture.nativeElement.textContent).toContain('Bearer token');
  });

  it('clears a rejected session token and reports invalid credentials', () => {
    session.setToken(API_TOKEN);
    fixture.detectChanges();

    const metadataRequest = http.expectOne((request) =>
      request.url.endsWith('/api/v1/trading/metadata'),
    );
    metadataRequest.flush({
      ok: false,
      error: {
        code: 'HARVESTER_TRADING_HISTORY_AUTHENTICATION_REQUIRED',
        message: 'Authentication required.',
      },
    }, {
      status: 401,
      statusText: 'Unauthorized',
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Token was rejected');
    expect(session.getToken()).toBeNull();
  });

  it('loads real orders, displays backend environment and renders an honest empty state', () => {
    session.setToken(API_TOKEN);
    fixture.detectChanges();

    http.expectOne((request) => request.url.endsWith('/api/v1/trading/metadata')).flush({
      ok: true,
      data: {
        environment: 'testnet',
        records: {
          orders: 0,
          fills: 0,
          commissions: 0,
        },
      },
    });
    http.expectOne((request) => request.url.endsWith('/api/v1/trading/orders')).flush({
      ok: true,
      data: createPage([], 0),
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('TESTNET');
    expect(fixture.nativeElement.textContent).toContain('No persisted orders');
    expect(fixture.nativeElement.textContent).not.toContain('DEMO');
  });

  it('applies filters and bounded pagination through the API', () => {
    session.setToken(API_TOKEN);
    fixture.detectChanges();
    http.expectOne((request) => request.url.endsWith('/api/v1/trading/metadata')).flush({
      ok: true,
      data: {
        environment: 'testnet',
        records: {
          orders: 26,
          fills: 0,
          commissions: 0,
        },
      },
    });
    http.expectOne((request) => request.url.endsWith('/api/v1/trading/orders')).flush({
      ok: true,
      data: createPage(Array.from({ length: 25 }, (_, index) => createOrder(`order-${index}`)), 26),
    });
    fixture.detectChanges();

    const symbolInput = fixture.nativeElement.querySelector('[data-testid="symbol-filter"]') as HTMLInputElement;
    symbolInput.value = 'BTCUSDT';
    symbolInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const applyButton = fixture.nativeElement.querySelector('[data-testid="apply-filters"]') as HTMLButtonElement;
    applyButton.click();
    fixture.detectChanges();

    const filteredRequest = http.expectOne((request) =>
      request.url.endsWith('/api/v1/trading/orders')
      && request.params.get('symbol') === 'BTCUSDT'
      && request.params.get('offset') === '0',
    );
    filteredRequest.flush({
      ok: true,
      data: createPage([createOrder('order-filtered')], 1),
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('order-filtered');
    expect(fixture.nativeElement.textContent).toContain('BTCUSDT');
  });

  it('loads persisted order details on selection and preserves null financial values', () => {
    session.setToken(API_TOKEN);
    fixture.detectChanges();
    http.expectOne((request) => request.url.endsWith('/api/v1/trading/metadata')).flush({
      ok: true,
      data: {
        environment: 'live',
        records: {
          orders: 1,
          fills: 0,
          commissions: 0,
        },
      },
    });
    http.expectOne((request) => request.url.endsWith('/api/v1/trading/orders')).flush({
      ok: true,
      data: createPage([createOrder('order-1')], 1),
    });
    fixture.detectChanges();

    const detailsButton = fixture.nativeElement.querySelector('[data-testid="record-details"]') as HTMLButtonElement;
    detailsButton.click();
    fixture.detectChanges();
    http.expectOne((request) => request.url.endsWith('/api/v1/trading/orders/order-1')).flush({
      ok: true,
      data: createOrder('order-1'),
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Order details');
    expect(fixture.nativeElement.textContent).toContain('65000.00000000');
    expect(fixture.nativeElement.textContent).toContain('Not recorded');
    expect(fixture.nativeElement.textContent).toContain('LIVE');
  });

  it('shows an API-unavailable state instead of replacing a failed request with sample records', () => {
    session.setToken(API_TOKEN);
    fixture.detectChanges();
    http.expectOne((request) => request.url.endsWith('/api/v1/trading/metadata')).error(new ProgressEvent('error'));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Harvester API is unavailable');
    expect(fixture.nativeElement.textContent).not.toContain('DEMO');
  });
});
