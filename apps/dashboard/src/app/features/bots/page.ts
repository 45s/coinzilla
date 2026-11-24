import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { OperatorApi, type OperatorCommand } from '../operator/api';

type OperatorCommandName = OperatorCommand['command'];

interface PendingCommand {
  readonly command: OperatorCommandName;
  readonly symbol?: string;
  readonly label: string;
}

interface RuntimeStatus {
  readonly observedAt: number | null;
  readonly startedAt: number | null;
  readonly runtimeState: string;
  readonly broker: string;
  readonly tradingEnabled: boolean;
  readonly tradingMode: string;
  readonly strategyMode: string;
  readonly stopping: boolean;
  readonly readiness: {
    readonly state: string;
    readonly blockers: readonly string[];
  };
  readonly userData: {
    readonly ready: boolean;
    readonly status: string;
    readonly ageMs: number | null;
  };
  readonly marketCounts: {
    readonly configured: number;
    readonly enabled: number;
    readonly blocked: number;
  };
}

interface MarketRow {
  readonly symbol: string;
  readonly enabled: boolean;
  readonly operatorBuysPaused: boolean;
  readonly readiness: string;
  readonly blockers: readonly string[];
  readonly latestPrice: string | null;
  readonly priceFresh: boolean;
}

interface RecoverySummary {
  readonly buyCost: string | null;
  readonly netSellProceeds: string | null;
  readonly outstandingRecoveryAmount: string | null;
  readonly realizedNetProfit: string | null;
}

interface PortfolioPosition {
  readonly symbol: string;
  readonly baseAsset: string | null;
  readonly quoteAsset: string | null;
  readonly activeQuantity: string | null;
  readonly freeQuantity: string | null;
  readonly totalQuantity: string | null;
  readonly investedQuote: string | null;
  readonly quoteNetCashFlow: string | null;
  readonly recovery: RecoverySummary | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown, fallback = 'Not reported'): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function readTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function readDecimal(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readRuntimeStatus(value: unknown): RuntimeStatus | null {
  if (!isRecord(value)) return null;
  const readiness = isRecord(value['readiness']) ? value['readiness'] : {};
  const userData = isRecord(value['userData']) ? value['userData'] : {};
  const marketCounts = isRecord(value['markets']) ? value['markets'] : {};
  return {
    observedAt: readTimestamp(value['observedAt']),
    startedAt: readTimestamp(value['startedAt']),
    runtimeState: readString(value['runtimeState'], 'UNKNOWN'),
    broker: readString(value['broker'], 'Unknown broker'),
    tradingEnabled: value['tradingEnabled'] === true,
    tradingMode: readString(value['tradingMode'], 'Unknown environment'),
    strategyMode: readString(value['strategyMode']),
    stopping: value['stopping'] === true,
    readiness: {
      state: readString(readiness['state'], 'UNKNOWN'),
      blockers: Array.isArray(readiness['blockers'])
        ? readiness['blockers'].filter((item): item is string => typeof item === 'string')
        : [],
    },
    userData: {
      ready: userData['ready'] === true,
      status: readString(userData['status'], 'UNKNOWN'),
      ageMs: typeof userData['ageMs'] === 'number' && Number.isFinite(userData['ageMs'])
        ? userData['ageMs']
        : null,
    },
    marketCounts: {
      configured: typeof marketCounts['configured'] === 'number' ? marketCounts['configured'] : 0,
      enabled: typeof marketCounts['enabled'] === 'number' ? marketCounts['enabled'] : 0,
      blocked: typeof marketCounts['blocked'] === 'number' ? marketCounts['blocked'] : 0,
    },
  };
}

function readMarkets(value: unknown): readonly MarketRow[] {
  if (!isRecord(value) || !Array.isArray(value['markets'])) return [];
  return value['markets'].flatMap((item) => {
    if (!isRecord(item) || typeof item['symbol'] !== 'string' || typeof item['enabled'] !== 'boolean') {
      return [];
    }
    return [{
      symbol: item['symbol'],
      enabled: item['enabled'],
      operatorBuysPaused: item['operatorBuysPaused'] === true,
      readiness: readString(item['readiness'], item['enabled'] ? 'UNKNOWN' : 'DISABLED'),
      blockers: Array.isArray(item['blockers'])
        ? item['blockers'].filter((blocker): blocker is string => typeof blocker === 'string')
        : [],
      latestPrice: readDecimal(item['latestPrice']),
      priceFresh: item['priceFresh'] === true,
    }];
  });
}

function readRecoverySummary(value: unknown): RecoverySummary | null {
  if (!isRecord(value)) return null;
  return {
    buyCost: readDecimal(value['buyCost']),
    netSellProceeds: readDecimal(value['netSellProceeds']),
    outstandingRecoveryAmount: readDecimal(value['outstandingRecoveryAmount']),
    realizedNetProfit: readDecimal(value['realizedNetProfit']),
  };
}

function readPortfolioPositions(value: unknown): readonly PortfolioPosition[] {
  if (!isRecord(value) || !Array.isArray(value['positions'])) return [];
  return value['positions'].flatMap((item) => {
    if (!isRecord(item) || typeof item['symbol'] !== 'string') return [];
    return [{
      symbol: item['symbol'],
      baseAsset: typeof item['baseAsset'] === 'string' ? item['baseAsset'] : null,
      quoteAsset: typeof item['quoteAsset'] === 'string' ? item['quoteAsset'] : null,
      activeQuantity: readDecimal(item['activeQuantity']),
      freeQuantity: readDecimal(item['freeQuantity']),
      totalQuantity: readDecimal(item['totalQuantity']),
      investedQuote: readDecimal(item['investedQuote']),
      quoteNetCashFlow: readDecimal(item['quoteNetCashFlow']),
      recovery: readRecoverySummary(item['recovery']),
    }];
  });
}

function formatRuntimeDuration(status: RuntimeStatus | null): string {
  if (status?.startedAt === null || status?.observedAt === null || status?.startedAt === undefined ||
      status?.observedAt === undefined || status.observedAt < status.startedAt) {
    return 'Not reported';
  }
  const totalSeconds = Math.floor((status.observedAt - status.startedAt) / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

@Component({
  selector: 'app-bots',
  standalone: true,
  templateUrl: './page.html',
  styleUrl: './page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BotsComponent implements OnInit {
  private readonly api = inject(OperatorApi);

  readonly connected = signal(false);
  readonly loading = signal(false);
  readonly commandRunning = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly status = signal<RuntimeStatus | null>(null);
  readonly markets = signal<readonly MarketRow[]>([]);
  readonly positions = signal<readonly PortfolioPosition[]>([]);
  readonly pendingCommand = signal<PendingCommand | null>(null);

  readonly runtimeDuration = computed(() => formatRuntimeDuration(this.status()));
  readonly activeMarkets = computed(() =>
    this.markets().filter((market) => market.enabled && market.readiness === 'READY'),
  );
  readonly blockedMarkets = computed(() =>
    this.markets().filter((market) => market.enabled && market.readiness !== 'READY'),
  );
  readonly disabledMarkets = computed(() => this.markets().filter((market) => !market.enabled));

  ngOnInit(): void {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(null);
    try {
      const [status, markets, portfolio] = await Promise.all([
        firstValueFrom(this.api.getStatus()),
        firstValueFrom(this.api.getMarkets()),
        firstValueFrom(this.api.getPortfolio()),
      ]);
      this.status.set(readRuntimeStatus(status.data));
      this.markets.set(readMarkets(markets.data));
      this.positions.set(readPortfolioPositions(portfolio.data));
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
