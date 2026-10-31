import assert from "node:assert/strict"
import test from "node:test"
import { Asset, CanonicalOrder, Market } from "@coinzilla/entities"
import { adaptCanonicalOrder, createCanonicalMarket } from "./adapt-canonical-order.js"

const market = new Market({
  venue: "binance",
  symbol: "DOGEFDUSD",
  baseAsset: new Asset({ id: "doge", code: "DOGE" }),
  quoteAsset: new Asset({ id: "fdusd", code: "FDUSD" }),
})

const order = {
  symbol: "DOGEFDUSD",
  orderId: 123,
  clientOrderId: "client-123",
  side: "BUY",
  type: "LIMIT",
  status: "PARTIALLY_FILLED",
  price: "0.05000000",
  origQty: "100.00000000",
  executedQty: "25.50000000",
  time: 1_700_000_000_000,
  updateTime: 1_700_000_000_100,
}

test("adapts a Binance order to an immutable canonical order with exact values", () => {
  const result = adaptCanonicalOrder({ order, market })

  assert.ok(result instanceof CanonicalOrder)
  assert.equal(result.brokerOrderId, "123")
  assert.equal(result.clientOrderId, "client-123")
  assert.equal(result.status, "PARTIALLY_FILLED")
  assert.equal(result.limitPrice.amount, "0.05")
  assert.equal(result.originalQuantity.amount, "100")
  assert.equal(result.executedQuantity.amount, "25.5")
  assert.equal(result.remainingQuantity.amount, "74.5")
  assert.equal(result.createdAt, order.time)
  assert.equal(result.updatedAt, order.updateTime)
  assert.equal(result.value.market.id, "binance:DOGEFDUSD")
  assert.ok(Object.isFrozen(result))
})

test("maps terminal and unknown Binance lifecycle states safely", () => {
  for (const [rawStatus, expected] of [
    ["FILLED", "FILLED"],
    ["CANCELED", "CANCELED"],
    ["REJECTED", "REJECTED"],
    ["EXPIRED_IN_MATCH", "EXPIRED"],
    ["PENDING_CANCEL", "UNKNOWN"],
  ]) {
    const result = adaptCanonicalOrder({
      order: {
        ...order,
        status: rawStatus,
        executedQty: rawStatus === "FILLED" ? "100" : "0",
      },
      market,
    })
    assert.equal(result.status, expected)
  }
})

test("adapts market orders without inventing a limit price", () => {
  const result = adaptCanonicalOrder({
    order: { ...order, type: "MARKET", status: "FILLED", executedQty: "100" },
    market,
  })

  assert.equal(result.type, "MARKET")
  assert.equal(result.limitPrice, undefined)
  assert.equal(result.status, "FILLED")
})

test("rejects missing IDs, unsupported types, malformed values, and unsafe IDs", () => {
  for (const invalid of [
    { ...order, clientOrderId: "" },
    { ...order, orderId: Number.MAX_SAFE_INTEGER + 1 },
    { ...order, type: "STOP_LOSS_LIMIT" },
    { ...order, origQty: 100 },
    { ...order, updateTime: -1 },
  ]) {
    assert.throws(() => adaptCanonicalOrder({ order: invalid, market }))
  }
})

test("creates market identity only from explicit exchange metadata", () => {
  const result = createCanonicalMarket({
    symbolInfo: { symbol: "DOGEFDUSD", baseAsset: "DOGE", quoteAsset: "FDUSD" },
  })

  assert.equal(result.id, "binance:DOGEFDUSD")
  assert.equal(result.baseAsset.code, "DOGE")
  assert.equal(result.quoteAsset.code, "FDUSD")
  assert.throws(() => createCanonicalMarket({ symbolInfo: { symbol: "DOGEFDUSD" } }))
})
