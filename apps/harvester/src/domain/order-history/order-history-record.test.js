import assert from "node:assert/strict"
import test from "node:test"
import {
  createOrderHistoryId,
  createOrderHistoryRecord,
} from "./order-history-record.js"
import {
  createOrderHistoryEvent,
  ORDER_HISTORY_MARKET,
} from "../../../test-support/order-history-fixtures.js"

test("creates a provider-account-scoped record without losing exact decimal precision", () => {
  const event = createOrderHistoryEvent()
  const record = createOrderHistoryRecord({
    order: event.data,
    sourceEvent: event,
    environment: "testnet",
  })

  assert.ok(record, "A qualifying filled order must produce a history record.")
  assert.equal(record.id, JSON.stringify([
    "testnet",
    "binanceTestnet",
    "binance",
    "binance-primary",
    "harvester-BTCUSDT-001",
  ]), "Order identity must include environment, provider instance/type, account, and client order ID.")
  assert.equal(record.executedQuantity, "0.2500", "Executed quantity must remain an exact decimal string.")
  assert.equal(record.originalQuantity, "1.0000", "Original quantity must retain its original decimal scale.")
  assert.equal(record.remainingQuantity, "0.7500", "Remaining quantity must remain an exact decimal string.")
  assert.deepEqual(record.market, ORDER_HISTORY_MARKET, "The persisted market must retain canonical asset identity.")
  assert.deepEqual(record.ownership, event.data.ownership, "Available strategy and position ownership must be preserved.")
  assert.equal(record.firstSourceEventId, event.id, "The first source event must be retained for traceability.")
  assert.equal(record.lastSourceEventName, event.name, "The last source event name must be retained.")
  assert.equal(Object.hasOwn(record, "processId"), false, "Temporary process IDs must not become order-history data.")
  assert.equal(Object.hasOwn(record, "runtimeSessionId"), false, "Runtime session IDs must not become order-history data.")
})

test("uses a collision-safe composite identity for provider accounts", () => {
  const first = createOrderHistoryId({
    environment: "testnet",
    providerInstanceId: "binanceTestnet",
    providerType: "binance",
    accountId: "primary:spot",
    clientOrderId: "order:1",
  })
  const second = createOrderHistoryId({
    environment: "testnet",
    providerInstanceId: "binanceTestnet",
    providerType: "binance",
    accountId: "primary",
    clientOrderId: "spot:order:1",
  })

  assert.notEqual(first, second, "Composite order IDs must not collide when identifier values contain separators.")
})

test("does not create a history record until executed quantity is positive", () => {
  const event = createOrderHistoryEvent({
    dataOverrides: {
      executedQuantity: "0.0000",
      remainingQuantity: "1.0000",
      status: "OPEN",
    },
  })

  assert.equal(createOrderHistoryRecord({
    order: event.data,
    sourceEvent: event,
    environment: "testnet",
  }), null, "Unfilled orders must not be inserted into the filled-order history collection.")
})

test("rejects incomplete provider identity instead of merging unrelated accounts", () => {
  const event = createOrderHistoryEvent({
    dataOverrides: {
      accountId: undefined,
    },
  })

  assert.throws(
    () => createOrderHistoryRecord({
      order: event.data,
      sourceEvent: event,
      environment: "testnet",
    }),
    (error) => error.code === "HARVESTER_ORDER_HISTORY_RECORD_INVALID",
    "A filled order without complete provider/account provenance must be rejected.",
  )
})
