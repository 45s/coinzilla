import assert from "node:assert/strict"
import test from "node:test"
import { projectHarvesterJournalRecovery } from "../../src/infrastructure/journal/project-harvester-journal-recovery.js"
import { restoreHarvesterJournalState } from "../../src/use-cases/restore-harvester-journal-state.js"
import { createRecoveryCrashFixture } from "../../test-support/recovery/recovery-crash-fixtures.js"

function restoreSnapshot({ fixture, recordCount }) {
  const records = fixture.records.slice(0, recordCount)
  const projection = projectHarvesterJournalRecovery({ records })
  assert.equal(
    projection.ok,
    true,
    projection.errors?.map((error) => error.message).join("; "),
  )
  const restored = restoreHarvesterJournalState({
    projection,
    marketMetadata: new Map([[fixture.market.symbol, fixture.market]]),
  })
  assert.equal(
    restored.ok,
    true,
    restored.errors?.map((error) => error.message).join("; "),
  )

  const state = restored.data
  return {
    state: {
      orders: state.orderRegistry.orders.map((order) => ({
        clientOrderId: order.clientOrderId,
        brokerOrderId: order.brokerOrderId ?? null,
        side: order.side,
        status: order.status,
        originalQuantity: order.originalQuantity.amount,
        executedQuantity: order.executedQuantity.amount,
      })),
      positions: state.portfolio.positions.map((position) => ({
        symbol: position.market.symbol,
        activeQuantity: position.baseQuantity.amount,
        freeQuantity: position.freeBaseQuantity.amount,
        totalQuantity: position.totalBaseQuantity.amount,
        spent: position.spent.amount,
        quoteNetCashFlow: position.quoteNetCashFlow.amount,
      })),
      ledgers: [...state.recoveryLedgers].map(([marketId, ledger]) => ({
        marketId,
        buyCost: ledger.buyCost,
        netSellProceeds: ledger.netSellProceeds,
        outstandingRecoveryAmount: ledger.outstandingRecoveryAmount,
        appliedFillIds: [...ledger.appliedFillIds],
      })),
      appliedFillIds: [...state.portfolio.appliedFillIds],
      journalFills: state.journalFills.map((fill) => ({
        fillId: fill.fillId,
        side: fill.side,
        quantity: fill.quantity,
        quoteQuantity: fill.quoteQuantity,
      })),
      pausedMarkets: [...state.pausedMarkets],
      durablePausedMarkets: [...state.durablePausedMarkets],
      recoveryManagedPausedMarkets: [...state.recoveryManagedPausedMarkets],
      completedOrderClientIds: [...state.completedOrderClientIds],
      requiresExchangeReconciliation: state.requiresExchangeReconciliation,
      sessions: projection.data.sessions.map((session) => ({
        fileName: session.fileName,
        tradingEnabled: session.tradingEnabled,
        hasTradingActivity: session.hasTradingActivity,
        uncleanTradingShutdown: session.uncleanTradingShutdown,
      })),
    },
    projection,
  }
}

const noPosition = []
const noLedger = []
const noFills = []
const noPause = []
const noCompletedOrders = []

test("reconstructs the complete state when the process crashes after durable order intent", () => {
  const fixture = createRecoveryCrashFixture()
  const { state } = restoreSnapshot({
    fixture,
    recordCount: fixture.checkpoints.afterOrderIntent,
  })

  assert.deepEqual(state, {
    orders: [{
      clientOrderId: "harvester-BTCUSDT-buy-001",
      brokerOrderId: null,
      side: "BUY",
      status: "UNKNOWN",
      originalQuantity: "1",
      executedQuantity: "0",
    }],
    positions: noPosition,
    ledgers: noLedger,
    appliedFillIds: noFills,
    journalFills: noFills,
    pausedMarkets: noPause,
    durablePausedMarkets: noPause,
    recoveryManagedPausedMarkets: noPause,
    completedOrderClientIds: noCompletedOrders,
    requiresExchangeReconciliation: true,
    sessions: [{
      fileName: "process-001.jsonl",
      tradingEnabled: true,
      hasTradingActivity: true,
      uncleanTradingShutdown: true,
    }],
  })
})

test("keeps an acknowledged order unresolved when the process crashes before any fill publication", () => {
  const fixture = createRecoveryCrashFixture()
  const { state } = restoreSnapshot({
    fixture,
    recordCount: fixture.checkpoints.beforeFillAppliedPublication,
  })

  assert.deepEqual(state, {
    orders: [{
      clientOrderId: "harvester-BTCUSDT-buy-001",
      brokerOrderId: "9001",
      side: "BUY",
      status: "UNKNOWN",
      originalQuantity: "1",
      executedQuantity: "0",
    }],
    positions: noPosition,
    ledgers: noLedger,
    appliedFillIds: noFills,
    journalFills: noFills,
    pausedMarkets: noPause,
    durablePausedMarkets: noPause,
    recoveryManagedPausedMarkets: noPause,
    completedOrderClientIds: noCompletedOrders,
    requiresExchangeReconciliation: true,
    sessions: [{
      fileName: "process-001.jsonl",
      tradingEnabled: true,
      hasTradingActivity: true,
      uncleanTradingShutdown: true,
    }],
  })
})

test("reconstructs partial-fill inventory and accounting exactly at the fill-applied boundary", () => {
  const fixture = createRecoveryCrashFixture()
  const { state } = restoreSnapshot({
    fixture,
    recordCount: fixture.checkpoints.afterPartialFillApplied,
  })

  assert.deepEqual(state, {
    orders: [{
      clientOrderId: "harvester-BTCUSDT-buy-001",
      brokerOrderId: "9001",
      side: "BUY",
      status: "UNKNOWN",
      originalQuantity: "1",
      executedQuantity: "0.4",
    }],
    positions: [{
      symbol: "BTCUSDT",
      activeQuantity: "0.3996",
      freeQuantity: "0",
      totalQuantity: "0.3996",
      spent: "40",
      quoteNetCashFlow: "-40",
    }],
    ledgers: [{
      marketId: fixture.market.id,
      buyCost: "40",
      netSellProceeds: "0",
      outstandingRecoveryAmount: "40",
      appliedFillIds: ["binance:BTCUSDT:buy-trade-001"],
    }],
    appliedFillIds: ["binance:BTCUSDT:buy-trade-001"],
    journalFills: [{
      fillId: "binance:BTCUSDT:buy-trade-001",
      side: "BUY",
      quantity: "0.4",
      quoteQuantity: "40",
    }],
    pausedMarkets: noPause,
    durablePausedMarkets: noPause,
    recoveryManagedPausedMarkets: noPause,
    completedOrderClientIds: noCompletedOrders,
    requiresExchangeReconciliation: true,
    sessions: [{
      fileName: "process-001.jsonl",
      tradingEnabled: true,
      hasTradingActivity: true,
      uncleanTradingShutdown: true,
    }],
  })
})

test("reconstructs final BUY fill facts across two process sessions without losing fee-adjusted inventory", () => {
  const fixture = createRecoveryCrashFixture()
  const { state } = restoreSnapshot({
    fixture,
    recordCount: fixture.checkpoints.afterFinalBuyFillApplied,
  })

  assert.deepEqual(state, {
    orders: [{
      clientOrderId: "harvester-BTCUSDT-buy-001",
      brokerOrderId: "9001",
      side: "BUY",
      status: "UNKNOWN",
      originalQuantity: "1",
      executedQuantity: "1",
    }],
    positions: [{
      symbol: "BTCUSDT",
      activeQuantity: "0.9992",
      freeQuantity: "0",
      totalQuantity: "0.9992",
      spent: "100",
      quoteNetCashFlow: "-100",
    }],
    ledgers: [{
      marketId: fixture.market.id,
      buyCost: "100",
      netSellProceeds: "0",
      outstandingRecoveryAmount: "100",
      appliedFillIds: [
        "binance:BTCUSDT:buy-trade-001",
        "binance:BTCUSDT:buy-trade-002",
      ],
    }],
    appliedFillIds: [
      "binance:BTCUSDT:buy-trade-001",
      "binance:BTCUSDT:buy-trade-002",
    ],
    journalFills: [
      {
        fillId: "binance:BTCUSDT:buy-trade-001",
        side: "BUY",
        quantity: "0.4",
        quoteQuantity: "40",
      },
      {
        fillId: "binance:BTCUSDT:buy-trade-002",
        side: "BUY",
        quantity: "0.6",
        quoteQuantity: "60",
      },
    ],
    pausedMarkets: noPause,
    durablePausedMarkets: noPause,
    recoveryManagedPausedMarkets: noPause,
    completedOrderClientIds: noCompletedOrders,
    requiresExchangeReconciliation: true,
    sessions: [
      {
        fileName: "process-001.jsonl",
        tradingEnabled: true,
        hasTradingActivity: true,
        uncleanTradingShutdown: true,
      },
      {
        fileName: "process-002.jsonl",
        tradingEnabled: true,
        hasTradingActivity: true,
        uncleanTradingShutdown: true,
      },
    ],
  })
})

test("does not reset recovery basis before the cycle-completion fact is published", () => {
  const fixture = createRecoveryCrashFixture()
  const { state } = restoreSnapshot({
    fixture,
    recordCount: fixture.checkpoints.afterRecoverySellFillApplied,
  })

  assert.deepEqual(state, {
    orders: [
      {
        clientOrderId: "harvester-BTCUSDT-buy-001",
        brokerOrderId: "9001",
        side: "BUY",
        status: "UNKNOWN",
        originalQuantity: "1",
        executedQuantity: "1",
      },
      {
        clientOrderId: "harvester-BTCUSDT-sell-001",
        brokerOrderId: "9002",
        side: "SELL",
        status: "UNKNOWN",
        originalQuantity: "0.9892",
        executedQuantity: "0.9892",
      },
    ],
    positions: [{
      symbol: "BTCUSDT",
      activeQuantity: "0.01",
      freeQuantity: "0",
      totalQuantity: "0.01",
      spent: "100",
      quoteNetCashFlow: "2",
    }],
    ledgers: [{
      marketId: fixture.market.id,
      buyCost: "100",
      netSellProceeds: "102",
      outstandingRecoveryAmount: "0",
      appliedFillIds: [
        "binance:BTCUSDT:buy-trade-001",
        "binance:BTCUSDT:buy-trade-002",
        "binance:BTCUSDT:sell-trade-001",
      ],
    }],
    appliedFillIds: [
      "binance:BTCUSDT:buy-trade-001",
      "binance:BTCUSDT:buy-trade-002",
      "binance:BTCUSDT:sell-trade-001",
    ],
    journalFills: [
      {
        fillId: "binance:BTCUSDT:buy-trade-001",
        side: "BUY",
        quantity: "0.4",
        quoteQuantity: "40",
      },
      {
        fillId: "binance:BTCUSDT:buy-trade-002",
        side: "BUY",
        quantity: "0.6",
        quoteQuantity: "60",
      },
      {
        fillId: "binance:BTCUSDT:sell-trade-001",
        side: "SELL",
        quantity: "0.9892",
        quoteQuantity: "102",
      },
    ],
    pausedMarkets: noPause,
    durablePausedMarkets: noPause,
    recoveryManagedPausedMarkets: noPause,
    completedOrderClientIds: noCompletedOrders,
    requiresExchangeReconciliation: true,
    sessions: [
      {
        fileName: "process-001.jsonl",
        tradingEnabled: true,
        hasTradingActivity: true,
        uncleanTradingShutdown: true,
      },
      {
        fileName: "process-002.jsonl",
        tradingEnabled: true,
        hasTradingActivity: true,
        uncleanTradingShutdown: true,
      },
    ],
  })
})

test("restores retained inventory, reset basis, and sticky pause after cycle and blocker publication", () => {
  const fixture = createRecoveryCrashFixture()
  const { state, projection } = restoreSnapshot({
    fixture,
    recordCount: fixture.checkpoints.afterStrategyPausePublication,
  })

  assert.equal(
    fixture.records[fixture.checkpoints.afterRecoveryCycleCompletion].payload.name,
    "execution.unowned_order",
  )
  assert.equal(
    projection.data.pausedMarkets.some((item) => item.symbol === "BTCUSDT" && item.reason === "UNOWNED_ORDER"),
    true,
  )

  assert.deepEqual(state, {
    orders: [
      {
        clientOrderId: "harvester-BTCUSDT-buy-001",
        brokerOrderId: "9001",
        side: "BUY",
        status: "UNKNOWN",
        originalQuantity: "1",
        executedQuantity: "1",
      },
      {
        clientOrderId: "harvester-BTCUSDT-sell-001",
        brokerOrderId: "9002",
        side: "SELL",
        status: "UNKNOWN",
        originalQuantity: "0.9892",
        executedQuantity: "0.9892",
      },
    ],
    positions: [{
      symbol: "BTCUSDT",
      activeQuantity: "0",
      freeQuantity: "0.01",
      totalQuantity: "0.01",
      spent: "0",
      quoteNetCashFlow: "2",
    }],
    ledgers: [{
      marketId: fixture.market.id,
      buyCost: "0",
      netSellProceeds: "0",
      outstandingRecoveryAmount: "0",
      appliedFillIds: [
        "binance:BTCUSDT:buy-trade-001",
        "binance:BTCUSDT:buy-trade-002",
        "binance:BTCUSDT:sell-trade-001",
      ],
    }],
    appliedFillIds: [
      "binance:BTCUSDT:buy-trade-001",
      "binance:BTCUSDT:buy-trade-002",
      "binance:BTCUSDT:sell-trade-001",
    ],
    journalFills: [
      {
        fillId: "binance:BTCUSDT:buy-trade-001",
        side: "BUY",
        quantity: "0.4",
        quoteQuantity: "40",
      },
      {
        fillId: "binance:BTCUSDT:buy-trade-002",
        side: "BUY",
        quantity: "0.6",
        quoteQuantity: "60",
      },
      {
        fillId: "binance:BTCUSDT:sell-trade-001",
        side: "SELL",
        quantity: "0.9892",
        quoteQuantity: "102",
      },
    ],
    pausedMarkets: ["BTCUSDT"],
    durablePausedMarkets: ["BTCUSDT"],
    recoveryManagedPausedMarkets: [],
    completedOrderClientIds: ["harvester-BTCUSDT-sell-001"],
    requiresExchangeReconciliation: true,
    sessions: [
      {
        fileName: "process-001.jsonl",
        tradingEnabled: true,
        hasTradingActivity: true,
        uncleanTradingShutdown: true,
      },
      {
        fileName: "process-002.jsonl",
        tradingEnabled: true,
        hasTradingActivity: true,
        uncleanTradingShutdown: true,
      },
    ],
  })
})
