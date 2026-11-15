import assert from "node:assert/strict"
import test from "node:test"
import { BitunixRestClient } from "./rest-client.js"

test("Bitunix REST client signs authenticated requests and unwraps successful data", async () => {
  let captured
  const client = new BitunixRestClient({
    apiKey: "api-key",
    apiSecret: "secret",
    now: () => 1700000000000,
    nonceFactory: () => "nonce",
    fetchFn: async (url, options) => {
      captured = { url,
        options }
      return {
        ok: true,
        status: 200,
        async json() {
          return { code: "0",
            msg: "success",
            data: "10000.00" }
        },
      }
    },
  })

  const result = await client.request("GET", "/api/spot/v1/market/last_price", {
    queryParams: { symbol: "BTCUSDT" },
  })

  assert.equal(captured.url, "https://openapi.bitunix.com/api/spot/v1/market/last_price?symbol=BTCUSDT")
  assert.equal(captured.options.headers["api-key"], "api-key")
  assert.equal(captured.options.headers.timestamp, "1700000000000")
  assert.equal(captured.options.headers.sign, "20fbd51d82ca634dfd00238d8e56ed67c355290378c465629cdf8c08530c9700")
  assert.ok(captured.options.signal instanceof AbortSignal)
  assert.equal(result.data, "10000.00")
})

test("Bitunix REST client preserves balance precision from JSON number tokens", async () => {
  const client = new BitunixRestClient({
    apiKey: "api-key",
    apiSecret: "secret",
    fetchFn: async () => ({
      ok: true,
      status: 200,
      async text() {
        return '{"code":0,"msg":"success","data":[{"coin":"BTC","balance":0.123456789012345678,"balanceLocked":0.000000000000000001}]}'
      },
    }),
  })

  const result = await client.request("GET", "/api/spot/v1/user/account")

  assert.equal(result.data[0].balance, "0.123456789012345678")
  assert.equal(result.data[0].balanceLocked, "0.000000000000000001")
})

test("Bitunix REST client signs compact POST bodies and does not retry state-changing requests", async () => {
  let callCount = 0
  const client = new BitunixRestClient({
    apiKey: "api-key",
    apiSecret: "secret",
    now: () => 1700000000000,
    nonceFactory: () => "nonce",
    fetchFn: async (_url, options) => {
      callCount += 1
      assert.equal(options.body, '{"symbol":"BTCUSDT","side":2}')
      throw new Error("socket closed")
    },
  })

  await assert.rejects(client.request("POST", "/api/spot/v1/order/place_order", {
    body: { symbol: "BTCUSDT",
      side: 2 },
    stateChanging: true,
  }), (error) => error.outcomeUnknown === true)
  assert.equal(callCount, 1)
})

test("Bitunix REST client rejects exchange errors and malformed responses", async () => {
  const client = new BitunixRestClient({
    apiKey: "api-key",
    apiSecret: "secret",
    fetchFn: async () => ({
      ok: true,
      status: 200,
      async json() {
        return { code: "1001",
          msg: "invalid symbol",
          data: null }
      },
    }),
  })

  await assert.rejects(client.request("GET", "/api/spot/v1/market/last_price", {
    queryParams: { symbol: "INVALID" },
  }), /invalid symbol/i)
})

test("Bitunix REST client validates request timeout", () => {
  assert.throws(() => new BitunixRestClient({
    apiKey: "key",
    apiSecret: "secret",
    requestTimeout: 0,
  }), /requestTimeout/i)
})
