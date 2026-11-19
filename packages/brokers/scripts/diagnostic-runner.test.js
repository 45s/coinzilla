import assert from "node:assert/strict"
import test from "node:test"
import {
  createObservedTransportFactory,
  runBitunixDiagnostics,
} from "./diagnostic-runner.js"

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
    async ping() {
      websocketCalls.push({
        method: "ping",
        args: {},
      })
      return "pong"
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

function createFakeOrderMethods({ websocketCalls }) {
  return {
    async getOpenOrders(args) {
      websocketCalls.push({
        method: "order.pending.list",
        args,
      })
      return [{
        orderId: "private-order-id",
        symbol: "BTCUSDT",
      }]
    },
    async getOrderHistory(args) {
      websocketCalls.push({
        method: "order.history.page",
        args,
      })
      return [{
        orderId: "private-history-order-id",
        symbol: "BTCUSDT",
      }]
    },
  }
}

function createFakeWebSocketClientFactory({ websocketCalls, options, clientCreations = [] }) {
  return (configuration) => {
    clientCreations.push(configuration)
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
      ...createFakeOrderMethods({ websocketCalls }),
    }
  }
}

function createFakeClients({ restCalls, websocketCalls, options = {}, clientCreations = [] }) {
  return {
    restClientFactory: createFakeRestClientFactory({
      restCalls,
      options,
    }),
    websocketClientFactory: createFakeWebSocketClientFactory({
      websocketCalls,
      options,
      clientCreations,
    }),
    clientCreations,
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
  const restKlineRequest = restCalls.find((request) => request.path.endsWith("/market/kline"))
  assert.equal(restKlineRequest.queryParams.interval, "1", "REST K-line requests must use the documented numeric interval")
  const websocketKlineArgs = websocketCalls.find((call) => call?.method === "market.kline").args
  assert.equal(websocketKlineArgs.symbol, "BTC", "WebSocket K-line requests must use the documented base-coin symbol")
  assert.equal(websocketKlineArgs.interval, "1", "WebSocket K-line requests must use the Spot RPC interval format")
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

  assert.equal(restCalls.length, 9, "A failed REST market request must not suppress any independent documented public or private read")
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
  assert.equal(events[2].error.message, "[error message withheld]", "Transport error text must never be persisted")
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


const expectedPublicRestRequests = [
  {
    path: "/api/spot/v1/common/coin_pair/list",
    authenticated: false,
    method: "GET",
    queryParams: {},
    body: undefined,
    stateChanging: false,
  },
  {
    path: "/api/spot/v1/market/last_price",
    authenticated: false,
    method: "GET",
    queryParams: {
      symbol: "BTCUSDT",
    },
    body: undefined,
    stateChanging: false,
  },
  {
    path: "/api/spot/v1/market/kline",
    authenticated: false,
    method: "GET",
    queryParams: {
      symbol: "BTCUSDT",
      interval: "1",
    },
    body: undefined,
    stateChanging: false,
  },
  {
    path: "/api/spot/v1/market/kline/history",
    authenticated: false,
    method: "GET",
    queryParams: {
      symbol: "BTCUSDT",
      interval: "1",
      limit: "1",
    },
    body: undefined,
    stateChanging: false,
  },
  {
    path: "/api/spot/v1/common/rate/list",
    authenticated: false,
    method: "GET",
    queryParams: {},
    body: undefined,
    stateChanging: false,
  },
  {
    path: "/api/spot/v1/common/coin/coin_network/list",
    authenticated: false,
    method: "GET",
    queryParams: {},
    body: undefined,
    stateChanging: false,
  },
]

function assertPublicRestCalls(restCalls) {
  const actualRequests = restCalls.map(({
    path,
    authenticated,
    method,
    queryParams,
    body,
    stateChanging,
  }) => ({
    path,
    authenticated,
    method,
    queryParams,
    body,
    stateChanging,
  }))
  assert.deepEqual(
    actualRequests,
    expectedPublicRestRequests,
    "public-only mode must issue the documented unsigned public REST reads and no private requests",
  )
}

function assertPublicOnlyReport(report) {
  assert.equal(report.summary.failed, 0, "missing optional credentials must not prevent the required public-only diagnostic checks")
  const configuration = report.results.find((entry) => entry.operation === "diagnostic configuration")
  assert.equal(configuration.response.credentialsConfigured, false, "the report must preserve public-only credential state")
  assert.deepEqual(
    configuration.response.missingCredentialVariables,
    ["BITUNIX_API_KEY", "BITUNIX_API_SECRET"],
    "the report must identify the exact credential variables required to enable private diagnostics",
  )
  assert.equal(
    report.results.find((entry) => entry.operation === "REST public order book depth").status,
    "skipped",
    "depth REST must be skipped when its required precision is not explicitly configured",
  )
  assert.equal(
    report.results.find((entry) => entry.operation === "REST private account balances").status,
    "skipped",
    "private REST account reads must be explicitly skipped when credentials are unavailable",
  )
  assert.equal(
    report.results.find((entry) => entry.operation === "REST private open orders").status,
    "skipped",
    "private open-order reads must be explicitly skipped when credentials are unavailable",
  )
  assert.equal(
    report.results.find((entry) => entry.operation === "WebSocket connection").status,
    "skipped",
    "authenticated WebSocket connection must be explicitly skipped without credentials",
  )
  assert.equal(
    report.results.find((entry) => entry.operation === "order.pending.list").status,
    "skipped",
    "private WebSocket order queries must be explicitly skipped without credentials",
  )
  assert.equal(
    report.results.filter((entry) => entry.operation.startsWith("user.")).every((entry) => entry.status === "skipped"),
    true,
    "all private WebSocket RPC operations must be individually marked skipped in public-only mode",
  )
}

function assertPublicOnlyDiagnostics({ report, restCalls }) {
  assertPublicRestCalls(restCalls)
  assertPublicOnlyReport(report)
}

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

  assertPublicOnlyDiagnostics({
    report,
    restCalls,
  })
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
  const configuration = report.results.find((entry) => entry.operation === "diagnostic configuration")
  assert.deepEqual(
    configuration.response.missingCredentialVariables,
    ["BITUNIX_API_SECRET"],
    "the report must identify the exact missing half of a partial credential pair",
  )
  assert.equal(restCalls.length, 6, "partial credentials must still allow every configured unsigned public REST check")
  assert.equal(JSON.stringify(report).includes("partial-api-key"), false, "a partial API key must never appear in the public-only diagnostic report")
})


test("diagnostics query and sanitize private WebSocket open orders and order history", async () => {
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
  const openOrdersCall = websocketCalls.find((entry) => entry?.method === "order.pending.list")
  const orderHistoryCall = websocketCalls.find((entry) => entry?.method === "order.history.page")

  assert.deepEqual(openOrdersCall.args, {
    symbol: "BTCUSDT",
  }, "private open-order RPC must be scoped to the configured symbol")
  assert.deepEqual(orderHistoryCall.args, {
    symbol: "BTCUSDT",
    page: 1,
    pageSize: 1,
  }, "private order-history RPC must be bounded to one small page")
  const openOrdersResult = report.results.find((entry) => entry.operation === "order.pending.list")
  const orderHistoryResult = report.results.find((entry) => entry.operation === "order.history.page")
  assert.equal(openOrdersResult.response.type, "array")
  assert.equal(openOrdersResult.response.itemCount, 1)
  assert.deepEqual(openOrdersResult.response.fields, ["orderId", "symbol"])
  assert.equal(orderHistoryResult.response.type, "array")
  assert.equal(orderHistoryResult.response.itemCount, 1)
  assert.deepEqual(orderHistoryResult.response.fields, ["orderId", "symbol"])
  assert.equal(JSON.stringify(report).includes("private-order-id"), false, "private order IDs must not be persisted in diagnostic reports")
  assert.equal(JSON.stringify(report).includes("private-history-order-id"), false, "private order-history IDs must not be persisted in diagnostic reports")
})

test("diagnostics reconnect the same authenticated client and do not claim subscription restoration", async () => {
  const restCalls = []
  const websocketCalls = []
  const clientCreations = []
  const factories = createFakeClients({
    restCalls,
    websocketCalls,
    clientCreations,
  })
  const report = await runBitunixDiagnostics({
    env: validEnvironment,
    ...factories,
  })

  assert.equal(
    clientCreations.length,
    1,
    "the reconnect probe must reuse the original WebSocket client instance instead of creating a second client",
  )
  assert.equal(
    websocketCalls.filter((entry) => entry === "connect").length,
    2,
    "the runner must make one explicit second connection after the initial RPC session closes",
  )
  assert.equal(
    websocketCalls.filter((entry) => entry === "disconnect").length,
    2,
    "the runner must cleanly close both the initial and reconnected sessions",
  )
  assert.equal(
    report.results.find((entry) => entry.operation === "ping").status,
    "passed",
    "the initial session must verify the documented authenticated ping RPC",
  )
  assert.equal(
    report.results.find((entry) => entry.operation === "WebSocket reconnect").status,
    "passed",
    "the second authenticated connection and ping must be reported independently",
  )
  assert.equal(
    report.results.find((entry) => entry.operation === "WebSocket subscription restoration").status,
    "skipped",
    "subscription restoration must be skipped because Bitunix documents one-shot RPC, not subscriptions",
  )
})


test("diagnostics query current open orders through the documented read-only POST endpoint", async () => {
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

  const openOrdersRequest = restCalls.find((request) => request.path === "/api/spot/v1/order/pending/list")
  assert.ok(openOrdersRequest, "the documented current-orders query must be included in authenticated REST diagnostics")
  assert.equal(openOrdersRequest.method, "POST", "the documented current-orders query uses POST")
  assert.deepEqual(openOrdersRequest.body, { symbol: "BTCUSDT" }, "the current-orders query must be scoped to the diagnostic symbol")
  assert.equal(openOrdersRequest.authenticated, true, "the current-orders query must use signed authentication")
  assert.equal(openOrdersRequest.stateChanging, false, "the current-orders POST is a read-only query, not an account-changing operation")
  assert.equal(report.results.find((entry) => entry.operation === "REST private open orders").status, "passed")
})


function createBrokerApiDiagnosticRestClientFactory({ calls, expectedApiKey, invalidSchema = false }) {
  return (configuration) => {
    assert.equal(configuration.apiKey, expectedApiKey, "the public Broker diagnostic must receive configured credentials without logging them")
    return {
      async request(request) {
        calls.push(request)
        return createBrokerApiDiagnosticResponse({
          request,
          invalidSchema,
        })
      },
    }
  }
}

function createBrokerApiDiagnosticResponse({ request, invalidSchema }) {
  if (request.path === "/api/spot/v1/common/coin_pair/list") {
    return {
      data: [{
        id: "1",
        base: "BTC",
        quote: "USDT",
        basePrecision: "8",
        quotePrecision: "8",
        minPrice: "0.0001",
        minVolume: "0.0001",
        ...(invalidSchema ? {} : { isOpen: "1" }),
        isHot: "0",
        isRecommend: "0",
        isShow: "1",
        tradeArea: "Spot",
        sort: "1",
        openTime: "2026-01-01T00:00:00Z",
        precisions: ["0.0001"],
        futureField: "must-not-be-persisted",
      }],
    }
  }
  if (request.path === "/api/spot/v1/market/last_price") {
    return { data: invalidSchema ? 123.45 : "123.4500" }
  }
  if (request.path === "/api/spot/v1/user/account") {
    return {
      data: [{
        coin: "BTC",
        balance: "987654.321",
        balanceLocked: "0",
      }],
    }
  }
  if (request.path === "/api/spot/v1/order/pending/list") {
    return { data: [] }
  }
  if (request.path === "/api/spot/v1/order/history/page") {
    return {
      data: {
        pageNum: 1,
        total: 0,
        data: [],
      },
    }
  }
  throw new Error(`Unexpected Broker API diagnostic request: ${request.path}`)
}

test("live diagnostics exercise Bitunix Spot reads through the public Broker API and report response schema drift", async () => {
  const rawRestCalls = []
  const websocketCalls = []
  const brokerApiCalls = []
  const factories = createFakeClients({
    restCalls: rawRestCalls,
    websocketCalls,
  })
  const report = await runBitunixDiagnostics({
    env: validEnvironment,
    ...factories,
    brokerApiRestClientFactory: createBrokerApiDiagnosticRestClientFactory({
      calls: brokerApiCalls,
      expectedApiKey: validEnvironment.BITUNIX_API_KEY,
    }),
  })

  assert.equal(report.results.find((entry) => entry.operation === "Broker API getExchangeMarkets").status, "passed", "the public Broker must normalize the exchange market catalog")
  assert.equal(report.results.find((entry) => entry.operation === "Broker API getPrices").status, "passed", "the public Broker must normalize one-shot prices")
  assert.equal(report.results.find((entry) => entry.operation === "Broker API getBalances").status, "passed", "the public Broker must normalize authenticated exact-decimal balances")
  assert.equal(report.results.find((entry) => entry.operation === "Broker API getOpenOrders").status, "passed", "the public Broker must exercise the authenticated open-order read")
  assert.equal(report.results.find((entry) => entry.operation === "Broker API getSymbolFilters").status, "passed", "the public Broker must validate raw symbol-filter metadata")
  assert.equal(report.results.find((entry) => entry.operation === "Broker API getOrderHistory").status, "passed", "the public Broker must exercise one authenticated symbol-scoped order-history page")
  assert.deepEqual(brokerApiCalls.map((request) => request.path), [
    "/api/spot/v1/common/coin_pair/list",
    "/api/spot/v1/market/last_price",
    "/api/spot/v1/common/coin_pair/list",
    "/api/spot/v1/user/account",
    "/api/spot/v1/order/pending/list",
    "/api/spot/v1/order/history/page",
  ], "the same public Broker instance must exercise the metadata, ticker, balance, open-order and history reads")
  assert.equal(brokerApiCalls[0].authenticated, false, "the market catalog must use unsigned public REST")
  assert.equal(brokerApiCalls[1].authenticated, false, "the public ticker must use unsigned REST")
  assert.equal(brokerApiCalls[2].authenticated, false, "symbol-filter metadata must use unsigned public REST")
  assert.equal(brokerApiCalls[3].authenticated ?? true, true, "account balances must use authenticated REST")
  assert.equal(brokerApiCalls[4].authenticated ?? true, true, "open orders must use authenticated REST")
  assert.equal(brokerApiCalls[5].authenticated ?? true, true, "order history must use authenticated REST")
  assert.deepEqual(report.results.find((entry) => entry.operation === "Broker API getOrderHistory").request.params, {
    symbol: "BTCUSDT",
    page: 1,
    limit: 10,
  }, "order history diagnostics must remain symbol-scoped and inspect only the first bounded page")
  assert.deepEqual(brokerApiCalls[5].body, {
    symbol: "BTCUSDT",
    page: 1,
    pageSize: 10,
  }, "the actual exchange request must carry the explicit symbol and bounded first-page parameters")
  assert.deepEqual(report.results.find((entry) => entry.operation === "Broker API getSymbolFilters").request.params, {
    symbol: "BTCUSDT",
  }, "symbol-filter diagnostics must inspect only the configured market")
  assert.equal(report.schemaObservations.at(-1).path, "/api/spot/v1/order/history/page", "the report must include order-history response-shape observations")
  assert.equal(report.schemaObservations.at(-1).schemaValid, true, "the order-history envelope must satisfy its documented page schema")
  assert.deepEqual(report.schemaObservations[0].unexpectedFields, ["futureField"], "unknown exchange fields must be reported without failing otherwise valid normalization")
  assert.equal(report.schemaObservations[0].schemaValid, true, "unknown fields alone must not fail the expected response schema")
  assert.equal(report.results.find((entry) => entry.operation === "Broker API schema getExchangeMarkets").status, "passed", "unknown additions must not fail the public Broker response schema check")
  assert.equal(report.schemaObservations[0].missingRequiredFields.length, 0, "the valid market fixture must satisfy required fields")
  assert.equal(JSON.stringify(report).includes("must-not-be-persisted"), false, "unknown response field values must never be persisted")
  assert.equal(JSON.stringify(report).includes("987654.321"), false, "private financial values must never be persisted")
  assert.equal(JSON.stringify(report).includes(validEnvironment.BITUNIX_API_SECRET), false, "diagnostic reports must never persist the API secret")
})


test("Broker diagnostics fail schema checks for missing required fields and unexpected scalar types", async () => {
  const brokerApiCalls = []
  const factories = createFakeClients({
    restCalls: [],
    websocketCalls: [],
  })
  const report = await runBitunixDiagnostics({
    env: validEnvironment,
    ...factories,
    brokerApiRestClientFactory: createBrokerApiDiagnosticRestClientFactory({
      calls: brokerApiCalls,
      expectedApiKey: validEnvironment.BITUNIX_API_KEY,
      invalidSchema: true,
    }),
  })

  assert.deepEqual(report.schemaObservations[0].missingRequiredFields, [{
    index: 0,
    fields: ["isOpen"],
  }], "the market response must expose missing required fields")
  assert.equal(report.schemaObservations[0].schemaValid, false, "missing required market fields must fail schema validation")
  assert.deepEqual(report.schemaObservations[1].unexpectedValueType, {
    expected: ["string"],
    actual: "number",
  }, "the latest-price response must be validated as a decimal string")
  assert.equal(report.schemaObservations[1].schemaValid, false, "unexpected scalar types must fail schema validation")
  assert.equal(report.results.find((entry) => entry.operation === "Broker API schema getExchangeMarkets").status, "failed", "the report must surface missing required fields as a failed check")
  assert.equal(report.results.find((entry) => entry.operation === "Broker API schema getPrices").status, "failed", "the report must surface unexpected response types as a failed check")
})

test("public-only Broker diagnostics never send the internal placeholder credential", async () => {
  const brokerApiCalls = []
  const report = await runBitunixDiagnostics({
    env: {},
    restClientFactory() {
      return {
        async request() {
          return { data: [] }
        },
      }
    },
    brokerApiRestClientFactory(configuration) {
      assert.equal(configuration.apiKey, "READ_ONLY_PUBLIC_DIAGNOSTIC", "the internal placeholder is only local config needed to construct the Bitunix Spot broker")
      assert.equal(configuration.apiSecret, "READ_ONLY_PUBLIC_DIAGNOSTIC", "the internal placeholder must never be used for signed public reads")
      return {
        async request(request) {
          brokerApiCalls.push(request)
          assert.equal(request.authenticated, false, "public Broker reads must explicitly disable authentication")
          if (request.path === "/api/spot/v1/common/coin_pair/list") {
            return createBrokerApiDiagnosticResponse({
              request,
              invalidSchema: false,
            })
          }
          if (request.path === "/api/spot/v1/market/last_price") {
            return { data: "123.4500" }
          }
          throw new Error(`Unexpected public-only Broker request: ${request.path}`)
        },
      }
    },
    websocketClientFactory() {
      throw new Error("private WebSocket diagnostics must not be constructed without credentials")
    },
  })

  assert.equal(report.summary.failed, 0, "public-only Broker diagnostics must complete without private credentials")
  assert.deepEqual(brokerApiCalls.map((request) => request.path), [
    "/api/spot/v1/common/coin_pair/list",
    "/api/spot/v1/market/last_price",
    "/api/spot/v1/common/coin_pair/list",
  ], "public-only mode must run public market metadata and skip all private Broker methods")
  assert.equal(JSON.stringify(report).includes("READ_ONLY_PUBLIC_DIAGNOSTIC"), false, "the internal placeholder credential must never be persisted")
})
