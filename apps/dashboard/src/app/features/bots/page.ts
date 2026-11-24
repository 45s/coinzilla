import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
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

type OperatorCommandName = OperatorCommand['command'];

interface PendingCommand {
  readonly command: OperatorCommandName;
  readonly symbol?: string;
  readonly label: string;
}

@Component({
  selector: 'app-bots',
  standalone: true,
  templateUrl: './page.html',
  styleUrl: './page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BotsComponent {
  private readonly api = inject(OperatorApi);

  readonly connected = signal(false);
  readonly loading = signal(false);
  readonly commandRunning = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly status = signal<BotsRuntimeStatus | null>(null);
  readonly markets = signal<readonly BotsMarketRow[]>([]);
  readonly positions = signal<readonly BotsPortfolioPosition[]>([]);
  readonly pendingCommand = signal<PendingCommand | null>(null);
  lastRefresh: Promise<void> = Promise.resolve();

  readonly runtimeDuration = computed(() => formatBotsRuntimeDuration(this.status()));
  readonly activeMarkets = computed(() =>
    this.markets().filter((market) => market.enabled && market.readiness === 'READY'),
  );
  readonly blockedMarkets = computed(() =>
    this.markets().filter((market) => market.enabled && market.readiness !== 'READY'),
  );
  readonly disabledMarkets = computed(() => this.markets().filter((market) => !market.enabled));

  constructor() {
    void this.refresh();
  }

  refresh(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.lastRefresh = this.loadSnapshots();
    return this.lastRefresh;
  }

  private async loadSnapshots(): Promise<void> {
    try {
      const [status, markets, portfolio] = await Promise.all([
        firstValueFrom(this.api.getStatus()),
        firstValueFrom(this.api.getMarkets()),
        firstValueFrom(this.api.getPortfolio()),
      ]);
      this.status.set(readBotsRuntimeStatus(status.data));
      this.markets.set(readBotsMarketRows(markets.data));
      this.positions.set(readBotsPortfolioPositions(portfolio.data));
      this.connected.set(true);
    } catch (error) {
      this.connected.set(false);
      this.errorMessage.set(this.describeError(error));
    } finally {
      this.loading.set(false);
    }
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
      this.successMessage.set(`${pending.label} accepted by Harvester.`);
      await this.refresh();
    } catch (error) {
      this.errorMessage.set(this.describeError(error));
    } finally {
      this.commandRunning.set(false);
    }
  }

  formatStartedAt(timestamp: number | null): string {
    return timestamp === null ? 'Not reported' : new Date(timestamp).toLocaleString();
  }

  private describeError(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const message = error.error?.error?.message;
      if (typeof message === 'string') return message;
      if (error.status === 0) return 'Cannot reach local Harvester at 127.0.0.1:4201.';
      return `Harvester request failed (${error.status}).`;
    }
    return error instanceof Error ? error.message : 'Bots workspace request failed.';
  }
}
