import assert from "node:assert/strict"
import test from "node:test"
import { Asset, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { createPortfolioWorkflow } from "./create-portfolio-workflow.js"

const baseAsset = new Asset({ id: "doge", code: "DOGE" })
const quoteAsset = new Asset({ id: "usdt", code: "USDT" })
const market = new Market({ venue: "binance", symbol: "DOGEUSDT", baseAsset, quoteAsset })
const fill = new Fill({
  tradeId: "durable-before-accounting",
  brokerOrderId: "broker-order-1",
  clientOrderId: "client-order-1",
  market,
  side: "BUY",
  price: new Money({ amount: "0.1", asset: quoteAsset }),
  quantity: new Quantity({ amount: "100", asset: baseAsset }),
  quoteQuantity: new Money({ amount: "10", asset: quoteAsset }),
  commissions: [],
  commissionStatus: "COMPLETE",
})

test("commits the durable fill before publishing the new Portfolio and RecoveryLedger", async () => {
  const order = []
  let workflow
  workflow = createPortfolioWorkflow({
    evaluateStrategy: () => ({ actions: [] }),
    logger: {},
    onDurableExecutionFill: async ({ fill: received }) => {
      order.push("durable")
      assert.equal(received, fill)
      assert.equal(workflow.getPortfolio().positions.length, 0, "In-memory accounting must remain unchanged during the durability barrier.")
      return { ok: true, data: { durable: true } }
    },
  })

  const result = await workflow.updateTradingAccounting({ fill })

  assert.equal(result.ok, true, result.errors?.[0]?.message)
  assert.deepEqual(order, ["durable"])
  assert.equal(workflow.getPortfolio().getPosition({ marketId: market.id }).baseQuantity.amount, "100")
})

test("does not mutate Portfolio or RecoveryLedger when the durable fill append fails", async () => {
  const workflow = createPortfolioWorkflow({
    evaluateStrategy: () => ({ actions: [] }),
    logger: {},
    onDurableExecutionFill: async () => ({
      ok: false,
      errors: [new Error("execution fact fsync failed")],
    }),
  })

  const result = await workflow.updateTradingAccounting({ fill })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /execution fact fsync failed/)
  assert.equal(workflow.getPortfolio().positions.length, 0)
  assert.equal(workflow.getRecoveryLedger({ marketId: market.id }).appliedFillIds.length, 0)
})
