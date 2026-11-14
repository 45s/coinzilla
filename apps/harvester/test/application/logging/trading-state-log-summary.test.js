import { StrategyId } from "../../../src/domain/strategies/strategy-ids.js"
import test from "node:test"
import assert from "node:assert/strict"
import {
  createPortfolioLogSummary,
  createPortfolioStatsLogSummary,
  createPositionLogSummary,
  createRecoveryLedgerLogSummary,
} from "../../../src/application/logging/trading-state-log-summary.js"

const position = {
  market: { id: "market-zro-usdt", symbol: "ZROUSDT" },
  quantity: { amount: "10" },
  spent: { amount: "10.5" },
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
    quantity: "10",
    spent: "10.5",
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
    legacyBuyCostMirror: "10.5",
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
      quantity: "10",
      spent: "10.5",
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


test("Portfolio Stats contains only Portfolio inventory and accounting values", () => {
  const summary = createPortfolioStatsLogSummary({
    position: {
      market: {
        symbol: "ZROUSDT",
        baseAsset: { code: "ZRO" },
        quoteAsset: { code: "USDT" },
      },
      baseQuantity: { amount: "25" },
      freeBaseQuantity: { amount: "0.15" },
      totalBaseQuantity: { amount: "25.15" },
      spent: { amount: "0" },
      quoteNetCashFlow: { amount: "0" },
    },
  })

  assert.deepEqual(summary, {
    message: "Portfolio Stats",
    symbol: "ZROUSDT",
    inventory: {
      activeBaseQuantity: "25 ZRO",
      freeBaseQuantity: "0.15 ZRO",
      totalBaseQuantity: "25.15 ZRO",
    },
    accounting: {
      spent: "0 USDT",
      quoteNetCashFlow: "0 USDT",
    },
  })
})


test("portfolio log summary selects one Position when a strategy owns multiple Positions for the market", () => {
  const selectedPosition = {
    ...position,
    positionId: "position:rs:cycle-2",
    strategyId: StrategyId.RECOVERY_SELLER,
  }
  const portfolio = {
    appliedFillIds: ["fill-1"],
    getPosition: (selection) => {
      assert.deepEqual(selection, {
        positionId: "position:rs:cycle-2",
        marketId: position.market.id,
        strategyId: StrategyId.RECOVERY_SELLER,
      })
      return selectedPosition
    },
  }

  const summary = createPortfolioLogSummary({
    portfolio,
    marketId: position.market.id,
    positionId: selectedPosition.positionId,
    strategyId: selectedPosition.strategyId,
  })

  assert.equal(summary.position.positionId, selectedPosition.positionId)
  assert.equal(summary.position.strategyId, selectedPosition.strategyId)
})
