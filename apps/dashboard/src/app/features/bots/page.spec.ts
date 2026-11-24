import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BotsComponent } from './page';

const BASE_URL = 'http://127.0.0.1:4201/api/v1/trading/operator';

class MockWebSocket extends EventTarget {
  static instances: MockWebSocket[] = [];
  closed = false;

  constructor(readonly url: string) {
    super();
    MockWebSocket.instances.push(this);
  }

  open(): void {
    this.dispatchEvent(new Event('open'));
  }

  sendMessage(message: unknown): void {
    this.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify(message),
    }));
  }

  close(): void {
    this.closed = true;
    this.dispatchEvent(new Event('close'));
  }
}

function createStatusResource() {
  return {
    ok: true,
    data: {
      observedAt: 120000,
      startedAt: 60000,
      runtimeState: 'RUNNING',
      broker: 'binance',
      tradingEnabled: true,
      tradingMode: 'testnet',
      strategyMode: 'conservative-testnet',
      stopping: false,
      readiness: {
        state: 'READY',
        blockers: [],
      },
      userData: {
        ready: true,
        status: 'READY',
        ageMs: 500,
        lastEventAt: 119500,
      },
      markets: {
        configured: 3,
        enabled: 2,
        blocked: 1,
      },
    },
  };
}

function createMarketsResource({ paused = false } = {}) {
  return {
    ok: true,
    data: {
      markets: [
        {
          symbol: 'BTCUSDT',
          enabled: true,
          operatorBuysPaused: paused,
          readiness: 'READY',
          blockers: [],
          latestPrice: '65000.00000000',
          priceFresh: true,
        },
        {
          symbol: 'ADAUSDT',
          enabled: true,
          operatorBuysPaused: false,
          readiness: 'BLOCKED',
          blockers: ['USER_DATA_NOT_READY'],
          latestPrice: null,
          priceFresh: false,
        },
        {
          symbol: 'SOLUSDT',
          enabled: false,
          operatorBuysPaused: false,
          readiness: 'DISABLED',
          blockers: [],
        },
      ],
    },
  };
}

function createPortfolioResource({ positions = true } = {}) {
  return {
    ok: true,
    data: {
      positions: positions ? [
        {
          symbol: 'BTCUSDT',
          baseAsset: 'BTC',
          quoteAsset: 'USDT',
          activeQuantity: '0.12500000',
          freeQuantity: '0.00100000',
          totalQuantity: '0.12600000',
          investedQuote: '500.00000000',
          quoteNetCashFlow: '-500.00000000',
          recovery: {
            buyCost: '500.00000000',
            netSellProceeds: '0',
            outstandingRecoveryAmount: '500.00000000',
            realizedNetProfit: '0',
          },
        },
      ] : [],
    },
  };
}

function createSnapshotMessage({ revision = 1, paused = false, positions = true } = {}) {
  return {
    type: 'bots.snapshot',
    version: 1,
    revision,
    observedAt: '2026-11-24T09:00:00.000Z',
    data: {
      status: createStatusResource(),
      markets: createMarketsResource({
        paused,
      }),
      portfolio: createPortfolioResource({
        positions,
      }),
    },
  };
}

function createUnavailableMessage() {
  const snapshot = createSnapshotMessage();
  return {
    ...snapshot,
    type: 'bots.snapshot.unavailable',
    data: {
      ...snapshot.data,
      markets: {
        ok: false,
        error: {
          code: 'HARVESTER_OPERATOR_SNAPSHOT_READ_FAILED',
          message: 'Harvester operator snapshot is unavailable.',
        },
      },
    },
  };
}

async function createBotsFixture(): Promise<{
  fixture: ComponentFixture<BotsComponent>;
  http: HttpTestingController;
  socket: MockWebSocket;
}> {
  await TestBed.configureTestingModule({
    imports: [BotsComponent],
    providers: [provideHttpClient(), provideHttpClientTesting()],
  }).compileComponents();
  const http = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(BotsComponent);
  fixture.detectChanges();
  const socket = MockWebSocket.instances.at(-1);
  if (!socket) throw new Error('Bots component did not create its WebSocket connection.');
  socket.open();
  socket.sendMessage(createSnapshotMessage());
  fixture.detectChanges();
  return {
    fixture,
    http,
    socket,
  };
}

describe('BotsComponent', () => {
  let http: HttpTestingController | undefined;

  afterEach(() => {
    http?.verify();
    http = undefined;
    MockWebSocket.instances = [];
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('renders authoritative runtime, market and Portfolio snapshots from WebSocket only', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const result = await createBotsFixture();
    http = result.http;
    const { fixture } = result;
    const renderedText = (fixture.nativeElement as HTMLElement).textContent as string;

    expect(renderedText).toContain('HARVESTER / BOT CONTROL');
    expect(renderedText).toContain('conservative-testnet');
    expect(renderedText).toContain('Individual strategy states');
    expect(renderedText).toContain('Market-level');
    expect(renderedText).toContain('1m 0s');
    expect(renderedText).toContain('SOLUSDT');
    expect(renderedText).toContain('Disabled markets');
    expect(renderedText).toContain('Unavailable');
    expect(renderedText).toContain('USER_DATA_NOT_READY');
    expect(renderedText).toContain('0.12500000');
    expect(renderedText).toContain('500.00000000');
    expect(renderedText).toContain('Snapshot fresh');
    expect(renderedText).toContain('WebSocket connected');
    http.expectNone(`${BASE_URL}/status`);
    http.expectNone(`${BASE_URL}/markets`);
    http.expectNone(`${BASE_URL}/portfolio`);
    http.expectNone(`${BASE_URL}/orders`);
    http.expectNone(`${BASE_URL}/balances`);
  });

  it('confirms a market BUY pause and waits for the next authoritative stream snapshot', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const result = await createBotsFixture();
    http = result.http;
    const { fixture, socket } = result;
    const buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'));
    const pauseButton = buttons.find((button) => button.textContent?.trim() === 'Pause BUYs') as HTMLButtonElement;
    expect(pauseButton).toBeDefined();
    pauseButton.click();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Confirm: Pause BUYs for BTCUSDT');

    const confirmButton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Confirm command')) as HTMLButtonElement;
    confirmButton.click();
    const command = http.expectOne(`${BASE_URL}/commands`);
    expect(command.request.method).toBe('POST');
    expect(command.request.body).toMatchObject({
      command: 'pause',
      symbol: 'BTCUSDT',
    });
    command.flush({
      ok: true,
      data: {
        symbol: 'BTCUSDT',
        paused: true,
        canceled: 0,
        reconciled: 0,
        unresolved: 0,
      },
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('waiting for the live snapshot');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Snapshot stale');

    socket.sendMessage(createSnapshotMessage({
      revision: 2,
      paused: true,
    }));
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('BUYs paused');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Snapshot fresh');
    http.expectNone(`${BASE_URL}/status`);
    http.expectNone(`${BASE_URL}/markets`);
    http.expectNone(`${BASE_URL}/portfolio`);
  });

  it('cancels a pending market pause without sending a command', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const result = await createBotsFixture();
    http = result.http;
    const { fixture } = result;
    const pauseButton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Pause BUYs') as HTMLButtonElement;
    pauseButton.click();
    fixture.detectChanges();

    const cancelButton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Cancel') as HTMLButtonElement;
    expect(cancelButton).toBeDefined();
    cancelButton.click();
    fixture.detectChanges();

    http.expectNone(`${BASE_URL}/commands`);
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Confirm: Pause BUYs for BTCUSDT');
  });

  it('ignores stale snapshot revisions and marks retained data stale on disconnect', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const result = await createBotsFixture();
    http = result.http;
    const { fixture, socket } = result;
    socket.sendMessage(createSnapshotMessage({
      revision: 2,
      paused: true,
    }));
    socket.sendMessage(createSnapshotMessage({
      revision: 1,
      paused: false,
    }));
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('BUYs paused');

    socket.close();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Snapshot stale');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Reconnecting to Harvester');
  });

  it('reconnects and accepts a new server revision epoch after Harvester restarts', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const result = await createBotsFixture();
    http = result.http;
    const { fixture, socket } = result;
    vi.useFakeTimers();
    socket.close();
    await vi.advanceTimersByTimeAsync(1_000);

    const reconnect = MockWebSocket.instances.at(-1);
    if (!reconnect) throw new Error('Bots component did not reconnect its WebSocket.');
    expect(MockWebSocket.instances).toHaveLength(2);
    reconnect.open();
    reconnect.sendMessage(createSnapshotMessage({
      revision: 1,
      paused: true,
    }));
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('BUYs paused');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Snapshot fresh');
  });

  it('marks an incomplete initial snapshot unavailable and keeps controls disabled', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    await TestBed.configureTestingModule({
      imports: [BotsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(BotsComponent);
    fixture.detectChanges();
    const socket = MockWebSocket.instances.at(-1);
    if (!socket) throw new Error('Bots component did not create its WebSocket connection.');
    socket.open();
    socket.sendMessage(createUnavailableMessage());
    fixture.detectChanges();

    const renderedText = (fixture.nativeElement as HTMLElement).textContent as string;
    expect(renderedText).toContain('Snapshot unavailable');
    expect(renderedText).toContain('A Harvester operator read model is unavailable');
    const pauseAllButton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Pause all BUYs') as HTMLButtonElement;
    expect(pauseAllButton.disabled).toBe(true);
    http.expectNone(`${BASE_URL}/status`);
    http.expectNone(`${BASE_URL}/markets`);
    http.expectNone(`${BASE_URL}/portfolio`);
  });

  it('closes the stream and cancels reconnect work when the page is destroyed', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const result = await createBotsFixture();
    http = result.http;
    const { fixture, socket } = result;
    fixture.destroy();
    expect(socket.closed).toBe(true);
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});
