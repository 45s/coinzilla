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
    localStorage.removeItem('coinzilla_market_screener_preferences_v1');
    localStorage.removeItem('coinzilla_market_screener_presets_v1');
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
    const movementWindow = fixture.nativeElement.querySelector('select[aria-label="Movement window"]') as HTMLSelectElement;
    const movementDirection = fixture.nativeElement.querySelector('select[aria-label="Movement direction"]') as HTMLSelectElement;
    expect(movementWindow.value).toBe('change24h');
    expect(movementWindow.disabled).toBe(true);
    expect(movementDirection.value).toBe('all');
    expect(movementDirection.disabled).toBe(true);
    expect(Array.from(movementWindow.options)).toHaveLength(4);
    expect(Array.from(movementDirection.options)).toHaveLength(3);
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
  it('filters only against the native percentage for the selected window', async () => {
    await TestBed.configureTestingModule({
      imports: [MarketScreenerComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(MarketScreenerComponent);
    fixture.detectChanges();
    const snapshot = createSnapshot();
    const market = {
      ...snapshot.markets[0],
      change1h: '-0.25',
    };
    http.expectOne(MARKET_DATA_URL).flush({
      ok: true,
      data: {
        ...snapshot,
        markets: [market],
      },
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const movementWindow = fixture.nativeElement.querySelector('select[aria-label="Movement window"]') as HTMLSelectElement;
    const movementDirection = fixture.nativeElement.querySelector('select[aria-label="Movement direction"]') as HTMLSelectElement;
    expect(movementWindow.disabled).toBe(false);
    expect(movementDirection.disabled).toBe(true);

    movementWindow.value = 'change1h';
    movementWindow.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(movementDirection.disabled).toBe(false);

    movementDirection.value = 'negative';
    movementDirection.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('BTCUSDT');

    movementDirection.value = 'positive';
    movementDirection.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('BTCUSDT');
  });

  it('retains the last market snapshot when navigating away and back', async () => {
    await TestBed.configureTestingModule({
      imports: [MarketScreenerComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);

    const firstFixture = TestBed.createComponent(MarketScreenerComponent);
    firstFixture.detectChanges();
    http.expectOne(MARKET_DATA_URL).flush({ ok: true, data: createSnapshot() });
    await firstFixture.whenStable();
    firstFixture.detectChanges();
    expect((firstFixture.nativeElement as HTMLElement).textContent).toContain('BTCUSDT');

    firstFixture.destroy();

    const secondFixture = TestBed.createComponent(MarketScreenerComponent);
    secondFixture.detectChanges();
    expect((secondFixture.nativeElement as HTMLElement).textContent).toContain('BTCUSDT');
    http.expectNone(MARKET_DATA_URL);
    secondFixture.destroy();
  });


  it('pins favourites above other markets and filters by custom labels and numeric ranges', async () => {
    await TestBed.configureTestingModule({
      imports: [MarketScreenerComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(MarketScreenerComponent);
    fixture.detectChanges();
    const snapshot = createSnapshot();
    const secondMarket = { ...snapshot.markets[0], symbol: 'ETHUSDT', base: 'ETH', lastPrice: '3200.00' };
    http.expectOne(MARKET_DATA_URL).flush({
      ok: true,
      data: { ...snapshot, markets: [secondMarket, snapshot.markets[0]] },
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const rows = () => Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr')).filter((row) => !row.querySelector('.empty-state'));
    expect(rows()[0].textContent).toContain('ETHUSDT');

    const btcFavorite = fixture.nativeElement.querySelector('button[aria-label^="Add BTCUSDT"]') as HTMLButtonElement;
    btcFavorite.click();
    fixture.detectChanges();
    expect(rows()[0].textContent).toContain('BTCUSDT');

    const labelName = fixture.nativeElement.querySelector('input[aria-label="New label name"]') as HTMLInputElement;
    labelName.value = 'JOHN';
    labelName.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const addLabel = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Add label')) as HTMLButtonElement;
    addLabel.click();
    fixture.detectChanges();

    const labelToggle = fixture.nativeElement.querySelector('.market-label-editor input[type="checkbox"]') as HTMLInputElement;
    labelToggle.click();
    fixture.detectChanges();
    const labelFilter = fixture.nativeElement.querySelector('.filter-label-chip') as HTMLButtonElement;
    expect(labelFilter.getAttribute('aria-pressed')).toBe('false');
    labelFilter.click();
    fixture.detectChanges();
    expect(labelFilter.getAttribute('aria-pressed')).toBe('true');
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain('BTCUSDT');

    const labelActions = fixture.nativeElement.querySelector('.label-filter-actions') as HTMLElement;
    const selectAllLabels = Array.from(labelActions.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Select all')) as HTMLButtonElement;
    const clearLabels = Array.from(labelActions.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Clear') as HTMLButtonElement;
    selectAllLabels.click();
    fixture.detectChanges();
    expect(labelFilter.getAttribute('aria-pressed')).toBe('true');
    clearLabels.click();
    fixture.detectChanges();
    expect(labelFilter.getAttribute('aria-pressed')).toBe('false');
    labelFilter.click();
    fixture.detectChanges();

    const minimumPrice = fixture.nativeElement.querySelector('input[aria-label="Minimum price"]') as HTMLInputElement;
    minimumPrice.value = '70000';
    minimumPrice.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(rows()).toHaveLength(0);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No markets match these filters.');

    const clearFilters = fixture.nativeElement.querySelector('.clear-filters-button') as HTMLButtonElement;
    clearFilters.click();
    fixture.detectChanges();
    expect(rows()).toHaveLength(2);
    expect(fixture.nativeElement.querySelector('.active-filter-count')).toBeNull();
  });

});
