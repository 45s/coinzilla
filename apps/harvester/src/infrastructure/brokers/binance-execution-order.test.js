import test from "node:test"
import assert from "node:assert/strict"
import { Asset, CanonicalOrder, Market } from "@coinzilla/entities"
import { createCanonicalOrderFromBinanceEvent } from "./binance-execution-order.js"

const baseAsset = new Asset({ id: "btc", code: "BTC" })
const quoteAsset = new Asset({ id: "usdt", code: "USDT" })
const market = new Market({
  venue: "binance",
  symbol: "BTCUSDT",
  baseAsset,
  quoteAsset,
})

const createEvent = ({
  status = "NEW",
  type = "LIMIT",
  quantity = "1",
  executedQuantity = "0",
  price = "100",
  ...overrides
} = {}) => ({
  eventType: "executionReport",
  executedOrder: {
    id: "1001",
    clientOrderId: "harvester-order-1",
    symbol: "BTCUSDT",
    side: "BUY",
    type,
    quantity,
    executedQuantity,
    price,
    status,
    createdAt: 100,
    updatedAt: 200,
    ...overrides,
  },
})

test("normalizes a NEW Binance limit order into canonical OPEN state", () => {
  const order = createCanonicalOrderFromBinanceEvent({
    event: createEvent(),
    market,
  })

  assert.ok(order instanceof CanonicalOrder)
  assert.equal(order.clientOrderId, "harvester-order-1")
  assert.equal(order.brokerOrderId, "1001")
  assert.equal(order.status, "OPEN")
  assert.equal(order.type, "LIMIT")
  assert.equal(order.limitPrice.amount, "100")
  assert.equal(order.originalQuantity.amount, "1")
  assert.equal(order.executedQuantity.amount, "0")
  assert.equal(order.remainingQuantity.amount, "1")
  assert.equal(order.createdAt, 100)
  assert.equal(order.acknowledgedAt, 200)
})

test("normalizes partial and terminal execution statuses", () => {
  const partial = createCanonicalOrderFromBinanceEvent({
    event: createEvent({ status: "PARTIALLY_FILLED", executedQuantity: "0.4" }),
    market,
  })
  const filled = createCanonicalOrderFromBinanceEvent({
    event: createEvent({ status: "FILLED", executedQuantity: "1" }),
    market,
  })
  const canceled = createCanonicalOrderFromBinanceEvent({
    event: createEvent({ status: "CANCELED", executedQuantity: "0.4" }),
    market,
  })

  assert.equal(partial.status, "PARTIALLY_FILLED")
  assert.equal(partial.remainingQuantity.amount, "0.6")
  assert.equal(filled.status, "FILLED")
  assert.equal(filled.remainingQuantity.amount, "0")
  assert.equal(filled.completedAt, 200)
  assert.equal(canceled.status, "CANCELED")
  assert.equal(canceled.executedQuantity.amount, "0.4")
})

test("normalizes market orders without inventing a limit price", () => {
  const order = createCanonicalOrderFromBinanceEvent({
    event: createEvent({
      type: "MARKET",
      status: "FILLED",
      quantity: "1",
      executedQuantity: "1",
      price: "0",
    }),
    market,
  })

  assert.equal(order.type, "MARKET")
  assert.equal(order.limitPrice, undefined)
})

test("maps unknown Binance statuses to canonical UNKNOWN", () => {
  const order = createCanonicalOrderFromBinanceEvent({
    event: createEvent({ status: "PENDING_CANCEL" }),
    market,
  })
  assert.equal(order.status, "UNKNOWN")
})

test("rejects invalid order identity, market, quantities and status facts", () => {
  const missingClientId = createEvent()
  missingClientId.executedOrder.clientOrderId = ""
  assert.throws(
    () => createCanonicalOrderFromBinanceEvent({ event: missingClientId, market }),
    /clientOrderId must be a non-empty string/,
  )

  const wrongSymbol = createEvent()
  wrongSymbol.executedOrder.symbol = "ETHUSDT"
  assert.throws(
    () => createCanonicalOrderFromBinanceEvent({ event: wrongSymbol, market }),
    /symbol does not match/,
  )

  assert.throws(
    () => createCanonicalOrderFromBinanceEvent({
      event: createEvent({ status: "PARTIALLY_FILLED", executedQuantity: "0" }),
      market,
    }),
    /requires executed and remaining quantity/,
  )
  assert.throws(
    () => createCanonicalOrderFromBinanceEvent({
      event: createEvent({ status: "FILLED", executedQuantity: "0.9" }),
      market,
    }),
    /must have zero remaining quantity/,
  )
  assert.throws(
    () => createCanonicalOrderFromBinanceEvent({
      event: createEvent({ executedQuantity: "2" }),
      market,
    }),
    /cannot exceed originalQuantity/,
  )
})
