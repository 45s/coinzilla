import assert from "node:assert/strict"
import test from "node:test"
import { BrokerCapabilities as EntityBrokerCapabilities } from "@coinzilla/entities"

import { BrokerCapabilities } from "../../../../broker/broker-capabilities.js"
import { createBinanceBrokerCapabilities } from "./capabilities.js"

test("Binance capability declaration uses the canonical BrokerCapabilities contract", () => {
  const capabilities = createBinanceBrokerCapabilities({ tradingMode: "testnet" })

  assert.ok(capabilities instanceof BrokerCapabilities)
  assert.ok(capabilities instanceof EntityBrokerCapabilities)
  assert.equal(capabilities.provider, "binance")
  assert.equal(capabilities.product, "spot")
  assert.deepEqual(capabilities.environment, {
    selector: "tradingMode",
    selectedMode: "testnet",
    supportedModes: ["testnet", "live"],
    notes: "NODE_ENV does not select exchange endpoints.",
  })
  assert.equal(capabilities.getStatus({ type: "READ_BALANCES" }), "SUPPORTED")
  assert.equal(capabilities.getStatus({ type: "PLACE_LIMIT_ORDER" }), "SUPPORTED")
  assert.equal(capabilities.getStatus({ type: "RECONCILE_ORDERS" }), "UNSUPPORTED")
  assert.equal(capabilities.getStatus({ type: "READ_COMPLETE_FILL_HISTORY" }), "UNKNOWN")
})

test("Binance mutation capability conditions remain explicit", () => {
  const capabilities = createBinanceBrokerCapabilities({ tradingMode: "live" })
  const placement = capabilities.getCapability({ type: "PLACE_LIMIT_ORDER" })
  const cancellation = capabilities.getCapability({ type: "CANCEL_ORDER" })

  assert.deepEqual(placement.conditions, [
    "The instance must use an explicitly validated tradingMode of testnet or live.",
    "The selected Binance account and API key must have Spot trading permission.",
    "The WebSocket API must be connected and user-data recovery must be acknowledged before state-changing calls.",
  ])
  assert.ok(cancellation.limitation)
  assert.equal(capabilities.environment.selectedMode, "live")
})



test("declares native event delivery and does not advertise polling observations", () => {
  const capabilities = createBinanceBrokerCapabilities({ tradingMode: "testnet" })

  assert.equal(capabilities.getStatus({ type: "SUBSCRIBE_USER_DATA" }), "SUPPORTED")
  assert.equal(capabilities.getStatus({ type: "OBSERVE_USER_DATA" }), "UNSUPPORTED")
})
