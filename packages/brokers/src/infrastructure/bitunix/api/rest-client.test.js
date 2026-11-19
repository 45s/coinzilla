import assert from "node:assert/strict"
import test from "node:test"
import { SystemCustomError } from "@coinzilla/utils"
import { BitunixRestClient, BitunixRestError } from "./rest-client.js"
import { createRestSignature } from "../auth/create-rest-signature.js"
import { createBitunixInt64JsonNumber } from "./json-serializer.js"

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
      retryAfterMs: null,
    }, "transport diagnostics must retain bounded, safe request context including the optional retry hint")
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

test("Bitunix REST client sends public GET requests without authentication headers or signing", async () => {
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

  assert.equal(
    captured.url,
    "https://openapi.bitunix.com/api/spot/v1/common/rate/list",
    "the public rate request must use the exact documented endpoint without query parameters",
  )
  assert.equal(captured.options.method, "GET", "the public rate endpoint must be requested with GET")
  assert.equal(captured.options.headers, undefined, "public requests must not include private API authentication headers")
  assert.ok(captured.options.signal instanceof AbortSignal, "public requests must retain the configured request timeout")
  assert.deepEqual(result.data, [], "an explicit empty public response must be returned without signing")
})

test("Bitunix REST client rejects unauthenticated mutations before network I/O", async () => {
  let callCount = 0
  const client = new BitunixRestClient({
    apiKey: "api-key",
    apiSecret: "secret",
    fetchFn: async () => {
      callCount += 1
      throw new Error("unauthenticated requests must not reach the exchange")
    },
  })

  await assert.rejects(
    client.request({
      method: "POST",
      path: "/api/spot/v1/order/place_order",
      authenticated: false,
      body: { symbol: "BTCUSDT" },
      stateChanging: true,
    }),
    /unauthenticated Bitunix requests must be read-only GET requests/i,
    "an unauthenticated order POST must be rejected before the network boundary",
  )

  await assert.rejects(
    client.request({
      method: "GET",
      path: "/api/spot/v1/market/last_price",
      authenticated: false,
      stateChanging: true,
    }),
    /state-changing requests must use POST/i,
    "a GET explicitly marked state-changing must be rejected before the network boundary",
  )

  assert.equal(callCount, 0, "no unauthenticated mutation may reach the exchange transport")
})


test("Bitunix REST client classifies HTTP 429 rate limits without retrying", async () => {
  let requestCount = 0
  const client = new BitunixRestClient({
    apiKey: "api-key",
    apiSecret: "secret",
    fetchFn: async () => {
      requestCount += 1
      return {
        ok: false,
        status: 429,
        async text() {
          return JSON.stringify({
            code: "429",
            msg: "too many requests",
          })
        },
      }
    },
  })

  await assert.rejects(client.request({
    method: "GET",
    path: "/api/spot/v1/common/coin_pair/list",
    authenticated: false,
  }), (error) => {
    assert.ok(error instanceof BitunixRestError, "HTTP rate limits must use the Bitunix REST error contract")
    assert.equal(error.code, "BITUNIX_REST_HTTP_FAILED", "HTTP rate limits must retain the stable HTTP failure code")
    assert.equal(error.kind, "http", "HTTP 429 must not be misclassified as an exchange-envelope rejection")
    assert.equal(error.status, 429, "the exact rate-limit status must remain available for diagnosis")
    return true
  })

  assert.equal(requestCount, 1, "a rate-limited public catalog request must not be retried implicitly")
})


test("Bitunix REST client supports unsigned public reads without configured credentials", async () => {
  let requestCount = 0
  const client = new BitunixRestClient({
    fetchFn: async (...args) => {
      const [url, options] = args
      requestCount += 1
      assert.equal(url, "https://openapi.bitunix.com/api/spot/v1/common/coin_pair/list", "credential-free diagnostics must call only the requested public endpoint")
      assert.equal(options.headers, undefined, "credential-free public requests must never construct authentication headers")
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
    path: "/api/spot/v1/common/coin_pair/list",
    authenticated: false,
  })

  assert.deepEqual(result.data, [], "an unsigned public response must be returned normally when credentials are absent")
  assert.equal(requestCount, 1, "one public diagnostic request must produce exactly one network call")
  await assert.rejects(
    client.request({
      method: "GET",
      path: "/api/spot/v1/user/account",
    }),
    (error) => {
      assert.ok(error instanceof BitunixRestError, "a signed read without credentials must use the broker-owned REST error contract")
      assert.equal(error.code, "BITUNIX_REST_AUTHENTICATION_REQUIRED", "missing signing credentials must have a stable broker-owned error code")
      assert.equal(error.kind, "authentication", "missing credentials must be classified separately from transport and exchange failures")
      return true
    },
    "private REST reads must fail before I/O when signing credentials are unavailable",
  )
  assert.equal(requestCount, 1, "a private request without credentials must be rejected before contacting Bitunix")
})


test("Bitunix REST client preserves int64 user UID tokens and nullable UIDs", async () => {
  const payloads = [
    '{"code":0,"msg":"success","data":{"uid":9223372036854775807}}',
    '{"code":0,"msg":"success","data":{"uid":null}}',
  ]
  const client = new BitunixRestClient({
    apiKey: "api-key",
    apiSecret: "secret",
    fetchFn: async () => ({
      ok: true,
      status: 200,
      async text() {
        return payloads.shift()
      },
    }),
  })

  const largeUid = await client.request({
    method: "GET",
    path: "/api/spot/v1/user/info",
  })
  const nullUid = await client.request({
    method: "GET",
    path: "/api/spot/v1/user/info",
  })

  assert.equal(largeUid.data.uid, "9223372036854775807", "an int64 UID must not be rounded by JavaScript Number parsing")
  assert.equal(nullUid.data.uid, null, "a documented null UID must remain null")
})


test("Bitunix REST client exposes Retry-After for HTTP 429 without automatic retry", async () => {
  let calls = 0
  const client = new BitunixRestClient({
    apiKey: "api-key",
    apiSecret: "secret",
    fetchFn: async () => {
      calls += 1
      return {
        ok: false,
        status: 429,
        headers: {
          get(name) {
            return name === "retry-after" ? "2" : null
          },
        },
        async text() {
          return JSON.stringify({
            code: 10001,
            msg: "Too many requests",
          })
        },
      }
    },
  })

  await assert.rejects(
    client.request({
      method: "POST",
      path: "/api/spot/v1/withdraw",
      body: {
        amount: "1",
      },
      stateChanging: true,
    }),
    (error) => {
      assert.ok(error instanceof BitunixRestError)
      assert.equal(error.kind, "http")
      assert.equal(error.status, 429)
      assert.equal(error.retryAfterMs, 2000)
      assert.equal(error.outcomeUnknown, false, "HTTP 429 confirms the state-changing request was rejected")
      return true
    },
  )
  assert.equal(calls, 1, "rate-limit responses must not be retried implicitly")
})

test("Bitunix REST client parses HTTP-date Retry-After and ignores malformed hints", async () => {
  const retryAfterDate = new Date(Date.now() + 5000).toUTCString()
  const retryValues = [retryAfterDate, "not-a-date"]
  const client = new BitunixRestClient({
    apiKey: "api-key",
    apiSecret: "secret",
    fetchFn: async () => ({
      ok: false,
      status: 429,
      headers: {
        get(name) {
          return name === "retry-after" ? retryValues.shift() : null
        },
      },
      async text() {
        return JSON.stringify({
          code: 10001,
          msg: "Too many requests",
        })
      },
    }),
  })

  await assert.rejects(
    client.request({
      method: "GET",
      path: "/api/spot/v1/user/account",
    }),
    (error) => {
      assert.ok(error instanceof BitunixRestError)
      assert.ok(error.retryAfterMs >= 0 && error.retryAfterMs <= 5000)
      return true
    },
  )
  await assert.rejects(
    client.request({
      method: "GET",
      path: "/api/spot/v1/user/account",
    }),
    (error) => {
      assert.ok(error instanceof BitunixRestError)
      assert.equal(error.retryAfterMs, null)
      return true
    },
  )
})


test("Bitunix REST client sends and signs exact int64 request numbers", async () => {
  const nonce = "nonce"
  const timestamp = 1_700_000_000_000
  let captured
  const client = new BitunixRestClient({
    apiKey: "api-key",
    apiSecret: "secret",
    now: () => timestamp,
    nonceFactory: () => nonce,
    fetchFn: async (...requestArguments) => {
      const [url, options] = requestArguments
      captured = {
        url,
        options,
      }
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            code: 0,
            msg: "success",
            data: "accepted",
          })
        },
      }
    },
  })

  const result = await client.request({
    method: "POST",
    path: "/api/spot/v1/inside_transfer",
    body: {
      toUid: createBitunixInt64JsonNumber({
        value: "9223372036854775807",
      }),
      amount: "1.000",
    },
    stateChanging: true,
  })

  assert.equal(result.data, "accepted")
  assert.equal(captured.options.body, '{"toUid":9223372036854775807,"amount":"1.000"}')
  assert.equal(
    captured.options.headers.sign,
    createRestSignature({
      nonce,
      timestamp: String(timestamp),
      apiKey: "api-key",
      secretKey: "secret",
      body: captured.options.body,
      bodyIsSerialized: true,
    }),
  )
})


test("Bitunix REST client requires explicit state-changing classification for every POST", async () => {
  let requestCount = 0
  const client = new BitunixRestClient({
    apiKey: "api-key",
    apiSecret: "secret",
    fetchFn: async () => {
      requestCount += 1
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            code: "0",
            msg: "success",
            data: {},
          }
        },
      }
    },
  })

  await assert.rejects(
    client.request({
      method: "POST",
      path: "/api/spot/v1/order/history/page",
      body: { symbol: "BTCUSDT" },
    }),
    /POST requests must explicitly set stateChanging/i,
    "a POST without an explicit read/mutation classification must fail before dispatch",
  )
  await assert.rejects(
    client.request({
      method: "POST",
      path: "/api/spot/v1/order/history/page",
      body: { symbol: "BTCUSDT" },
      stateChanging: "false",
    }),
    /stateChanging flag must be a boolean/i,
    "string booleans must not silently classify a request as read-only",
  )
  await assert.rejects(
    client.request({
      method: "GET",
      path: "/api/spot/v1/market/last_price",
      stateChanging: true,
    }),
    /state-changing requests must use POST/i,
    "state-changing GET requests must be rejected before dispatch",
  )

  assert.equal(requestCount, 0, "invalid request classifications must never reach the transport")
})

test("Bitunix REST client accepts explicitly classified read-only POST requests", async () => {
  let requestCount = 0
  const client = new BitunixRestClient({
    apiKey: "api-key",
    apiSecret: "secret",
    fetchFn: async () => {
      requestCount += 1
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
    method: "POST",
    path: "/api/spot/v1/order/pending/list",
    body: { symbol: "BTCUSDT" },
    stateChanging: false,
  })

  assert.deepEqual(result.data, [])
  assert.equal(requestCount, 1, "an explicitly read-only POST must still be dispatched once")
})



async function assertMalformedEnvelopeOutcome({ payload, stateChanging, name }) {
  const client = new BitunixRestClient({
    apiKey: "api-key",
    apiSecret: "secret",
    fetchFn: async () => ({
      ok: true,
      status: 200,
      async json() {
        return payload
      },
    }),
  })

  await assert.rejects(
    client.request({
      method: "POST",
      path: "/api/spot/v1/order/place_order",
      body: { symbol: "BTCUSDT" },
      stateChanging,
    }),
    (error) => {
      assert.ok(error instanceof BitunixRestError)
      assert.equal(error.kind, "response")
      assert.equal(
        error.outcomeUnknown,
        stateChanging,
        `${name} must preserve uncertainty only for mutations`,
      )
      return true
    },
  )
}

test("Bitunix REST malformed success envelopes preserve unknown mutation outcomes", async () => {
  const malformedPayloads = [
    {
      name: "non-object envelope",
      payload: null,
    },
    {
      name: "invalid exchange code",
      payload: {
        code: ["0"],
        msg: "success",
        data: [],
      },
    },
    {
      name: "missing message",
      payload: {
        code: "0",
        data: [],
      },
    },
  ]

  for (const { name, payload } of malformedPayloads) {
    for (const stateChanging of [false, true]) {
      await assertMalformedEnvelopeOutcome({ payload, stateChanging, name })
    }
  }
})

test("Bitunix REST explicit exchange rejections remain definitive for state-changing requests", async () => {
  const client = new BitunixRestClient({
    apiKey: "api-key",
    apiSecret: "secret",
    fetchFn: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          code: "10001",
          msg: "order rejected",
          data: null,
        }
      },
    }),
  })

  await assert.rejects(
    client.request({
      method: "POST",
      path: "/api/spot/v1/order/place_order",
      body: {
        symbol: "BTCUSDT",
      },
      stateChanging: true,
    }),
    (error) => {
      assert.equal(error.kind, "exchange")
      assert.equal(error.outcomeUnknown, false)
      assert.equal(error.exchangeCode, "10001")
      return true
    },
  )
})
