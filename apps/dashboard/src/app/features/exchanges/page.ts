import { DatePipe, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ExchangesApi, type ExchangeAccountData, type ExchangeAccountMetadata } from './api';

interface ExchangeAccountView {
  readonly metadata: ExchangeAccountMetadata;
  readonly data: ExchangeAccountData | null;
  readonly error: string | null;
}

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
  readonly status: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function readAmount(value: unknown): string {
  const record = asRecord(value);
  const amount = record['amount'] ?? value;
  return typeof amount === 'string' || typeof amount === 'number' ? String(amount) : '—';
}

function readBalances(data: ExchangeAccountData | null): readonly BalanceRow[] {
  const balances = data?.accountSnapshot.balances;
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
  }).filter((balance) => balance.code !== 'Unknown asset' ||
    balance.free !== '—' || balance.locked !== '—' || balance.total !== '—');
}

function readOpenOrders(data: ExchangeAccountData | null): readonly OpenOrderRow[] {
  const orders = data?.openOrders;
  if (!Array.isArray(orders)) return [];
  return orders.map((value) => {
    const order = asRecord(value);
    const market = asRecord(order['market']);
    return {
      symbol: String(order['symbol'] ?? market['symbol'] ?? '—'),
      side: String(order['side'] ?? '—'),
      type: String(order['type'] ?? order['orderType'] ?? '—'),
      price: readAmount(order['price'] ?? order['limitPrice']),
      quantity: readAmount(order['originalQuantity'] ?? order['quantity'] ?? order['amount']),
      status: String(order['status'] ?? 'OPEN'),
    };
  });
}

@Component({
  selector: 'app-exchanges',
  standalone: true,
  templateUrl: './page.html',
  styleUrl: './page.css',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExchangesComponent implements OnInit, OnDestroy {
  private readonly api = inject(ExchangesApi);
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  readonly accounts = signal<readonly ExchangeAccountView[]>([]);
  readonly loading = signal(false);
  readonly connected = signal(false);
  readonly liveStatus = signal<'connecting' | 'live' | 'reconnecting' | 'offline'>('connecting');
  readonly errorMessage = signal<string | null>(null);
  readonly lastUpdated = signal<string | null>(null);
  readonly totalOpenOrders = computed(() =>
    this.accounts().reduce((total, account) => total + (account.data?.openOrders.length ?? 0), 0),
  );

  ngOnInit(): void {
    void this.refresh();
    this.connectSocket();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(null);
    try {
      const metadata = await firstValueFrom(this.api.listAccounts());
      const accounts = await Promise.all(metadata.map(async (account): Promise<ExchangeAccountView> => {
        try {
          const data = await firstValueFrom(this.api.getAccount(account.providerInstanceId));
          return { metadata: account, data, error: null };
        } catch (error) {
          return { metadata: account, data: null, error: this.describeError(error) };
        }
      }));
      this.accounts.set(accounts);
      this.connected.set(true);
      this.lastUpdated.set(new Date().toISOString());
    } catch (error) {
      this.connected.set(false);
      this.errorMessage.set(this.describeError(error));
    } finally {
      this.loading.set(false);
    }
  }

  private connectSocket(): void {
    if (this.destroyed) return;
    this.liveStatus.set(this.socket ? 'reconnecting' : 'connecting');
    try {
      const socket = this.api.createEventSocket();
      this.socket = socket;
      socket.addEventListener('open', () => {
        if (this.socket === socket) this.liveStatus.set('live');
      });
      socket.addEventListener('message', (event: MessageEvent<string>) => {
        if (this.socket !== socket) return;
        try {
          const message = JSON.parse(event.data) as { type?: string };
          if (message.type === 'exchange-account.updated' || message.type === 'trading-history.updated') {
            void this.refresh();
          }
        } catch {
          // Ignore malformed optional notifications; REST remains authoritative.
        }
      });
      socket.addEventListener('close', () => {
        if (this.socket !== socket || this.destroyed) return;
        this.socket = null;
        this.liveStatus.set('reconnecting');
        this.reconnectTimer = setTimeout(() => this.connectSocket(), 2_000);
      });
      socket.addEventListener('error', () => {
        if (this.socket === socket) this.liveStatus.set('offline');
      });
    } catch {
      this.liveStatus.set('offline');
    }
  }

  balances(account: ExchangeAccountView): readonly BalanceRow[] {
    return readBalances(account.data);
  }

  orders(account: ExchangeAccountView): readonly OpenOrderRow[] {
    return readOpenOrders(account.data);
  }

  private describeError(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const message = error.error?.error?.message;
      if (typeof message === 'string') return message;
      if (error.status === 0) return 'Cannot reach local Harvester at 127.0.0.1:4201.';
      return `Harvester request failed (${error.status}).`;
    }
    return error instanceof Error ? error.message : 'Exchange account request failed.';
  }
}
