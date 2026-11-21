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
} from './api';
import { createMarketFavoritesCookie, readMarketFavorites } from './favorites-cookie';

type MarketMovementFilter = 'all' | 'positive' | 'negative';
type MarketMovementWindow = 'change5m' | 'change1h' | 'change4h' | 'change24h';
interface MarketLabel {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}
interface ScreenerPreferences {
  readonly labels: readonly MarketLabel[];
  readonly marketLabels: Readonly<Record<string, readonly string[]>>;
}
interface ScreenerPreset {
  readonly name: string;
  readonly searchQuery: string;
  readonly favoritesOnly: boolean;
  readonly movementFilter: MarketMovementFilter;
  readonly movementWindow: MarketMovementWindow;
  readonly selectedLabels: readonly string[];
  readonly minPrice: string;
  readonly maxPrice: string;
  readonly minVolume: string;
  readonly maxVolume: string;
  readonly minChange: string;
  readonly maxChange: string;
}
const PREFERENCES_KEY = 'coinzilla_market_screener_preferences_v1';
const PRESETS_KEY = 'coinzilla_market_screener_presets_v1';

function readStorage<T>(document: Document, key: string, fallback: T): T {
  try {
    const raw = document.defaultView?.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(document: Document, key: string, value: unknown): void {
  try {
    document.defaultView?.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Keep the current session usable when browser storage is unavailable.
  }
}

function numericValue(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function withinRange(value: string | null, minimum: string, maximum: string): boolean {
  if (!minimum && !maximum) return true;
  const numeric = numericValue(value);
  if (numeric === null) return false;
  return (!minimum || numeric >= Number(minimum)) && (!maximum || numeric <= Number(maximum));
}

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
  private readonly savedPreferences = readStorage<ScreenerPreferences>(
    this.document, PREFERENCES_KEY, { labels: [], marketLabels: {} },
  );

  readonly selectedSource = signal<MarketSource>('bitunix-futures');
  readonly snapshot = this.api.bitunixFuturesSnapshot;
  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly searchQuery = signal('');
  readonly favoritesOnly = signal(false);
  readonly movementFilter = signal<MarketMovementFilter>('all');
  readonly movementWindow = signal<MarketMovementWindow>('change24h');
  readonly favoriteSymbols = signal<ReadonlySet<string>>(
    new Set(readMarketFavorites(this.document.cookie, 'bitunix-futures')),
  );
  readonly labels = signal<readonly MarketLabel[]>(this.savedPreferences.labels);
  readonly marketLabels = signal<Readonly<Record<string, readonly string[]>>>(this.savedPreferences.marketLabels);
  readonly newLabelName = signal('');
  readonly newLabelColor = signal('#4f9de8');
  readonly selectedLabels = signal<ReadonlySet<string>>(new Set<string>());
  readonly minPrice = signal('');
  readonly maxPrice = signal('');
  readonly minVolume = signal('');
  readonly maxVolume = signal('');
  readonly minChange = signal('');
  readonly maxChange = signal('');
  readonly presetName = signal('');
  readonly presets = signal<readonly ScreenerPreset[]>(readStorage(this.document, PRESETS_KEY, []));
  readonly markets = computed(() => this.snapshot()?.markets ?? []);
  readonly hasAnyNativeMovement = computed(() => this.markets().some((market) =>
    market.change5m !== null || market.change1h !== null
      || market.change4h !== null || market.change24h !== null,
  ));
  readonly hasNativeMovementForSelectedWindow = computed(() => this.markets().some(
    (market) => market[this.movementWindow()] !== null,
  ));
  readonly visibleMarkets = computed(() => {
    const query = this.searchQuery().trim().toUpperCase();
    const favorites = this.favoriteSymbols();
    const selectedLabels = this.selectedLabels();
    const labelsByMarket = this.marketLabels();
    const movementFilter = this.movementFilter();
    const movementWindow = this.movementWindow();
    const minChange = this.minChange();
    const maxChange = this.maxChange();
    const filtered = this.markets().filter((market) => {
      const matchesQuery = !query || market.symbol.includes(query)
        || (market.base ?? '').includes(query)
        || (market.quote ?? '').includes(query);
      const matchesFavorites = !this.favoritesOnly() || favorites.has(market.symbol);
      const assigned = labelsByMarket[market.symbol] ?? [];
      const matchesLabels = selectedLabels.size === 0
        || [...selectedLabels].every((labelId) => assigned.includes(labelId));
      const movement = market[movementWindow];
      const matchesMovement = movementFilter === 'all' || (movement !== null
        && (movementFilter === 'negative' ? movement.startsWith('-') : !movement.startsWith('-')));
      const matchesChangeRange = withinRange(movement, minChange, maxChange);
      return matchesQuery && matchesFavorites && matchesLabels && matchesMovement
        && matchesChangeRange
        && withinRange(market.lastPrice, this.minPrice(), this.maxPrice())
        && withinRange(market.quoteVol, this.minVolume(), this.maxVolume());
    });
    return filtered.sort((left, right) =>
      Number(favorites.has(right.symbol)) - Number(favorites.has(left.symbol)),
    );
  });
  readonly updatedAt = computed(() => {
    const value = this.snapshot()?.observedAt;
    if (!value) return 'Not yet loaded';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleTimeString();
  });

  ngOnInit(): void {
    if (this.snapshot() === null) void this.refresh();
  }

  async refresh(): Promise<void> {
    if (this.selectedSource() !== 'bitunix-futures') {
      this.errorMessage.set('This market source is not implemented yet.');
      return;
    }
    this.loading.set(true);
    this.errorMessage.set(null);
    try {
      this.api.bitunixFuturesSnapshot.set(await firstValueFrom(this.api.getBitunixFuturesMarkets()));
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

  updateMovementWindow(event: Event): void {
    const nextWindow = (event.target as HTMLSelectElement).value as MarketMovementWindow;
    this.movementWindow.set(nextWindow);
    if (!this.markets().some((market) => market[nextWindow] !== null)) this.movementFilter.set('all');
  }

  updateSelectedLabels(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.selectedLabels.set(new Set(Array.from(select.selectedOptions, (option) => option.value)));
  }

  updateRange(event: Event, field: 'minPrice' | 'maxPrice' | 'minVolume' | 'maxVolume' | 'minChange' | 'maxChange'): void {
    this[field].set((event.target as HTMLInputElement).value);
  }

  updateNewLabelName(event: Event): void {
    this.newLabelName.set((event.target as HTMLInputElement).value);
  }

  updateNewLabelColor(event: Event): void {
    this.newLabelColor.set((event.target as HTMLInputElement).value);
  }

  addLabel(): void {
    const name = this.newLabelName().trim().slice(0, 24);
    if (!name || this.labels().some((label) => label.name.toLowerCase() === name.toLowerCase())) return;
    const label = { id: `label-${Date.now()}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name, color: this.newLabelColor() };
    this.labels.update((labels) => [...labels, label]);
    this.newLabelName.set('');
    this.persistPreferences();
  }

  updateLabelColor(labelId: string, event: Event): void {
    const color = (event.target as HTMLInputElement).value;
    this.labels.update((labels) => labels.map((label) =>
      label.id === labelId ? { ...label, color } : label,
    ));
    this.persistPreferences();
  }

  removeLabel(labelId: string): void {
    this.labels.update((labels) => labels.filter((label) => label.id !== labelId));
    const next: Record<string, readonly string[]> = {};
    for (const [symbol, ids] of Object.entries(this.marketLabels())) {
      const filtered = ids.filter((id) => id !== labelId);
      if (filtered.length) next[symbol] = filtered;
    }
    this.marketLabels.set(next);
    this.selectedLabels.update((selected) => {
      const result = new Set(selected);
      result.delete(labelId);
      return result;
    });
    this.persistPreferences();
  }

  toggleMarketLabel(symbol: string, labelId: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const current = this.marketLabels()[symbol] ?? [];
    const nextIds = checked ? [...new Set([...current, labelId])] : current.filter((id) => id !== labelId);
    const next = { ...this.marketLabels() };
    if (nextIds.length) next[symbol] = nextIds;
    else delete next[symbol];
    this.marketLabels.set(next);
    this.persistPreferences();
  }

  isMarketLabelAssigned(symbol: string, labelId: string): boolean {
    return (this.marketLabels()[symbol] ?? []).includes(labelId);
  }

  labelsForMarket(symbol: string): readonly MarketLabel[] {
    const assigned = new Set(this.marketLabels()[symbol] ?? []);
    return this.labels().filter((label) => assigned.has(label.id));
  }

  savePreset(): void {
    const name = this.presetName().trim().slice(0, 32);
    if (!name) return;
    const preset: ScreenerPreset = {
      name,
      searchQuery: this.searchQuery(),
      favoritesOnly: this.favoritesOnly(),
      movementFilter: this.movementFilter(),
      movementWindow: this.movementWindow(),
      selectedLabels: [...this.selectedLabels()],
      minPrice: this.minPrice(), maxPrice: this.maxPrice(),
      minVolume: this.minVolume(), maxVolume: this.maxVolume(),
      minChange: this.minChange(), maxChange: this.maxChange(),
    };
    this.presets.update((presets) => [...presets.filter((item) => item.name !== name), preset]);
    writeStorage(this.document, PRESETS_KEY, this.presets());
    this.presetName.set('');
  }

  loadPreset(event: Event): void {
    const name = (event.target as HTMLSelectElement).value;
    const preset = this.presets().find((item) => item.name === name);
    if (!preset) return;
    this.searchQuery.set(preset.searchQuery);
    this.favoritesOnly.set(preset.favoritesOnly);
    this.movementFilter.set(preset.movementFilter);
    this.movementWindow.set(preset.movementWindow);
    this.selectedLabels.set(new Set(preset.selectedLabels));
    this.minPrice.set(preset.minPrice); this.maxPrice.set(preset.maxPrice);
    this.minVolume.set(preset.minVolume); this.maxVolume.set(preset.maxVolume);
    this.minChange.set(preset.minChange); this.maxChange.set(preset.maxChange);
  }

  toggleFavorite(symbol: string): void {
    const next = new Set(this.favoriteSymbols());
    if (next.has(symbol)) next.delete(symbol);
    else next.add(symbol);
    this.favoriteSymbols.set(next);
    const secure = this.document.location?.protocol === 'https:';
    this.document.cookie = createMarketFavoritesCookie(this.selectedSource(), [...next], secure);
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

  private persistPreferences(): void {
    writeStorage(this.document, PREFERENCES_KEY, {
      labels: this.labels(),
      marketLabels: this.marketLabels(),
    } satisfies ScreenerPreferences);
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
