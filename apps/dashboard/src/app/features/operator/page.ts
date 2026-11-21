import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { OperatorApi, type OperatorCommand } from './api';

type OperatorCommandName = OperatorCommand['command'];

interface PendingCommand {
  readonly command: OperatorCommandName;
  readonly symbol?: string;
  readonly label: string;
}
interface OperatorMarketRow {
  readonly symbol: string;
  readonly enabled: boolean;
  readonly operatorBuysPaused: boolean;
  readonly readiness: string;
  readonly blockers: readonly string[];
}

function readOperatorMarkets(value: unknown): readonly OperatorMarketRow[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { markets?: unknown }).markets)) return [];
  return (value as { markets: unknown[] }).markets.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const market = item as Record<string, unknown>;
    if (typeof market.symbol !== 'string' || typeof market.enabled !== 'boolean') return [];
    return [{
      symbol: market.symbol,
      enabled: market.enabled,
      operatorBuysPaused: market.operatorBuysPaused === true,
      readiness: typeof market.readiness === 'string' ? market.readiness : 'UNKNOWN',
      blockers: Array.isArray(market.blockers) ? market.blockers.filter((blocker): blocker is string => typeof blocker === 'string') : [],
    }];
  });
}

@Component({
  selector: 'app-operator',
  standalone: true,
  templateUrl: './page.html',
  styleUrl: './page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OperatorComponent {
  private readonly api = inject(OperatorApi);

  readonly connected = signal(false);
  readonly loading = signal(false);
  readonly commandRunning = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly status = signal<unknown>(null);
  readonly markets = signal<unknown>(null);
  readonly positions = signal<unknown>(null);
  readonly orders = signal<unknown>(null);
  readonly balances = signal<unknown>(null);
  readonly pendingCommand = signal<PendingCommand | null>(null);
  readonly marketRows = computed(() => readOperatorMarkets(this.markets()));

  constructor() {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(null);
    try {
      const [status, markets, positions, orders, balances] = await Promise.all([
        firstValueFrom(this.api.getStatus()),
        firstValueFrom(this.api.getMarkets()),
        firstValueFrom(this.api.getPortfolio()),
        firstValueFrom(this.api.getOrders()),
        firstValueFrom(this.api.getBalances()),
      ]);
      this.status.set(status.data);
      this.markets.set(markets.data);
      this.positions.set(positions.data);
      this.orders.set(orders.data);
      this.balances.set(balances.data);
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
    const labels: Record<OperatorCommandName, string> = {
      pause: `Pause BUYs for ${symbol}`,
      unpause: `Unpause BUYs for ${symbol}`,
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
      this.successMessage.set(`${pending.label} completed. Harvester accepted the command.`);
      await this.refresh();
    } catch (error) {
      this.errorMessage.set(this.describeError(error));
    } finally {
      this.commandRunning.set(false);
    }
  }

  formatJson(value: unknown): string {
    return value === null ? 'Waiting for Harvester…' : JSON.stringify(value, null, 2) ?? String(value);
  }

  private describeError(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const message = error.error?.error?.message;
      if (typeof message === 'string') return message;
      if (error.status === 0) return 'Cannot reach local Harvester at 127.0.0.1:4201.';
      return `Harvester request failed (${error.status}).`;
    }
    return error instanceof Error ? error.message : 'Operator request failed.';
  }
}
