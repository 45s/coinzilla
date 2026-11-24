import assert from "node:assert/strict"
import test from "node:test"

import { BitunixFuturesConfig } from "../config/bitunix-futures-config.js"
import { BitunixFuturesRestClient } from "./rest-client.js"

function createConfig({ apiKey = "bitunix-rate-limit-test-key" } = {}) {
  return new BitunixFuturesConfig({
    apiKey,
    apiSecret: "bitunix-rate-limit-test-secret",
    tradingMode: "live",
  })
}

test("Bitunix Futures REST client serializes concurrent requests at a conservative 10 requests per second", async () => {
  let clock = 0
  const calls = []
  const delays = []
  const client = new BitunixFuturesRestClient({
    config: createConfig(),
    now: () => 1_700_000_000_000,
    rateLimitNow: () => clock,
    sleepFn: async (delay) => {
      delays.push(delay)
      clock += delay
    },
    fetchFn: async (...args) => {
      const [url] = args
      calls.push({
        url: String(url),
        time: clock,
      })
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          data: [],
        }),
      }
    },
  })

  await Promise.all([
    client.request({
      method: "GET",
      path: "/api/v1/futures/account",
      queryParams: {
        marginCoin: "USDT",
      },
    }),
    client.request({
      method: "GET",
      path: "/api/v1/futures/account",
      queryParams: {
        marginCoin: "USDT",
      },
    }),
    client.request({
      method: "GET",
      path: "/api/v1/futures/account",
      queryParams: {
        marginCoin: "USDT",
      },
    }),
  ])

  assert.deepEqual(calls.map(({ time }) => time), [0, 100, 200])
  assert.deepEqual(delays, [100, 100])
})


test("Bitunix Futures REST rate limiting is shared across clients using the same API key", async () => {
  let clock = 0
  const calls = []
  const firstConfig = createConfig({
    apiKey: "bitunix-rate-limit-shared-test-key",
  })
  const secondConfig = createConfig({
    apiKey: "bitunix-rate-limit-shared-test-key",
  })
  const dependencies = {
    config,
    now: () => 1_700_000_000_000,
    rateLimitNow: () => clock,
    sleepFn: async (delay) => {
      clock += delay
    },
    fetchFn: async (...args) => {
      calls.push(clock)
      const [url] = args
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          data: String(url),
        }),
      }
    },
  }
  const firstClient = new BitunixFuturesRestClient({
    ...dependencies,
    config: firstConfig,
  })
  const secondClient = new BitunixFuturesRestClient({
    ...dependencies,
    config: secondConfig,
  })

  await Promise.all([
    firstClient.request({
      method: "GET",
      path: "/api/v1/futures/account",
    }),
    secondClient.request({
      method: "GET",
      path: "/api/v1/futures/account",
    }),
  ])

  assert.deepEqual(calls, [0, 100])
})
