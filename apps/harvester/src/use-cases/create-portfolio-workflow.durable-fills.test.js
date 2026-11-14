import assert from "node:assert/strict"
import test from "node:test"
import { Asset, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"
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
  const workflow = createPortfolioWorkflow({
    evaluateStrategy: () => ({ actions: [] }),
    logger: {},
    onOperationalStateExecutionFill: async ({ fill: received }) => {
      order.push("durable")
      assert.equal(received, fill)
      assert.equal(workflow.getPortfolio().positions.length, 0, "In-memory accounting must remain unchanged during the durability barrier.")
      return { ok: true, data: { durable: true } }
    },
  })

  const result = await workflow.updateTradingAccounting({ fill })

  assert.equal(result.ok, true, "The durable third-asset baseline and execution fact must allow the canonical fill to commit.")
  assert.deepEqual(order, ["durable"])
  assert.equal(workflow.getPortfolio().getPosition({ marketId: market.id }).baseQuantity.amount, "100", "The committed fill must update Portfolio quantity only after both durable facts succeed.")
})

test("does not mutate Portfolio or RecoveryLedger when the durable fill append fails", async () => {
  const workflow = createPortfolioWorkflow({
    evaluateStrategy: () => ({ actions: [] }),
    logger: {},
    onOperationalStateExecutionFill: async () => ({
      ok: false,
      errors: [new Error("execution fact fsync failed")],
    }),
  })

  const result = await workflow.updateTradingAccounting({ fill })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /execution fact fsync failed/)
  assert.equal(workflow.getPortfolio().positions.length, 0)
  assert.equal(workflow.getRecoveryLedger({ marketId: market.id }), undefined, "No empty recovery ledger should be published when the durable fill barrier fails.")
})


test("persists a third-asset commission baseline before its durable execution fill", async () => {
  const feeAsset = new Asset({ id: "bnb", code: "BNB" })
  const feeFill = new Fill({
    tradeId: "durable-third-asset-order",
    brokerOrderId: "broker-order-third-asset",
    clientOrderId: "client-order-third-asset",
    market,
    side: "BUY",
    price: new Money({ amount: "0.1", asset: quoteAsset }),
    quantity: new Quantity({ amount: "100", asset: baseAsset }),
    quoteQuantity: new Money({ amount: "10", asset: quoteAsset }),
    commissions: [new Commission({
      amount: new Money({ amount: "0.001", asset: feeAsset }),
      quoteValue: new Money({ amount: "0.1", asset: quoteAsset }),
    })],
    commissionStatus: "COMPLETE",
  })
  const order = []
  const workflow = createPortfolioWorkflow({
    evaluateStrategy: () => ({ actions: [] }),
    logger: {},
    onCommissionAsset: async ({ assetId, assetCode }) => {
      order.push("baseline")
      assert.deepEqual({ assetId, assetCode }, { assetId: feeAsset.id, assetCode: feeAsset.code }, "The targeted baseline must identify the exact third-asset commission charged by the fill.")
      assert.equal(
        workflow.getPortfolio().positions.length,
        0,
        "The fee-asset baseline must be durable before the fill changes in-memory accounting.",
      )
      return { ok: true, data: { sourceTime: 100, durable: true } }
    },
    onOperationalStateExecutionFill: async ({ fill: received }) => {
      order.push("fill")
      assert.equal(received, feeFill, "The durable execution fact must receive the exact canonical Fill whose fee baseline was persisted.")
      assert.equal(
        workflow.getPortfolio().positions.length,
        0,
        "The durable fill must still precede the in-memory accounting commit.",
      )
      return { ok: true, data: { durable: true } }
    },
  })

  const result = await workflow.updateTradingAccounting({ fill: feeFill })

  assert.equal(result.ok, true, result.errors?.[0]?.message)
  assert.deepEqual(
    order,
    ["baseline", "fill"],
    "The durable COMMISSION_BASELINE fact must precede EXECUTION_FILL_APPLIED for the same third-asset fee.",
  )
  assert.equal(workflow.getPortfolio().getPosition({ marketId: market.id }).baseQuantity.amount, "100")
})
