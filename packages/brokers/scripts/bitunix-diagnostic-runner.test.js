import assert from "node:assert/strict"
import test from "node:test"
import {
  createObservedTransportFactory,
  runBitunixDiagnostics,
} from "./bitunix-diagnostic-runner.js"

const validEnvironment = Object.freeze({
  BITUNIX_API_KEY: "diagnostic-api-key",
  BITUNIX_API_SECRET: "diagnostic-api-secret",
})

function createFakeRestClientFactory({ restCalls, options }) {
  return (configuration) => {
    assert.equal(configuration.apiKey, validEnvironment.BITUNIX_API_KEY, "The REST client must receive the configured API key without exposing it in reports")
    return {
      async request(request) {
        restCalls.push(request)
        if (options.restFailurePath === request.path) {
          throw Object.assign(new Error("simulated REST failure"), {
            code: "BITUNIX_REST_HTTP_FAILED",
            kind: "http",
            status: 503,
          })
        }
        const isAccountRequest = request.path.endsWith("/user/account")
        let data = [{ symbol: "BTCUSDT" }]
        if (isAccountRequest) {
          data = [{
            coin: "BTC",
            balance: "123",
          }]
        }
        return { data }
      },
    }
  }
}

function createFakeMarketMethods({ websocketCalls }) {
  return {
    async getLastPrice(args) {
      websocketCalls.push({
        method: "market.last_price",
        args,
      })
      return "123.45"
    },
    async getDepth(args) {
      websocketCalls.push({
        method: "market.depth",
        args,
      })
      return {
        bids: [],
        asks: [],
      }
    },
    async getKline(args) {
      websocketCalls.push({
        method: "market.kline",
        args,
      })
      return { close: "123.45" }
    },
  }
}

function createFakeCatalogMethods({ websocketCalls, options }) {
  return {
    async getTradingPairs() {
      websocketCalls.push("common.coin_pair.list")
      return [{ symbol: "BTCUSDT" }]
    },
    async getExchangeRates() {
      websocketCalls.push("common.rate.list")
      if (options.websocketFailureMethod === "common.rate.list") {
        throw new Error("simulated WebSocket RPC failure")
      }
      return []
    },
    async getTokenNetworks() {
      websocketCalls.push("common.coin.coin_network.list")
      return []
    },
  }
}

function createFakeAccountMethods({ websocketCalls }) {
  return {
    async getAccount() {
      websocketCalls.push("user.account")
      return [{
        coin: "BTC",
        balance: "123",
      }]
    },
    async getUserInfo() {
      websocketCalls.push("user.info")
      return { uid: 123 }
    },
  }
}

function createFakeWebSocketClientFactory({ websocketCalls, options }) {
  return (configuration) => {
    assert.equal(typeof configuration.transportFactory, "function", "The real WebSocket transport must be wrapped to capture sanitized input and output")
    return {
      state: "idle",
      async connect() {
        websocketCalls.push("connect")
        if (options.websocketConnectFailure) {
          throw new Error("simulated WebSocket connection failure")
        }
        this.state = "open"
      },
      async disconnect() {
        websocketCalls.push("disconnect")
        this.state = "closed"
      },
      ...createFakeMarketMethods({ websocketCalls }),
      ...createFakeCatalogMethods({
        websocketCalls,
        options,
      }),
      ...createFakeAccountMethods({ websocketCalls }),
    }
  }
}

function createFakeClients({ restCalls, websocketCalls, options = {} }) {
  return {
    restClientFactory: createFakeRestClientFactory({
      restCalls,
      options,
    }),
    websocketClientFactory: createFakeWebSocketClientFactory({
      websocketCalls,
      options,
    }),
  }
}

test("diagnostics use code defaults without diagnostic environment variables", async () => {
  const restCalls = []
  const websocketCalls = []
  const factories = createFakeClients({
    restCalls,
    websocketCalls,
  })
  const report = await runBitunixDiagnostics({
    env: validEnvironment,
    restClientFactory(configuration) {
      assert.equal(configuration.requestTimeout, 10_000, "The REST timeout must come from the diagnostic constants")
      return factories.restClientFactory(configuration)
    },
    websocketClientFactory(configuration) {
      assert.equal(configuration.requestTimeout, 10_000, "The WebSocket RPC timeout must come from the diagnostic constants")
      assert.equal(configuration.connectTimeout, 10_000, "The WebSocket connect timeout must come from the diagnostic constants")
      assert.equal(configuration.closeTimeout, 10_000, "The WebSocket close timeout must come from the diagnostic constants")
      return factories.websocketClientFactory(configuration)
    },
  })

  assert.equal(report.summary.failed, 0, "Credentials alone must be sufficient; diagnostic options must not require environment variables")
  assert.equal(report.runtime.symbol, "BTCUSDT", "The default diagnostic symbol must come from the diagnostic constants")
  assert.deepEqual(restCalls.find((request) => request.path.endsWith("/market/last_price")).queryParams, { symbol: "BTCUSDT" }, "REST market requests must use the constant symbol")
  assert.equal(websocketCalls.find((call) => call?.method === "market.last_price").args.symbol, "BTCUSDT", "WebSocket market requests must use the constant symbol")
  assert.equal(websocketCalls.find((call) => call?.method === "market.kline").args.interval, "1min", "K-line requests must use the constant interval")
  assert.equal(report.results.find((entry) => entry.operation === "REST public market catalog").response.type, "array", "Public response bodies must remain omitted by the constant default")
})

test("diagnostics continue after independent REST failures and always disconnect the WebSocket client", async () => {
  const restCalls = []
  const websocketCalls = []
  const factories = createFakeClients({
    restCalls,
    websocketCalls,
    options: {
      restFailurePath: "/api/spot/v1/market/last_price",
    },
  })
  const env = {
    ...validEnvironment,
    BITUNIX_DIAGNOSTICS_DEPTH_PRECISION: "0.01",
  }
  const report = await runBitunixDiagnostics({
    env,
    ...factories,
  })

  assert.equal(restCalls.length, 3, "A failed REST market request must not suppress the independent catalog and private-account checks")
  assert.equal(report.results.find((entry) => entry.operation === "REST public last price").status, "failed", "The failing REST endpoint must be reported independently")
  assert.equal(report.results.find((entry) => entry.operation === "REST private account balances").status, "passed", "Later REST checks must still run after an earlier endpoint failure")
  assert.equal(websocketCalls[0], "connect", "The WebSocket diagnostics must connect before issuing RPC calls")
  assert.equal(websocketCalls.at(-1), "disconnect", "The WebSocket client must always be disconnected after diagnostics")
  assert.equal(report.results.find((entry) => entry.operation === "user.account").response.fields.includes("balance"), true, "Private WebSocket results may expose field names but never balance values")
  assert.equal(JSON.stringify(report).includes("diagnostic-api-secret"), false, "Diagnostic reports must never contain the configured API secret")
})

test("diagnostics skip depth RPC when its required precision is not configured", async () => {
  const restCalls = []
  const websocketCalls = []
  const factories = createFakeClients({
    restCalls,
    websocketCalls,
  })
  const report = await runBitunixDiagnostics({
    env: validEnvironment,
    ...factories,
  })

  assert.equal(report.results.find((entry) => entry.operation === "market.depth").status, "skipped", "Depth RPC must be skipped rather than inventing undocumented precision semantics")
  assert.equal(websocketCalls.some((entry) => entry && entry.method === "market.depth"), false, "The exchange must not receive a depth request with an inferred precision")
  assert.equal(websocketCalls.at(-1), "disconnect", "The connection must still close when an optional RPC is skipped")
})

test("diagnostics report connection failure and skip all dependent RPC calls while cleaning up", async () => {
  const restCalls = []
  const websocketCalls = []
  const factories = createFakeClients({
    restCalls,
    websocketCalls,
    options: {
      websocketConnectFailure: true,
    },
  })
  const report = await runBitunixDiagnostics({
    env: validEnvironment,
    ...factories,
  })

  assert.equal(report.results.find((entry) => entry.operation === "WebSocket connection").status, "failed", "A failed WebSocket handshake must be distinguishable from RPC failures")
  assert.equal(report.results.filter((entry) => entry.operation === "market.last_price").length, 1, "Every skipped RPC must still receive an individual diagnostic result")
  assert.equal(report.results.find((entry) => entry.operation === "market.last_price").status, "skipped", "RPC calls must not be sent after a failed connection")
  assert.equal(websocketCalls.includes("disconnect"), true, "The client cleanup path must run even after a failed connection attempt")
})

function createFakeObservedTransportFactory({ handlers, sentMessages }) {
  return () => ({
    async connect() {},
    send(message) {
      sentMessages.push(message)
    },
    close() {},
    onMessage(listener) {
      handlers.message = listener
      return () => {}
    },
    onError(listener) {
      handlers.error = listener
      return () => {}
    },
    onClose(listener) {
      handlers.close = listener
      return () => {}
    },
  })
}

test("observed WebSocket transport captures sanitized request, response, errors and close events", () => {
  const handlers = {}
  const events = []
  const sentMessages = []
  const secrets = ["test-api-key", "test-api-secret"]
  const transportFactory = createObservedTransportFactory({
    events,
    secrets,
    includePublicPayloads: false,
    now: () => 1_800_000_000_000,
    transportFactory: createFakeObservedTransportFactory({
      handlers,
      sentMessages,
    }),
  })
  const transport = transportFactory({
    url: "wss://openapi.bitunix.com:443/ws-api/v1",
  })
  transport.onMessage(() => {})
  transport.onError(() => {})
  transport.onClose(() => {})
  const request = {
    id: "request-1",
    method: "user.account",
    params: {
      apiKey: "test-api-key",
      nonce: "nonce-value",
      sign: "signature-value",
    },
  }
  transport.send(JSON.stringify(request))
  handlers.message(JSON.stringify({
    id: "request-1",
    code: "0",
    msg: "success",
    data: [{
      coin: "BTC",
      balance: "123.45",
    }],
  }))
  handlers.error(new Error("transport failed with test-api-secret"))
  handlers.close({
    code: 1006,
    reason: "closed test-api-secret",
  })

  assert.equal(sentMessages.length, 1, "The observer must forward the exact outgoing request to the real transport")
  assert.equal(events[0].payload.params.apiKey, "[REDACTED]", "The captured WS input must redact API keys")
  assert.equal(events[0].payload.params.sign, "[REDACTED]", "The captured WS input must redact signatures")
  assert.equal(events[0].payload.params.nonce, "[REDACTED]", "The captured WS input must redact nonces")
  assert.equal(events[1].method, "user.account", "Responses must be correlated to the request method by request ID")
  assert.deepEqual(events[1].payload.data, {
    type: "array",
    itemCount: 1,
    fields: ["balance", "coin"],
  }, "Private WS responses must be summarized without account values")
  assert.equal(events[2].error.message, "transport failed with [REDACTED]", "Transport errors must be sanitized")
  assert.equal(events[3].close.code, 1006, "The WebSocket close code must remain available for diagnosing abnormal disconnects")
  assert.equal(events[3].close.reason, "closed [REDACTED]", "Close diagnostics must be sanitized")
  assert.equal(JSON.stringify(events).includes("123.45"), false, "Private account values must never enter the event report")
})

test("a failed WebSocket RPC does not suppress later independent RPC checks", async () => {
  const restCalls = []
  const websocketCalls = []
  const factories = createFakeClients({
    restCalls,
    websocketCalls,
    options: {
      websocketFailureMethod: "common.rate.list",
    },
  })
  const report = await runBitunixDiagnostics({
    env: validEnvironment,
    ...factories,
  })

  assert.equal(report.results.find((entry) => entry.operation === "common.rate.list").status, "failed", "The failing RPC must retain its own failure result")
  assert.equal(report.results.find((entry) => entry.operation === "user.info").status, "passed", "Later RPC checks must continue after one request fails")
  assert.equal(websocketCalls.at(-1), "disconnect", "The WebSocket session must still close after an RPC failure")
})


test("public-only diagnostics run unsigned REST checks when credentials are missing", async () => {
  const restCalls = []
  let websocketFactoryCalls = 0
  const report = await runBitunixDiagnostics({
    env: {},
    restClientFactory() {
      return {
        async request(request) {
          restCalls.push(request)
          return { data: [] }
        },
      }
    },
    websocketClientFactory() {
      websocketFactoryCalls += 1
      throw new Error("authenticated WebSocket client must not be constructed without credentials")
    },
  })

  assert.equal(report.summary.failed, 0, "missing optional credentials must not prevent the required public-only diagnostic checks")
  const configuration = report.results.find((entry) => entry.operation === "diagnostic configuration")
  assert.equal(configuration.response.credentialsConfigured, false, "the report must preserve public-only credential state")
  assert.deepEqual(
    configuration.response.missingCredentialVariables,
    ["BITUNIX_API_KEY", "BITUNIX_API_SECRET"],
    "the report must identify the exact credential variables required to enable private diagnostics",
  )
  assert.deepEqual(
    restCalls.map(({ path, authenticated, method }) => ({
      path,
      authenticated,
      method,
    })),
    [
      {
        path: "/api/spot/v1/common/coin_pair/list",
        authenticated: false,
        method: "GET",
      },
      {
        path: "/api/spot/v1/market/last_price",
        authenticated: false,
        method: "GET",
      },
    ],
    "public-only mode must issue only the unsigned catalog and last-price GET requests",
  )
  assert.equal(
    report.results.find((entry) => entry.operation === "REST private account balances").status,
    "skipped",
    "private REST account reads must be explicitly skipped when credentials are unavailable",
  )
  assert.equal(
    report.results.find((entry) => entry.operation === "WebSocket connection").status,
    "skipped",
    "authenticated WebSocket connection must be explicitly skipped without credentials",
  )
  assert.equal(
    report.results.filter((entry) => entry.operation.startsWith("user.")).every((entry) => entry.status === "skipped"),
    true,
    "all private WebSocket RPC operations must be individually marked skipped in public-only mode",
  )
  assert.equal(websocketFactoryCalls, 0, "public-only mode must not construct or connect an authenticated WebSocket client")
})

test("partial Bitunix credentials fall back to public-only diagnostics without exposing the supplied key", async () => {
  const restCalls = []
  const report = await runBitunixDiagnostics({
    env: {
      BITUNIX_API_KEY: "partial-api-key",
    },
    restClientFactory() {
      return {
        async request(request) {
          restCalls.push(request)
          return { data: [] }
        },
      }
    },
    websocketClientFactory() {
      throw new Error("private WebSocket checks must be skipped for partial credentials")
    },
  })

  assert.equal(report.summary.failed, 0, "a partial credential pair must degrade to public-only checks rather than aborting public diagnostics")
  assert.equal(restCalls.length, 2, "partial credentials must still allow both unsigned public REST checks")
  assert.equal(JSON.stringify(report).includes("partial-api-key"), false, "a partial API key must never appear in the public-only diagnostic report")
})
