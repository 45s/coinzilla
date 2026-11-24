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
        runtimeState: 'RUNNING',
      },
    },
    markets: {
      ok: true,
      data: {
        markets: [],
      },
    },
    portfolio: {
      ok: true,
      data: {
        positions: [],
      },
    },
  },
} as const;

describe('Bots WebSocket protocol', () => {
  it('accepts a complete versioned snapshot with all authoritative resources', () => {
    expect(parseBotsWebSocketMessage(JSON.stringify(validSnapshot))).toEqual(validSnapshot);
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
