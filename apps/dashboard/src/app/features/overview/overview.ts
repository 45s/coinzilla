import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { OperatorApi } from '../operator/api';
import { parseBotsWebSocketMessage } from '../bots/realtime';
import { readBotsRuntimeStatus, type BotsRuntimeStatus } from '../bots/view-model';
import { demoMetrics, demoPositions } from './overview.data';

type ConnectionState = 'checking' | 'connected' | 'offline' | 'unavailable';
type SocketState = 'connecting' | 'connected' | 'reconnecting' | 'offline';
type SnapshotState = 'waiting' | 'fresh' | 'stale' | 'unavailable';

const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isRuntimeStatusPayload(value: unknown): boolean {
  return isRecord(value)
    && Number.isSafeInteger(value['observedAt'])
    && typeof value['runtimeState'] === 'string'
    && typeof value['tradingEnabled'] === 'boolean'
    && isRecord(value['readiness'])
    && typeof value['readiness']['state'] === 'string'
    && Array.isArray(value['readiness']['blockers'])
    && isRecord(value['userData'])
    && typeof value['userData']['ready'] === 'boolean'
    && isRecord(value['markets'])
    && Number.isSafeInteger(value['markets']['configured'])
    && Number.isSafeInteger(value['markets']['enabled'])
    && Number.isSafeInteger(value['markets']['blocked']);
}

@Component({
  selector: 'app-overview',
  standalone: true,
  templateUrl: './overview.html',
  styleUrl: './overview.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OverviewComponent implements OnInit, OnDestroy {
  private readonly api = inject(OperatorApi);
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private lastRevision = 0;
  private destroyed = false;

  readonly metrics = demoMetrics;
  readonly positions = demoPositions;
  readonly apiState = signal<ConnectionState>('checking');
  readonly apiDescription = signal('Checking the local Harvester API');
  readonly socketState = signal<SocketState>('connecting');
  readonly snapshotState = signal<SnapshotState>('waiting');
  readonly runtimeStatus = signal<BotsRuntimeStatus | null>(null);

  readonly services = computed(() => {
    const runtime = this.runtimeStatus();
    const socket = this.socketState();
    const snapshot = this.snapshotState();
    return [
      {
        name: 'Harvester API',
        description: this.apiDescription(),
        state: this.apiState(),
        label: this.apiState().toUpperCase(),
      },
      {
        name: 'Trading runtime',
        description: runtime ? `Runtime state: ${runtime.runtimeState}` : 'No valid runtime status received',
        state: runtime ? 'connected' as const : 'unavailable' as const,
        label: runtime?.runtimeState ?? 'UNAVAILABLE',
      },
      {
        name: 'Harvester event stream',
        description: socket === 'connected'
          ? snapshot === 'fresh' ? 'Connected · latest snapshot received' : `Connected · snapshot ${snapshot}`
          : socket === 'reconnecting' ? 'Connection lost · reconnecting' : socket === 'offline' ? 'Event stream unavailable' : 'Connecting to local event stream',
        state: socket === 'connected' && snapshot === 'fresh'
          ? 'connected' as const
          : socket === 'offline' ? 'offline' as const
            : snapshot === 'stale' ? 'offline' as const
              : 'checking' as const,
        label: socket === 'connected' && snapshot === 'fresh'
          ? 'CONNECTED'
          : socket === 'reconnecting' ? 'RECONNECTING'
            : socket === 'offline' ? 'OFFLINE'
              : snapshot === 'unavailable' ? 'UNAVAILABLE' : 'CONNECTING',
      },
    ];
  });

  readonly connectedCount = computed(() => this.services().filter((service) => service.state === 'connected').length);

  ngOnInit(): void {
    void this.checkApiStatus();
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
    socket?.close(1000, 'Overview page destroyed');
  }

  private async checkApiStatus(): Promise<void> {
    try {
      const response = await firstValueFrom(this.api.getStatus());
      if (this.destroyed) return;
      if (!isRecord(response) || response['ok'] !== true || !isRuntimeStatusPayload(response['data'])) {
        this.apiState.set('unavailable');
        this.apiDescription.set('Harvester returned an invalid runtime status response');
        return;
      }
      this.apiState.set('connected');
      this.apiDescription.set('Local Harvester API responding');
      this.runtimeStatus.set(readBotsRuntimeStatus(response['data']));
    } catch {
      if (this.destroyed) return;
      this.apiState.set('offline');
      this.apiDescription.set('Cannot reach Harvester at 127.0.0.1:4201');
    }
  }

  private connectToStream(): void {
    if (this.destroyed) return;
    this.socketState.set(this.reconnectAttempt === 0 ? 'connecting' : 'reconnecting');
    try {
      const socket = this.api.createEventSocket();
      this.socket = socket;
      socket.addEventListener('open', () => {
        if (this.socket !== socket || this.destroyed) return;
        this.socketState.set('connected');
        void this.checkApiStatus();
      });
      socket.addEventListener('message', (event: MessageEvent) => {
        if (this.socket !== socket || this.destroyed || typeof event.data !== 'string') return;
        this.handleSnapshot(event.data);
      });
      socket.addEventListener('error', () => {
        if (this.socket === socket) socket.close();
      });
      socket.addEventListener('close', () => this.handleSocketClose(socket));
    } catch {
      this.socketState.set('offline');
      this.snapshotState.set(this.runtimeStatus() ? 'stale' : 'waiting');
      this.scheduleReconnect();
    }
  }

  private handleSnapshot(serializedMessage: string): void {
    const message = parseBotsWebSocketMessage(serializedMessage);
    if (!message || message.revision <= this.lastRevision) return;
    this.lastRevision = message.revision;
    if (message.type === 'bots.snapshot.unavailable' || message.type === 'bots.state.updated.unavailable') {
      this.snapshotState.set(this.runtimeStatus() ? 'stale' : 'unavailable');
      return;
    }
    const status = readBotsRuntimeStatus(message.data.status.data);
    if (!status) {
      this.snapshotState.set(this.runtimeStatus() ? 'stale' : 'unavailable');
      return;
    }
    this.runtimeStatus.set(status);
    this.snapshotState.set('fresh');
    this.reconnectAttempt = 0;
  }

  private handleSocketClose(socket: WebSocket): void {
    if (this.socket !== socket || this.destroyed) return;
    this.socket = null;
    this.lastRevision = 0;
    this.socketState.set('reconnecting');
    this.snapshotState.set(this.runtimeStatus() ? 'stale' : 'waiting');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer !== null) return;
    const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectToStream();
    }, delay);
  }
}
