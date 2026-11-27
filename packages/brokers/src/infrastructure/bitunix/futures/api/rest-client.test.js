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

test("Bitunix Futures depth response preserves numeric JSON price and quantity tokens losslessly", async () => {
  const config = new BitunixFuturesConfig({
    apiKey: "bitunix-futures-depth-test-key",
    apiSecret: "bitunix-futures-depth-test-secret",
    tradingMode: "live",
  })
  const client = new BitunixFuturesRestClient({
    config,
    fetchFn: async () => ({
      ok: true,
      status: 200,
      text: async () => '{"code":0,"data":{"asks":[[0.1001,0.123456789012345678]],"bids":[[0.1,1]]}}',
    }),
    now: () => 1_700_000_000_000,
    nonceFactory: () => "nonce-depth",
  })

  const response = await client.request({
    method: "GET",
    path: "/api/v1/futures/market/depth",
    queryParams: {
      symbol: "BTCUSDT",
    },
  })

  assert.equal(response.data.asks[0][0], "0.1001", "depth price tokens must remain decimal strings")
  assert.equal(response.data.asks[0][1], "0.123456789012345678", "depth quantity tokens must not be rounded through JavaScript Number")
  assert.equal(response.data.bids[0][0], "0.1", "bid price tokens must also remain exact")
})


test("Bitunix Futures REST classifies non-JSON HTTP mutation failures by status before parsing the body", async () => {
  let clock = 0
  const statuses = [400, 429, 500]
  let requestIndex = 0
  const client = new BitunixFuturesRestClient({
    config: new BitunixFuturesConfig({
      apiKey: "bitunix-futures-http-status-test-key",
      apiSecret: "bitunix-futures-http-status-test-secret",
      tradingMode: "live",
    }),
    now: () => 1_700_000_000_000,
    rateLimitNow: () => clock,
    sleepFn: async (delay) => {
      clock += delay
    },
    fetchFn: async () => {
      const status = statuses[requestIndex]
      requestIndex += 1
      return {
        ok: false,
        status,
        text: async () => "<html>gateway error</html>",
      }
    },
  })

  for (const status of statuses) {
    await assert.rejects(
      client.request({
        method: "POST",
        path: "/api/v1/futures/trade/place_order",
        body: {
          symbol: "BTCUSDT",
        },
        stateChanging: true,
      }),
      (error) => {
        assert.equal(error.kind, "http", `HTTP ${status} must retain its HTTP failure classification`)
        assert.equal(error.status, status, `HTTP ${status} must retain its response status`)
        assert.equal(error.outcomeUnknown, status >= 500, `HTTP ${status} must use the documented mutation outcome classification`)
        return true
      },
    )
  }

  assert.equal(requestIndex, statuses.length, "each HTTP failure must be dispatched exactly once")
})

test("Bitunix Futures clients with the same API key share one rate limiter", async () => {
  let clock = 0
  const delays = []
  const fetchFn = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ code: 0, data: {} }),
  })
  const config = new BitunixFuturesConfig({
    apiKey: "same-key-shared-limiter-regression",
    apiSecret: "shared-limiter-test-secret",
    tradingMode: "live",
  })
  const first = new BitunixFuturesRestClient({
    config,
    fetchFn,
    rateLimitNow: () => clock,
    sleepFn: async (delay) => {
      delays.push(delay)
      clock += delay
    },
  })
  const second = new BitunixFuturesRestClient({
    config,
    fetchFn,
    rateLimitNow: () => 0,
    sleepFn: async () => {
      assert.fail("a same-key client must reuse the first client's shared limiter")
    },
  })

  await first.request({ method: "GET", path: "/api/v1/futures/market/time" })
  await second.request({ method: "GET", path: "/api/v1/futures/market/time" })

  assert.deepEqual(delays, [100], "the second client must wait on the shared limiter's schedule")
})

test("Bitunix Futures clients with different API keys have isolated rate limiters", async () => {
  let firstClock = 0
  let secondClock = 0
  const firstDelays = []
  const secondDelays = []
  const fetchFn = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ code: 0, data: {} }),
  })
  const first = new BitunixFuturesRestClient({
    config: new BitunixFuturesConfig({
      apiKey: "different-key-limiter-regression-a",
      apiSecret: "limiter-test-secret-a",
      tradingMode: "live",
    }),
    fetchFn,
    rateLimitNow: () => firstClock,
    sleepFn: async (delay) => {
      firstDelays.push(delay)
      firstClock += delay
    },
  })
  const second = new BitunixFuturesRestClient({
    config: new BitunixFuturesConfig({
      apiKey: "different-key-limiter-regression-b",
      apiSecret: "limiter-test-secret-b",
      tradingMode: "live",
    }),
    fetchFn,
    rateLimitNow: () => secondClock,
    sleepFn: async (delay) => {
      secondDelays.push(delay)
      secondClock += delay
    },
  })

  await first.request({ method: "GET", path: "/api/v1/futures/market/time" })
  await second.request({ method: "GET", path: "/api/v1/futures/market/time" })

  assert.deepEqual(firstDelays, [], "the first key must start without waiting")
  assert.deepEqual(secondDelays, [], "a different key must not inherit the first key's schedule")
})
