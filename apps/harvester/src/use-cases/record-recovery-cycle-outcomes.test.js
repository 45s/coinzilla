import { StrategyId } from "../domain/strategies/strategy-ids.js"
import assert from "node:assert/strict"
import test from "node:test"
import { Asset, CanonicalOrder, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { RecoveryLedger } from "../domain/strategies/conservative/recovery-ledger.js"
import { createFileOperationalStateStore } from "../infrastructure/operational-state/create-file-operational-state-store.js"
import { recordRecoveryCycleCompleted } from "./record-recovery-cycle-completed.js"
import { recordRecoveryCycleNotCompleted } from "./record-recovery-cycle-not-completed.js"

const baseAsset = new Asset({ id: "asset:BTC", code: "BTC" })
const quoteAsset = new Asset({ id: "asset:USDT", code: "USDT" })
const market = new Market({ venue: "binance", symbol: "BTCUSDT", baseAsset, quoteAsset })
const makeFill = ({ tradeId, side, quantity, quoteQuantity, price }) => new Fill({
  tradeId,
  brokerOrderId: "broker-" + tradeId,
  market,
  side,
  price: new Money({ amount: price, asset: quoteAsset }),
  quantity: new Quantity({ amount: quantity, asset: baseAsset }),
  quoteQuantity: new Money({ amount: quoteQuantity, asset: quoteAsset }),
  commissionStatus: "COMPLETE",
})
const makeSellOrder = ({ status = "FILLED", quantity = "1", executedQuantity = quantity, price = "130005" } = {}) => new CanonicalOrder({
  clientOrderId: "harvester-sell-cycle-1",
  brokerOrderId: "broker-sell-cycle-1",
  market,
  side: "SELL",
  type: "LIMIT",
  limitPrice: new Money({ amount: price, asset: quoteAsset }),
  originalQuantity: new Quantity({ amount: quantity, asset: baseAsset }),
  executedQuantity: new Quantity({ amount: executedQuantity, asset: baseAsset }),
  status,
  createdAt: 1,
  acknowledgedAt: 1,
  updatedAt: 2,
  ...(status === "FILLED" ? { completedAt: 2 } : {}),
})
const makeStore = async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-recovery-cycle-outcomes-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createFileOperationalStateStore({
    directory,
    runtimeSessionId: "recovery-cycle-outcomes-test",
    now: () => new Date("2026-11-12T00:00:00.000Z"),
  })
  await store.initialize()
  return store
}
const makeCycle = () => {
  const buyFill = makeFill({ tradeId: "cycle-buy", side: "BUY", quantity: "2", quoteQuantity: "130000", price: "65000" })
  const sellFill = makeFill({ tradeId: "cycle-sell", side: "SELL", quantity: "1", quoteQuantity: "130005", price: "130005" })
  const portfolio = new Portfolio()
    .applyFill({ fill: buyFill, strategyId: StrategyId.COIN_GRABBER }).portfolio
    .applyFill({ fill: sellFill, strategyId: StrategyId.COIN_GRABBER }).portfolio
  const recoveryLedger = RecoveryLedger.empty({ market })
    .applyFill({ fill: buyFill, strategyId: StrategyId.COIN_GRABBER }).ledger
    .applyFill({ fill: sellFill, strategyId: StrategyId.COIN_GRABBER }).ledger
  return {
    portfolio,
    recoveryLedger,
    position: portfolio.getPosition({ marketId: market.id }),
    completion: {
      eligible: true,
      realizedNetProfit: "5",
      activeQuantity: "1",
      keepQuantity: "1",
      minProfit: "5",
      freeQuantity: "1",
    },
  }
}

const makeNotCompletedCycle = () => {
  const buyFill = makeFill({ tradeId: "cycle-not-completed-buy", side: "BUY", quantity: "0.42", quoteQuantity: "39.75", price: "94.642857142857142857" })
  const sellFill = makeFill({ tradeId: "cycle-not-completed-sell", side: "SELL", quantity: "0.4", quoteQuantity: "40", price: "100" })
  const portfolio = new Portfolio()
    .applyFill({ fill: buyFill, strategyId: StrategyId.COIN_GRABBER }).portfolio
    .applyFill({ fill: sellFill, strategyId: StrategyId.COIN_GRABBER }).portfolio
  const recoveryLedger = RecoveryLedger.empty({ market })
    .applyFill({ fill: buyFill, strategyId: StrategyId.COIN_GRABBER }).ledger
    .applyFill({ fill: sellFill, strategyId: StrategyId.COIN_GRABBER }).ledger
  return {
    portfolio,
    recoveryLedger,
    position: portfolio.getPosition({ marketId: market.id }),
  }
}

test("persists a completed recovery cycle with its exact terminal SELL identity", async (t) => {
  const operationalStateStore = await makeStore(t)
  const cycle = makeCycle()
  const sellOrder = makeSellOrder()
  const result = await recordRecoveryCycleCompleted({
    operationalStateStore,
    ...cycle,
    sellOrder,
    minProfit: "5",
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.equal(result.data.durable, true)
  assert.equal(result.data.record.factType, "RECOVERY_CYCLE_COMPLETED")
  assert.equal(result.data.record.data.sellOrderClientId, sellOrder.clientOrderId)
  assert.equal(result.data.record.data.sellOrderBrokerOrderId, sellOrder.brokerOrderId)
  assert.deepEqual(result.data.record.data.appliedFillIds, cycle.recoveryLedger.appliedFillIds)
})

test("requires a canonical fully filled SELL before recording a completed cycle", async (t) => {
  const operationalStateStore = await makeStore(t)
  const cycle = makeCycle()
  const result = await recordRecoveryCycleCompleted({
    operationalStateStore,
    ...cycle,
    sellOrder: makeSellOrder({ status: "OPEN", executedQuantity: "0" }),
    minProfit: "5",
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /fully filled.*SELL|terminal SELL/i)
})

test("persists an explicit CONTINUE_SELL_THROUGH outcome tied to the full SELL and current cycle evidence", async (t) => {
  const operationalStateStore = await makeStore(t)
  const cycle = makeNotCompletedCycle()
  const sellOrder = makeSellOrder({ quantity: "0.4", price: "100" })
  const result = await recordRecoveryCycleNotCompleted({
    operationalStateStore,
    ...cycle,
    sellOrder,
    completion: {
      eligible: false,
      pause: false,
      reason: "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH",
      realizedNetProfit: "0.25",
      activeQuantity: "0.02",
      keepQuantity: "0.01",
      minProfit: "0.01",
    },
    minProfit: "0.01",
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.equal(result.data.record.factType, "RECOVERY_CYCLE_NOT_COMPLETED")
  assert.equal(result.data.record.data.outcome, "CONTINUE_SELL_THROUGH")
  assert.equal(result.data.record.data.sellOrderClientId, sellOrder.clientOrderId)
  assert.equal(result.data.record.data.sellOrderBrokerOrderId, sellOrder.brokerOrderId)
  assert.deepEqual(result.data.record.data.appliedFillIds, cycle.recoveryLedger.appliedFillIds)
})

test("does not persist a non-completion outcome for an unfilled or non-SELL order", async () => {
  let appendCalls = 0
  const operationalStateStore = { append: async () => { appendCalls += 1; return { ok: true, data: { durable: true } } } }
  const cycle = makeNotCompletedCycle()
  const result = await recordRecoveryCycleNotCompleted({
    operationalStateStore,
    ...cycle,
    sellOrder: makeSellOrder({ status: "OPEN", quantity: "0.4", executedQuantity: "0", price: "100" }),
    completion: {
      eligible: false,
      pause: false,
      reason: "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH",
      realizedNetProfit: "0.25",
      activeQuantity: "0.02",
      keepQuantity: "0.01",
      minProfit: "0.01",
    },
    minProfit: "0.01",
  })

  assert.equal(result.ok, false)
  assert.equal(appendCalls, 0)
})
