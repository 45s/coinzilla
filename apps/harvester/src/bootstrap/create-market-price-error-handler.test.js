import nodeTest from "node:test"
import assert from "node:assert/strict"
import { StrategyId } from "../../domain/strategies/strategy-ids.js"
import { createMarketPriceErrorHandler } from "./create-market-price-error-handler.js"

const test = (...args) => nodeTest(`[create-market-price-error-handler.test.js] ${args[0]}`, ...args.slice(1))

function createFixture({ strategyIdsBySymbol = {} } = {}) {
  const records = []
  const logger = {
    error: (record) => records.push(record),
  }
  return {
    records,
    reportError: createMarketPriceErrorHandler({
      logger,
      strategyIdsBySymbol,
    }),
  }
}

test("attributes a CG-owned market-price processing failure to CG", () => {
  const fixture = createFixture({
    strategyIdsBySymbol: { BTCUSDT: StrategyId.COIN_GRABBER },
  })
  const error = new Error("CG processing failed")

  fixture.reportError({
    symbol: "BTCUSDT",
    error,
  })

  assert.equal(fixture.records.length, 1, "A market-price failure must emit one structured error.")
  assert.equal(fixture.records[0].strategyId, StrategyId.COIN_GRABBER, "CG ownership must remain explicit in the diagnostic.")
  assert.equal(fixture.records[0].symbol, "BTCUSDT", "The failing market symbol must remain available.")
  assert.equal(fixture.records[0].error, error, "The original error object must be preserved.")
})

test("attributes an RS-owned market-price processing failure to RS", () => {
  const fixture = createFixture({
    strategyIdsBySymbol: { LINEAUSDT: StrategyId.RECOVERY_SELLER },
  })
  const errors = [new Error("RS processing failed")]

  fixture.reportError({
    symbol: "LINEAUSDT",
    errors,
  })

  assert.equal(fixture.records[0].strategyId, StrategyId.RECOVERY_SELLER, "RS ownership must not inherit the old unconditional CG identity.")
  assert.equal(fixture.records[0].symbol, "LINEAUSDT", "The RS market symbol must remain available.")
  assert.equal(fixture.records[0].errors, errors, "The original structured error collection must be preserved.")
})

test("does not invent a strategy owner for missing or ambiguous market ownership", () => {
  const fixture = createFixture({
    strategyIdsBySymbol: {
      BTCUSDT: null,
    },
  })
  const error = new Error("ownership unavailable")

  fixture.reportError({
    symbol: "BTCUSDT",
    error,
  })
  fixture.reportError({
    symbol: "UNKNOWNUSDT",
    error,
  })

  assert.equal(fixture.records.length, 2, "Unknown market-price failures must still be reported.")
  for (const record of fixture.records) {
    assert.equal(Object.hasOwn(record, "strategyId"), false, "Unknown ownership must omit strategyId instead of falsely marking CG.")
    assert.equal(record.error, error, "Unknown ownership must not discard the original error.")
  }
})

test("preserves the established message and both error payload fields", () => {
  const fixture = createFixture({
    strategyIdsBySymbol: { BTCUSDT: StrategyId.COIN_GRABBER },
  })
  const error = new Error("primary")
  const errors = [new Error("secondary")]

  fixture.reportError({
    symbol: "BTCUSDT",
    error,
    errors,
  })

  assert.deepEqual(fixture.records[0], {
    message: "Market price processing failed",
    strategyId: StrategyId.COIN_GRABBER,
    symbol: "BTCUSDT",
    error,
    errors,
  }, "The attribution correction must preserve the established structured error contract.")
})
