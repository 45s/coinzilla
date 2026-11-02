import test from "node:test"
import assert from "node:assert/strict"
import { Asset, CanonicalOrder, Market } from "@coinzilla/entities"
import { createPendingCanonicalOrder } from "./create-pending-canonical-order.js"

const baseAsset = new Asset({ id: "doge", code: "DOGE" })
const quoteAsset = new Asset({ id: "usdt", code: "USDT" })
const market = new Market({ venue: "binance", symbol: "DOGEUSDT", baseAsset, quoteAsset })
const order = {
  symbol: "DOGEUSDT",
  side: "BUY",
  type: "LIMIT_MAKER",
  quantity: "100",
  price: "0.1",
}

test("creates an immutable PENDING canonical order without broker identity", () => {
  const result = createPendingCanonicalOrder({
    order,
    market,
    clientOrderId: "h-12345678901234567890123456789012",
    supportedOrderTypes: ["LIMIT", "LIMIT_MAKER"],
  })

  assert.ok(result instanceof CanonicalOrder)
  assert.equal(result.status, "PENDING")
  assert.equal(result.brokerOrderId, undefined)
  assert.equal(result.executedQuantity.amount, "0")
  assert.equal(result.remainingQuantity.amount, "100")
  assert.equal(result.limitPrice.amount, "0.1")
})

test("defaults to the exchange-validated post-only type when type is omitted", () => {
  const result = createPendingCanonicalOrder({
    order: { ...order, type: undefined },
    market,
    clientOrderId: "h-12345678901234567890123456789012",
    supportedOrderTypes: ["LIMIT_MAKER"],
  })
  assert.equal(result.type, "LIMIT_MAKER")
})

test("rejects invalid order intent, exchange capability and decimal values", () => {
  const common = {
    market,
    clientOrderId: "h-12345678901234567890123456789012",
    supportedOrderTypes: ["LIMIT", "LIMIT_MAKER"],
  }
  assert.throws(() => createPendingCanonicalOrder({
    ...common,
    order: { ...order, side: "HOLD" },
  }), /side must be BUY or SELL/)
  assert.throws(() => createPendingCanonicalOrder({
    ...common,
    order: { ...order, type: "MARKET" },
  }), /only supports LIMIT/)
  assert.throws(() => createPendingCanonicalOrder({
    ...common,
    order: { ...order, type: "LIMIT" },
    supportedOrderTypes: ["LIMIT_MAKER"],
  }), /does not support order type LIMIT/)
  assert.throws(() => createPendingCanonicalOrder({
    ...common,
    order: { ...order, quantity: 100 },
  }))
  assert.throws(() => createPendingCanonicalOrder({
    ...common,
    order: { ...order, price: "0" },
  }), /limitPrice should be greater than zero/)
})
