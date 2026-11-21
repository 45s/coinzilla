import assert from "node:assert/strict"
import test from "node:test"
import {
  createOrderIdentityKey,
  createSourceEvent,
  validateCanonicalOrderProviderIdentity,
} from "./map-history-records.js"

const providerIdentity = Object.freeze({
  providerInstanceId: "binance-primary",
  providerType: "binance",
  accountId: "binance-account",
})

test("creates stable exchange order identity keys from market and broker order IDs", () => {
  assert.equal(
    createOrderIdentityKey({
      order: {
        market: { id: "binance:BTCUSDT" },
        brokerOrderId: "123",
      },
    }),
    "binance:BTCUSDT:123",
    "Order identity must include both the canonical market and exchange order ID.",
  )
})

test("creates immutable exchange-history provenance events", () => {
  const event = createSourceEvent({
    id: "exchange-order:123",
    name: "exchange.history_order_observed",
    observedAt: "2026-11-20T00:00:00.000Z",
  })
  assert.deepEqual(
    event,
    {
      id: "exchange-order:123",
      name: "exchange.history_order_observed",
      source: "binance.exchange-history",
      timestamp: "2026-11-20T00:00:00.000Z",
    },
    "Exchange history provenance must retain its stable source, identity, name, and observation time.",
  )
})

test("rejects an order whose supplied provider identity belongs to another account", () => {
  assert.throws(
    () => validateCanonicalOrderProviderIdentity({
      order: {
        providerInstanceId: "binance-secondary",
        providerType: "binance",
        accountId: "binance-account",
        brokerOrderId: "123",
      },
      providerIdentity,
      symbol: "BTCUSDT",
    }),
    /provider identity conflicts/,
    "History from another provider instance must never be persisted under this account's identity.",
  )
})
