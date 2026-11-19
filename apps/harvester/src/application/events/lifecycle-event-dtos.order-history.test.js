import assert from "node:assert/strict"
import test from "node:test"
import {
  Asset,
  CanonicalOrder,
  Market,
  Money,
  Quantity,
} from "@coinzilla/entities"
import {
  mapOrderCancelFailedData,
  mapOrderCancelledData,
  mapOrderSubmittedData,
  mapOrderUpdatedData,
} from "./lifecycle-event-dtos.js"

function createOrder({
  status = "PARTIALLY_FILLED",
  executedQuantity = "0.2500",
  updatedAt = 102,
  completedAt,
} = {}) {
  const baseAsset = new Asset({
    id: "asset:BTC",
    code: "BTC",
  })
  const quoteAsset = new Asset({
    id: "asset:USDT",
    code: "USDT",
  })
  const market = new Market({
    venue: "binance",
    symbol: "BTCUSDT",
    baseAsset,
    quoteAsset,
  })
  return new CanonicalOrder({
    clientOrderId: "harvester-BTCUSDT-001",
    brokerOrderId: "broker-order-001",
    providerInstanceId: "binanceTestnet",
    providerType: "binance",
    accountId: "binance-primary",
    market,
    side: "BUY",
    type: "LIMIT_MAKER",
    limitPrice: new Money({
      amount: "65000.0000",
      asset: quoteAsset,
    }),
    originalQuantity: new Quantity({
      amount: "1.0000",
      asset: baseAsset,
    }),
    executedQuantity: new Quantity({
      amount: executedQuantity,
      asset: baseAsset,
    }),
    status,
    createdAt: 100,
    acknowledgedAt: 101,
    updatedAt,
    completedAt,
  })
}

const ownership = {
  clientOrderId: "harvester-BTCUSDT-001",
  brokerOrderId: "broker-order-001",
  strategyId: "CG_coinGrabber",
  positionId: "position-001",
  purpose: "INITIAL_BUY",
  cycleId: "cycle-001",
}

test("publishes complete canonical facts for immediately filled acknowledgements", () => {
  const order = createOrder({
    status: "FILLED",
    executedQuantity: "1.0000",
    remainingQuantity: "0.0000",
    updatedAt: 103,
    completedAt: 103,
  })
  const result = mapOrderSubmittedData({
    order,
    ownership,
  })

  assert.equal(result.ok, true, "A canonical filled acknowledgement must map successfully.")
  assert.equal(result.data.executedQuantity, "1.0000", JSON.stringify(result))
  assert.equal(result.data.remainingQuantity, "0.0000", "The submitted event must include remaining quantity.")
  assert.deepEqual(result.data.market, order.market.value, "Order events must carry canonical market and asset identity.")
  assert.deepEqual(result.data.ownership, {
    strategyId: "CG_coinGrabber",
    positionId: "position-001",
    purpose: "INITIAL_BUY",
    cycleId: "cycle-001",
  }, "Available strategy/position ownership must be published without client or broker IDs being duplicated.")
  assert.equal(result.data.completedAt, 103, "Immediate fill completion time must be retained.")
})

test("publishes order type, market, ownership, and cumulative quantities for applied updates", () => {
  const order = createOrder()
  const result = mapOrderUpdatedData({
    order,
    ownership,
    executionType: "TRADE",
  })

  assert.equal(result.ok, true, "A canonical partial-fill update must map successfully.")
  assert.equal(result.data.type, "LIMIT_MAKER", "Order update evidence must include the canonical order type.")
  assert.deepEqual(result.data.market, order.market.value, "Order update evidence must include full market identity.")
  assert.equal(result.data.originalQuantity, "1.0000", JSON.stringify(result))
  assert.equal(result.data.executedQuantity, "0.2500", "Order update evidence must preserve cumulative execution.")
  assert.equal(result.data.remainingQuantity, "0.7500", "Order update evidence must preserve remaining quantity.")
  assert.deepEqual(result.data.ownership, {
    strategyId: "CG_coinGrabber",
    positionId: "position-001",
    purpose: "INITIAL_BUY",
    cycleId: "cycle-001",
  }, "Order update evidence must preserve available strategy ownership.")
})

test("publishes cumulative execution for partially filled cancellation outcomes", () => {
  const canceledOrder = createOrder({
    status: "CANCELED",
    executedQuantity: "0.2500",
    remainingQuantity: "0.7500",
    updatedAt: 104,
    completedAt: 104,
  })
  const unknownOrder = createOrder({
    status: "UNKNOWN",
    executedQuantity: "0.2500",
    remainingQuantity: "0.7500",
    updatedAt: 105,
  })
  const canceled = mapOrderCancelledData({
    order: canceledOrder,
    ownership,
  })
  const unknown = mapOrderCancelFailedData({
    order: unknownOrder,
    ownership,
    outcome: "UNCONFIRMED",
  })

  assert.equal(canceled.data.executedQuantity, "0.2500", JSON.stringify(canceled))
  assert.equal(canceled.data.remainingQuantity, "0.7500", "Confirmed cancellation must retain remaining quantity.")
  assert.equal(unknown.data.executedQuantity, "0.2500", "Unconfirmed cancellation must retain cumulative partial execution.")
  assert.equal(unknown.data.status, "UNKNOWN", "Unconfirmed cancellation must retain the canonical order status.")
  assert.deepEqual(unknown.data.market, unknownOrder.market.value, "Unconfirmed cancellation evidence must retain canonical market identity.")
})
