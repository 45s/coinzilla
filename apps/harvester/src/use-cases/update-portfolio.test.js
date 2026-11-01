import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { makeUpdatePortfolio } from "./update-portfolio.js"

const baseAsset = new Asset({ id: "asset:X", code: "X" })
const quoteAsset = new Asset({ id: "asset:USD", code: "USD" })
const market = new Market({ venue: "test", symbol: "XUSD", baseAsset, quoteAsset })
const fill = new Fill({
  tradeId: "trade-1",
  brokerOrderId: "order-1",
  market,
  side: "BUY",
  price: new Money({ amount: "10", asset: quoteAsset }),
  quantity: new Quantity({ amount: "2", asset: baseAsset }),
  quoteQuantity: new Money({ amount: "20", asset: quoteAsset }),
  commissions: [],
  commissionStatus: "COMPLETE",
})

test("returns an updated Portfolio after applying a normalized Fill", async () => {
  const updatePortfolio = makeUpdatePortfolio()
  const result = await updatePortfolio({ portfolio: new Portfolio(), fill })
  assert.equal(result.ok, true)
  assert.equal(result.data.applied, true)
  assert.equal(result.data.portfolio.getPosition({ symbol: "XUSD" }).baseQuantity.amount, "2")
})

test("returns duplicate status without applying the same Fill twice", async () => {
  const updatePortfolio = makeUpdatePortfolio()
  const first = await updatePortfolio({ portfolio: new Portfolio(), fill })
  const second = await updatePortfolio({ portfolio: first.data.portfolio, fill })
  assert.equal(second.ok, true)
  assert.equal(second.data.duplicate, true)
  assert.equal(second.data.portfolio.getPosition({ symbol: "XUSD" }).baseQuantity.amount, "2")
})

test("returns explicit failures for invalid portfolio or fill inputs", async () => {
  const updatePortfolio = makeUpdatePortfolio()
  assert.equal((await updatePortfolio({ portfolio: {}, fill })).ok, false)
  assert.equal((await updatePortfolio({ portfolio: new Portfolio(), fill: {} })).ok, false)
})
