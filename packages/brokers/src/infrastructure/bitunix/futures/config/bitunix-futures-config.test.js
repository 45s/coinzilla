import assert from "node:assert/strict"
import test from "node:test"

import { BitunixFuturesConfig } from "./bitunix-futures-config.js"

const credentials = {
  apiKey: "bitunix-futures-config-test-key",
  apiSecret: "bitunix-futures-config-test-secret",
  tradingMode: "live",
}

test("Bitunix Futures configuration rejects unknown provider options instead of silently ignoring typos", () => {
  assert.throws(
    () => new BitunixFuturesConfig({
      ...credentials,
      requestTimout: 2_000,
    }),
    /unsupported option.*requestTimout/i,
  )
})

test("Bitunix Futures configuration rejects non-object constructor inputs", () => {
  for (const input of [null, [], "live"]) {
    assert.throws(
      () => new BitunixFuturesConfig(input),
      /configuration input must be an object/i,
    )
  }
})

test("Bitunix Futures configuration accepts its documented options", () => {
  const config = new BitunixFuturesConfig({
    ...credentials,
    requestTimeout: 5_000,
    allowLiveOrderMutations: false,
    allowLiveAccountMutations: false,
  })

  assert.equal(config.requestTimeout, 5_000)
  assert.equal(config.allowLiveOrderMutations, false)
  assert.equal(config.allowLiveAccountMutations, false)
})
