import { describe, expect, it } from 'vitest';

import {
  formatBotsRuntimeDuration,
  readBotsMarketRows,
  readBotsPortfolioPositions,
  readBotsRuntimeStatus,
} from './view-model';

describe('Bots view model', () => {
  it('maps the effective runtime strategy, readiness and lifecycle timestamps', () => {
    const status = readBotsRuntimeStatus({
      observedAt: 120000,
      startedAt: 60000,
      runtimeState: 'RUNNING',
      broker: 'binance',
      tradingEnabled: true,
      tradingMode: 'testnet',
      strategyMode: 'conservative-testnet',
      stopping: false,
      readiness: { state: 'BLOCKED', blockers: ['USER_DATA_NOT_READY', 7] },
      userData: { ready: false, status: 'STALE', ageMs: 1500 },
      markets: { configured: 3, enabled: 2, blocked: 1 },
    });

    expect(status).toMatchObject({
      observedAt: 120000,
      startedAt: 60000,
      runtimeState: 'RUNNING',
      broker: 'binance',
      tradingEnabled: true,
      tradingMode: 'testnet',
      strategyMode: 'conservative-testnet',
      readiness: { state: 'BLOCKED', blockers: ['USER_DATA_NOT_READY'] },
      userData: { ready: false, status: 'STALE', ageMs: 1500 },
      marketCounts: { configured: 3, enabled: 2, blocked: 1 },
    });
  });

  it('returns null for non-object runtime payloads and safe defaults for incomplete snapshots', () => {
    expect(readBotsRuntimeStatus(null)).toBeNull();
    expect(readBotsRuntimeStatus([])).toBeNull();

    const status = readBotsRuntimeStatus({
      observedAt: -1,
      startedAt: 'unknown',
      runtimeState: null,
      broker: '',
      tradingEnabled: false,
      tradingMode: null,
      strategyMode: '',
      readiness: null,
      userData: null,
      markets: null,
    });

    expect(status).toMatchObject({
      observedAt: null,
      startedAt: null,
      runtimeState: 'UNKNOWN',
      broker: 'Unknown broker',
      tradingEnabled: false,
      tradingMode: 'Unknown environment',
      strategyMode: 'Not reported',
      readiness: { state: 'UNKNOWN', blockers: [] },
      userData: { ready: false, status: 'UNKNOWN', ageMs: null },
      marketCounts: { configured: 0, enabled: 0, blocked: 0 },
    });
  });

  it('maps valid, blocked and disabled market snapshots without accepting malformed rows', () => {
    const markets = readBotsMarketRows({
      markets: [
        { symbol: 'BTCUSDT', enabled: true, readiness: 'READY', operatorBuysPaused: true, blockers: [], latestPrice: '65000.00000000', priceFresh: true },
        { symbol: 'ADAUSDT', enabled: true, blockers: ['USER_DATA_NOT_READY', 1], latestPrice: 0, priceFresh: false },
        { symbol: 'SOLUSDT', enabled: false, blockers: [] },
        { symbol: 7, enabled: true },
        null,
      ],
    });

    expect(markets).toHaveLength(3);
    expect(markets[0]).toMatchObject({
      symbol: 'BTCUSDT',
      enabled: true,
      readiness: 'READY',
      operatorBuysPaused: true,
      latestPrice: '65000.00000000',
      priceFresh: true,
    });
    expect(markets[1]).toMatchObject({
      symbol: 'ADAUSDT',
      readiness: 'UNKNOWN',
      blockers: ['USER_DATA_NOT_READY'],
      latestPrice: null,
      priceFresh: false,
    });
    expect(markets[2]).toMatchObject({
      symbol: 'SOLUSDT',
      enabled: false,
      readiness: 'DISABLED',
    });
    expect(readBotsMarketRows({ markets: 'invalid' })).toEqual([]);
  });

  it('preserves Portfolio decimal strings and keeps optional recovery fields nullable', () => {
    const positions = readBotsPortfolioPositions({
      positions: [
        {
          symbol: 'BTCUSDT',
          baseAsset: 'BTC',
          quoteAsset: 'USDT',
          activeQuantity: '0.12500000',
          freeQuantity: '0.00100000',
          totalQuantity: '0.12600000',
          investedQuote: '500.00000000',
          quoteNetCashFlow: '-500.00000000',
          recovery: {
            buyCost: '500.00000000',
            netSellProceeds: '0',
            outstandingRecoveryAmount: '500.00000000',
            realizedNetProfit: '0',
          },
        },
        { symbol: 'ADAUSDT', recovery: null },
        { symbol: 5 },
        null,
      ],
    });

    expect(positions).toHaveLength(2);
    expect(positions[0]).toMatchObject({
      symbol: 'BTCUSDT',
      activeQuantity: '0.12500000',
      freeQuantity: '0.00100000',
      totalQuantity: '0.12600000',
      investedQuote: '500.00000000',
      quoteNetCashFlow: '-500.00000000',
      recovery: {
        buyCost: '500.00000000',
        netSellProceeds: '0',
        outstandingRecoveryAmount: '500.00000000',
        realizedNetProfit: '0',
      },
    });
    expect(positions[1]).toMatchObject({
      symbol: 'ADAUSDT',
      baseAsset: null,
      quoteAsset: null,
      activeQuantity: null,
      recovery: null,
    });
    expect(readBotsPortfolioPositions({ positions: null })).toEqual([]);
  });

  it('formats elapsed process time across seconds, hours and days', () => {
    const status = readBotsRuntimeStatus({
      observedAt: 120000,
      startedAt: 60000,
      runtimeState: 'RUNNING',
      tradingEnabled: true,
    });
    expect(formatBotsRuntimeDuration(status)).toBe('1m 0s');

    expect(formatBotsRuntimeDuration({
      ...status!,
      startedAt: 0,
      observedAt: 3660000,
    })).toBe('1h 1m');
    expect(formatBotsRuntimeDuration({
      ...status!,
      startedAt: 0,
      observedAt: 93780000,
    })).toBe('1d 2h 3m');
    expect(formatBotsRuntimeDuration(null)).toBe('Not reported');
    expect(formatBotsRuntimeDuration({
      ...status!,
      startedAt: null,
    })).toBe('Not reported');
    expect(formatBotsRuntimeDuration({
      ...status!,
      startedAt: 2000,
      observedAt: 1000,
    })).toBe('Not reported');
  });
});
