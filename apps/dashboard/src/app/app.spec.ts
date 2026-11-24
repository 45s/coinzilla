import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { AppComponent, readSavedDashboardTheme } from './app';

class BotsTestWebSocket extends EventTarget {
  static instances: BotsTestWebSocket[] = [];

  constructor(readonly url: string) {
    super();
    BotsTestWebSocket.instances.push(this);
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
    this.dispatchEvent(new Event('close'));
  }
}

function createBotsSnapshot() {
  return {
    type: 'bots.snapshot',
    version: 1,
    revision: 1,
    observedAt: '2026-11-24T09:00:00.000Z',
    data: {
      status: {
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
          },
          markets: {
            configured: 0,
            enabled: 0,
            blocked: 0,
          },
        },
      },
      markets: {
        ok: true,
        data: {
          markets: [],
        },
      },
      portfolio: {
        ok: true,
        data: {
          positions: [],
        },
      },
    },
  };
}

describe('AppComponent', () => {
  it('renders the Coinzilla dashboard shell and keeps the Overview explicitly labeled as preview data', async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient()],
    }).compileComponents();

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    const renderedText = fixture.nativeElement.textContent as string;

    expect(renderedText).toContain('coinzilla');
    expect(renderedText).toContain('Overview');
    expect(renderedText).toContain('MOCK DATA');
    expect(renderedText).toContain('Portfolio performance');
    expect(renderedText).toContain('fictional demo data');
  });

  it('provides a dedicated Bots workspace from the live Harvester snapshot stream', async () => {
    vi.stubGlobal('WebSocket', BotsTestWebSocket as unknown as typeof WebSocket);
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const botsButton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button.nav-item'))
      .find((button) => button.textContent?.includes('Bots')) as HTMLButtonElement | undefined;
    expect(botsButton, 'The primary navigation must expose Bots as a separate workspace.').toBeDefined();
    if (!botsButton) return;

    botsButton.click();
    fixture.detectChanges();
    const socket = BotsTestWebSocket.instances.at(-1);
    if (!socket) throw new Error('Bots workspace did not open its WebSocket connection.');
    socket.open();
    socket.sendMessage(createBotsSnapshot());
    fixture.detectChanges();

    const http = TestBed.inject(HttpTestingController);
    http.expectNone('http://127.0.0.1:4201/api/v1/trading/operator/status');
    http.expectNone('http://127.0.0.1:4201/api/v1/trading/operator/markets');
    http.expectNone('http://127.0.0.1:4201/api/v1/trading/operator/portfolio');

    const renderedText = (fixture.nativeElement as HTMLElement).textContent as string;
    expect(renderedText, 'The Bots workspace must identify itself as a live Harvester control surface.').toContain('HARVESTER / BOT CONTROL');
    expect(renderedText, 'The Bots workspace must summarize the active runtime strategy mode.').toContain('Strategy mode');
    expect(renderedText, 'The Bots workspace must expose process uptime.').toContain('Running time');
    expect(renderedText, 'The Bots workspace must expose configured market controls.').toContain('Market controls');
    expect(renderedText, 'The Bots workspace must show the Portfolio position view.').toContain('Portfolio positions');

    fixture.destroy();
    vi.unstubAllGlobals();
    BotsTestWebSocket.instances = [];
  });

  it('navigates to real-record Orders, Fills and Commissions pages', async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient()],
    }).compileComponents();

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const ordersButton = Array.from(root.querySelectorAll('button.nav-item'))
      .find((button) => button.textContent?.includes('Orders')) as HTMLButtonElement;
    ordersButton.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Connecting to Harvester');
    expect(fixture.nativeElement.textContent).toContain('Orders');

    const fillsButton = Array.from(root.querySelectorAll('button.nav-item'))
      .find((button) => button.textContent?.includes('Fills')) as HTMLButtonElement;
    fillsButton.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Fills');

    const commissionsButton = Array.from(root.querySelectorAll('button.nav-item'))
      .find((button) => button.textContent?.includes('Commissions')) as HTMLButtonElement;
    commissionsButton.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Commissions');
  });

  it('navigates to the separate live Open Orders page without replacing persisted order history', async () => {
    class TestWebSocket extends EventTarget {
      constructor(readonly url: string) { super(); }
      close(): void { this.dispatchEvent(new Event('close')); }
    }
    vi.stubGlobal('WebSocket', TestWebSocket as unknown as typeof WebSocket);
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient()],
    }).compileComponents();

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const openOrdersButton = Array.from(root.querySelectorAll('button.nav-item'))
      .find((button) => button.textContent?.includes('Open Orders')) as HTMLButtonElement;
    expect(openOrdersButton).toBeDefined();
    openOrdersButton.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Open Orders');
    expect(fixture.nativeElement.textContent).toContain('HARVESTER / LIVE ACCOUNT SNAPSHOTS');
    expect(fixture.nativeElement.textContent).toContain('Waiting for open-order snapshots');

    fixture.destroy();
    vi.unstubAllGlobals();
  });

  it('offers the existing theme plus six palettes and persists the selected theme', async () => {
    window.localStorage.removeItem('coinzilla.dashboard.theme');
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient()],
    }).compileComponents();

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector('select[aria-label="Dashboard theme"]') as HTMLSelectElement;
    expect(select.options.length).toBe(8);
    expect(Array.from(select.options).map((option) => option.value)).toEqual([
      'current', 'midnight', 'light', 'oled', 'green', 'arctic', 'warm', 'system',
    ]);

    select.value = 'light';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(window.localStorage.getItem('coinzilla.dashboard.theme')).toBe('light');

    fixture.destroy();
    window.localStorage.removeItem('coinzilla.dashboard.theme');
  });

  it('reads a previously saved theme during component initialization', () => {
    window.localStorage.setItem('coinzilla.dashboard.theme', 'light');
    expect(readSavedDashboardTheme(window.localStorage)).toBe('light');
    expect(readSavedDashboardTheme(undefined)).toBe('current');
    expect(readSavedDashboardTheme({
      getItem: () => 'not-a-theme',
    })).toBe('current');
    expect(readSavedDashboardTheme({
      getItem: () => { throw new Error('storage unavailable'); },
    })).toBe('current');
    window.localStorage.removeItem('coinzilla.dashboard.theme');
  });
});
