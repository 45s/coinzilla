import { describe, expect, it } from 'vitest';

import { parseBotsWebSocketMessage } from './realtime';

const validSnapshot = {
  type: 'bots.snapshot',
  version: 1,
  revision: 1,
  observedAt: '2026-11-24T09:00:00.000Z',
  data: {
    status: {
      ok: true,
      data: {
        observedAt: 120000,
        runtimeState: 'RUNNING',
        tradingEnabled: true,
        userData: {
          ready: true,
        },
        readiness: {
          state: 'READY',
          blockers: [],
        },
        markets: {
          configured: 0,
          enabled: 0,
          blocked: 0,
        },
      },
    },
    markets: {
      ok: true,
      data: {
        observedAt: 120000,
        tradingEnabled: true,
        userDataReady: true,
        userDataStatus: 'READY',
        markets: [],
      },
    },
    portfolio: {
      ok: true,
      data: {
        observedAt: 120000,
        positions: [],
      },
    },
  },
} as const;

describe('Bots WebSocket protocol', () => {
  it('accepts a complete versioned snapshot with all authoritative resources', () => {
    expect(parseBotsWebSocketMessage(JSON.stringify(validSnapshot))).toEqual(validSnapshot);
  });

  it('accepts a complete revisioned state update using the full authoritative DTO shape', () => {
    const update = { ...validSnapshot, type: 'bots.state.updated', revision: 2 };
    expect(parseBotsWebSocketMessage(JSON.stringify(update))).toEqual(update);
  });

  it('accepts an explicit unavailable follow-up state update', () => {
    const update = { ...validSnapshot, type: 'bots.state.updated.unavailable', revision: 2, data: { ...validSnapshot.data, markets: { ok: false, error: { code: 'HARVESTER_OPERATOR_SNAPSHOT_READ_FAILED', message: 'Harvester operator snapshot is unavailable.' } } };
    expect(parseBotsWebSocketMessage(JSON.stringify(update))).toEqual(update);
  });

  it('rejects malformed JSON, unsupported versions and invalid revisions', () => {
    expect(parseBotsWebSocketMessage('{not-json')).toBeNull();
    expect(parseBotsWebSocketMessage(JSON.stringify({
      ...validSnapshot,
      version: 2,
    }))).toBeNull();
    expect(parseBotsWebSocketMessage(JSON.stringify({
      ...validSnapshot,
      revision: 0,
    }))).toBeNull();
  });

  it('rejects a complete snapshot that omits a required resource', () => {
    const incomplete = {
      ...validSnapshot,
      data: {
        ...validSnapshot.data,
        markets: {
          ok: true,
          data: null,
        },
      },
    };
    expect(parseBotsWebSocketMessage(JSON.stringify(incomplete))).toBeNull();
  });

  it('rejects numeric market prices instead of accepting lossy price data', () => {
    const malformed = {
      ...validSnapshot,
      data: {
        ...validSnapshot.data,
        markets: {
          ok: true,
          data: {
            observedAt: 120000,
            tradingEnabled: true,
            userDataReady: true,
            userDataStatus: 'READY',
            markets: [{
              symbol: 'BTCUSDT',
              enabled: true,
              readiness: 'READY',
              blockers: [],
              latestPrice: 65000,
              priceFresh: true,
            }],
          },
        },
      },
    };
    expect(parseBotsWebSocketMessage(JSON.stringify(malformed))).toBeNull();
  });

  it('rejects numeric recovery values instead of accepting lossy financial data', () => {
    const malformed = {
      ...validSnapshot,
      data: {
        ...validSnapshot.data,
        portfolio: {
          ok: true,
          data: {
            observedAt: 120000,
            positions: [{
              symbol: 'BTCUSDT',
              activeQuantity: '0.1',
              investedQuote: '500',
              recovery: {
                buyCost: 500,
                netSellProceeds: '0',
                outstandingRecoveryAmount: '500',
                realizedNetProfit: '0',
              },
            }],
          },
        },
      },
    };
    expect(parseBotsWebSocketMessage(JSON.stringify(malformed))).toBeNull();
  });

  it('accepts an explicit unavailable snapshot without converting failed reads to empty data', () => {
    const unavailable = {
      ...validSnapshot,
      type: 'bots.snapshot.unavailable',
      data: {
        ...validSnapshot.data,
        markets: {
          ok: false,
          error: {
            code: 'HARVESTER_OPERATOR_SNAPSHOT_READ_FAILED',
            message: 'Harvester operator snapshot is unavailable.',
          },
        },
      },
    };
    expect(parseBotsWebSocketMessage(JSON.stringify(unavailable))).toEqual(unavailable);
  });

  it('rejects an unavailable message when every resource claims success', () => {
    const mislabeled = {
      ...validSnapshot,
      type: 'bots.snapshot.unavailable',
    };
    expect(parseBotsWebSocketMessage(JSON.stringify(mislabeled))).toBeNull();
  });
});
