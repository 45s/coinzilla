import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { BotsComponent } from './page';

const BASE_URL = 'http://127.0.0.1:4201/api/v1/trading/operator';

function flushInitialSnapshots(http: HttpTestingController, { paused = false, positions = true } = {}): void {
  http.expectOne(`${BASE_URL}/status`).flush({
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
      readiness: { state: 'READY', blockers: [] },
      userData: { ready: true, status: 'READY', ageMs: 500, lastEventAt: 119500 },
      markets: { configured: 3, enabled: 2, blocked: 1 },
    },
  });
  http.expectOne(`${BASE_URL}/markets`).flush({
    ok: true,
    data: {
      markets: [
        { symbol: 'BTCUSDT', enabled: true, operatorBuysPaused: paused, readiness: 'READY', blockers: [], latestPrice: '65000.00000000', priceFresh: true },
        { symbol: 'ADAUSDT', enabled: true, operatorBuysPaused: false, readiness: 'BLOCKED', blockers: ['USER_DATA_NOT_READY'], latestPrice: null, priceFresh: false },
        { symbol: 'SOLUSDT', enabled: false, operatorBuysPaused: false, readiness: 'DISABLED', blockers: [] },
      ],
    },
  });
  http.expectOne(`${BASE_URL}/portfolio`).flush({
    ok: true,
    data: {
      positions: positions ? [{
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
      }] : [],
    },
  });
}

describe('BotsComponent', () => {
  let http: HttpTestingController | undefined;

  afterEach(() => {
    http?.verify();
  });

  it('loads live runtime, market and Portfolio snapshots without converting financial decimals', async () => {
    await TestBed.configureTestingModule({
      imports: [BotsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(BotsComponent);
    fixture.detectChanges();
    flushInitialSnapshots(http);
    await fixture.componentInstance.lastRefresh;
    await fixture.whenStable();
    fixture.detectChanges();

    const renderedText = (fixture.nativeElement as HTMLElement).textContent as string;
    expect(renderedText, 'The Bots page must identify the live Harvester control surface.').toContain('HARVESTER / BOT CONTROL');
    expect(renderedText, 'The active runtime strategy mode must come from Harvester status.').toContain('conservative-testnet');
    expect(renderedText, 'Process uptime must be calculated from Harvester start and observation timestamps.').toContain('1m 0s');
    expect(renderedText, 'Configured disabled markets must remain visible as disabled.').toContain('SOLUSDT');
    expect(renderedText, 'Disabled markets must not be conflated with active or blocked markets.').toContain('Disabled markets');
    expect(renderedText, 'An explicitly disabled market must not be shown as an actionable market.').toContain('Unavailable');
    expect(renderedText, 'Blocked markets must show their actual readiness blocker.').toContain('USER_DATA_NOT_READY');
    expect(renderedText, 'Portfolio base quantity must preserve the exact decimal string.').toContain('0.12500000');
    expect(renderedText, 'Portfolio quote cost must preserve the exact decimal string.').toContain('500.00000000');
  });

  it('confirms a market BUY pause and refreshes the authoritative market state', async () => {
    await TestBed.configureTestingModule({
      imports: [BotsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(BotsComponent);
    fixture.detectChanges();
    flushInitialSnapshots(http);
    await fixture.componentInstance.lastRefresh;
    await fixture.whenStable();
    fixture.detectChanges();

    const pauseButton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Pause BUYs') as HTMLButtonElement;
    expect(pauseButton, 'An enabled market must expose its market-scoped BUY pause action.').toBeDefined();
    pauseButton.click();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent, 'A pause request must require explicit confirmation.').toContain('Confirm: Pause BUYs for BTCUSDT');

    const confirmButton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Confirm command')) as HTMLButtonElement;
    expect(confirmButton, 'The confirmation panel must expose a command confirmation action.').toBeDefined();
    confirmButton.click();

    const command = http.expectOne(`${BASE_URL}/commands`);
    expect(command.request.method, 'The confirmed market pause must use the existing operator command endpoint.').toBe('POST');
    expect(command.request.body, 'The command must target only the selected market BUY gate.').toMatchObject({ command: 'pause', symbol: 'BTCUSDT' });
    command.flush({ ok: true, data: { symbol: 'BTCUSDT', paused: true, canceled: 0, reconciled: 0, unresolved: 0 } });

    await Promise.resolve();
    flushInitialSnapshots(http, { paused: true });
    await fixture.componentInstance.lastRefresh;
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent, 'The page must show the refreshed Harvester pause state after command success.').toContain('BUYs paused');
  });

  it('cancels a pending pause without sending a command', async () => {
    await TestBed.configureTestingModule({
      imports: [BotsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(BotsComponent);
    fixture.detectChanges();
    flushInitialSnapshots(http);
    await fixture.componentInstance.lastRefresh;
    await fixture.whenStable();
    fixture.detectChanges();

    const pauseButton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Pause BUYs') as HTMLButtonElement;
    pauseButton.click();
    fixture.detectChanges();

    const cancelButton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Cancel') as HTMLButtonElement;
    expect(cancelButton, 'The confirmation panel must let the operator cancel before sending.').toBeDefined();
    cancelButton.click();
    fixture.detectChanges();

    http.expectNone(`${BASE_URL}/commands`);
    expect((fixture.nativeElement as HTMLElement).textContent, 'Cancel must close the confirmation panel.').not.toContain('Confirm: Pause BUYs for BTCUSDT');
  });

  it('sends an explicitly confirmed market resume through the existing unpause command', async () => {
    await TestBed.configureTestingModule({
      imports: [BotsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(BotsComponent);
    fixture.detectChanges();
    flushInitialSnapshots(http, { paused: true });
    await fixture.componentInstance.lastRefresh;
    await fixture.whenStable();
    fixture.detectChanges();

    const resumeButton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Resume BUYs') as HTMLButtonElement;
    expect(resumeButton, 'A paused enabled market must expose its market-scoped resume action.').toBeDefined();
    resumeButton.click();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent, 'Resuming must require explicit confirmation.').toContain('Confirm: Resume BUYs for BTCUSDT');

    const confirmButton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Confirm command')) as HTMLButtonElement;
    confirmButton.click();

    const command = http.expectOne(`${BASE_URL}/commands`);
    expect(command.request.body, 'The resume command must target only the selected market BUY gate.').toMatchObject({ command: 'unpause', symbol: 'BTCUSDT' });
    command.flush({ ok: true, data: { symbol: 'BTCUSDT', paused: false } });

    await Promise.resolve();
    flushInitialSnapshots(http, { paused: false });
    await fixture.componentInstance.lastRefresh;
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent, 'The refreshed market state must show BUYs active after resume.').toContain('BUYs active');
  });

  it('confirms a global BUY pause without adding a market symbol', async () => {
    await TestBed.configureTestingModule({
      imports: [BotsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(BotsComponent);
    fixture.detectChanges();
    flushInitialSnapshots(http);
    await fixture.componentInstance.lastRefresh;
    await fixture.whenStable();
    fixture.detectChanges();

    const pauseAllButton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Pause all BUYs') as HTMLButtonElement;
    expect(pauseAllButton, 'The workspace must expose the existing global BUY pause control.').toBeDefined();
    pauseAllButton.click();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent, 'Global BUY pause must require explicit confirmation.').toContain('Confirm: Pause BUYs across all markets');

    const confirmButton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Confirm command')) as HTMLButtonElement;
    confirmButton.click();

    const command = http.expectOne(`${BASE_URL}/commands`);
    expect(command.request.body, 'Global pause must use the existing global command without a market symbol.').toMatchObject({ command: 'pauseallbuys' });
    expect(command.request.body, 'A global pause must not accidentally target one market.').not.toHaveProperty('symbol');
    command.flush({ ok: true, data: { paused: true, canceled: 0, reconciled: 0, unresolved: 0 } });

    await Promise.resolve();
    flushInitialSnapshots(http);
    await fixture.componentInstance.lastRefresh;
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent, 'The global pause action must complete and refresh the authoritative snapshot.').toContain('Pause BUYs across all markets accepted by Harvester.');
  });

  it('keeps the connection unavailable when any required operator snapshot fails', async () => {
    await TestBed.configureTestingModule({
      imports: [BotsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(BotsComponent);
    fixture.detectChanges();
    http.expectOne(`${BASE_URL}/status`).flush({ error: { message: 'status unavailable' } }, {
      status: 503,
      statusText: 'Service Unavailable',
    });
    http.expectOne(`${BASE_URL}/markets`).flush({ ok: true, data: { markets: [] } });
    http.expectOne(`${BASE_URL}/portfolio`).flush({ ok: true, data: { positions: [] } });
    await fixture.componentInstance.lastRefresh;
    await fixture.whenStable();
    fixture.detectChanges();

    const renderedText = (fixture.nativeElement as HTMLElement).textContent as string;
    expect(renderedText, 'A failed Harvester query must not be presented as a connected runtime.').toContain('Harvester unavailable');
    expect(renderedText, 'The API failure must remain visible to the operator.').toContain('status unavailable');
  });

  it('shows an explicit empty Portfolio state when Harvester reports no positions', async () => {
    await TestBed.configureTestingModule({
      imports: [BotsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(BotsComponent);
    fixture.detectChanges();
    flushInitialSnapshots(http, { positions: false });
    await fixture.componentInstance.lastRefresh;
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent, 'An empty Portfolio must be distinguished from an unavailable Harvester snapshot.').toContain('No Portfolio positions');
  });
});
