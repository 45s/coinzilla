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

test("matches an execution report by broker order ID when Binance client ID differs", () => {
  const pending = makeOrder({ clientOrderId: "h-ZROUSDT-1" })
  const acknowledged = makeOrder({
    clientOrderId: "h-ZROUSDT-1",
    brokerOrderId: "666845",
    status: "OPEN",
    createdAt: 100,
    acknowledgedAt: 101,
    updatedAt: 101,
  })
  const registry = OrderRegistry.empty()
    .registerPending({ order: pending }).registry
    .applyUpdate({ order: acknowledged }).registry

  const canceledReport = makeOrder({
    clientOrderId: "CU5G5c9IZgepakVzo3Z3kw",
    brokerOrderId: "666845",
    status: "CANCELED",
    createdAt: 100,
    acknowledgedAt: 101,
    updatedAt: 102,
    completedAt: 102,
  })
  const result = registry.applyUpdate({ order: canceledReport })

  assert.equal(registry.getOrderByBrokerOrderId({ brokerOrderId: "666845" }).clientOrderId, "h-ZROUSDT-1")
  assert.equal(result.unknown, false)
  assert.equal(result.applied, true)
  assert.equal(result.registry.getOrder({ clientOrderId: "h-ZROUSDT-1" }).status, "CANCELED")
  assert.equal(result.registry.getOrder({ clientOrderId: "CU5G5c9IZgepakVzo3Z3kw" }), undefined)
})

test("rejects an event whose broker and client IDs point to different registered orders", () => {
  const first = makeOrder({ clientOrderId: "harvester-1" })
  const second = makeOrder({ clientOrderId: "harvester-2", side: "SELL" })
  const registry = OrderRegistry.empty()
    .registerPending({ order: first }).registry
    .registerPending({ order: second }).registry
    .applyUpdate({ order: makeOrder({
      clientOrderId: "harvester-1",
      brokerOrderId: "9001",
      status: "OPEN",
      createdAt: 100,
      acknowledgedAt: 101,
      updatedAt: 101,
    }) }).registry
    .applyUpdate({ order: makeOrder({
      clientOrderId: "harvester-2",
      brokerOrderId: "9002",
      side: "SELL",
      status: "OPEN",
      createdAt: 100,
      acknowledgedAt: 101,
      updatedAt: 101,
    }) }).registry

  assert.throws(() => registry.applyUpdate({ order: makeOrder({
    clientOrderId: "harvester-2",
    brokerOrderId: "9001",
    status: "CANCELED",
    createdAt: 100,
    acknowledgedAt: 101,
    updatedAt: 102,
    completedAt: 102,
  }) }), /identify different registered orders/)
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

test("rejects decreasing executed quantity and stale update timestamps without changing registry state", () => {
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
  const before = current.value

  assert.throws(() => current.applyUpdate({
    order: makeOrder({
      brokerOrderId: "9001",
      status: "PARTIALLY_FILLED",
      executedQuantity: "30",
      createdAt: 100,
      acknowledgedAt: 101,
      updatedAt: 103,
    }),
  }), /cannot move backwards/, "A report with less executed quantity must be rejected instead of reducing the broker's cumulative execution.")
  assert.deepEqual(
    current.value,
    before,
    "Rejecting a decreasing execution report must leave every canonical order field and the current registry unchanged.",
  )
  assert.throws(() => current.applyUpdate({
    order: makeOrder({
      brokerOrderId: "9001",
      status: "PARTIALLY_FILLED",
      executedQuantity: "50",
      createdAt: 100,
      acknowledgedAt: 101,
      updatedAt: 101,
    }),
  }), /timestamp cannot move backwards/, "A report with a timestamp older than the current order state must be rejected even when its executed quantity is higher.")
  assert.deepEqual(
    current.value,
    before,
    "Rejecting a stale-timestamp report must preserve the accepted PARTIALLY_FILLED order and all of its identities, quantities and timestamps.",
  )
  assert.equal(
    current.getOrderByBrokerOrderId({ brokerOrderId: "9001" }).remainingQuantity.amount,
    "60",
    "The current order must retain 60 unfilled units after both rejected reports.",
  )
  assert.equal(
    current.getActiveOrders({ marketId: market.id }).length,
    1,
    "The rejected reports must not release the active order commitment.",
  )
  assert.equal(
    current.getTerminalOrders({ marketId: market.id }).length,
    0,
    "The rejected reports must not move the order into terminal state.",
  )
  assert.equal(
    registry.getOrder({ clientOrderId: "harvester-1" }).status,
    "PENDING",
    "Applying the accepted partial update must not mutate the original pre-update registry snapshot.",
  )
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

test("preserves the complete order state when a late FILLED update follows partial CANCELED or EXPIRED", () => {
  for (const terminalStatus of ["CANCELED", "EXPIRED"]) {
    const registry = OrderRegistry.empty().registerPending({
      order: makeOrder(),
    }).registry
    const terminalOrder = makeOrder({
      brokerOrderId: "9001",
      status: terminalStatus,
      executedQuantity: "40",
      createdAt: 100,
      acknowledgedAt: 101,
      updatedAt: 102,
      completedAt: 102,
    })
    const terminal = registry.applyUpdate({ order: terminalOrder }).registry
    const expectedFilledOrder = makeOrder({
      brokerOrderId: "9001",
      status: "FILLED",
      executedQuantity: "100",
      createdAt: 100,
      acknowledgedAt: 101,
      updatedAt: 103,
      completedAt: 103,
    })
    const filled = terminal.applyUpdate({ order: expectedFilledOrder })
    const trackedFilledOrder = filled.registry.getOrder({ clientOrderId: "harvester-1" })

    assert.deepEqual(
      terminal.getOrder({ clientOrderId: "harvester-1" }).value,
      terminalOrder.value,
      "The " + terminalStatus + " report must retain its broker identity, 40 executed units, 60 remaining units and terminal timestamps.",
    )
    assert.equal(
      filled.applied,
      true,
      "A later authoritative FILLED report with increased execution quantity must advance the " + terminalStatus + " order.",
    )
    assert.equal(
      filled.duplicate,
      false,
      "The late FILLED report must be applied as new execution state, not classified as a duplicate.",
    )
    assert.equal(
      filled.stale,
      false,
      "A late FILLED report with greater cumulative execution must not be discarded as stale.",
    )
    assert.equal(
      filled.unknown,
      false,
      "The late FILLED report must remain matched to the owned canonical order.",
    )
    assert.deepEqual(
      trackedFilledOrder.value,
      expectedFilledOrder.value,
      "The resulting FILLED order must preserve client/broker IDs, market, side, type, price, original quantity, full executed quantity, zero remaining quantity and all timestamps.",
    )
    assert.deepEqual(
      filled.registry.getActiveOrders(),
      [],
      "A fully executed order must no longer appear in the active registry.",
    )
    assert.deepEqual(
      filled.registry.getTerminalOrders().map((order) => order.value),
      [expectedFilledOrder.value],
      "The terminal registry must contain exactly the fully executed canonical order.",
    )
    assert.equal(
      terminal.getOrder({ clientOrderId: "harvester-1" }).status,
      terminalStatus,
      "Applying the late FILLED report must not mutate the earlier " + terminalStatus + " registry snapshot.",
    )
    assert.equal(
      registry.getOrder({ clientOrderId: "harvester-1" }).status,
      "PENDING",
      "Applying terminal reports must not mutate the original PENDING registry snapshot.",
    )
  }
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


test("allows a late FILLED update after an EXPIRED order report", () => {
  const registry = OrderRegistry.empty().registerPending({
    order: makeOrder(),
  }).registry
  const expired = registry.applyUpdate({
    order: makeOrder({
      brokerOrderId: "9001",
      status: "EXPIRED",
      executedQuantity: "0",
      createdAt: 100,
      acknowledgedAt: 101,
      updatedAt: 102,
      completedAt: 102,
    }),
  }).registry
  const filled = expired.applyUpdate({
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

  assert.equal(filled.applied, true)
  assert.equal(filled.registry.getTerminalOrders()[0].status, "FILLED")
  assert.equal(filled.registry.getActiveOrders().length, 0)
})


test("attaches a client-ID-resolved broker order ID to an UNKNOWN submission", () => {
  const clientOrderId = "h-lost-ack"
  const pending = makeOrder({ clientOrderId })
  const registry = OrderRegistry.empty().registerPending({ order: pending }).registry.applyUpdate({
    order: makeOrder({ clientOrderId, status: "UNKNOWN", updatedAt: 102 }),
  }).registry
  const acknowledged = makeOrder({
    clientOrderId,
    brokerOrderId: "broker-lost-ack",
    status: "FILLED",
    executedQuantity: "100",
    createdAt: 100,
    acknowledgedAt: 101,
    updatedAt: 103,
    completedAt: 103,
  })

  const attached = registry.attachAcknowledgedBrokerOrderId({ order: acknowledged })
  const tracked = attached.registry.getOrder({ clientOrderId })

  assert.equal(attached.applied, true)
  assert.equal(tracked.status, "UNKNOWN")
  assert.equal(tracked.brokerOrderId, "broker-lost-ack")
  assert.equal(tracked.executedQuantity.amount, "0")
})
test("tracks a FILLED acknowledgement as UNKNOWN until execution quantity is reconciled", () => {
  const pending = makeOrder({ clientOrderId: "h-ZROUSDT-ack" })
  const registry = OrderRegistry.empty().registerPending({ order: pending }).registry
  const acknowledged = makeOrder({
    clientOrderId: pending.clientOrderId,
    brokerOrderId: "698746",
    status: "FILLED",
    executedQuantity: "100",
    createdAt: 100,
    acknowledgedAt: 101,
    updatedAt: 102,
    completedAt: 102,
  })

  const attached = registry.attachAcknowledgedBrokerOrderId({ order: acknowledged })
  const trackedPending = attached.registry.getOrder({ clientOrderId: pending.clientOrderId })
  assert.equal(attached.applied, true)
  assert.equal(trackedPending.status, "UNKNOWN")
  assert.equal(trackedPending.brokerOrderId, "698746")
  assert.equal(trackedPending.executedQuantity.amount, "0")

  const partial = makeOrder({
    clientOrderId: pending.clientOrderId,
    brokerOrderId: "698746",
    status: "PARTIALLY_FILLED",
    executedQuantity: "40",
    createdAt: 100,
    acknowledgedAt: 101,
    updatedAt: 103,
  })
  const updated = attached.registry.applyUpdate({ order: partial })
  assert.equal(updated.applied, true)
  assert.equal(updated.registry.getOrder({ clientOrderId: pending.clientOrderId }).executedQuantity.amount, "40")
})


test("deduplicates an identical acknowledgement but rejects changed intent on the same broker identity", () => {
  const pending = makeOrder({ clientOrderId: "h-ack-replay" })
  const registry = OrderRegistry.empty().registerPending({ order: pending }).registry
  const acknowledged = makeOrder({
    clientOrderId: pending.clientOrderId,
    brokerOrderId: "698746",
    status: "FILLED",
    executedQuantity: "100",
    createdAt: 100,
    acknowledgedAt: 101,
    updatedAt: 102,
    completedAt: 102,
  })

  const attached = registry.attachAcknowledgedBrokerOrderId({ order: acknowledged })
  const duplicate = attached.registry.attachAcknowledgedBrokerOrderId({ order: acknowledged })
  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.applied, false)
  assert.equal(duplicate.registry, attached.registry)

  assert.throws(
    () => attached.registry.attachAcknowledgedBrokerOrderId({
      order: makeOrder({
        clientOrderId: pending.clientOrderId,
        brokerOrderId: "698746",
        quantity: "101",
        status: "FILLED",
        executedQuantity: "101",
        createdAt: 100,
        acknowledgedAt: 101,
        updatedAt: 103,
        completedAt: 103,
      }),
    }),
    /changed immutable order intent/,
  )
})

test("rejects an acknowledgement that reuses another Harvester order's broker ID", () => {
  const first = makeOrder({ clientOrderId: "h-ack-first" })
  const second = makeOrder({ clientOrderId: "h-ack-second", side: "SELL" })
  const registry = OrderRegistry.empty()
    .registerPending({ order: first }).registry
    .registerPending({ order: second }).registry
  const secondAcknowledgement = makeOrder({
    clientOrderId: second.clientOrderId,
    brokerOrderId: "698746",
    side: "SELL",
    status: "OPEN",
    createdAt: 100,
    acknowledgedAt: 101,
    updatedAt: 101,
  })
  const owned = registry.attachAcknowledgedBrokerOrderId({ order: secondAcknowledgement }).registry

  assert.throws(
    () => owned.attachAcknowledgedBrokerOrderId({
      order: makeOrder({
        clientOrderId: first.clientOrderId,
        brokerOrderId: "698746",
        status: "FILLED",
        executedQuantity: "100",
        createdAt: 100,
        acknowledgedAt: 101,
        updatedAt: 102,
        completedAt: 102,
      }),
    }),
    /already owned by another Harvester order/,
  )
})

test("marks a PENDING submission UNKNOWN without releasing its order commitment", () => {
  const clientOrderId = "h-unknown-submit"
  const registry = OrderRegistry.empty().registerPending({
    order: makeOrder({ clientOrderId }),
  }).registry

  const result = registry.markUnknown({ clientOrderId })
  const tracked = result.data.registry.getOrder({ clientOrderId })

  assert.equal(result.ok, true)
  assert.equal(result.data.applied, true)
  assert.equal(tracked.status, "UNKNOWN")
  assert.equal(tracked.clientOrderId, clientOrderId)
  assert.equal(tracked.originalQuantity.amount, "100")
  assert.equal(tracked.executedQuantity.amount, "0")
  assert.equal(result.data.registry.getActiveOrders({ marketId: market.id }).length, 1)
})

test("marks an acknowledged OPEN order UNKNOWN without losing broker identity or commitment", () => {
  const clientOrderId = "h-unknown-cancel-open"
  const brokerOrderId = "broker-unknown-cancel-open"
  const pending = makeOrder({ clientOrderId })
  const open = makeOrder({
    clientOrderId,
    brokerOrderId,
    status: "OPEN",
    updatedAt: 10,
  })
  const registry = OrderRegistry.empty()
    .registerPending({ order: pending }).registry
    .applyUpdate({ order: open }).registry

  const result = registry.markCancellationUnknown({ clientOrderId })
  const tracked = result.data.registry.getOrder({ clientOrderId })

  assert.equal(result.ok, true)
  assert.equal(result.data.applied, true)
  assert.equal(tracked.status, "UNKNOWN")
  assert.equal(tracked.brokerOrderId, brokerOrderId)
  assert.equal(tracked.executedQuantity.amount, "0")
  assert.equal(tracked.originalQuantity.amount, "100")
  assert.equal(result.data.registry.getActiveOrders({ marketId: market.id }).length, 1)
})

test("marks a partially filled order UNKNOWN and preserves cumulative execution", () => {
  const clientOrderId = "h-unknown-cancel-partial"
  const brokerOrderId = "broker-unknown-cancel-partial"
  const pending = makeOrder({ clientOrderId })
  const partiallyFilled = makeOrder({
    clientOrderId,
    brokerOrderId,
    status: "PARTIALLY_FILLED",
    executedQuantity: "25.5",
    updatedAt: 20,
  })
  const registry = OrderRegistry.empty()
    .registerPending({ order: pending }).registry
    .applyUpdate({ order: partiallyFilled }).registry

  const result = registry.markCancellationUnknown({ clientOrderId })
  const tracked = result.data.registry.getOrder({ clientOrderId })

  assert.equal(result.ok, true)
  assert.equal(tracked.status, "UNKNOWN")
  assert.equal(tracked.brokerOrderId, brokerOrderId)
  assert.equal(tracked.executedQuantity.amount, "25.5")
  assert.equal(tracked.originalQuantity.amount, "100")
  assert.equal(result.data.registry.getActiveOrders({ marketId: market.id }).length, 1)
})

test("does not downgrade an already acknowledged order when submission failure arrives late", () => {
  const clientOrderId = "h-ack-race"
  const pending = makeOrder({ clientOrderId })
  const registry = OrderRegistry.empty().registerPending({ order: pending }).registry.applyUpdate({
    order: makeOrder({ clientOrderId, brokerOrderId: "broker-ack-race", status: "OPEN", updatedAt: 102 }),
  }).registry

  const result = registry.markUnknown({ clientOrderId })

  assert.equal(result.ok, true)
  assert.equal(result.data.alreadyAcknowledged, true)
  assert.equal(result.data.order.status, "OPEN")
  assert.equal(result.data.order.brokerOrderId, "broker-ack-race")
})

test("returns an error when marking an unregistered order UNKNOWN", () => {
  const result = OrderRegistry.empty().markUnknown({ clientOrderId: "missing-client-id" })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /unregistered order/)
})
