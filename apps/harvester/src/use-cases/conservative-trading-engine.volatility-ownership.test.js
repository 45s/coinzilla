import test from "node:test";
import assert from "node:assert/strict";
import { StrategyId } from "../domain/strategies/strategy-ids.js";
import { makeConservativeTradingEngine } from "./conservative-trading-engine.js";
import { conservativeStrategyPolicy } from "../domain/strategies/conservative/strategy-policy.js";

const rsOnlyMarketSymbol = "LINEAUSDT";
const rsOnlyMarketSnapshot = {
  ok: true,
  data: {
    status: {
      isReady: true,
      isFresh: true,
      reason: null,
      lastClosedCandleOpenTime: 60_000,
      observedAt: 60_000,
    },
    metrics: {
      openTime: 60_000,
      atr: "1",
      natr: "2",
      referenceNatr: "1",
      volatilityRatio: "2",
    },
  },
};

const appConfig = {
  strategies: {
    [StrategyId.COIN_GRABBER]: {
      enabled: true,
      settings: {
        conservative: { enabled: true },
        aggressive: { enabled: false },
      },
      pairs: {
        DOGEUSDT: {
          enabled: true,
          enableVolatilityProtection: true,
        },
      },
    },
    [StrategyId.RECOVERY_SELLER]: {
      enabled: true,
      pairs: {
        [rsOnlyMarketSymbol]: {
          enabled: true,
          enableVolatilityProtection: false,
        },
      },
    },
  },
};

function createEngine({ emittedSystemLogs } = {}) {
  return makeConservativeTradingEngine({
    broker: {},
    strategyPolicy: conservativeStrategyPolicy,
    appConfig,
    getPortfolio: () => undefined,
    getRecoveryLedger: () => undefined,
    getMarketMetadata: () => undefined,
    getAccountSnapshot: () => undefined,
    updateTradingAccounting: async () => ({ ok: true }),
    completeRecoveryCycle: async () => ({ ok: true }),
    canTrade: () => true,
    onPause: async () => {},
    isStopping: () => false,
    getVolatilityData: () => rsOnlyMarketSnapshot,
    isMarketPriceFresh: () => true,
    isMarketBookFresh: () => true,
    hasUnownedOpenOrdersForSymbol: () => false,
    now: () => 60_000,
    logger: {
      system: (record) => emittedSystemLogs.push(record),
    },
    initialState: {},
  });
}

test("does not process CG volatility for RS-only LINEA when RS volatility is disabled", async () => {
  const emittedSystemLogs = [];
  const engine = createEngine({ emittedSystemLogs });

  const result = await engine.processVolatilitySnapshot({
    symbol: rsOnlyMarketSymbol,
    snapshot: rsOnlyMarketSnapshot,
  });

  assert.equal(result.ok, true, "CG must safely ignore volatility snapshots for markets it does not own.");
  assert.equal(result.data.skipped, true, "RS-only LINEA must not enter the CG volatility state machine.");
  assert.equal(
    result.data.reason,
    "VOLATILITY_PROTECTION_DISABLED_FOR_PAIR",
    "A market absent from CG configuration must be reported as volatility protection disabled.",
  );
  assert.equal(
    engine.getVolatilityProtectionState({ symbol: rsOnlyMarketSymbol }),
    undefined,
    "CG must not allocate volatility state for RS-only LINEA.",
  );
  assert.deepEqual(
    emittedSystemLogs,
    [],
    "CG must not emit a volatility state-change log for RS-only LINEA.",
  );
});
