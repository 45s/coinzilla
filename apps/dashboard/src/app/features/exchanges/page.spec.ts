import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExchangesComponent } from './page';

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

function createAccount(providerInstanceId: string, providerType: string, accountId: string) {
  return {
    providerInstanceId,
    providerType,
    accountId,
    environment: 'testnet',
    connected: true,
    accountSnapshot: {
      sourceTime: '2026-11-22T10:00:00.000Z',
      balances: [{ asset: { code: 'USDT' }, free: '100.00000000', locked: '0', total: '100.00000000' }],
    },
    openOrders: [],
    errors: {},
  };
}

function sendSnapshot(socket: FakeWebSocket, accounts: readonly object[]): void {
  socket.open();
  socket.receive({
    type: 'exchange-accounts.snapshot',
    observedAt: '2026-11-22T10:00:00.000Z',
    accounts,
  });
}

describe('ExchangesComponent', () => {
  let fixture: ComponentFixture<ExchangesComponent>;

  beforeEach(async () => {
    FakeWebSocket.instances = [];
    window.localStorage.removeItem('coinzilla.dashboard.exchange-favorites');
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
    await TestBed.configureTestingModule({
      imports: [ExchangesComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(ExchangesComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    window.localStorage.removeItem('coinzilla.dashboard.exchange-favorites');
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('uses only the Harvester WebSocket and renders the first account snapshot', () => {
    const socket = FakeWebSocket.instances[0];
    expect(socket.url).toBe('ws://127.0.0.1:4201/api/v1/trading/events');
    sendSnapshot(socket, [createAccount('binance-testnet', 'binance', 'primary')]);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('binance');
    expect(fixture.nativeElement.textContent).toContain('100.00000000');
    expect(fixture.nativeElement.textContent).toContain('Live WebSocket');
  });

  it('keeps persisted favourites above other accounts and toggles them', () => {
    window.localStorage.setItem('coinzilla.dashboard.exchange-favorites', JSON.stringify(['bitunix-live']));
    fixture.destroy();
    fixture = TestBed.createComponent(ExchangesComponent);
    fixture.detectChanges();
    const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    sendSnapshot(socket, [
      createAccount('binance-testnet', 'binance', 'primary'),
      createAccount('bitunix-live', 'bitunix', 'secondary'),
    ]);
    fixture.detectChanges();

    const cards = Array.from(fixture.nativeElement.querySelectorAll('.exchange-card')) as HTMLElement[];
    expect(cards[0].getAttribute('data-provider-id')).toBe('bitunix-live');

    const removeFavorite = fixture.nativeElement.querySelector('[aria-label="Remove from favourites"]') as HTMLButtonElement;
    removeFavorite.click();
    fixture.detectChanges();
    expect(window.localStorage.getItem('coinzilla.dashboard.exchange-favorites')).toBe('[]');

    const addFavorite = fixture.nativeElement.querySelector('[aria-label="Add to favourites"]') as HTMLButtonElement;
    addFavorite.click();
    fixture.detectChanges();
    expect(window.localStorage.getItem('coinzilla.dashboard.exchange-favorites')).toContain('bitunix-live');
  });

  it('filters accounts by search and connection status without disturbing favourite priority', () => {
    const socket = FakeWebSocket.instances[0];
    sendSnapshot(socket, [
      createAccount('binance-testnet', 'binance', 'primary'),
      { ...createAccount('bitunix-live', 'bitunix', 'secondary'), connected: false },
    ]);
    fixture.detectChanges();

    const search = fixture.nativeElement.querySelector('[data-testid="exchange-search"]') as HTMLInputElement;
    search.value = 'bitunix';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.exchange-card').length).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('bitunix');

    search.value = '';
    search.dispatchEvent(new Event('input'));
    const connection = fixture.nativeElement.querySelector('[data-testid="connection-filter"]') as HTMLSelectElement;
    connection.value = 'disconnected';
    connection.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.exchange-card').length).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('DISCONNECTED');
  });

  it('reconnects automatically and applies the fresh snapshot after a dropped socket', async () => {
    vi.useFakeTimers();
    const firstSocket = FakeWebSocket.instances[0];
    firstSocket.open();
    firstSocket.close();

    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeWebSocket.instances.length).toBe(2);
    sendSnapshot(FakeWebSocket.instances[1], [createAccount('bitunix-live', 'bitunix', 'secondary')]);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('bitunix');
    expect(fixture.nativeElement.textContent).toContain('Live WebSocket');
  });

  it('reconnects to request a fresh snapshot when refresh is selected', () => {
    const firstSocket = FakeWebSocket.instances[0];
    sendSnapshot(firstSocket, [createAccount('binance-testnet', 'binance', 'primary')]);
    fixture.detectChanges();

    const refresh = fixture.nativeElement.querySelector('.refresh-button') as HTMLButtonElement;
    refresh.click();
    fixture.detectChanges();
    expect(FakeWebSocket.instances.length).toBe(2);
    sendSnapshot(FakeWebSocket.instances[1], [createAccount('bitunix-live', 'bitunix', 'secondary')]);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('bitunix');
    expect(fixture.nativeElement.textContent).not.toContain('binance');
  });
});
