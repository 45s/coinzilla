import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, type HttpTestingController } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
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

function createFill(id: string) {
  return {
    id,
    canonicalFillId: 'canonical-fill-1',
    providerType: 'binance',
    providerInstanceId: 'binanceTestnet',
    accountId: 'binance-primary',
    environment: 'testnet',
    marketId: 'spot-btc-usdt',
    symbol: 'BTCUSDT',
    exchangeTradeId: 'trade-123',
    exchangeOrderId: 'order-123',
    clientOrderId: null,
    orderId: 'order-123',
    strategyId: null,
    positionId: null,
    cycleId: null,
    side: 'BUY',
    executionPrice: '65000.00000000',
    executedBaseQuantity: '0.00012500',
    executedQuoteQuantity: '8.12500000',
    liquidityRole: 'MAKER',
    commissionStatus: 'RECORDED',
    exchangeExecutedAt: '2026-11-20T10:00:00.000Z',
    localObservedAt: '2026-11-20T10:00:01.000Z',
    lastObservedAt: '2026-11-20T10:00:01.000Z',
    sourceKind: 'execution_report',
    sourceEventId: 'event-1',
    lastSourceEventId: 'event-1',
    sourceEventName: 'executionReport',
    sourceEventSource: 'binance',
    sourceEventTimestamp: '2026-11-20T10:00:00.000Z',
    ingestionSource: 'live',
    lastIngestionSource: 'live',
  };
}

async function connectToResource(
  fixture: ComponentFixture<TradingHistoryComponent>,
  http: HttpTestingController,
  session: TradingHistorySession,
  resource: 'orders' | 'fills' | 'commissions' = 'orders',
) {
  session.setToken(API_TOKEN);
  fixture.componentRef.setInput('resource', resource);
  fixture.detectChanges();
  http.expectOne((request) => request.url.endsWith('/api/v1/trading/metadata')).flush({
    ok: true,
    data: {
      environment: 'testnet',
      records: {
        orders: 26,
        fills: 1,
        commissions: 1,
      },
    },
  });
  await fixture.whenStable();
  return http.expectOne((request) => request.url.endsWith(`/api/v1/trading/${resource}`));
}

describe('TradingHistoryComponent', () => {
  let fixture: ComponentFixture<TradingHistoryComponent>;
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

  it('clears a rejected session token and reports invalid credentials', async () => {
    session.setToken(API_TOKEN);
    fixture.detectChanges();

    http.expectOne((request) => request.url.endsWith('/api/v1/trading/metadata')).flush({
      ok: false,
      error: {
        code: 'HARVESTER_TRADING_HISTORY_AUTHENTICATION_REQUIRED',
        message: 'Authentication required.',
      },
    }, {
      status: 401,
      statusText: 'Unauthorized',
    });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Token was rejected');
    expect(session.getToken()).toBeNull();
  });

  it('loads real orders, displays backend environment and renders an honest empty state', async () => {
    const request = await connectToResource(fixture, http, session);
    request.flush({
      ok: true,
      data: createPage([], 0),
    });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('TESTNET');
    expect(fixture.nativeElement.textContent).toContain('No persisted orders');
    expect(fixture.nativeElement.textContent).not.toContain('DEMO');
  });

  it('applies market filters through the API and resets the offset', async () => {
    const request = await connectToResource(fixture, http, session);
    request.flush({
      ok: true,
      data: createPage(Array.from({ length: 25 }, (_, index) => createOrder(`order-${index}`)), 26),
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const symbolInput = fixture.nativeElement.querySelector('[data-testid="symbol-filter"]') as HTMLInputElement;
    symbolInput.value = 'BTCUSDT';
    symbolInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const applyButton = fixture.nativeElement.querySelector('[data-testid="apply-filters"]') as HTMLButtonElement;
    applyButton.click();
    fixture.detectChanges();

    const filteredRequest = http.expectOne((candidate) =>
      candidate.url.endsWith('/api/v1/trading/orders')
      && candidate.params.get('symbol') === 'BTCUSDT'
      && candidate.params.get('offset') === '0',
    );
    filteredRequest.flush({
      ok: true,
      data: createPage([createOrder('order-filtered')], 1),
    });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('order-filtered');
    expect(fixture.nativeElement.textContent).toContain('BTCUSDT');
  });

  it('uses bounded server pagination when advancing to the next page', async () => {
    const request = await connectToResource(fixture, http, session);
    request.flush({
      ok: true,
      data: createPage(Array.from({ length: 25 }, (_, index) => createOrder(`order-${index}`)), 26),
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const nextButton = Array.from(fixture.nativeElement.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('Next')) as HTMLButtonElement;
    nextButton.click();
    fixture.detectChanges();
    const nextRequest = http.expectOne((candidate) =>
      candidate.url.endsWith('/api/v1/trading/orders')
      && candidate.params.get('limit') === '25'
      && candidate.params.get('offset') === '25',
    );
    nextRequest.flush({
      ok: true,
      data: createPage([createOrder('order-page-2')], 26, 25),
    });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Page 2 of 2');
    expect(fixture.nativeElement.textContent).toContain('order-page-2');
  });

  it('loads persisted order details and preserves null financial values', async () => {
    const request = await connectToResource(fixture, http, session);
    request.flush({
      ok: true,
      data: createPage([createOrder('order-1')], 1),
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const detailsButton = fixture.nativeElement.querySelector('[data-testid="record-details"]') as HTMLButtonElement;
    detailsButton.click();
    fixture.detectChanges();
    http.expectOne((candidate) => candidate.url.endsWith('/api/v1/trading/orders/order-1')).flush({
      ok: true,
      data: createOrder('order-1'),
    });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Orders details');
    expect(fixture.nativeElement.textContent).toContain('65000.00000000');
    expect(fixture.nativeElement.textContent).toContain('Not recorded');
  });

  it('shows persisted commission facts when a fill is opened', async () => {
    const request = await connectToResource(fixture, http, session, 'fills');
    request.flush({
      ok: true,
      data: createPage([createFill('fill-1')], 1),
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const detailsButton = fixture.nativeElement.querySelector('[data-testid="record-details"]') as HTMLButtonElement;
    detailsButton.click();
    fixture.detectChanges();
    http.expectOne((candidate) => candidate.url.endsWith('/api/v1/trading/fills/fill-1')).flush({
      ok: true,
      data: {
        ...createFill('fill-1'),
        commissions: [{
          id: 'commission-1',
          amount: '0.00000013',
          assetId: 'bnb-asset',
          assetCode: 'BNB',
          quoteValueAmount: null,
          quoteValueAssetId: null,
          quoteValueAssetCode: null,
        }],
      },
    });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Persisted commission facts');
    expect(fixture.nativeElement.textContent).toContain('0.00000013');
    expect(fixture.nativeElement.textContent).toContain('BNB');
    expect(fixture.nativeElement.textContent).toContain('Not recorded');
  });

  it('shows an API-unavailable state instead of replacing a failed request with sample records', async () => {
    session.setToken(API_TOKEN);
    fixture.detectChanges();
    http.expectOne((request) => request.url.endsWith('/api/v1/trading/metadata')).error(new ProgressEvent('error'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Harvester API is unavailable');
    expect(fixture.nativeElement.textContent).not.toContain('DEMO');
  });

  it('shows API request errors instead of presenting empty or sample records', async () => {
    const request = await connectToResource(fixture, http, session);
    request.flush({
      ok: false,
      error: {
        code: 'HARVESTER_TRADING_HISTORY_QUERY_FAILED',
        message: 'Trading-history query failed.',
      },
    }, {
      status: 500,
      statusText: 'Server Error',
    });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Harvester request failed (HTTP 500)');
    expect(fixture.nativeElement.textContent).not.toContain('DEMO');
  });
});
