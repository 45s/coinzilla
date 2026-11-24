import assert from "node:assert/strict"
import test from "node:test"

import { Broker } from "../../../index.js"

const broker = new Broker({
  provider: "bitunix-futures",
  apiKey: "bitunix-futures-capabilities-test-key",
  apiSecret: "bitunix-futures-capabilities-test-secret",
  tradingMode: "live",
})

test("Bitunix Futures capability declarations match implemented streams and read-only safety limits", () => {
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
    "READ_OPEN_ORDERS",
    "READ_COMPLETE_FILL_HISTORY",
    "RECOVER_USER_DATA_SESSION",
    "RECOVER_PROCESS_RESTART",
    "SUBSCRIBE_CANDLES",
  ]) {
    assert.equal(capabilities.getStatus({ type }), "UNKNOWN", `${type} must not overstate completeness`)
  }

  for (const type of [
    "PLACE_LIMIT_ORDER",
    "PLACE_MARKET_ORDER",
    "CANCEL_ORDER",
    "CANCEL_ALL_ORDERS",
  ]) {
    assert.equal(capabilities.getStatus({ type }), "UNSUPPORTED", `${type} must remain disabled`)
  }

  const userData = capabilities.getCapability({
    type: "SUBSCRIBE_USER_DATA",
  })
  assert.match(userData.limitation, /not authoritative or replayable/i)
})
