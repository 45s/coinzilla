import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';

import { ExchangesApi, type ExchangeAccountData } from '../exchanges/api';

interface OpenOrderRow {
  readonly key: string;
  readonly account: ExchangeAccountData;
  readonly raw: Record<string, unknown>;
  readonly symbol: string;
  readonly side: string;
  readonly type: string;
  readonly price: string;
  readonly quantity: string;
  readonly executed: string;
  readonly remaining: string;
  readonly status: string;
}

interface OrderGroup {
  readonly account: ExchangeAccountData;
  readonly orders: readonly OpenOrderRow[];
}

type SideFilter = 'all' | 'BUY' | 'SELL';

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function readText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '—';
}

function readAmount(value: unknown): string {
  const record = asRecord(value);
  return readText(record['amount'] ?? value);
}

function createOpenOrderRow(account: ExchangeAccountData, value: unknown, index: number): OpenOrderRow {
  const order = asRecord(value);
  const symbol = readText(order['symbol']);
  const side = readText(order['side']);
  const orderId = order['exchangeOrderId'] ?? order['orderId'] ?? order['clientOrderId'] ?? order['id'];
  return {
    key: orderId === null || orderId === undefined ? `${symbol}-${side}-${index}` : String(orderId),
    account,
    raw: order,
    symbol,
    side,
    type: readText(order['type'] ?? order['orderType']),
    price: readAmount(order['price'] ?? order['limitPrice']),
    quantity: readAmount(order['originalQuantity'] ?? order['quantity'] ?? order['amount']),
    executed: readAmount(order['executedQuantity'] ?? order['filledQuantity']),
    remaining: readAmount(order['remainingQuantity']),
    status: readText(order['status']),
  };
}

@Component({
  selector: 'app-open-orders',
  standalone: true,
  templateUrl: './page.html',
  styleUrl: './page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OpenOrdersComponent implements OnInit, OnDestroy {
  private readonly api = inject(ExchangesApi);
  private releaseConnection: (() => void) | null = null;

  readonly searchQuery = signal('');
  readonly providerFilter = signal('all');
  readonly sideFilter = signal<SideFilter>('all');
  readonly statusFilter = signal('all');
  readonly selectedOrder = signal<OpenOrderRow | null>(null);
  readonly accounts = this.api.accounts;
  readonly liveStatus = this.api.liveStatus;
  readonly loading = this.api.loading;
  readonly errorMessage = this.api.errorMessage;
  readonly lastUpdated = this.api.lastUpdated;
  readonly totalOpenOrders = computed(() => this.accounts().reduce(
    (total, account) => total + (account.openOrders?.length ?? 0),
    0,
  ));
  readonly providerOptions = computed(() => this.accounts().map((account) => ({
    value: account.providerInstanceId,
    label: `${account.providerType} · ${account.accountId} · ${account.environment.toUpperCase()}`,
  })));
  readonly orderGroups = computed<readonly OrderGroup[]>(() => {
    const query = this.searchQuery().trim().toLowerCase();
    const provider = this.providerFilter();
    const side = this.sideFilter();
    const status = this.statusFilter();
    return this.accounts().map((account) => {
      const orders = (account.openOrders ?? []).map((order, index) =>
        createOpenOrderRow(account, order, index),
      ).filter((order) => {
        const searchable = [
          order.symbol,
          order.side,
          order.type,
          order.status,
          order.key,
        ].join(' ').toLowerCase();
        if (query && !searchable.includes(query)) return false;
        if (provider !== 'all' && account.providerInstanceId !== provider) return false;
        if (side !== 'all' && order.side !== side) return false;
        if (status !== 'all' && order.status !== status) return false;
        return true;
      });
      return { account, orders };
    }).filter((group) => (provider === 'all' || group.account.providerInstanceId === provider)
      && (group.orders.length > 0 || group.account.errors.openOrders !== undefined));
  });
  readonly visibleOrderCount = computed(() => this.orderGroups().reduce(
    (total, group) => total + group.orders.length,
    0,
  ));
  readonly orderDetailsJson = computed(() => {
    const selected = this.selectedOrder();
    return selected ? JSON.stringify({
      provider: {
        providerType: selected.account.providerType,
        providerInstanceId: selected.account.providerInstanceId,
        accountId: selected.account.accountId,
        environment: selected.account.environment,
      },
      order: selected.raw,
    }, null, 2) : '';
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

  updateProvider(event: Event): void {
    this.providerFilter.set((event.target as HTMLSelectElement).value);
  }

  updateSide(event: Event): void {
    this.sideFilter.set((event.target as HTMLSelectElement).value as SideFilter);
  }

  updateStatus(event: Event): void {
    this.statusFilter.set((event.target as HTMLSelectElement).value);
  }

  selectOrder(order: OpenOrderRow): void {
    this.selectedOrder.set(order);
  }

  refresh(): void {
    this.api.refresh();
  }

  updatedAt(): string {
    const value = this.lastUpdated();
    if (!value) return 'Waiting for first snapshot';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleTimeString();
  }
}
