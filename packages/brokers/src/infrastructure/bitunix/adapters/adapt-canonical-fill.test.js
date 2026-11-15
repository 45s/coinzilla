import assert from "node:assert/strict"
import test from "node:test"
import { Fill } from "@coinzilla/entities"
import { createCanonicalMarket } from "./create-canonical-market.js"
import { adaptCanonicalFill } from "./adapt-canonical-fill.js"

const market = createCanonicalMarket({
  symbolInfo: { symbol: "BTCUSDT", base: "BTC", quote: "USDT", isOpen: "1" },
})

test("adapts Bitunix Spot matching-order facts into an exact canonical fill", () => {
  const fill = adaptCanonicalFill({
    trade: {
      id: "trade-123",
      orderId: "order-456",
      volume: "0.00250000",
      price: "60000.10",
      fee: "0.0000025",
      feeCoin: "BTC",
      role: "1",
      ctime: "2026-11-15T10:00:00.000Z",
    },
    side: "BUY",
    market,
  })

  assert.ok(fill instanceof Fill)
  assert.equal(fill.tradeId, "trade-123")
  assert.equal(fill.brokerOrderId, "order-456")
  assert.equal(fill.side, "BUY")
  assert.equal(fill.price.amount, "60000.1")
  assert.equal(fill.quantity.amount, "0.0025")
  assert.equal(fill.quoteQuantity.amount, "150.00025")
  assert.equal(fill.liquidityRole, "MAKER")
  assert.equal(fill.commissions[0].amount.amount, "0.0000025")
  assert.equal(fill.commissionStatus, "COMPLETE")
})

test("rejects missing execution identity, invalid liquidity role, and invalid time", () => {
  const trade = {
    id: "trade-123",
    orderId: "order-456",
    volume: "0.0025",
    price: "60000",
    fee: "0",
    feeCoin: "BTC",
    role: "2",
    ctime: "2026-11-15T10:00:00.000Z",
  }

  assert.throws(() => adaptCanonicalFill({ trade: { ...trade, id: "" }, side: "BUY", market }))
  assert.throws(() => adaptCanonicalFill({ trade: { ...trade, role: "9" }, side: "BUY", market }))
  assert.throws(() => adaptCanonicalFill({ trade: { ...trade, ctime: "invalid" }, side: "BUY", market }))
})
