import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Fill, Market } from "@coinzilla/entities"
import { createCanonicalFillFromBinanceEvent } from "./binance-execution-fill.js"

const baseAsset = new Asset({ id: "btc", code: "BTC" })
const quoteAsset = new Asset({ id: "usdt", code: "USDT" })
const market = new Market({
  venue: "binance",
  symbol: "BTCUSDT",
  baseAsset,
  quoteAsset,
})

const createEvent = (overrides = {}) => ({
  eventType: "executionReport",
  executionType: "TRADE",
  executedOrder: { clientOrderId: "client-1" },
  fill: {
    id: "123",
    orderId: "456",
    symbol: "BTCUSDT",
    side: "BUY",
    price: "65000.10",
    quantity: "0.01",
    quoteQuantity: "650.001",
    commissionAmount: "0.00001",
    commissionAsset: "BTC",
    isMaker: true,
    time: 1700000000000,
  },
  ...overrides,
})

test("normalizes a Binance trade execution into a canonical Fill", () => {
  const fill = createCanonicalFillFromBinanceEvent({ event: createEvent(), market })

  assert.ok(fill instanceof Fill)
  assert.equal(fill.id, "binance:BTCUSDT:123")
  assert.equal(fill.brokerOrderId, "456")
  assert.equal(fill.clientOrderId, "client-1")
  assert.equal(fill.side, "BUY")
  assert.equal(fill.price.amount, "65000.1")
  assert.equal(fill.quantity.amount, "0.01")
  assert.equal(fill.quoteQuantity.amount, "650.001")
  assert.equal(fill.liquidityRole, "MAKER")
  assert.equal(fill.executedAt, 1700000000000)
  assert.equal(fill.commissions.length, 1)
  assert.equal(fill.commissions[0].amount.amount, "0.00001")
  assert.equal(fill.commissions[0].amount.asset.id, baseAsset.id)
  assert.equal(fill.commissionStatus, "COMPLETE")
})

test("normalizes zero commission as complete without requiring a commission asset", () => {
  const event = createEvent()
  event.fill.commissionAmount = "0"
  event.fill.commissionAsset = null

  const fill = createCanonicalFillFromBinanceEvent({ event, market })

  assert.equal(fill.commissions.length, 0)
  assert.equal(fill.commissionStatus, "COMPLETE")
})

test("preserves a positive commission with an unsupported third asset for domain rejection", () => {
  const event = createEvent()
  event.fill.commissionAsset = "BNB"

  const fill = createCanonicalFillFromBinanceEvent({ event, market })

  assert.equal(fill.commissions[0].amount.asset.code, "BNB")
  assert.notEqual(fill.commissions[0].amount.asset.id, baseAsset.id)
  assert.notEqual(fill.commissions[0].amount.asset.id, quoteAsset.id)
})

test("marks positive commission with a missing asset as incomplete", () => {
  const event = createEvent()
  event.fill.commissionAsset = null

  const fill = createCanonicalFillFromBinanceEvent({ event, market })

  assert.equal(fill.commissionStatus, "UNKNOWN")
  assert.equal(fill.commissions.length, 0)
})

test("rejects non-trade reports and malformed execution facts", () => {
  assert.throws(
    () => createCanonicalFillFromBinanceEvent({
      event: { ...createEvent(), executionType: "NEW" },
      market,
    }),
    /not a trade execution/,
  )
  assert.throws(
    () => createCanonicalFillFromBinanceEvent({
      event: createEvent({ fill: null }),
      market,
    }),
    /missing fill facts/,
  )
  const wrongSymbol = createEvent()
  wrongSymbol.fill.symbol = "ETHUSDT"
  assert.throws(
    () => createCanonicalFillFromBinanceEvent({ event: wrongSymbol, market }),
    /symbol does not match/,
  )
  const missingTradeId = createEvent()
  missingTradeId.fill.id = "not-a-number"
  assert.throws(
    () => createCanonicalFillFromBinanceEvent({ event: missingTradeId, market }),
    /numeric identifier/,
  )
  const negativeFee = createEvent()
  negativeFee.fill.commissionAmount = "-0.01"
  assert.throws(
    () => createCanonicalFillFromBinanceEvent({ event: negativeFee, market }),
    /commission must be non-negative/,
  )
})
