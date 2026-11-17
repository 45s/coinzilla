import assert from "node:assert/strict"
import test from "node:test"
import { SystemCustomError } from "@coinzilla/utils"
import { BitunixRestClient, BitunixRestError } from "./rest-client.js"

test("Bitunix REST client signs authenticated requests and unwraps successful data", async () => {
  let captured
  const client = new BitunixRestClient({
    apiKey: "api-key",
    apiSecret: "secret",
    now: () => 1700000000000,
    nonceFactory: () => "nonce",
    fetchFn: async (...args) => {
      const [url, options] = args
      captured = {
        url,
        options,
      }
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

  const result = await client.request({
    method: "GET",
    path: "/api/spot/v1/market/last_price",
    queryParams: { symbol: "BTCUSDT" },
  })

  assert.equal(captured.url, "https://openapi.bitunix.com/api/spot/v1/market/last_price?symbol=BTCUSDT")
  assert.equal(captured.options.headers["api-key"], "api-key")
  assert.equal(captured.options.headers.timestamp, "1700000000000")
  assert.equal(captured.options.headers.sign, "20fbd51d82ca634dfd00238d8e56ed67c355290378c465629cdf8c08530c9700")
  assert.ok(captured.options.signal instanceof AbortSignal)
  assert.equal(result.data, "10000.00")
})


test("Bitunix REST client sends explicitly public GET requests without authentication headers or signing", async () => {
  let captured
  const client = new BitunixRestClient({
    apiKey: "api-key",
    apiSecret: "secret",
    now: () => {
      throw new Error("public requests must not read the signing clock")
    },
    nonceFactory: () => {
      throw new Error("public requests must not create a nonce")
    },
    fetchFn: async (url, options) => {
      captured = { url, options }
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            code: "0",
            msg: "success",
            data: [],
          }
        },
      }
    },
  })

  const result = await client.request({
    method: "GET",
    path: "/api/spot/v1/common/rate/list",
    authenticated: false,
  })

  assert.equal(captured.url, "https://openapi.bitunix.com/api/spot/v1/common/rate/list")
  assert.equal(captured.options.method, "GET")
  assert.equal(captured.options.headers, undefined)
  assert.ok(captured.options.signal instanceof AbortSignal)
  assert.deepEqual(result.data, [])
})

test("Bitunix REST client rejects unauthenticated mutations before network I/O", async () => {
  let callCount = 0
  const client = new BitunixRestClient({
    apiKey: "api-key",
    apiSecret: "secret",
    fetchFn: async () => {
      callCount += 1
      throw new Error("must not send")
    },
  })

  await assert.rejects(client.request({
    method: "POST",
    path: "/api/spot/v1/order/place_order",
    authenticated: false,
    body: { symbol: "BTCUSDT" },
  }), /unauthenticated Bitunix requests must be read-only GET requests/i)

  await assert.rejects(client.request({
    method: "GET",
    path: "/api/spot/v1/market/last_price",
    authenticated: false,
    stateChanging: true,
  }), /unauthenticated Bitunix requests must be read-only GET requests/i)

  assert.equal(callCount, 0)
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

  const result = await client.request({
    method: "GET",
    path: "/api/spot/v1/user/account",
  })

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
    fetchFn: async (...args) => {
      const [, options] = args
      callCount += 1
      assert.equal(options.body, '{"symbol":"BTCUSDT","side":2}')
      throw new Error("socket closed")
    },
  })

  await assert.rejects(client.request({
    method: "POST",
    path: "/api/spot/v1/order/place_order",
    body: {
      symbol: "BTCUSDT",
      side: 2,
    },
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

  await assert.rejects(client.request({
    method: "GET",
    path: "/api/spot/v1/market/last_price",
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


test("Bitunix REST client preserves transport failure causes and classifies the boundary", async () => {
  const transportFailure = new Error("socket closed")
  const client = new BitunixRestClient({
    apiKey: "api-key",
    apiSecret: "secret",
    fetchFn: async () => {
      throw transportFailure
    },
  })

  await assert.rejects(client.request({
    method: "GET",
    path: "/api/spot/v1/market/last_price",
  }), (error) => {
    assert.ok(error instanceof BitunixRestError, "transport failures must use the Bitunix REST error contract")
    assert.ok(error instanceof SystemCustomError, "Bitunix REST errors must use the shared structured-error base")
    assert.equal(error.code, "BITUNIX_REST_TRANSPORT_FAILED", "transport failures must expose a stable broker-owned code")
    assert.deepEqual(error.context, {
      path: "/api/spot/v1/market/last_price",
      status: null,
      exchangeCode: null,
    }, "transport diagnostics must retain bounded, safe request context")
    assert.equal(error.kind, "transport", "network failures must remain distinguishable from HTTP and exchange rejections")
    assert.equal(error.cause, transportFailure, "the original transport failure must remain available as the native cause")
    return true
  })
})

test("Bitunix REST client classifies non-JSON HTTP failures without misreporting them as malformed success responses", async () => {
  const client = new BitunixRestClient({
    apiKey: "api-key",
    apiSecret: "secret",
    fetchFn: async () => ({
      ok: false,
      status: 502,
      async text() {
        return "upstream unavailable"
      },
    }),
  })

  await assert.rejects(client.request({
    method: "GET",
    path: "/api/spot/v1/market/last_price",
  }), (error) => {
    assert.ok(error instanceof BitunixRestError, "HTTP failures must use the Bitunix REST error contract")
    assert.ok(error instanceof SystemCustomError, "HTTP failures must use the shared structured-error base")
    assert.equal(error.code, "BITUNIX_REST_HTTP_FAILED", "HTTP failures must expose a stable broker-owned code")
    assert.equal(error.kind, "http", "a non-success HTTP status must take precedence over response-envelope parsing")
    assert.equal(error.status, 502, "the actual HTTP status must remain available for diagnosis")
    assert.ok(error.cause instanceof SyntaxError, "the failed JSON parse must remain available as the HTTP error cause")
    return true
  })
})

test("Bitunix REST client keeps exchange error codes opaque and classifies exchange-level failures", async () => {
  const unknownExchangeCode = "987654321"
  const client = new BitunixRestClient({
    apiKey: "api-key",
    apiSecret: "secret",
    fetchFn: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          code: unknownExchangeCode,
          msg: "unrecognized exchange rejection",
          data: null,
        }
      },
    }),
  })

  await assert.rejects(client.request({
    method: "GET",
    path: "/api/spot/v1/market/last_price",
  }), (error) => {
    assert.ok(error instanceof BitunixRestError, "exchange rejections must use the Bitunix REST error contract")
    assert.ok(error instanceof SystemCustomError, "exchange rejections must use the shared structured-error base")
    assert.equal(error.code, "BITUNIX_REST_EXCHANGE_REJECTED", "exchange rejections must expose a stable broker-owned code")
    assert.equal(error.exchangeCode, unknownExchangeCode, "undocumented exchange codes must remain separately available without guessed classifications")
    assert.equal(error.kind, "exchange", "a non-zero API code in an HTTP-success response must be classified as an exchange rejection")
    return true
  })
})

test("Bitunix REST client rejects malformed success-code types instead of coercing them to zero", async () => {
  const client = new BitunixRestClient({
    apiKey: "api-key",
    apiSecret: "secret",
    fetchFn: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          code: ["0"],
          msg: "success",
          data: [],
        }
      },
    }),
  })

  await assert.rejects(client.request({
    method: "GET",
    path: "/api/spot/v1/market/last_price",
  }), (error) => {
    assert.ok(error instanceof BitunixRestError, "malformed envelopes must use the Bitunix REST error contract")
    assert.ok(error instanceof SystemCustomError, "malformed responses must use the shared structured-error base")
    assert.equal(error.code, "BITUNIX_REST_RESPONSE_INVALID", "malformed responses must expose a stable broker-owned code")
    assert.equal(error.kind, "response", "a non-scalar API code must be classified as malformed response data")
    return true
  })
})

test("Bitunix REST client rejects success envelopes missing the documented message field", async () => {
  const client = new BitunixRestClient({
    apiKey: "api-key",
    apiSecret: "secret",
    fetchFn: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          code: 0,
          data: [],
        }
      },
    }),
  })

  await assert.rejects(client.request({
    method: "GET",
    path: "/api/spot/v1/market/last_price",
  }), (error) => {
    assert.ok(error instanceof BitunixRestError, "incomplete success envelopes must use the Bitunix REST error contract")
    assert.ok(error instanceof SystemCustomError, "incomplete success envelopes must use the shared structured-error base")
    assert.equal(error.code, "BITUNIX_REST_RESPONSE_INVALID", "incomplete success envelopes must expose a stable broker-owned code")
    assert.equal(error.kind, "response", "a missing documented message field must fail as a malformed response")
    return true
  })
})


test("Bitunix REST client rejects malformed HTTP status metadata without misclassifying it as an HTTP failure", async () => {
  const client = new BitunixRestClient({
    apiKey: "api-key",
    apiSecret: "secret",
    fetchFn: async () => ({
      ok: false,
      status: "502",
      async text() {
        return "upstream unavailable"
      },
    }),
  })

  await assert.rejects(client.request({
    method: "GET",
    path: "/api/spot/v1/market/last_price",
  }), (error) => {
    assert.ok(error instanceof BitunixRestError, "malformed HTTP metadata must use the Bitunix REST error contract")
    assert.ok(error instanceof SystemCustomError, "malformed HTTP metadata must use the shared structured-error base")
    assert.equal(error.kind, "response", "invalid status metadata must not be classified as a valid HTTP status failure")
    assert.equal(error.code, "BITUNIX_REST_RESPONSE_INVALID", "invalid status metadata must expose the response-validation code")
    assert.equal(error.status, null, "an invalid HTTP status must not be preserved as a numeric status")
    assert.ok(error.cause instanceof SyntaxError, "the attempted body parse failure must remain available as the cause")
    return true
  })
})
