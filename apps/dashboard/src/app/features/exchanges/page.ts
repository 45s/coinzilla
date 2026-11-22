import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';

import { ExchangesApi, type ExchangeAccountData } from './api';
import { readFavoriteProviderIds, writeFavoriteProviderIds } from './favorites-storage';

type ConnectionFilter = 'all' | 'connected' | 'disconnected';
type EnvironmentFilter = 'all' | 'testnet' | 'live';

interface BalanceRow {
  readonly code: string;
  readonly free: string;
  readonly locked: string;
  readonly total: string;
}

interface OpenOrderRow {
  readonly symbol: string;
  readonly side: string;
  readonly type: string;
  readonly price: string;
  readonly quantity: string;
  readonly executed: string;
  readonly remaining: string;
  readonly status: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function readAmount(value: unknown): string {
  const record = asRecord(value);
  const amount = record['amount'] ?? value;
  return typeof amount === 'string' || typeof amount === 'number' ? String(amount) : '—';
}

function readBalances(account: ExchangeAccountData): readonly BalanceRow[] {
  const balances = account.accountSnapshot?.balances;
  if (!Array.isArray(balances)) return [];
  return balances.map((value) => {
    const balance = asRecord(value);
    const asset = asRecord(balance['asset']);
    return {
      code: typeof asset['code'] === 'string' ? asset['code'] : 'Unknown asset',
      free: readAmount(balance['free']),
      locked: readAmount(balance['locked']),
      total: readAmount(balance['total']),
    };
  }).filter((balance) => balance.code !== 'Unknown asset'
    || balance.free !== '—' || balance.locked !== '—' || balance.total !== '—');
}

function readOpenOrders(account: ExchangeAccountData): readonly OpenOrderRow[] {
  if (!Array.isArray(account.openOrders)) return [];
  return account.openOrders.map((value) => {
    const order = asRecord(value);
    return {
      symbol: String(order['symbol'] ?? '—'),
      side: String(order['side'] ?? '—'),
      type: String(order['type'] ?? order['orderType'] ?? '—'),
      price: readAmount(order['price'] ?? order['limitPrice']),
      quantity: readAmount(order['originalQuantity'] ?? order['quantity'] ?? order['amount']),
      executed: readAmount(order['executedQuantity'] ?? order['filledQuantity']),
      remaining: readAmount(order['remainingQuantity']),
      status: String(order['status'] ?? '—'),
    };
  });
}

/** Return browser storage when available without making restricted environments fatal. */
function getBrowserStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

@Component({
  selector: 'app-exchanges',
  standalone: true,
  templateUrl: './page.html',
  styleUrl: './page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExchangesComponent implements OnInit, OnDestroy {
  private readonly api = inject(ExchangesApi);
  private releaseConnection: (() => void) | null = null;

  readonly searchQuery = signal('');
  readonly connectionFilter = signal<ConnectionFilter>('all');
  readonly environmentFilter = signal<EnvironmentFilter>('all');
  readonly favoritesOnly = signal(false);
  readonly favoriteProviderIds = signal(new Set(readFavoriteProviderIds(getBrowserStorage())));
  readonly accounts = this.api.accounts;
  readonly liveStatus = this.api.liveStatus;
  readonly loading = this.api.loading;
  readonly errorMessage = this.api.errorMessage;
  readonly lastUpdated = this.api.lastUpdated;
  readonly favoriteCount = computed(() => this.favoriteProviderIds().size);
  readonly visibleAccounts = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();
    const connection = this.connectionFilter();
    const environment = this.environmentFilter();
    const favorites = this.favoriteProviderIds();
    return this.accounts().filter((account) => {
      const searchable = [
        account.providerType,
        account.providerInstanceId,
        account.accountId,
        account.environment,
      ].join(' ').toLowerCase();
      if (query && !searchable.includes(query)) return false;
      if (connection === 'connected' && !account.connected) return false;
      if (connection === 'disconnected' && account.connected) return false;
      if (environment !== 'all' && account.environment !== environment) return false;
      if (this.favoritesOnly() && !favorites.has(account.providerInstanceId)) return false;
      return true;
    }).sort((left, right) => {
      const favoriteOrder = Number(favorites.has(right.providerInstanceId))
        - Number(favorites.has(left.providerInstanceId));
      return favoriteOrder
        || left.providerType.localeCompare(right.providerType)
        || left.accountId.localeCompare(right.accountId);
    });
  });

  ngOnInit(): void {
    this.releaseConnection = this.api.connect();
  }

  ngOnDestroy(): void {
    this.releaseConnection?.();
    this.releaseConnection = null;
  }

  updateSearch(event: Event): void {
    this.searchQuery.set((event.target as HTMLInputElement).value);
  }

  updateConnectionFilter(event: Event): void {
    this.connectionFilter.set((event.target as HTMLSelectElement).value as ConnectionFilter);
  }

  updateEnvironmentFilter(event: Event): void {
    this.environmentFilter.set((event.target as HTMLSelectElement).value as EnvironmentFilter);
  }

  toggleFavoritesOnly(event: Event): void {
    this.favoritesOnly.set((event.target as HTMLInputElement).checked);
  }

  toggleFavorite(providerInstanceId: string): void {
    const nextFavorites = new Set(this.favoriteProviderIds());
    if (nextFavorites.has(providerInstanceId)) nextFavorites.delete(providerInstanceId);
    else nextFavorites.add(providerInstanceId);
    this.favoriteProviderIds.set(nextFavorites);
    writeFavoriteProviderIds(getBrowserStorage(), [...nextFavorites]);
  }

  clearFilters(): void {
    this.searchQuery.set('');
    this.connectionFilter.set('all');
    this.environmentFilter.set('all');
    this.favoritesOnly.set(false);
  }

  refresh(): void {
    this.api.refresh();
  }

  balances(account: ExchangeAccountData): readonly BalanceRow[] {
    return readBalances(account);
  }

  orders(account: ExchangeAccountData): readonly OpenOrderRow[] {
    return readOpenOrders(account);
  }

  updatedAt(): string {
    const value = this.lastUpdated();
    if (!value) return 'Waiting for first snapshot';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleTimeString();
  }
}
