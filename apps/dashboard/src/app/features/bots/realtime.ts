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

export interface BotsSnapshotUnavailableMessage {
  readonly type: 'bots.snapshot.unavailable';
  readonly version: 1;
  readonly revision: number;
  readonly observedAt: string;
  readonly data: BotsSnapshotUnavailableData;
}

export type BotsWebSocketMessage = BotsSnapshotMessage | BotsSnapshotUnavailableMessage;

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

function isSnapshotResource(value: unknown): value is BotsSnapshotResource {
  return isAvailableResource(value) || isUnavailableResource(value);
}

function isSnapshotData(value: unknown): value is BotsSnapshotUnavailableData {
  return isRecord(value)
    && isSnapshotResource(value.status)
    && isSnapshotResource(value.markets)
    && isSnapshotResource(value.portfolio);
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
  return null;
}
