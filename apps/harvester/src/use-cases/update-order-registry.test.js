import test from "node:test"
import assert from "node:assert/strict"
import { Asset, CanonicalOrder, Market, Money, Quantity } from "@coinzilla/entities"
import { OrderRegistry } from "../domain/orders/order-registry.js"
import { updateOrderRegistry } from "./update-order-registry.js"

const baseAsset = new Asset({ id: "doge", code: "DOGE" })
const quoteAsset = new Asset({ id: "usdt", code: "USDT" })
const market = new Market({ venue: "binance", symbol: "DOGEUSDT", baseAsset, quoteAsset })

const makeOrder = ({ status = "OPEN", executedQuantity = "0" } = {}) => new CanonicalOrder({
  clientOrderId: "harvester-1",
  brokerOrderId: "100",
  market,
  side: "BUY",
  type: "LIMIT_MAKER",
  limitPrice: new Money({ amount: "0.1", asset: quoteAsset }),
  originalQuantity: new Quantity({ amount: "100", asset: baseAsset }),
  executedQuantity: new Quantity({ amount: executedQuantity, asset: baseAsset }),
  status,
  createdAt: 1,
  acknowledgedAt: 2,
  updatedAt: 2,
})

test("returns an updated immutable registry through the shared result shape", () => {
  const pending = new CanonicalOrder({
    clientOrderId: "harvester-1",
    market,
    side: "BUY",
    type: "LIMIT_MAKER",
    limitPrice: new Money({ amount: "0.1", asset: quoteAsset }),
    originalQuantity: new Quantity({ amount: "100", asset: baseAsset }),
    executedQuantity: new Quantity({ amount: "0", asset: baseAsset }),
    status: "PENDING",
  })
  const registry = OrderRegistry.empty().registerPending({ order: pending }).registry
  const result = updateOrderRegistry({ registry, order: makeOrder() })

  assert.equal(result.ok, true)
  assert.equal(result.data.applied, true)
  assert.equal(result.data.registry.getOrder({ clientOrderId: "harvester-1" }).status, "OPEN")
  assert.equal(registry.getOrder({ clientOrderId: "harvester-1" }).status, "PENDING")
})

test("returns unknown exchange order updates without adopting them", () => {
  const result = updateOrderRegistry({
    registry: OrderRegistry.empty(),
    order: makeOrder(),
  })
  assert.equal(result.ok, true)
  assert.equal(result.data.unknown, true)
  assert.equal(result.data.registry.orders.length, 0)
})

test("returns validation errors through toResult", () => {
  assert.equal(updateOrderRegistry({ registry: {}, order: makeOrder() }).ok, false)
  assert.equal(updateOrderRegistry({
    registry: OrderRegistry.empty(),
    order: {},
  }).ok, false)
})
