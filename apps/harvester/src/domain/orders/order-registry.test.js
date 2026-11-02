import test from "node:test"
import assert from "node:assert/strict"
import { Asset, CanonicalOrder, Market, Money, Quantity } from "@coinzilla/entities"
import { OrderRegistry } from "./order-registry.js"

const baseAsset = new Asset({ id: "doge", code: "DOGE" })
const quoteAsset = new Asset({ id: "usdt", code: "USDT" })
const market = new Market({
  venue: "binance",
  symbol: "DOGEUSDT",
  baseAsset,
  quoteAsset,
})

function makeOrder({
  clientOrderId = "harvester-1",
  brokerOrderId,
  side = "BUY",
  type = "LIMIT_MAKER",
  quantity = "100",
  executedQuantity = "0",
  price = "0.1",
  status = "PENDING",
  createdAt,
  acknowledgedAt,
  updatedAt,
  completedAt,
} = {}) {
  return new CanonicalOrder({
    clientOrderId,
    ...(brokerOrderId === undefined ? {} : { brokerOrderId }),
    market,
    side,
    type,
    limitPrice: type === "MARKET"
      ? undefined
      : new Money({ amount: price, asset: quoteAsset }),
    originalQuantity: new Quantity({ amount: quantity, asset: baseAsset }),
    executedQuantity: new Quantity({ amount: executedQuantity, asset: baseAsset }),
    status,
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(acknowledgedAt === undefined ? {} : { acknowledgedAt }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    ...(completedAt === undefined ? {} : { completedAt }),
  })
}

test("registers multiple pending orders and treats an identical registration as a duplicate", () => {
  const first = makeOrder()
  const second = makeOrder({ clientOrderId: "harvester-2", side: "SELL" })
  const registry = OrderRegistry.empty()
    .registerPending({ order: first }).registry
    .registerPending({ order: second }).registry

  const duplicate = registry.registerPending({ order: first })
  assert.equal(registry.orders.length, 2)
  assert.equal(duplicate.registry, registry)
  assert.equal(duplicate.applied, false)
  assert.equal(duplicate.duplicate, true)
  assert.equal(registry.getActiveOrders().length, 2)
})

test("rejects conflicting reuse of a client order ID", () => {
  const registry = OrderRegistry.empty().registerPending({
    order: makeOrder(),
  }).registry

  assert.throws(
    () => registry.registerPending({
      order: makeOrder({ quantity: "101" }),
    }),
    /Conflicting pending order reused clientOrderId/,
  )
})

test("applies broker acknowledgement and partial-fill updates immutably", () => {
  const pending = makeOrder()
  const registry = OrderRegistry.empty().registerPending({ order: pending }).registry
  const open = makeOrder({
    brokerOrderId: "9001",
    status: "OPEN",
    createdAt: 100,
    acknowledgedAt: 101,
    updatedAt: 101,
  })
  const opened = registry.applyUpdate({ order: open })
  const partial = makeOrder({
    brokerOrderId: "9001",
    status: "PARTIALLY_FILLED",
    executedQuantity: "40",
    createdAt: 100,
    acknowledgedAt: 101,
    updatedAt: 102,
  })
  const partiallyFilled = opened.registry.applyUpdate({ order: partial })

  assert.equal(registry.getOrder({ clientOrderId: pending.clientOrderId }).status, "PENDING")
  assert.equal(opened.registry.getOrder({ clientOrderId: pending.clientOrderId }).status, "OPEN")
  assert.equal(partiallyFilled.registry.getOrder({
    clientOrderId: pending.clientOrderId,
  }).remainingQuantity.amount, "60")
  assert.equal(partiallyFilled.registry.getActiveOrders().length, 1)
})

test("does not adopt exchange orders not registered by Harvester", () => {
  const registry = OrderRegistry.empty()
  const result = registry.applyUpdate({
    order: makeOrder({
      clientOrderId: "manual-order",
      brokerOrderId: "999",
      status: "OPEN",
      createdAt: 1,
      acknowledgedAt: 2,
      updatedAt: 2,
    }),
  })

  assert.equal(result.unknown, true)
  assert.equal(result.applied, false)
  assert.equal(result.registry, registry)
  assert.equal(registry.orders.length, 0)
})

test("treats identical order updates as idempotent", () => {
  const registry = OrderRegistry.empty().registerPending({
    order: makeOrder(),
  }).registry
  const update = makeOrder({
    brokerOrderId: "9001",
    status: "OPEN",
    createdAt: 100,
    acknowledgedAt: 101,
    updatedAt: 101,
  })
  const first = registry.applyUpdate({ order: update })
  const duplicate = first.registry.applyUpdate({ order: update })

  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.registry, first.registry)
})

test("rejects decreasing executed quantity and stale update timestamps", () => {
  const registry = OrderRegistry.empty().registerPending({
    order: makeOrder(),
  }).registry
  const partial = makeOrder({
    brokerOrderId: "9001",
    status: "PARTIALLY_FILLED",
    executedQuantity: "40",
    createdAt: 100,
    acknowledgedAt: 101,
    updatedAt: 102,
  })
  const current = registry.applyUpdate({ order: partial }).registry

  assert.throws(() => current.applyUpdate({
    order: makeOrder({
      brokerOrderId: "9001",
      status: "PARTIALLY_FILLED",
      executedQuantity: "30",
      createdAt: 100,
      acknowledgedAt: 101,
      updatedAt: 103,
    }),
  }), /cannot move backwards/)
  assert.throws(() => current.applyUpdate({
    order: makeOrder({
      brokerOrderId: "9001",
      status: "PARTIALLY_FILLED",
      executedQuantity: "50",
      createdAt: 100,
      acknowledgedAt: 101,
      updatedAt: 101,
    }),
  }), /timestamp cannot move backwards/)
})

test("rejects immutable order intent changes and invalid status transitions", () => {
  const registry = OrderRegistry.empty().registerPending({
    order: makeOrder(),
  }).registry
  const open = registry.applyUpdate({
    order: makeOrder({
      brokerOrderId: "9001",
      status: "OPEN",
      createdAt: 100,
      acknowledgedAt: 101,
      updatedAt: 101,
    }),
  }).registry

  assert.throws(() => open.applyUpdate({
    order: makeOrder({
      brokerOrderId: "9001",
      quantity: "99",
      status: "OPEN",
      createdAt: 100,
      acknowledgedAt: 101,
      updatedAt: 102,
    }),
  }), /changed immutable order intent/)
  assert.throws(() => open.applyUpdate({
    order: makeOrder({
      brokerOrderId: "9001",
      status: "REJECTED",
      executedQuantity: "1",
      createdAt: 100,
      acknowledgedAt: 101,
      updatedAt: 102,
    }),
  }), /Rejected orders cannot have changing executed quantity/)
})

test("allows a late terminal FILLED update after a partial cancellation race", () => {
  const registry = OrderRegistry.empty().registerPending({
    order: makeOrder(),
  }).registry
  const canceled = registry.applyUpdate({
    order: makeOrder({
      brokerOrderId: "9001",
      status: "CANCELED",
      executedQuantity: "40",
      createdAt: 100,
      acknowledgedAt: 101,
      updatedAt: 102,
      completedAt: 102,
    }),
  }).registry
  const filled = canceled.applyUpdate({
    order: makeOrder({
      brokerOrderId: "9001",
      status: "FILLED",
      executedQuantity: "100",
      createdAt: 100,
      acknowledgedAt: 101,
      updatedAt: 103,
      completedAt: 103,
    }),
  })

  assert.equal(filled.registry.getTerminalOrders()[0].status, "FILLED")
  assert.equal(filled.registry.getActiveOrders().length, 0)
})

test("validates constructor and operation input types", () => {
  assert.throws(() => new OrderRegistry({ orders: [{}] }), /CanonicalOrder/)
  assert.throws(() => new OrderRegistry({ orders: [makeOrder(), makeOrder()] }), /duplicate clientOrderIds/)
  assert.throws(() => OrderRegistry.empty().registerPending({ order: {} }), /PENDING CanonicalOrder/)
  assert.throws(() => OrderRegistry.empty().applyUpdate({ order: makeOrder() }), /broker-acknowledged/)
  assert.throws(() => OrderRegistry.empty().getOrder({}), /clientOrderId/)
})

test("ignores a stale OPEN acknowledgement that arrives after a newer fill event", () => {
  const registry = OrderRegistry.empty().registerPending({
    order: makeOrder(),
  }).registry
  const partial = registry.applyUpdate({
    order: makeOrder({
      brokerOrderId: "9001",
      status: "PARTIALLY_FILLED",
      executedQuantity: "40",
      createdAt: 100,
      acknowledgedAt: 101,
      updatedAt: 102,
    }),
  }).registry
  const staleAcknowledgement = partial.applyUpdate({
    order: makeOrder({
      brokerOrderId: "9001",
      status: "OPEN",
      createdAt: 100,
    }),
  })

  assert.equal(staleAcknowledgement.stale, true)
  assert.equal(staleAcknowledgement.applied, false)
  assert.equal(staleAcknowledgement.registry, partial)
  assert.equal(partial.getOrder({ clientOrderId: "harvester-1" }).status, "PARTIALLY_FILLED")
})
