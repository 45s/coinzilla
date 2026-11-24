import assert from "node:assert/strict"
import test from "node:test"

import { BitunixFuturesConfig } from "../config/bitunix-futures-config.js"
import { BitunixFuturesRestClient } from "./rest-client.js"

test("Bitunix Futures REST requires every POST request to declare its mutation state", async () => {
  let requestCount = 0
  const config = new BitunixFuturesConfig({
    apiKey: "bitunix-futures-rest-test-key",
    apiSecret: "bitunix-futures-rest-test-secret",
    tradingMode: "live",
  })
  const client = new BitunixFuturesRestClient({
    config,
    fetchFn: async () => {
      requestCount += 1
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          data: {},
        }),
      }
    },
  })

  await assert.rejects(
    client.request({
      method: "POST",
      path: "/api/v1/futures/trade/place_order",
      body: {},
    }),
    /stateChanging/,
    "a state-changing endpoint must never inherit a silent read-only default",
  )
  assert.equal(requestCount, 0, "an ambiguous POST must be rejected before network dispatch")
})
