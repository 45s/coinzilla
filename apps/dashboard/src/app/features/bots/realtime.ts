export interface BotsOperatorResource {
  readonly ok: true;
  readonly data: Record<string, unknown>;
}

export interface BotsUnavailableResource {
  readonly ok: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

export type BotsSnapshotResource = BotsOperatorResource | BotsUnavailableResource;

export interface BotsSnapshotData {
  readonly status: BotsOperatorResource;
  readonly markets: BotsOperatorResource;
  readonly portfolio: BotsOperatorResource;
}

export interface BotsSnapshotUnavailableData {
  readonly status: BotsSnapshotResource;
  readonly markets: BotsSnapshotResource;
  readonly portfolio: BotsSnapshotResource;
}

export interface BotsSnapshotMessage {
  readonly type: 'bots.snapshot';
  readonly version: 1;
  readonly revision: number;
  readonly observedAt: string;
  readonly data: BotsSnapshotData;
}

export interface BotsStateUpdatedMessage {
  readonly type: 'bots.state.updated';
  readonly version: 1;
  readonly revision: number;
  readonly observedAt: string;
  readonly data: BotsSnapshotUnavailableData;
}

export interface BotsStateUpdatedUnavailableMessage {
  readonly type: 'bots.state.updated.unavailable';
  readonly version: 1;
  readonly revision: number;
  readonly observedAt: string;
  readonly data: BotsSnapshotUnavailableData;
}

export interface BotsSnapshotUnavailableMessage {
  readonly type: 'bots.snapshot.unavailable';
  readonly version: 1;
  readonly revision: number;
  readonly observedAt: string;
  readonly data: BotsSnapshotUnavailableData;
}

export type BotsWebSocketMessage = BotsSnapshotMessage | BotsStateUpdatedMessage | BotsStateUpdatedUnavailableMessage | BotsSnapshotUnavailableMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAvailableResource(value: unknown): value is BotsOperatorResource {
  return isRecord(value) && value['ok'] === true && isRecord(value['data']);
}

function isUnavailableResource(value: unknown): value is BotsUnavailableResource {
  if (!isRecord(value) || value['ok'] !== false || !isRecord(value['error'])) {
    return false;
  }
  const error = value['error'];
  return typeof error['code'] === 'string' && typeof error['message'] === 'string';
}

function isStatusData(value: unknown): boolean {
  if (!isRecord(value) || !Number.isSafeInteger(value['observedAt'])
    || typeof value['runtimeState'] !== 'string'
    || typeof value['tradingEnabled'] !== 'boolean'
    || !isRecord(value['userData'])
    || typeof value['userData']['ready'] !== 'boolean'
    || !isRecord(value['readiness'])
    || typeof value['readiness']['state'] !== 'string'
    || !Array.isArray(value['readiness']['blockers'])
    || !isRecord(value['markets'])) {
    return false;
  }
  const marketCounts = value['markets'];
  return Number.isSafeInteger(marketCounts['configured'])
    && Number.isSafeInteger(marketCounts['enabled'])
    && Number.isSafeInteger(marketCounts['blocked']);
}

function isMarketsData(value: unknown): boolean {
  if (!isRecord(value) || !Number.isSafeInteger(value['observedAt'])
    || typeof value['tradingEnabled'] !== 'boolean'
    || typeof value['userDataReady'] !== 'boolean'
    || typeof value['userDataStatus'] !== 'string'
    || !Array.isArray(value['markets'])) {
    return false;
  }
  return value['markets'].every((market) => isRecord(market)
    && typeof market['symbol'] === 'string'
    && typeof market['enabled'] === 'boolean'
    && typeof market['readiness'] === 'string'
    && Array.isArray(market['blockers'])
    && (market['operatorBuysPaused'] === undefined || typeof market['operatorBuysPaused'] === 'boolean')
    && (market['latestPrice'] === undefined || market['latestPrice'] === null || typeof market['latestPrice'] === 'string')
    && (market['priceFresh'] === undefined || market['priceFresh'] === null || typeof market['priceFresh'] === 'boolean'));
}

function isPositionData(value: unknown): boolean {
  if (!isRecord(value)
    || typeof value['symbol'] !== 'string'
    || typeof value['activeQuantity'] !== 'string'
    || typeof value['investedQuote'] !== 'string') {
    return false;
  }
  for (const field of ['freeQuantity', 'totalQuantity', 'quoteNetCashFlow']) {
    if (value[field] !== undefined && value[field] !== null && typeof value[field] !== 'string') {
      return false;
    }
  }
  if (value['recovery'] === null) {
    return true;
  }
  const recovery = value['recovery'];
  return isRecord(recovery)
    && typeof recovery['buyCost'] === 'string'
    && typeof recovery['netSellProceeds'] === 'string'
    && typeof recovery['outstandingRecoveryAmount'] === 'string'
    && typeof recovery['realizedNetProfit'] === 'string';
}

function isPortfolioData(value: unknown): boolean {
  if (!isRecord(value) || !Number.isSafeInteger(value['observedAt'])
    || !Array.isArray(value['positions'])) {
    return false;
  }
  return value['positions'].every(isPositionData);
}

function isStatusResource(value: unknown): value is BotsSnapshotResource {
  return isUnavailableResource(value)
    || (isAvailableResource(value) && isStatusData(value['data']));
}

function isMarketsResource(value: unknown): value is BotsSnapshotResource {
  return isUnavailableResource(value)
    || (isAvailableResource(value) && isMarketsData(value['data']));
}

function isPortfolioResource(value: unknown): value is BotsSnapshotResource {
  return isUnavailableResource(value)
    || (isAvailableResource(value) && isPortfolioData(value['data']));
}

function isSnapshotData(value: unknown): value is BotsSnapshotUnavailableData {
  return isRecord(value)
    && isStatusResource(value['status'])
    && isMarketsResource(value['markets'])
    && isPortfolioResource(value['portfolio']);
}

function isSnapshotEnvelope(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || value['version'] !== 1) {
    return false;
  }
  return Number.isSafeInteger(value['revision'])
    && Number(value['revision']) > 0
    && typeof value['observedAt'] === 'string'
    && Number.isFinite(Date.parse(value['observedAt']))
    && isSnapshotData(value['data']);
}

export function parseBotsWebSocketMessage(raw: string): BotsWebSocketMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isSnapshotEnvelope(value)) {
    return null;
  }
  const { status, markets, portfolio } = value['data'] as BotsSnapshotUnavailableData;
  if (value['type'] === 'bots.snapshot') {
    if (!isAvailableResource(status) || !isAvailableResource(markets) || !isAvailableResource(portfolio)) {
      return null;
    }
    return value as unknown as BotsSnapshotMessage;
  }
  if (value['type'] === 'bots.snapshot.unavailable') {
    if (isAvailableResource(status) && isAvailableResource(markets) && isAvailableResource(portfolio)) {
      return null;
    }
    return value as unknown as BotsSnapshotUnavailableMessage;
  }
  if (value['type'] === 'bots.state.updated') return value as unknown as BotsStateUpdatedMessage;
  if (value['type'] === 'bots.state.updated.unavailable') {
    if (isAvailableResource(status) && isAvailableResource(markets) && isAvailableResource(portfolio)) return null;
    return value as unknown as BotsStateUpdatedUnavailableMessage;
  }
  return null;
}
