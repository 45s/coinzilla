import assert from "node:assert/strict"
import test from "node:test"

import { BitunixFuturesConfig } from "./bitunix-futures-config.js"

const credentials = {
  apiKey: "bitunix-futures-config-test-key",
  apiSecret: "bitunix-futures-config-test-secret",
}

test("Bitunix Futures config selects the official USDT Futures endpoint and disables mutations by default", () => {
  const config = new BitunixFuturesConfig({
    ...credentials,
    tradingMode: "live",
  })

  assert.equal(config.baseUrl, "https://fapi.bitunix.com", "Futures REST must use the official Futures API host")
  assert.equal(config.tradingMode, "live", "the environment must remain explicit")
  assert.equal(config.allowLiveOrderMutations, false, "LIVE order mutations must be disabled by default")
  assert.equal(config.allowLiveAccountMutations, false, "LIVE account-setting mutations must be disabled by default")
  assert.equal(Object.isFrozen(config), true, "validated provider configuration must be immutable")
})

test("Bitunix Futures config rejects undocumented TESTNET and unsafe REST endpoints", () => {
  assert.throws(
    () => new BitunixFuturesConfig({
      ...credentials,
      tradingMode: "testnet",
    }),
    /no Futures TESTNET endpoint is documented/,
    "the adapter must not invent a TESTNET endpoint or infer an environment",
  )

  assert.throws(
    () => new BitunixFuturesConfig({
      ...credentials,
      tradingMode: "live",
      baseUrl: "https://example.invalid",
    }),
    /official Bitunix Futures REST endpoint/,
    "provider configuration must not redirect signed credentials to an arbitrary host",
  )
})
