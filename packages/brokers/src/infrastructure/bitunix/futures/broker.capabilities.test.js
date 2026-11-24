import assert from "node:assert/strict"
import test from "node:test"

import { Broker } from "../../../index.js"

const broker = new Broker({
  provider: "bitunix-futures",
  apiKey: "bitunix-futures-capabilities-test-key",
  apiSecret: "bitunix-futures-capabilities-test-secret",
  tradingMode: "live",
})

test("Bitunix Futures capability declarations match implemented operations and explicit mutation gates", () => {
  const { capabilities } = broker
  assert.equal(capabilities.provider, "bitunix")
  assert.equal(capabilities.product, "futures")
  assert.deepEqual(capabilities.environment.supportedModes, ["live"])

  for (const type of [
    "READ_BALANCES",
    "READ_CANONICAL_ORDER",
    "READ_CANONICAL_ORDER_HISTORY",
    "READ_TRADE_HISTORY",
    "SUBSCRIBE_MARKET_PRICES",
    "SUBSCRIBE_BOOK_TICKER",
    "SUBSCRIBE_USER_DATA",
    "OBSERVE_USER_DATA",
  ]) {
    assert.equal(capabilities.getStatus({ type }), "SUPPORTED", `${type} should be supported`)
  }

  for (const type of [
    "READ_COMPLETE_FILL_HISTORY",
    "RECOVER_USER_DATA_SESSION",
    "RECOVER_PROCESS_RESTART",
      ]) {
    assert.equal(capabilities.getStatus({ type }), "UNKNOWN", `${type} must not overstate completeness`)
  }

  for (const type of ["READ_OPEN_ORDERS", "SUBSCRIBE_CANDLES"]) {
    assert.equal(capabilities.getStatus({ type }), "UNSUPPORTED", `${type} must be explicitly unavailable through the common contract`)
    assert.ok(capabilities.getCapability({ type }).reason, `${type} must explain its unsupported common projection`)
  }

  for (const type of ["PLACE_LIMIT_ORDER", "PLACE_MARKET_ORDER"]) {
    const capability = capabilities.getCapability({ type })
    assert.equal(capability.status, "SUPPORTED")
    assert.equal(capability.method, "createFuturesOrder")
    assert.ok(capability.conditions.includes("allowLiveOrderMutations === true"))
  }

  const cancelOrder = capabilities.getCapability({
    type: "CANCEL_ORDER",
  })
  assert.equal(cancelOrder.status, "SUPPORTED")
  assert.equal(cancelOrder.method, "cancelOrder")
  assert.ok(cancelOrder.conditions.includes("allowLiveOrderMutations === true"))

  const cancelAllOrders = capabilities.getCapability({
    type: "CANCEL_ALL_ORDERS",
  })
  assert.equal(cancelAllOrders.status, "SUPPORTED")
  assert.equal(cancelAllOrders.method, "cancelAllOpenOrders")
  assert.ok(cancelAllOrders.conditions.includes("allowLiveOrderMutations === true"))

  const userData = capabilities.getCapability({
    type: "SUBSCRIBE_USER_DATA",
  })
  assert.match(userData.limitation, /no canonical event, replay cursor, sequence number or replay guarantee is claimed/i)
})
