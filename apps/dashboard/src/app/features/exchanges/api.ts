import { Injectable, signal } from '@angular/core';

export interface ExchangeAccountMetadata {
  readonly providerInstanceId: string;
  readonly providerType: string;
  readonly accountId: string;
  readonly environment: 'testnet' | 'live';
  readonly connected: boolean;
}

export interface ExchangeAccountSnapshot {
  readonly sourceTime: string | number | null;
  readonly balances: readonly unknown[];
}

export interface ExchangeAccountReadErrors {
  readonly accountSnapshot?: string;
  readonly openOrders?: string;
}

export interface ExchangeAccountData extends ExchangeAccountMetadata {
  readonly accountSnapshot: ExchangeAccountSnapshot | null;
  readonly openOrders: readonly unknown[] | null;
  readonly errors: ExchangeAccountReadErrors;
}

interface ExchangeAccountsMessage {
  readonly type: 'exchange-accounts.snapshot' | 'exchange-accounts.updated';
  readonly observedAt: string;
  readonly accounts: readonly ExchangeAccountData[];
}

type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

const WEBSOCKET_URL = 'ws://127.0.0.1:4201/api/v1/trading/events';
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isExchangeAccount(value: unknown): value is ExchangeAccountData {
  if (!isRecord(value)) return false;
  return typeof value['providerInstanceId'] === 'string'
    && typeof value['providerType'] === 'string'
    && typeof value['accountId'] === 'string'
    && (value['environment'] === 'testnet' || value['environment'] === 'live')
    && typeof value['connected'] === 'boolean'
    && (value['accountSnapshot'] === null || isRecord(value['accountSnapshot']))
    && (value['openOrders'] === null || Array.isArray(value['openOrders']))
    && isRecord(value['errors']);
}

function isExchangeAccountsMessage(value: unknown): value is ExchangeAccountsMessage {
  if (!isRecord(value)) return false;
  return (value['type'] === 'exchange-accounts.snapshot' || value['type'] === 'exchange-accounts.updated')
    && typeof value['observedAt'] === 'string'
    && Array.isArray(value['accounts'])
    && value['accounts'].every(isExchangeAccount);
}

@Injectable({ providedIn: 'root' })
export class ExchangesApi {
  readonly accounts = signal<readonly ExchangeAccountData[]>([]);
  readonly liveStatus = signal<LiveStatus>('offline');
  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);
  readonly lastUpdated = signal<string | null>(null);

  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private consumers = 0;

  connect(): () => void {
    this.consumers += 1;
    this.openSocket();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.consumers = Math.max(0, this.consumers - 1);
      if (this.consumers === 0) this.disconnect();
    };
  }

  refresh(): void {
    if (this.consumers === 0) return;
    this.clearReconnectTimer();
    const previousSocket = this.socket;
    this.socket = null;
    previousSocket?.close();
    this.openSocket();
  }

  private openSocket(): void {
    if (this.consumers === 0 || this.socket !== null) return;
    this.liveStatus.set(this.reconnectAttempt === 0 ? 'connecting' : 'reconnecting');
    this.errorMessage.set(null);
    try {
      const socket = new WebSocket(WEBSOCKET_URL);
      this.socket = socket;
      socket.addEventListener('open', () => {
        if (this.socket !== socket) return;
        this.liveStatus.set('live');
        this.reconnectAttempt = 0;
      });
      socket.addEventListener('message', (event: MessageEvent<string>) => {
        if (this.socket !== socket) return;
        this.receiveSnapshot(event.data);
      });
      socket.addEventListener('close', () => {
        if (this.socket !== socket) return;
        this.socket = null;
        if (this.consumers === 0) return;
        this.liveStatus.set('reconnecting');
        this.scheduleReconnect();
      });
      socket.addEventListener('error', () => {
        if (this.socket === socket) {
          this.liveStatus.set('offline');
          this.errorMessage.set('The local Harvester WebSocket is unavailable.');
        }
      });
    } catch {
      this.socket = null;
      this.liveStatus.set('offline');
      this.errorMessage.set('Cannot connect to local Harvester at 127.0.0.1:4201.');
      this.scheduleReconnect();
    }
  }

  private receiveSnapshot(serializedMessage: string): void {
    try {
      const message: unknown = JSON.parse(serializedMessage);
      if (!isExchangeAccountsMessage(message)) return;
      this.accounts.set(message.accounts);
      this.loading.set(false);
      this.errorMessage.set(null);
      this.lastUpdated.set(message.observedAt);
    } catch {
      this.errorMessage.set('Harvester sent an unreadable account snapshot.');
    }
  }

  private scheduleReconnect(): void {
    if (this.consumers === 0 || this.reconnectTimer !== null) return;
    const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)];
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer === null) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private disconnect(): void {
    this.clearReconnectTimer();
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.liveStatus.set('offline');
  }
}
