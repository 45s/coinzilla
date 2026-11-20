import assert from "node:assert/strict"
import test from "node:test"
import { sha256OperationalStateValue } from "../operational-state-canonical.js"
import { validateRecoverySellerMixedSellReconciledFact } from "./validate-operational-state-recovery-seller-facts.js"

function makeFact(overrides = {}) {
  const data = {
    cycleId: "rs-cycle-1",
    marketId: "binance:BTCUSDT",
    venue: "binance",
    symbol: "BTCUSDT",
    baseAssetId: "asset:BTC",
    quoteAssetId: "asset:USDT",
    sellOrderClientId: "rs-sell-client-1",
    sellOrderBrokerOrderId: "rs-sell-broker-1",
    terminalStatus: "CANCELED",
    appliedFillIds: ["binance:BTCUSDT:trade-1"],
    accountingApplied: true,
    eligible: false,
    ...overrides,
  }
  const identity = JSON.stringify([
    data.marketId,
    data.cycleId,
    data.sellOrderClientId,
    data.sellOrderBrokerOrderId,
  ])
  return {
    factType: "RECOVERY_SELLER_MIXED_SELL_RECONCILED",
    factId: `recovery-seller-mixed-sell-reconciled:${sha256OperationalStateValue(identity)}`,
    canonicalData: data,
  }
}

test("accepts an explicit durable terminal mixed-SELL accounting boundary", () => {
  assert.doesNotThrow(() => validateRecoverySellerMixedSellReconciledFact(makeFact()))
})

test("rejects non-terminal, uncommitted, ambiguous and malformed mixed-SELL boundaries", () => {
  for (const changes of [
    { terminalStatus: "OPEN" },
    { accountingApplied: false },
    { eligible: "true" },
    { appliedFillIds: [] },
    { appliedFillIds: ["fill-1", "fill-1"] },
    { appliedFillIds: [""] },
    { unsupported: true },
    { marketId: "other:BTCUSDT" },
  ]) {
    const fact = makeFact(changes)
    assert.throws(
      () => validateRecoverySellerMixedSellReconciledFact(fact),
      /identity|terminal order|unique canonical|unsupported fields/,
    )
  }
})
