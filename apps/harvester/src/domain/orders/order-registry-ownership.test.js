import test from "node:test"
import assert from "node:assert/strict"
import { Asset, CanonicalOrder, Market, Money, Quantity } from "@coinzilla/entities"
import { OrderRegistry } from "./order-registry.js"

const baseAsset = new Asset({ id: "asset:ZRO", code: "ZRO" })
const quoteAsset = new Asset({ id: "asset:USDT", code: "USDT" })
const market = new Market({
  venue: "binance",
  symbol: "ZROUSDT",
  baseAsset,
  quoteAsset,
})

function makeOrder({
  clientOrderId = "h-rs-order",
  brokerOrderId,
  side = "SELL",
  status = "PENDING",
  executedQuantity = "0",
} = {}) {
  return new CanonicalOrder({
    clientOrderId,
    ...(brokerOrderId === undefined ? {} : { brokerOrderId }),
    market,
    side,
    type: "LIMIT_MAKER",
    limitPrice: new Money({ amount: "2.1", asset: quoteAsset }),
    originalQuantity: new Quantity({ amount: "10.01", asset: baseAsset }),
    executedQuantity: new Quantity({ amount: executedQuantity, asset: baseAsset }),
    status,
  })
}

const recoverySellerOwnership = Object.freeze({
  strategyId: "RS_recoverySeller",
  positionId: "position:rs:zrousdt",
  purpose: "LEGACY_RECOVERY_SELL",
  cycleId: "rs-cycle-0001",
})

test("retains immutable strategy and Position ownership when a pending order is registered", () => {
  const pendingOrder = makeOrder()
  const registered = OrderRegistry.empty().registerPending({
    order: pendingOrder,
    ownership: recoverySellerOwnership,
  })

  const ownership = registered.registry.getOwnership({
    clientOrderId: pendingOrder.clientOrderId,
  })

  assert.equal(registered.applied, true, "A new RS order must be registered before broker submission.")
  assert.deepEqual(ownership, {
    clientOrderId: pendingOrder.clientOrderId,
    strategyId: recoverySellerOwnership.strategyId,
    positionId: recoverySellerOwnership.positionId,
    purpose: recoverySellerOwnership.purpose,
    cycleId: recoverySellerOwnership.cycleId,
  }, "The order registry must retain the exact originating strategy, Position, purpose and cycle identity.")
  assert.equal(Object.isFrozen(ownership), true, "Order ownership metadata must be immutable after registration.")
  assert.equal(Object.isFrozen(registered.registry.value.ownerships[0]), true, "Serialized ownership metadata must not expose a mutable registry record.")
})

test("attaches the exchange broker order identity to the original immutable ownership record", () => {
  const pendingOrder = makeOrder({ clientOrderId: "h-rs-ack" })
  const registered = OrderRegistry.empty().registerPending({
    order: pendingOrder,
    ownership: recoverySellerOwnership,
  }).registry
  const acknowledgedOrder = makeOrder({
    clientOrderId: pendingOrder.clientOrderId,
    brokerOrderId: "broker-rs-ack",
    status: "OPEN",
  })

  const attached = registered.attachAcknowledgedBrokerOrderId({
    order: acknowledgedOrder,
  })
  const ownership = attached.registry.getOwnership({
    brokerOrderId: "broker-rs-ack",
  })

  assert.equal(attached.applied, true, "The first broker acknowledgement must attach its exchange identity to the registered order.")
  assert.equal(ownership.clientOrderId, pendingOrder.clientOrderId, "Broker lookup must resolve to Harvester's original client order identity.")
  assert.equal(ownership.brokerOrderId, "broker-rs-ack", "The immutable ownership record must retain the exchange-assigned broker order identity.")
  assert.equal(ownership.strategyId, recoverySellerOwnership.strategyId, "Acknowledgement must not change the strategy that owns the order.")
  assert.equal(ownership.positionId, recoverySellerOwnership.positionId, "Acknowledgement must not change the Position attributed to the order.")
})

test("preserves order ownership when Binance reports a different client ID for a known broker order", () => {
  const pendingOrder = makeOrder({ clientOrderId: "h-rs-original-client-id" })
  const registered = OrderRegistry.empty().registerPending({
    order: pendingOrder,
    ownership: recoverySellerOwnership,
  }).registry
  const acknowledgedOrder = makeOrder({
    clientOrderId: pendingOrder.clientOrderId,
    brokerOrderId: "broker-rs-identity",
    status: "OPEN",
  })
  const acknowledged = registered.applyUpdate({
    order: acknowledgedOrder,
  }).registry
  const exchangeUpdate = makeOrder({
    clientOrderId: "binance-replaced-client-id",
    brokerOrderId: "broker-rs-identity",
    status: "PARTIALLY_FILLED",
    executedQuantity: "4",
  })

  const updated = acknowledged.applyUpdate({ order: exchangeUpdate })
  const ownership = updated.registry.getOwnership({
    clientOrderId: pendingOrder.clientOrderId,
    brokerOrderId: "broker-rs-identity",
  })

  assert.equal(updated.applied, true, "A broker-ID-matched exchange update must advance the original Harvester-owned order.")
  assert.equal(ownership.clientOrderId, pendingOrder.clientOrderId, "The registry must preserve the original Harvester client ID rather than adopting Binance's replacement ID.")
  assert.equal(ownership.brokerOrderId, "broker-rs-identity", "The known broker order identity must remain linked to its original owner.")
  assert.equal(ownership.strategyId, recoverySellerOwnership.strategyId, "An exchange client-ID change must never transfer strategy ownership.")
  assert.equal(updated.registry.getOrder({ clientOrderId: pendingOrder.clientOrderId }).executedQuantity.amount, "4", "The partial execution must update only the matched canonical order.")
})

test("rejects conflicting ownership when a client order identity is reused", () => {
  const pendingOrder = makeOrder({ clientOrderId: "h-rs-owner-conflict" })
  const registered = OrderRegistry.empty().registerPending({
    order: pendingOrder,
    ownership: recoverySellerOwnership,
  }).registry

  assert.throws(() => registered.registerPending({
    order: pendingOrder,
    ownership: {
      ...recoverySellerOwnership,
      strategyId: "CG_coinGrabber",
      positionId: "position:cg:zrousdt",
    },
  }), /ownership|owner/i, "One registered client order ID must never be reassigned to another strategy or Position.")
})

test("removes ownership together with a pending order that is safely deferred before broker submission", () => {
  const pendingOrder = makeOrder({ clientOrderId: "h-rs-deferred" })
  const registered = OrderRegistry.empty().registerPending({
    order: pendingOrder,
    ownership: recoverySellerOwnership,
  }).registry

  const removed = registered.removePending({
    clientOrderId: pendingOrder.clientOrderId,
  })

  assert.equal(removed.removed, true, "A local PENDING order may be removed only when broker submission has not occurred.")
  assert.equal(removed.registry.getOrder({ clientOrderId: pendingOrder.clientOrderId }), undefined, "The deferred order must no longer reserve an order identity.")
  assert.equal(removed.registry.getOwnership({ clientOrderId: pendingOrder.clientOrderId }), undefined, "Ownership metadata for a removed PENDING order must not become orphaned.")
  assert.equal(registered.getOwnership({ clientOrderId: pendingOrder.clientOrderId }).strategyId, recoverySellerOwnership.strategyId, "Removing the next immutable registry snapshot must not mutate the prior ownership snapshot.")
})
