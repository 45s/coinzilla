import nodeTest from "node:test"
import assert from "node:assert/strict"
import { Asset, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { createPortfolioWorkflow } from "./create-portfolio-workflow.js"

const createMarket = () => {
  const baseAsset = new Asset({ id: "asset:BTC", code: "BTC" })
  const quoteAsset = new Asset({ id: "asset:USDT", code: "USDT" })
  return new Market({
    venue: "binance",
    symbol: "BTCUSDT",
    baseAsset,
    quoteAsset,
  })
}

const market = createMarket()

const createFill = ({ tradeId, quantity, quoteQuantity }) => new Fill({
  tradeId,
  brokerOrderId: "broker-order-" + tradeId,
  market,
  side: "BUY",
  price: new Money({ amount: "65000", asset: market.quoteAsset }),
  quantity: new Quantity({ amount: quantity, asset: market.baseAsset }),
  quoteQuantity: new Money({ amount: quoteQuantity, asset: market.quoteAsset }),
  commissions: [],
  commissionStatus: "COMPLETE",
})

const createWorkflow = () => createPortfolioWorkflow({
  evaluateStrategy: () => ({ action: "NO_ACTION" }),
  logger: {},
})

const test = (name, ...args) => nodeTest("[create-portfolio-workflow.test.js] " + name, ...args)

test("serializes concurrent canonical fills and commits both accounting projections", async () => {
  const workflow = createWorkflow()
  const firstFill = createFill({ tradeId: "trade-1", quantity: "0.01", quoteQuantity: "650" })
  const secondFill = createFill({ tradeId: "trade-2", quantity: "0.02", quoteQuantity: "1300" })

  const [firstResult, secondResult] = await Promise.all([
    workflow.updateTradingAccounting({ fill: firstFill }),
    workflow.updateTradingAccounting({ fill: secondFill }),
  ])

  assert.equal(firstResult.ok, true, "The first canonical fill must commit successfully.")
  assert.equal(secondResult.ok, true, "The concurrent second canonical fill must commit after the first.")
  assert.equal(
    workflow.getPortfolio().getPosition({ marketId: market.id }).baseQuantity.amount,
    "0.03",
    "Both serialized BUY fills must be reflected in the active BTC position.",
  )
  assert.equal(
    workflow.getPortfolio().getPosition({ marketId: market.id }).spent.amount,
    "1950",
    "Portfolio cost basis must include the exact quote value of both canonical fills.",
  )
})

test("does not account the same canonical fill twice when deliveries overlap", async () => {
  const workflow = createWorkflow()
  const canonicalFill = createFill({ tradeId: "duplicate-trade", quantity: "0.01", quoteQuantity: "650" })

  const [firstResult, duplicateResult] = await Promise.all([
    workflow.updateTradingAccounting({ fill: canonicalFill }),
    workflow.updateTradingAccounting({ fill: canonicalFill }),
  ])

  assert.equal(firstResult.ok, true, "The first delivery of a canonical fill must be accepted.")
  assert.equal(duplicateResult.ok, true, "An identical replay must be reported as a successful idempotent result.")
  assert.equal(duplicateResult.data.duplicate, true, "The replay result must explicitly identify duplicate delivery.")
  assert.equal(
    workflow.getPortfolio().getPosition({ marketId: market.id }).baseQuantity.amount,
    "0.01",
    "An identical duplicate delivery must not increase the active BTC quantity a second time.",
  )
})

test("rejects non-canonical fill input without mutating Portfolio state", async () => {
  const workflow = createWorkflow()

  const result = await workflow.updateTradingAccounting({ fill: { tradeId: "untrusted-event" } })

  assert.equal(result.ok, false, "Accounting must reject a plain event object instead of treating it as a canonical Fill.")
  assert.ok(result.errors?.[0] instanceof TypeError, "The rejected input must expose the canonical-Fill contract violation in the normalized errors array.")
  assert.equal(
    workflow.getPortfolio().positions.length,
    0,
    "Rejecting a non-canonical event must leave the Portfolio unchanged.",
  )
})
