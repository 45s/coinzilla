import assert from "node:assert/strict"
import test from "node:test"

import { BrokerCapabilities } from "../../broker/broker-capabilities.js"
import { createBitunixBrokerCapabilities } from "./capabilities.js"

test("Bitunix Spot capability declaration uses the canonical BrokerCapabilities contract", () => {
  const capabilities = createBitunixBrokerCapabilities()

  assert.ok(capabilities instanceof BrokerCapabilities)
  assert.equal(capabilities.provider, "bitunix")
  assert.equal(capabilities.product, "spot")
  assert.equal(capabilities.environment.selectedMode, "live")
  assert.equal(capabilities.getStatus({ type: "READ_BALANCES" }), "SUPPORTED")
  assert.equal(capabilities.getStatus({ type: "READ_ACCOUNT_SNAPSHOT" }), "UNSUPPORTED")
  assert.equal(capabilities.getStatus({ type: "READ_FILLS" }), "UNSUPPORTED")
  assert.equal(capabilities.getStatus({ type: "PLACE_LIMIT_ORDER" }), "UNSUPPORTED")
  assert.equal(capabilities.getStatus({ type: "PLACE_MARKET_ORDER" }), "UNSUPPORTED")
  assert.equal(capabilities.getStatus({ type: "CANCEL_ORDER" }), "UNSUPPORTED")
  assert.equal(capabilities.getStatus({ type: "CANCEL_ALL_ORDERS" }), "UNSUPPORTED")
  assert.equal(capabilities.getStatus({ type: "READ_COMPLETE_FILL_HISTORY" }), "UNKNOWN")
  assert.equal(capabilities.getStatus({ type: "OBSERVE_USER_DATA" }), "SUPPORTED")
  assert.equal(capabilities.getStatus({ type: "SUBSCRIBE_USER_DATA" }), "UNSUPPORTED")
})

test("Bitunix Spot live mutation capabilities require explicit configuration opt-in", () => {
  const capabilities = createBitunixBrokerCapabilities({
    allowLiveOrderMutations: true,
  })

  for (const type of [
    "PLACE_LIMIT_ORDER",
    "PLACE_MARKET_ORDER",
    "CANCEL_ORDER",
    "CANCEL_ALL_ORDERS",
  ]) {
    assert.equal(capabilities.getStatus({ type }), "SUPPORTED", type)
  }
})

test("Bitunix order capability declares official base and quote volume semantics", () => {
  const capabilities = createBitunixBrokerCapabilities({
    allowLiveOrderMutations: true,
  })

  assert.match(
    capabilities.getCapability({ type: "PLACE_LIMIT_ORDER" }).guarantee,
    /base-coin volume/i,
  )
  assert.match(
    capabilities.getCapability({ type: "PLACE_MARKET_ORDER" }).guarantee,
    /quoteQuantity/i,
  )
  assert.match(
    capabilities.getCapability({ type: "PLACE_MARKET_ORDER" }).conditions.join(" "),
    /quote-coin quantity/i,
  )
})

test("Bitunix Spot capability factory rejects non-boolean live mutation opt-in", () => {
  assert.throws(() => createBitunixBrokerCapabilities({
    allowLiveOrderMutations: "true",
  }), /must be a boolean/i)
})

test("Bitunix Spot capability declarations preserve canonical lifecycle blockers", () => {
  const capabilities = createBitunixBrokerCapabilities()

  for (const type of [
    "SUBSCRIBE_MARKET_PRICES",
    "SUBSCRIBE_CANDLES",
    "SUBSCRIBE_BOOK_TICKER",
    "SUBSCRIBE_USER_DATA",
    "RECONCILE_ORDERS",
    "REPLAY_USER_DATA_EVENTS",
  ]) {
    assert.equal(capabilities.getStatus({ type }), "UNSUPPORTED", type)
  }

  assert.match(
    capabilities.getCapability({ type: "PLACE_LIMIT_ORDER" }).reason,
    /disabled by default/i,
  )
})
