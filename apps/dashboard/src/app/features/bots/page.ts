import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { OperatorApi, type OperatorCommand } from '../operator/api';
import {
  formatBotsRuntimeDuration,
  readBotsMarketRows,
  readBotsPortfolioPositions,
  readBotsRuntimeStatus,
  type BotsMarketRow,
  type BotsPortfolioPosition,
  type BotsRuntimeStatus,
} from './view-model';
import { parseBotsWebSocketMessage } from './realtime';

type OperatorCommandName = OperatorCommand['command'];
type SocketState = 'connecting' | 'live' | 'reconnecting' | 'offline';
type SnapshotFreshness = 'waiting' | 'fresh' | 'stale' | 'unavailable';

interface PendingCommand {
  readonly command: OperatorCommandName;
  readonly symbol?: string;
  readonly label: string;
}

const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

@Component({
  selector: 'app-bots',
  standalone: true,
  templateUrl: './page.html',
  styleUrl: './page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BotsComponent implements OnInit, OnDestroy {
  private readonly api = inject(OperatorApi);
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private lastRevision = 0;
  private pendingCommandSnapshotLabel: string | null = null;
  private destroyed = false;

  readonly socketState = signal<SocketState>('connecting');
  readonly snapshotFreshness = signal<SnapshotFreshness>('waiting');
  readonly lastObservedAt = signal<string | null>(null);
  readonly connected = computed(() => this.socketState() === 'live' && this.snapshotFreshness() === 'fresh');
  readonly loading = signal(true);
  readonly commandRunning = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly status = signal<BotsRuntimeStatus | null>(null);
  readonly markets = signal<readonly BotsMarketRow[]>([]);
  readonly positions = signal<readonly BotsPortfolioPosition[]>([]);
  readonly pendingCommand = signal<PendingCommand | null>(null);

  readonly runtimeDuration = computed(() => formatBotsRuntimeDuration(this.status()));
  readonly activeMarkets = computed(() =>
    this.markets().filter((market) => market.enabled && market.readiness === 'READY'),
  );
  readonly blockedMarkets = computed(() =>
    this.markets().filter((market) => market.enabled && market.readiness !== 'READY'),
  );
  readonly disabledMarkets = computed(() => this.markets().filter((market) => !market.enabled));

  ngOnInit(): void {
    this.connectToStream();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, 'Bots page destroyed');
  }

  private connectToStream(): void {
    if (this.destroyed) return;
    this.socketState.set(this.reconnectAttempt === 0 ? 'connecting' : 'reconnecting');
    this.loading.set(this.status() === null);
    try {
      const socket = this.api.createEventSocket();
      this.socket = socket;
      socket.addEventListener('open', () => {
        if (this.socket === socket && !this.destroyed) {
          this.socketState.set('live');
        }
      });
      socket.addEventListener('message', (event: MessageEvent) => this.handleSocketMessage(socket, event));
      socket.addEventListener('error', () => {
        if (this.socket === socket) socket.close();
      });
      socket.addEventListener('close', () => this.handleSocketClose(socket));
    } catch {
      this.socketState.set('offline');
      this.loading.set(false);
      if (this.lastRevision > 0) this.snapshotFreshness.set('stale');
      this.scheduleReconnect();
    }
  }

  private handleSocketClose(socket: WebSocket): void {
    if (this.socket !== socket || this.destroyed) return;
    this.socket = null;
    const hadSnapshot = this.status() !== null;
    this.lastRevision = 0;
    this.socketState.set('reconnecting');
    this.loading.set(false);
    this.snapshotFreshness.set(hadSnapshot ? 'stale' : 'waiting');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer !== null) return;
    const delayIndex = Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1);
    const delay = RECONNECT_DELAYS_MS[delayIndex];
    this.reconnectAttempt += 1;
    if (this.reconnectAttempt >= RECONNECT_DELAYS_MS.length) {
      this.socketState.set('offline');
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectToStream();
    }, delay);
  }

  private handleSocketMessage(socket: WebSocket, event: MessageEvent): void {
    if (this.socket !== socket || typeof event.data !== 'string') return;
    const message = parseBotsWebSocketMessage(event.data);
    if (!message || message.revision <= this.lastRevision) return;
    const hadSnapshot = this.status() !== null;
    this.lastRevision = message.revision;
    if (message.type === 'bots.snapshot.unavailable') {
      this.loading.set(false);
      this.snapshotFreshness.set(hadSnapshot ? 'stale' : 'unavailable');
      this.errorMessage.set(hadSnapshot
        ? 'A Harvester operator read model is unavailable. The last complete snapshot is retained.'
        : 'A Harvester operator read model is unavailable. Waiting for a complete snapshot.');
      return;
    }
    this.status.set(readBotsRuntimeStatus(message.data.status.data));
    this.markets.set(readBotsMarketRows(message.data.markets.data));
    this.positions.set(readBotsPortfolioPositions(message.data.portfolio.data));
    this.lastObservedAt.set(message.observedAt);
    this.snapshotFreshness.set('fresh');
    this.loading.set(false);
    this.errorMessage.set(null);
    if (this.pendingCommandSnapshotLabel) {
      this.successMessage.set(`${this.pendingCommandSnapshotLabel} state synchronized.`);
      this.pendingCommandSnapshotLabel = null;
    }
    this.reconnectAttempt = 0;
  }

  requestCommand(command: OperatorCommandName, selectedSymbol?: string): void {
    const requiresSymbol = command === 'pause' || command === 'unpause';
    const symbol = selectedSymbol?.trim().toUpperCase() ?? '';
    if (requiresSymbol && !symbol) {
      this.errorMessage.set('Choose a configured market before requesting Pause or Unpause.');
      return;
    }
    if (requiresSymbol && !this.markets().some((market) => market.symbol === symbol && market.enabled)) {
      this.errorMessage.set('Only an enabled configured market can receive a market BUY command.');
      return;
    }
    const labels: Record<OperatorCommandName, string> = {
      pause: `Pause BUYs for ${symbol}`,
      unpause: `Resume BUYs for ${symbol}`,
      pauseallbuys: 'Pause BUYs across all markets',
      resumeallbuys: 'Resume BUYs across all markets',
    };
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.pendingCommand.set({
      command,
      ...(requiresSymbol ? { symbol } : {}),
      label: labels[command],
    });
  }

  cancelCommand(): void {
    this.pendingCommand.set(null);
  }

  async confirmCommand(): Promise<void> {
    const pending = this.pendingCommand();
    if (!pending || this.commandRunning() || !this.connected()) return;
    const revisionBeforeCommand = this.lastRevision;
    this.commandRunning.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);
    const request: OperatorCommand = {
      command: pending.command,
      requestId: `dashboard-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      ...(pending.symbol ? { symbol: pending.symbol } : {}),
    };
    try {
      await firstValueFrom(this.api.execute(request));
      this.pendingCommand.set(null);
      if (this.lastRevision === revisionBeforeCommand) {
        this.snapshotFreshness.set('stale');
        this.pendingCommandSnapshotLabel = pending.label;
        this.successMessage.set(`${pending.label} accepted; waiting for the live snapshot.`);
      } else {
        this.successMessage.set(`${pending.label} accepted by Harvester.`);
      }
    } catch (error) {
      this.errorMessage.set(this.describeError(error));
    } finally {
      this.commandRunning.set(false);
    }
  }

  formatStartedAt(timestamp: number | null): string {
    return timestamp === null ? 'Not reported' : new Date(timestamp).toLocaleString();
  }

  formatObservedAt(timestamp: string | null): string {
    return timestamp === null ? 'No authoritative snapshot yet' : new Date(timestamp).toLocaleString();
  }

  private describeError(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const message = error.error?.error?.message;
      if (typeof message === 'string') return message;
      if (error.status === 0) return 'Cannot reach local Harvester at 127.0.0.1:4201.';
      return `Harvester command failed (${error.status}).`;
    }
    return error instanceof Error ? error.message : 'Bots workspace command failed.';
  }
}
