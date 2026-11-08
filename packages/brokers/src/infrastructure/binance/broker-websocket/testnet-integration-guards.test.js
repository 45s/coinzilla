import test from "node:test"
import assert from "node:assert/strict"
import { isTestnetOrderMutationEnabled } from "./testnet-integration-guards.js"

test("TESTNET order mutations require a separate explicit opt-in", () => {
  assert.equal(isTestnetOrderMutationEnabled({}), false)
  assert.equal(isTestnetOrderMutationEnabled({ BINANCE_TESTNET_INTEGRATION: "1" }), false)
  assert.equal(isTestnetOrderMutationEnabled({ BINANCE_TESTNET_ALLOW_ORDER_MUTATIONS: "true" }), false)
  assert.equal(isTestnetOrderMutationEnabled({ BINANCE_TESTNET_ALLOW_ORDER_MUTATIONS: "1" }), true)
})
