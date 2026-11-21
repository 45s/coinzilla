import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  type OnInit,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
  MarketScreenerApi,
  type MarketSource,
  type MarketScreenerRow,
  type MarketScreenerSnapshot,
} from './api';
import { createMarketFavoritesCookie, readMarketFavorites } from './favorites-cookie';

type MarketMovementFilter = 'all' | 'positive' | 'negative';

@Component({
  selector: 'app-market-screener',
  standalone: true,
  templateUrl: './page.html',
  styleUrl: './page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarketScreenerComponent implements OnInit {
  private readonly api = inject(MarketScreenerApi);
  private readonly document = inject(DOCUMENT);

  readonly selectedSource = signal<MarketSource>('bitunix-futures');
  readonly snapshot = signal<MarketScreenerSnapshot | null>(null);
  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly searchQuery = signal('');
  readonly favoritesOnly = signal(false);
  readonly movementFilter = signal<MarketMovementFilter>('all');
  readonly favoriteSymbols = signal<ReadonlySet<string>>(
    new Set(readMarketFavorites(this.document.cookie, 'bitunix-futures')),
  );
  readonly markets = computed(() => this.snapshot()?.markets ?? []);
  readonly hasNative24hMovement = computed(() =>
    this.markets().some((market) => market.change24h !== null),
  );
  readonly visibleMarkets = computed(() => {
    const query = this.searchQuery().trim().toUpperCase();
    const favorites = this.favoriteSymbols();
    const movementFilter = this.movementFilter();
    return this.markets().filter((market) => {
      const matchesQuery = !query || market.symbol.includes(query)
        || (market.base ?? '').includes(query)
        || (market.quote ?? '').includes(query);
      const matchesFavorites = !this.favoritesOnly() || favorites.has(market.symbol);
      const change24h = market.change24h;
      const matchesMovement = movementFilter === 'all' || (change24h !== null
        && (movementFilter === 'negative' ? change24h.startsWith('-') : !change24h.startsWith('-')));
      return matchesQuery && matchesFavorites && matchesMovement;
    });
  });
  readonly updatedAt = computed(() => {
    const value = this.snapshot()?.observedAt;
    if (!value) {
      return 'Not yet loaded';
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleTimeString();
  });

  ngOnInit(): void {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    if (this.selectedSource() !== 'bitunix-futures') {
      this.errorMessage.set('This market source is not implemented yet.');
      return;
    }
    this.loading.set(true);
    this.errorMessage.set(null);
    try {
      this.snapshot.set(await firstValueFrom(this.api.getBitunixFuturesMarkets()));
    } catch (error) {
      this.errorMessage.set(this.requestErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  updateSearch(event: Event): void {
    this.searchQuery.set((event.target as HTMLInputElement).value);
  }

  updateFavoritesOnly(event: Event): void {
    this.favoritesOnly.set((event.target as HTMLInputElement).checked);
  }

  updateMovementFilter(event: Event): void {
    this.movementFilter.set((event.target as HTMLSelectElement).value as MarketMovementFilter);
  }

  toggleFavorite(symbol: string): void {
    const next = new Set(this.favoriteSymbols());
    if (next.has(symbol)) {
      next.delete(symbol);
    } else {
      next.add(symbol);
    }
    this.favoriteSymbols.set(next);
    const secure = this.document.location?.protocol === 'https:';
    this.document.cookie = createMarketFavoritesCookie(
      this.selectedSource(),
      [...next],
      secure,
    );
  }

  isFavorite(symbol: string): boolean {
    return this.favoriteSymbols().has(symbol);
  }

  displayValue(value: string | null | undefined): string {
    return value ?? 'N/A';
  }

  movementValue(value: string | null): string {
    return value === null ? 'N/A' : `${value}%`;
  }

  trackBySymbol(_index: number, market: MarketScreenerRow): string {
    return market.symbol;
  }

  private requestErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status === 0) {
      return 'Harvester API is unavailable. Start Harvester and keep its local API enabled.';
    }
    if (error instanceof HttpErrorResponse) {
      return `Market data request failed (HTTP ${error.status}). Try refreshing.`;
    }
    return 'Market data could not be loaded. Check the Harvester API logs.';
  }
}
