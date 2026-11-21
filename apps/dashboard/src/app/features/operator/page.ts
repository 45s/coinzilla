import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { OperatorApi, type OperatorCommand } from './api';

type OperatorRead = 'status' | 'markets' | 'positions' | 'orders' | 'balances';
type OperatorCommandName = OperatorCommand['command'];

interface PendingCommand {
  readonly command: OperatorCommandName;
  readonly symbol?: string;
  readonly label: string;
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
  readonly symbol = signal('');
  readonly commandInput = signal('');
  readonly status = signal<unknown>(null);
  readonly markets = signal<unknown>(null);
  readonly positions = signal<unknown>(null);
  readonly orders = signal<unknown>(null);
  readonly balances = signal<unknown>(null);
  readonly pendingCommand = signal<PendingCommand | null>(null);

  constructor() {
    void this.refresh();
  }

  updateCommandInput(event: Event): void {
    this.commandInput.set((event.target as HTMLInputElement).value);
  }

  async runCommandLine(): Promise<void> {
    const [command, symbol] = this.commandInput().trim().split(/\\s+/, 2);
    if (!command) return;
    const normalized = command.toLowerCase();
    if (normalized === 'pause' || normalized === 'unpause') {
      if (!symbol) {
        this.errorMessage.set(`Usage: ${normalized} SYMBOL`);
        return;
      }
      this.symbol.set(symbol.toUpperCase());
      this.requestCommand(normalized);
      return;
    }
    if (normalized === 'pauseallbuys' || normalized === 'resumeallbuys') {
      this.requestCommand(normalized);
      return;
    }
    if (['status', 'markets', 'portfolio', 'orders', 'balances'].includes(normalized)) {
      await this.refresh();
      if (this.connected()) this.successMessage.set(`Refreshed ${normalized}.`);
      return;
    }
    if (normalized === 'help') {
      this.successMessage.set('Commands: status, markets, portfolio, orders, balances, pause SYMBOL, unpause SYMBOL, pauseallbuys, resumeallbuys.');
      this.errorMessage.set(null);
      return;
    }
    this.errorMessage.set('Unknown command. Type help to see available commands.');
  }

  updateSymbol(event: Event): void {
    this.symbol.set((event.target as HTMLInputElement).value.toUpperCase().replace(/[^A-Z0-9._-]/g, ''));
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

  requestCommand(command: OperatorCommandName): void {
    const requiresSymbol = command === 'pause' || command === 'unpause';
    const symbol = this.symbol().trim();
    if (requiresSymbol && !symbol) {
      this.errorMessage.set('Enter a market symbol first.');
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
    if (!pending || this.commandRunning()) return;
    this.commandRunning.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);
    const request: OperatorCommand = {
      command: pending.command,
      requestId: `dashboard-${Date.now()}`,
      ...(pending.symbol ? { symbol: pending.symbol } : {}),
    };
    try {
      const result = await firstValueFrom(this.api.execute(request));
      this.successMessage.set(`${pending.label} completed. Harvester accepted the command.`);
      this.pendingCommand.set(null);
      await this.refresh();
      if (result.data !== undefined) {
        this.successMessage.set(`${pending.label} completed. Harvester accepted the command.`);
      }
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
