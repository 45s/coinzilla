import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OpenOrdersComponent } from './page';

class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = [];

  readyState = 0;

  constructor(readonly url: string) {
    super();
    FakeWebSocket.instances.push(this);
  }

  open(): void {
    this.readyState = 1;
    this.dispatchEvent(new Event('open'));
  }

  receive(message: Readonly<Record<string, unknown>>): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
  }

  close(): void {
    if (this.readyState >= 2) return;
    this.readyState = 3;
    this.dispatchEvent(new Event('close'));
  }
}

function createAccount(providerInstanceId: string, providerType: string, accountId: string, orders: readonly object[]) {
  return {
    providerInstanceId,
    providerType,
    accountId,
    environment: 'testnet',
    connected: true,
    accountSnapshot: null,
    openOrders: orders,
    errors: {},
  };
}

function createOrder(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'LIMIT',
    price: '65000.00000000',
    originalQuantity: '0.01000000',
    executedQuantity: '0.00400000',
    remainingQuantity: '0.00600000',
    status: 'PARTIALLY_FILLED',
    exchangeOrderId: 'exchange-order-1',
    clientOrderId: 'client-order-1',
    ...overrides,
  };
}

describe('OpenOrdersComponent', () => {
  let fixture: ComponentFixture<OpenOrdersComponent>;

  beforeEach(async () => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
    await TestBed.configureTestingModule({
      imports: [OpenOrdersComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(OpenOrdersComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    vi.unstubAllGlobals();
  });

  function sendSnapshot(accounts: readonly object[]): void {
    const socket = FakeWebSocket.instances[0];
    expect(socket.url).toBe('ws://127.0.0.1:4201/api/v1/trading/events');
    socket.open();
    socket.receive({
      type: 'exchange-accounts.snapshot',
      observedAt: '2026-11-22T10:00:00.000Z',
      accounts,
    });
    fixture.detectChanges();
  }

  it('shows open orders grouped by CEX with full order details', () => {
    sendSnapshot([
      createAccount('binance-testnet', 'binance', 'primary', [createOrder()]),
      createAccount('bitunix-live', 'bitunix', 'secondary', [createOrder({
        symbol: 'ETHUSDT',
        side: 'SELL',
        status: 'NEW',
        exchangeOrderId: 'bitunix-order-2',
      })]),
    ]);

    expect(fixture.nativeElement.textContent).toContain('2 matching orders');
    expect(fixture.nativeElement.textContent).toContain('binance');
    expect(fixture.nativeElement.textContent).toContain('bitunix');
    expect(fixture.nativeElement.textContent).toContain('65000.00000000');

    const detailsButtons = fixture.nativeElement.querySelectorAll('.details-button') as NodeListOf<HTMLButtonElement>;
    detailsButtons[0].click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('All available order fields');
    expect(fixture.nativeElement.textContent).toContain('exchange-order-1');
    expect(fixture.nativeElement.textContent).toContain('0.00600000');
  });

  it('filters orders by provider, symbol and side', () => {
    sendSnapshot([
      createAccount('binance-testnet', 'binance', 'primary', [createOrder()]),
      createAccount('bitunix-live', 'bitunix', 'secondary', [createOrder({
        symbol: 'ETHUSDT',
        side: 'SELL',
        exchangeOrderId: 'bitunix-order-2',
      })]),
    ]);

    const search = fixture.nativeElement.querySelector('[data-testid="order-search"]') as HTMLInputElement;
    search.value = 'ETHUSDT';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('1 matching orders');
    expect(fixture.nativeElement.textContent).toContain('ETHUSDT');
    expect(fixture.nativeElement.textContent).not.toContain('BTCUSDT');

    search.value = '';
    search.dispatchEvent(new Event('input'));
    const provider = fixture.nativeElement.querySelector('[data-testid="provider-filter"]') as HTMLSelectElement;
    provider.value = 'binance-testnet';
    provider.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('BTCUSDT');
    expect(fixture.nativeElement.textContent).not.toContain('ETHUSDT');
  });

  it('shows a truthful empty state when no connected account has open orders', () => {
    sendSnapshot([createAccount('binance-testnet', 'binance', 'primary', [])]);
    expect(fixture.nativeElement.textContent).toContain('No open orders match these filters');
  });

  it('does not turn a failed open-order read into an empty order list', () => {
    sendSnapshot([{
      ...createAccount('binance-testnet', 'binance', 'primary', []),
      openOrders: null,
      errors: { openOrders: 'Open orders are unavailable.' },
    }]);
    expect(fixture.nativeElement.textContent).toContain('Open orders are unavailable.');
  });
});
