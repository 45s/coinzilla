export interface BotsRuntimeStatus {
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

export interface BotsMarketRow {
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

export interface BotsPortfolioPosition {
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

function readRecoverySummary(value: unknown): RecoverySummary | null {
  if (!isRecord(value)) return null;
  return {
    buyCost: readDecimal(value['buyCost']),
    netSellProceeds: readDecimal(value['netSellProceeds']),
    outstandingRecoveryAmount: readDecimal(value['outstandingRecoveryAmount']),
    realizedNetProfit: readDecimal(value['realizedNetProfit']),
  };
}

export function readBotsRuntimeStatus(value: unknown): BotsRuntimeStatus | null {
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

export function readBotsMarketRows(value: unknown): readonly BotsMarketRow[] {
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

export function readBotsPortfolioPositions(value: unknown): readonly BotsPortfolioPosition[] {
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

export function formatBotsRuntimeDuration(status: BotsRuntimeStatus | null): string {
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
