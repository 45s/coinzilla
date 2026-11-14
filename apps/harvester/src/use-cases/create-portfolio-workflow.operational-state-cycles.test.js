import { StrategyId } from "../domain/strategies/strategy-ids.js"
import assert from "node:assert/strict"
import test from "node:test"
import { Asset, CanonicalOrder, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { RecoveryLedger } from "../domain/strategies/conservative/recovery-ledger.js"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { createFileOperationalStateStore } from "../infrastructure/operational-state/create-file-operational-state-store.js"
import { createPortfolioWorkflow } from "./create-portfolio-workflow.js"
import { recordRecoveryCycleCompleted } from "./record-recovery-cycle-completed.js"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const baseAsset = new Asset({ id: "binance:DOGE", code: "DOGE" })
const quoteAsset = new Asset({ id: "binance:USDT", code: "USDT" })
const market = new Market({ venue: "binance", symbol: "DOGEUSDT", baseAsset, quoteAsset })
const makeFill = ({ tradeId, side, price, quantity, quoteQuantity }) => new Fill({
  tradeId,
  brokerOrderId: "broker-" + tradeId,
  clientOrderId: "client-" + tradeId,
  market,
  side,
  price: new Money({ amount: price, asset: quoteAsset }),
  quantity: new Quantity({ amount: quantity, asset: baseAsset }),
  quoteQuantity: new Money({ amount: quoteQuantity, asset: quoteAsset }),
  commissions: [],
  commissionStatus: "COMPLETE",
})
const buyFill = makeFill({ tradeId: "cycle-buy", side: "BUY", price: "100", quantity: "2", quoteQuantity: "200" })
const sellFill = makeFill({ tradeId: "cycle-sell", side: "SELL", price: "210", quantity: "1", quoteQuantity: "210" })
const initialPortfolio = new Portfolio().applyFill({ fill: buyFill, strategyId: StrategyId.COIN_GRABBER }).portfolio.applyFill({ fill: sellFill, strategyId: StrategyId.COIN_GRABBER }).portfolio
const initialLedger = RecoveryLedger.empty({ market }).applyFill({ fill: buyFill, strategyId: StrategyId.COIN_GRABBER }).ledger.applyFill({ fill: sellFill, strategyId: StrategyId.COIN_GRABBER }).ledger
const sellOrder = new CanonicalOrder({
  clientOrderId: "client-cycle-sell",
  brokerOrderId: "broker-cycle-sell",
  market,
  side: "SELL",
  type: "LIMIT",
  limitPrice: new Money({ amount: "210", asset: quoteAsset }),
  originalQuantity: new Quantity({ amount: "1", asset: baseAsset }),
  executedQuantity: new Quantity({ amount: "1", asset: baseAsset }),
  status: "FILLED",
  createdAt: 1,
  acknowledgedAt: 1,
  updatedAt: 2,
  completedAt: 2,
})

const createStore = async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-recovery-cycle-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createFileOperationalStateStore({
    directory,
    runtimeSessionId: "recovery-cycle-test",
    now: () => new Date("2026-11-12T00:00:00.000Z"),
  })
  await store.initialize()
  return store
}

test("records a deterministic completed-cycle fact with its fill boundary and exact accounting values", async (t) => {
  const operationalStateStore = await createStore(t)
  const position = initialPortfolio.getPosition({ marketId: market.id })
  const completion = {
    eligible: true,
    activeQuantity: position.baseQuantity.amount,
    keepQuantity: "1",
    minProfit: "5",
    freeQuantity: "1",
    realizedNetProfit: initialLedger.realizedNetProfit,
  }
  const result = await recordRecoveryCycleCompleted({
    operationalStateStore,
    recoveryLedger: initialLedger,
    position,
    sellOrder,
    completion,
    minProfit: "5",
    inventoryDisposition: null,
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.equal(result.data.durable, true)
  assert.match(result.data.record.data.cycleId, /^[0-9a-f]{64}$/)
  assert.equal(result.data.record.factId, "recovery-cycle-completed:" + market.id + ":" + result.data.record.data.cycleId)
  assert.equal(result.data.record.factType, "RECOVERY_CYCLE_COMPLETED")
  assert.deepEqual(result.data.record.data.appliedFillIds, [buyFill.id, sellFill.id])
  assert.equal(result.data.record.data.spent, "200")
  assert.equal(result.data.record.data.buyCost, "200")
  assert.equal(result.data.record.data.netSellProceeds, "210")
  assert.equal(result.data.record.data.realizedNetProfit, "10")
  assert.equal(result.data.record.data.minProfit, "5")
  assert.equal(result.data.record.data.freeQuantity, "1")
})

test("commits the cycle fact before publishing the reset Portfolio and RecoveryLedger", async () => {
  let observed = false
  const workflow = createPortfolioWorkflow({
    evaluateStrategy: () => ({ actions: [] }),
    logger: {},
    initialPortfolio,
    initialRecoveryLedgers: new Map([[market.id, initialLedger]]),
    onOperationalStateRecoveryCycleCompleted: async ({ recoveryLedger, position, completion }) => {
      observed = true
      assert.equal(recoveryLedger, initialLedger)
      assert.equal(position, initialPortfolio.getPosition({ marketId: market.id }))
      assert.equal(completion.eligible, true)
      assert.equal(workflow.getPortfolio(), initialPortfolio, "The Portfolio reset must not publish before the durable cycle fact.")
      assert.equal(workflow.getRecoveryLedger({ marketId: market.id }), initialLedger, "The RecoveryLedger reset must not publish before the durable cycle fact.")
      return { ok: true, data: { durable: true } }
    },
  })

  const result = await workflow.completeRecoveryCycle({
    marketId: market.id,
    keepQuantity: "1",
    minProfit: "5",
    sellOrder,
  })

  assert.equal(result.ok, true, result.errors?.[0]?.message)
  assert.equal(observed, true)
  assert.equal(workflow.getPortfolio().getPosition({ marketId: market.id }).spent.amount, "0")
  assert.equal(workflow.getRecoveryLedger({ marketId: market.id }).buyCost, "0")
})

test("does not reset Portfolio or RecoveryLedger when the completed-cycle fact is not durable", async () => {
  const workflow = createPortfolioWorkflow({
    evaluateStrategy: () => ({ actions: [] }),
    logger: {},
    initialPortfolio,
    initialRecoveryLedgers: new Map([[market.id, initialLedger]]),
    onOperationalStateRecoveryCycleCompleted: async () => ({
      ok: false,
      errors: [new Error("cycle fact fsync failed")],
    }),
  })

  const result = await workflow.completeRecoveryCycle({
    marketId: market.id,
    keepQuantity: "1",
    minProfit: "5",
    sellOrder,
  })

  assert.equal(result.ok, false, "A failed durable cycle fact must prevent recovery completion from being published.")
  assert.match(result.errors[0].message, /cycle fact fsync failed/, "The durable write failure must remain visible to the caller.")
  assert.equal(workflow.getPortfolio(), initialPortfolio, "The Portfolio must remain unchanged when the completed-cycle fact is not durable.")
  assert.equal(workflow.getRecoveryLedger({ marketId: market.id }), initialLedger, "The RecoveryLedger must remain unchanged when the completed-cycle fact is not durable.")
})
