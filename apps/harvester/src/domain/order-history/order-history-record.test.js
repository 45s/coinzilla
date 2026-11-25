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
    "binance:BTCUSDT",
    "exchange",
    "broker-order-001",
  ]), "An exchange order ID must be scoped by environment, provider account, and market.")
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

test("requires market scope whenever an exchange order ID is available", () => {
  assert.throws(
    () => createOrderHistoryId({
      environment: "testnet",
      providerInstanceId: "binanceTestnet",
      providerType: "binance",
      accountId: "binance-primary",
      clientOrderId: "h-BTCUSDT-1",
      brokerOrderId: "exchange-order-1",
    }),
    /marketId/,
  )
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


test("distinguishes Binance historical orders when a terminal client order ID is reused", () => {
  const sharedIdentity = {
    environment: "testnet",
    providerInstanceId: "binanceTestnet",
    providerType: "binance",
    accountId: "binance-primary",
  }
  const cases = [
    {
      symbol: "ZROUSDT",
      clientOrderId: "h-ZROUSDT-1",
      earlierBrokerOrderId: "661725",
      incomingBrokerOrderId: "661748",
    },
    {
      symbol: "DOGEUSDT",
      clientOrderId: "h-DOGEUSDT-1",
      earlierBrokerOrderId: "1193586",
      incomingBrokerOrderId: "1193792",
    },
  ]

  for (const scenario of cases) {
    const earlierOrderId = createOrderHistoryId({
      ...sharedIdentity,
      marketId: `binance:${scenario.symbol}`,
      clientOrderId: scenario.clientOrderId,
      brokerOrderId: scenario.earlierBrokerOrderId,
    })
    const incomingOrderId = createOrderHistoryId({
      ...sharedIdentity,
      marketId: `binance:${scenario.symbol}`,
      clientOrderId: scenario.clientOrderId,
      brokerOrderId: scenario.incomingBrokerOrderId,
    })

    assert.notEqual(
      incomingOrderId,
      earlierOrderId,
      `Distinct ${scenario.symbol} exchange orders must not collide merely because Binance reused their clientOrderId.`,
    )
  }
})

test("keeps a pending order identity stable until an exchange order ID is assigned", () => {
  const identity = {
    environment: "testnet",
    providerInstanceId: "binanceTestnet",
    providerType: "binance",
    accountId: "binance-primary",
    clientOrderId: "h-ZROUSDT-1",
    marketId: "binance:ZROUSDT",
    createdAt: 1795054597373,
  }
  const pendingOrderId = createOrderHistoryId(identity)
  const acknowledgedOrderId = createOrderHistoryId({
    ...identity,
    brokerOrderId: "661748",
  })

  assert.notEqual(
    acknowledgedOrderId,
    pendingOrderId,
    "An acknowledged exchange order must acquire an identity distinct from the client-ID-only pending placeholder.",
  )
})


test("scopes exchange order IDs by market because provider order IDs may be market-local", () => {
  const sharedIdentity = {
    environment: "testnet",
    providerInstanceId: "binanceTestnet",
    providerType: "binance",
    accountId: "binance-primary",
    brokerOrderId: "661748",
  }
  const zroOrderId = createOrderHistoryId({
    ...sharedIdentity,
    marketId: "binance:ZROUSDT",
    clientOrderId: "h-ZROUSDT-1",
  })
  const dogeOrderId = createOrderHistoryId({
    ...sharedIdentity,
    marketId: "binance:DOGEUSDT",
    clientOrderId: "h-DOGEUSDT-1",
  })

  assert.notEqual(
    zroOrderId,
    dogeOrderId,
    "The same provider order ID in different markets must never identify the same exchange order.",
  )
})
