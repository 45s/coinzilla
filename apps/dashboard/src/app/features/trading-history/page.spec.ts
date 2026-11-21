import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TradingHistoryComponent } from './page';


class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = [];

  readyState = 0;
  readonly sent: string[] = [];

  constructor(readonly url: string) {
    super();
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  open(): void {
    this.readyState = 1;
    this.dispatchEvent(new Event('open'));
  }

  receive(message: Readonly<Record<string, unknown>>): void {
    this.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify(message),
    }));
  }

  close(): void {
    if (this.readyState >= 2) {
      return;
    }
    this.readyState = 3;
    this.dispatchEvent(new Event('close'));
  }
}

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
    exchangeOrderId: `broker-${id.replace(/^order-/, '')}`,
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
  resource: 'orders' | 'fills' | 'commissions' = 'orders',
) {
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

  beforeEach(async () => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
    await TestBed.configureTestingModule({
      imports: [TradingHistoryComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TradingHistoryComponent);
  });

  afterEach(() => {
    fixture.destroy();
    http.verify();
    vi.unstubAllGlobals();
  });

  it('shows an explicit connection form when no session token is available', () => {
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Connect to Harvester');
    expect(fixture.nativeElement.textContent).toContain('Bearer token');
  });

  it('clears a rejected session token and reports invalid credentials', async () => {
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
    const request = await connectToResource(fixture, http);
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
    const applySpy = vi.spyOn(fixture.componentInstance, 'applyFilters');
    applyButton.click();
    const applyPromise = applySpy.mock.results[0].value as Promise<void>;
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
    await applyPromise;
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Order broker-filtered');
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

    const root = fixture.nativeElement as HTMLElement;
    const nextButton = Array.from(root.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Next')) as HTMLButtonElement;
    const nextPageSpy = vi.spyOn(fixture.componentInstance, 'nextPage');
    nextButton.click();
    const nextPagePromise = nextPageSpy.mock.results[0].value as Promise<void>;
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
    await nextPagePromise;
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Page 2 of 2');
    expect(fixture.nativeElement.textContent).toContain('Order broker-page-2');
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

    const orderRow = fixture.nativeElement.querySelector('tbody tr') as HTMLTableRowElement;
    expect(orderRow.textContent).toContain('Order broker-1');
    expect(orderRow.textContent).not.toContain('order-1');
    expect(fixture.nativeElement.textContent).toContain('Orders details');
    expect(fixture.nativeElement.textContent).toContain('65000.00000000');
    expect(fixture.nativeElement.textContent).toContain('Not recorded');
  });

  it('labels an order limit price separately from a fill execution price', async () => {
    const request = await connectToResource(fixture, http, 'orders');
    request.flush({
      ok: true,
      data: createPage([createOrder('order-1')], 1),
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const headerText = fixture.nativeElement.querySelector('thead')?.textContent ?? '';
    expect(headerText).toContain('Limit price');
    expect(headerText).not.toContain('Execution price');
    expect(headerText).toContain('Order status');

    const row = fixture.nativeElement.querySelector('tbody tr') as HTMLTableRowElement;
    expect(row.textContent).toContain('65000.00000000');
  });

  it('shows an exchange trade reference when a fill has no linked order projection', async () => {
    const request = await connectToResource(fixture, http, session, 'fills');
    const compositeId = '["testnet","binanceTestnet","binance","binance-primary","binance:ZROUSDT","15507"]';
    const unlinkedFill = {
      ...createFill(compositeId),
      exchangeTradeId: '15507',
      exchangeOrderId: '981545',
      clientOrderId: 'h-c2fdfb99c955460bb003d6-3',
      orderId: null,
    };
    request.flush({
      ok: true,
      data: createPage([unlinkedFill], 1),
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const headerText = fixture.nativeElement.querySelector('thead')?.textContent ?? '';
    expect(headerText).toContain('Execution price');
    expect(headerText).toContain('Commission status');
    const row = fixture.nativeElement.querySelector('tbody tr') as HTMLTableRowElement;
    expect(row.textContent).toContain('Trade 15507');
    expect(row.textContent).not.toContain(compositeId);

    const detailsButton = fixture.nativeElement.querySelector('[data-testid="record-details"]') as HTMLButtonElement;
    detailsButton.click();
    fixture.detectChanges();
    http.expectOne((candidate) => candidate.url.endsWith(`/api/v1/trading/fills/${encodeURIComponent(compositeId)}`)).flush({
      ok: true,
      data: {
        ...unlinkedFill,
        commissions: [],
      },
    });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('h-c2fdfb99c955460bb003d6-3');
    expect(fixture.nativeElement.textContent).toContain('981545');
    expect(fixture.nativeElement.textContent).toContain('Internal persistence ID');
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

  it('authenticates the WebSocket without placing the token in the URL and resyncs after connection', async () => {
    const request = await connectToResource(fixture, http, session);
    request.flush({
      ok: true,
      data: createPage([createOrder('order-initial')], 1),
    });
    await fixture.whenStable();

    const socket = FakeWebSocket.instances[0];
    expect(socket.url).toBe('ws://127.0.0.1:4201/api/v1/trading/events');
    expect(socket.url).not.toContain(API_TOKEN);
    socket.open();
    expect(JSON.parse(socket.sent[0])).toEqual({
      type: 'authenticate',
      token: API_TOKEN,
    });

    socket.receive({ type: 'authenticated' });
    http.expectOne((candidate) => candidate.url.endsWith('/api/v1/trading/metadata')).flush({
      ok: true,
      data: {
        environment: 'testnet',
        records: { orders: 1, fills: 0, commissions: 0 },
      },
    });
    const resync = http.expectOne((candidate) => candidate.url.endsWith('/api/v1/trading/orders'));
    resync.flush({
      ok: true,
      data: createPage([createOrder('order-resynced')], 1),
    });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.liveStatus()).toBe('live');
    expect(fixture.nativeElement.textContent).toContain('Live updates');
    expect(fixture.nativeElement.textContent).toContain('Order broker-resynced');
  });

  it('refreshes the active resource after a persisted-change notification and reconnects with a fresh snapshot', async () => {
    const request = await connectToResource(fixture, http, session);
    request.flush({
      ok: true,
      data: createPage([createOrder('order-initial')], 1),
    });
    await fixture.whenStable();

    const firstSocket = FakeWebSocket.instances[0];
    firstSocket.open();
    http.expectOne((candidate) => candidate.url.endsWith('/api/v1/trading/metadata')).flush({
      ok: true,
      data: {
        environment: 'testnet',
        records: { orders: 1, fills: 0, commissions: 0 },
      },
    });
    http.expectOne((candidate) => candidate.url.endsWith('/api/v1/trading/orders')).flush({
      ok: true,
      data: createPage([createOrder('order-connected')], 1),
    });
    await fixture.whenStable();

    firstSocket.receive({
      type: 'trading-history.updated',
      resources: ['orders'],
    });
    const liveRefresh = http.expectOne((candidate) => candidate.url.endsWith('/api/v1/trading/orders'));
    liveRefresh.flush({
      ok: true,
      data: createPage([createOrder('order-live')], 1),
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    http.expectOne((candidate) => candidate.url.endsWith('/api/v1/trading/metadata')).flush({
      ok: true,
      data: {
        environment: 'testnet',
        records: { orders: 2, fills: 1, commissions: 1 },
      },
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Order broker-live');
    expect(fixture.nativeElement.textContent).toContain('2 orders');

    firstSocket.close();
    expect(fixture.componentInstance.liveStatus()).toBe('reconnecting');
    await new Promise((resolve) => setTimeout(resolve, 1050));
    const reconnectSocket = FakeWebSocket.instances[1];
    expect(reconnectSocket).toBeDefined();
    reconnectSocket.open();
    http.expectOne((candidate) => candidate.url.endsWith('/api/v1/trading/metadata')).flush({
      ok: true,
      data: {
        environment: 'testnet',
        records: { orders: 3, fills: 1, commissions: 1 },
      },
    });
    const reconnectSnapshot = http.expectOne((candidate) => candidate.url.endsWith('/api/v1/trading/orders'));
    reconnectSnapshot.flush({
      ok: true,
      data: createPage([createOrder('order-reconnected')], 1),
    });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.liveStatus()).toBe('live');
    expect(fixture.nativeElement.textContent).toContain('Order broker-reconnected');

    reconnectSocket.close();
    await new Promise((resolve) => setTimeout(resolve, 1050));
    expect(FakeWebSocket.instances[2]).toBeDefined();
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
