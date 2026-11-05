import test from "node:test"
import assert from "node:assert/strict"
import {
  createPortfolioLogSummary,
  createPositionLogSummary,
  createRecoveryLedgerLogSummary,
} from "../../../src/application/logging/trading-state-log-summary.js"

const position = {
  market: { id: "market-zro-usdt", symbol: "ZROUSDT" },
  baseQuantity: { amount: "10" },
  freeBaseQuantity: { amount: "0.01" },
  totalBaseQuantity: { amount: "10.01" },
  quoteNetCashFlow: { amount: "-10.5" },
}

const recoveryLedger = {
  market: position.market,
  buyCost: "10.5",
  netSellProceeds: "0",
  outstandingRecoveryAmount: "10.5",
  realizedNetProfit: "-10.5",
  appliedFillIds: ["fill-1", "fill-2"],
  get value() {
    throw new Error("Diagnostic summaries must not serialize RecoveryLedger.value")
  },
}

test("position log summary keeps trading quantities without serializing the full Position", () => {
  assert.deepEqual(createPositionLogSummary({ position }), {
    marketId: "market-zro-usdt",
    symbol: "ZROUSDT",
    activeBaseQuantity: "10",
    freeBaseQuantity: "0.01",
    totalBaseQuantity: "10.01",
    quoteNetCashFlow: "-10.5",
  })
})

test("recovery ledger log summary keeps accounting totals and fill count, not fill fingerprints", () => {
  const summary = createRecoveryLedgerLogSummary({ recoveryLedger })

  assert.deepEqual(summary, {
    marketId: "market-zro-usdt",
    symbol: "ZROUSDT",
    buyCost: "10.5",
    netSellProceeds: "0",
    outstandingRecoveryAmount: "10.5",
    realizedNetProfit: "-10.5",
    appliedFillCount: 2,
  })
  assert.equal("appliedFillIds" in summary, false)
  assert.equal("appliedFillFingerprints" in summary, false)
})

test("portfolio log summary is scoped to the evaluated market and exposes only aggregate fill count", () => {
  const portfolio = {
    appliedFillIds: ["fill-1", "fill-2", "fill-3"],
    getPosition: ({ marketId }) => marketId === position.market.id ? position : undefined,
    get value() {
      throw new Error("Diagnostic summaries must not serialize Portfolio.value")
    },
  }

  assert.deepEqual(createPortfolioLogSummary({
    portfolio,
    marketId: position.market.id,
  }), {
    position: {
      marketId: "market-zro-usdt",
      symbol: "ZROUSDT",
      activeBaseQuantity: "10",
      freeBaseQuantity: "0.01",
      totalBaseQuantity: "10.01",
      quoteNetCashFlow: "-10.5",
    },
    appliedFillCount: 3,
  })
})

test("missing portfolio positions and ledgers are represented as null", () => {
  assert.deepEqual(createPortfolioLogSummary({
    portfolio: { appliedFillIds: [], getPosition: () => undefined },
    marketId: "market-zro-usdt",
  }), { position: null, appliedFillCount: 0 })
  assert.equal("appliedFillFingerprints" in createPortfolioLogSummary({
    portfolio: { appliedFillIds: [], getPosition: () => undefined },
    marketId: "market-zro-usdt",
  }), false)
  assert.equal(createPositionLogSummary({}), null)
  assert.equal(createRecoveryLedgerLogSummary({}), null)
  assert.deepEqual(createPortfolioLogSummary({
    portfolio: { appliedFillIds: [], getPosition: () => { throw new Error("must not query without market id") } },
  }), { position: null, appliedFillCount: 0 })
})
