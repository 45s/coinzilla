import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { MarketScreenerComponent } from './page';

const MARKET_DATA_URL = 'http://127.0.0.1:4201/api/v1/markets/bitunix/futures';

function createSnapshot() {
  return {
    provider: 'bitunix' as const,
    marketType: 'futures' as const,
    observedAt: '2026-11-21T12:00:00.000Z',
    markets: [{
      symbol: 'BTCUSDT',
      base: 'BTC',
      quote: 'USDT',
      symbolStatus: 'OPEN',
      isApiSupported: true,
      maxLeverage: 125,
      lastPrice: '67000.10',
      markPrice: '67001.20',
      open: '65000.00',
      high: '68000.00',
      low: '64000.00',
      quoteVol: '123456.78',
      baseVol: '12.5',
      change5m: null,
      change1h: null,
      change4h: null,
      change24h: null,
    }],
  };
}

describe('MarketScreenerComponent', () => {
  let http: HttpTestingController;

  afterEach(() => {
    http.verify();
    document.cookie = 'coinzilla_market_favorites_bitunix_futures=; Path=/; Max-Age=0';
  });

  it('defaults to Bitunix Futures and renders absent native movement fields as N/A', async () => {
    await TestBed.configureTestingModule({
      imports: [MarketScreenerComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(MarketScreenerComponent);
    fixture.detectChanges();

    const request = http.expectOne(MARKET_DATA_URL);
    expect(request.request.method).toBe('GET');
    request.flush({ ok: true, data: createSnapshot() });
    await fixture.whenStable();
    fixture.detectChanges();

    const renderedText = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(renderedText).toContain('Bitunix · Futures');
    expect(renderedText).toContain('BTCUSDT');
    expect(renderedText).toContain('67000.10');
    expect(renderedText).toContain('N/A');
    expect(renderedText).toContain('Movement values are shown only when returned by Bitunix');
    const movementFilter = fixture.nativeElement.querySelector('select[aria-label="24-hour movement filter"]') as HTMLSelectElement;
    expect(movementFilter.disabled).toBe(true);
    expect(Array.from(movementFilter.options)).toHaveLength(3);
  });

  it('persists a favourite in the Bitunix Futures cookie when the star is toggled', async () => {
    await TestBed.configureTestingModule({
      imports: [MarketScreenerComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(MarketScreenerComponent);
    fixture.detectChanges();
    http.expectOne(MARKET_DATA_URL).flush({ ok: true, data: createSnapshot() });
    await fixture.whenStable();
    fixture.detectChanges();

    const favoriteButton = fixture.nativeElement.querySelector('.favorite-toggle') as HTMLButtonElement;
    favoriteButton.click();
    fixture.detectChanges();

    expect(document.cookie).toContain('coinzilla_market_favorites_bitunix_futures=');
    expect(favoriteButton.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows future providers as unavailable options instead of presenting fake market data', async () => {
    await TestBed.configureTestingModule({
      imports: [MarketScreenerComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(MarketScreenerComponent);
    fixture.detectChanges();
    const selector = fixture.nativeElement.querySelector('select[aria-label="Market source"]') as HTMLSelectElement;

    expect(selector.disabled).toBe(false);
    expect(Array.from(selector.options).filter((option) => option.disabled)).toHaveLength(3);
    http.expectOne(MARKET_DATA_URL).flush({
      ok: true,
      data: {
        provider: 'bitunix',
        marketType: 'futures',
        observedAt: '2026-11-21T12:00:00.000Z',
        markets: [],
      },
    });
    await fixture.whenStable();
  });
});
