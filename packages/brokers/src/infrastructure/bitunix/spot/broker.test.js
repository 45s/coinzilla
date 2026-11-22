import assert from "node:assert/strict"
import test from "node:test"
import { BitunixSpotBroker } from "./broker.js"
import { BitunixRestClient } from "./api/rest-client.js"
import { createRestSignature } from "./auth/create-rest-signature.js"
import { BrokerUnsupportedOperationError } from "../../../broker/errors/broker-unsupported-operation-error.js"


function createSuccessfulPlacementResponses() {
  return [
    {
      code: "0",
      msg: "success",
      data: {
        orderId: "12345678901234567890",
        symbol: "BTCUSDT",
        side: 2,
        type: 1,
        volume: "1.00",
        price: "100.00",
        placeStatus: "1",
      },
    },
    {
      code: "0",
      msg: "success",
      data: {
        orderId: "12345678901234567890",
        symbol: "BTCUSDT",
        side: "2",
        type: "1",
        status: "1",
        volume: "1.00",
        dealVolume: "0",
        price: "100.00",
        ctime: "2026-11-21T12:00:00Z",
        utime: "2026-11-21T12:00:00Z",
      },
    },
  ]
}

function createSignedPlacementTestBroker({ requests, responses, fetchFn, nonceFactory }) {
  return new BitunixSpotBroker({
    apiKey: "test-api-key",
    apiSecret: "test-api-secret",
    tradingMode: "live",
    allowLiveOrderMutations: true,
    dependencies: {
      restClientFactory: (config) => new BitunixRestClient({
        ...config,
        now: () => 1795262400000,
        nonceFactory: nonceFactory ?? (() => `test-nonce-${requests.length}`),
        fetchFn: async (...requestArgs) => {
          const [url, options] = requestArgs
          requests.push({
            url: new URL(url),
            options,
          })
          if (fetchFn) {
            return fetchFn(...requestArgs)
          }
          return new Response(JSON.stringify(responses.shift()), {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          })
        },
      }),
    },
  })
}

function createBroker({ responses = {}, allowLiveOrderMutations = true, reconcilerFactory, logger } = {}) {
  const calls = []
  const restClient = {
    async request(input = {}) {
      const { method, path, ...options } = input
      calls.push({
        method,
        path,
        options,
      })
      const key = path
      const configuredResponse = responses[key]
      if (configuredResponse instanceof Error) {
        throw configuredResponse
      }
      if (typeof configuredResponse === "function") {
        const value = await configuredResponse(input)
        if (value instanceof Error) {
          throw value
        }
        return { data: value }
      }
      return { data: configuredResponse }
    },
  }
  const broker = new BitunixSpotBroker({
    apiKey: "key",
    apiSecret: "secret",
    tradingMode: "live",
    allowLiveOrderMutations,
    logger,
    dependencies: {
      restClientFactory: () => restClient,
      ...(reconcilerFactory ? { reconcilerFactory } : {}),
    },
  })
  return { broker,
    calls }
}

test("Bitunix Spot broker loads canonical Spot markets", async () => {
  const { broker, calls } = createBroker({
    responses: {
      "/api/spot/v1/common/coin_pair/list": [
        { base: "BTC",
          quote: "USDT",
          isOpen: "1" },
        { base: "ETH",
          quote: "USDT",
          isOpen: "1" },
        { base: "OLD",
          quote: "USDT",
          isOpen: "0" },
      ],
    },
  })

  const result = await broker.getExchangeMarkets()

  assert.equal(result.ok, true)
  assert.deepEqual(result.data.map(({ venue, symbol }) => [venue, symbol]), [
    ["bitunix", "BTCUSDT"],
    ["bitunix", "ETHUSDT"],
  ])
  assert.equal(calls[0].method, "GET")
})

test("Bitunix Spot broker reads balances without inventing an account snapshot timestamp", async () => {
  const { broker, calls } = createBroker({
    responses: {
      "/api/spot/v1/user/account": [
        { coin: "USDT",
          balance: "12.3400",
          balanceLocked: "1.25" },
      ],
    },
  })

  const balances = await broker.getBalances()
  const snapshot = await broker.getAccountSnapshot()

  assert.equal(balances.ok, true)
  assert.equal(balances.data[0].free.amount, "12.34")
  assert.equal(balances.data[0].locked.amount, "1.25")
  assert.equal(snapshot.ok, false)
  assert.match(snapshot.errors[0].message, /source timestamp/i)
  assert.equal(calls.length, 1)
})

test("Bitunix Spot getOpenOrders() enumerates markets and preserves partial symbol failures", async () => {
  const { broker, calls } = createBroker({
    responses: {
      "/api/spot/v1/common/coin_pair/list": [
        {
          base: "BTC",
          quote: "USDT",
          isOpen: "1",
        },
        {
          base: "ETH",
          quote: "USDT",
          isOpen: "1",
        },
        {
          base: "OLD",
          quote: "USDT",
          isOpen: "0",
        },
      ],
      "/api/spot/v1/order/pending/list": async ({ body }) => {
        if (body.symbol === "ETHUSDT") {
          throw new Error("synthetic ETH pending failure")
        }
        return [{
          orderId: "1234567890123456789",
          symbol: "BTCUSDT",
          side: "2",
          type: "1",
          status: "1",
          volume: "0.5",
          dealVolume: "0",
          price: "100",
          ctime: "2026-11-22T00:00:00Z",
        }]
      },
    },
  })

  const openOrders = await broker.getOpenOrders()
  const history = await broker.getOrderHistory()

  assert.equal(openOrders.ok, false, "a partial market failure must remain visible")
  assert.equal(openOrders.data.length, 1, "successful symbols must still contribute their orders")
  assert.equal(openOrders.data[0].id, "1234567890123456789")
  assert.equal(openOrders.data[0].symbol, "BTCUSDT")
  assert.match(openOrders.errors[0].message, /synthetic ETH pending failure/)
  assert.equal(history.ok, false, "history remains symbol-scoped")
  assert.match(history.errors[0].message, /symbol/i)
  assert.deepEqual(calls.map(({ path, options }) => [
    path,
    options.body?.symbol ?? null,
  ]), [
    ["/api/spot/v1/common/coin_pair/list", null],
    ["/api/spot/v1/order/pending/list", "BTCUSDT"],
    ["/api/spot/v1/order/pending/list", "ETHUSDT"],
  ])
})

test("Bitunix Spot symbol-scoped order reads reject rows for a different symbol", async () => {
  const foreignOrder = {
    orderId: "foreign-order",
    symbol: "ETHUSDT",
    side: "2",
    type: "1",
    status: "1",
    volume: "0.5",
    dealVolume: "0",
    price: "10",
  }
  const { broker } = createBroker({
    responses: {
      "/api/spot/v1/order/pending/list": [foreignOrder],
      "/api/spot/v1/order/history/page": {
        total: 1,
        pageNum: "1",
        data: [foreignOrder],
      },
    },
  })

  const pending = await broker.getOpenOrders({ symbol: "BTCUSDT" })
  const history = await broker.getOrderHistory({ symbol: "BTCUSDT" })

  assert.equal(pending.ok, false, "pending-order rows must match the requested symbol")
  assert.equal(history.ok, false, "order-history rows must match the requested symbol")
  assert.match(pending.errors[0].message, /symbol.*does not match/i)
  assert.match(history.errors[0].message, /symbol.*does not match/i)
})

test("Bitunix Spot broker fetches pending orders for one symbol", async () => {
  const { broker, calls } = createBroker({
    responses: {
      "/api/spot/v1/order/pending/list": [],
    },
  })

  const result = await broker.getOpenOrders({ symbol: "BTCUSDT" })

  assert.equal(result.ok, true)
  assert.deepEqual(result.data, [])
  assert.deepEqual(calls[0].options.body, { symbol: "BTCUSDT" })
})

test("Bitunix Spot fill lookup stays unsupported until execution semantics are proven", async () => {
  const { broker, calls } = createBroker()

  const result = await broker.getFills({
    symbol: "BTCUSDT",
    orderId: "123",
  })

  assert.equal(result.ok, false, "unproven matching-order semantics cannot be exposed as canonical fills")
  assert.match(result.errors[0].message, /not supported safely.*quantity denomination.*execution completeness/i)
  assert.equal(calls.length, 0, "unsupported fill lookup must not issue partial or misleading reads")
})

test("Bitunix Spot live order mutations stay disabled by default and send no requests", async () => {
  const { broker, calls } = createBroker({
    allowLiveOrderMutations: false,
  })

  const created = await broker.createOrder({
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    quantity: "1",
    price: "100",
  })
  const cancelled = await broker.cancelOrder({
    symbol: "BTCUSDT",
    orderId: "123",
  })
  const cancelledAll = await broker.cancelAllOpenOrders({
    symbol: "BTCUSDT",
  })

  for (const result of [created, cancelled, cancelledAll]) {
    assert.equal(result.ok, false)
    assert.equal(result.mutationOutcome, "NOT_SENT")
    assert.match(result.errors[0].message, /disabled by default/i)
  }
  assert.equal(cancelled.cancellationOutcome, "NOT_SENT")
  assert.equal(cancelledAll.cancellationOutcome, "NOT_SENT")
  assert.equal(broker.capabilities.getStatus({ type: "PLACE_LIMIT_ORDER" }), "UNSUPPORTED")
  assert.equal(broker.capabilities.getStatus({ type: "CANCEL_ORDER" }), "UNSUPPORTED")
  assert.equal(calls.length, 0)
})

test("Bitunix Spot LIMIT placement sends base quantity as REST volume", async () => {
  const detail = {
    orderId: "123",
    symbol: "BTCUSDT",
    side: "2",
    type: "1",
    status: "1",
    volume: "1",
    dealVolume: "0",
    price: "100",
    ctime: "2026-11-15T12:00:00Z",
    utime: "2026-11-15T12:00:00Z",
  }
  const { broker, calls } = createBroker({
    responses: {
      "/api/spot/v1/order/place_order": {
        orderId: "123",
        symbol: "BTCUSDT",
        side: 2,
        type: 1,
        volume: "1",
        price: "100",
        placeStatus: "1",
      },
      "/api/spot/v1/order/detail": detail,
    },
  })

  const result = await broker.createOrder({
    symbol: "btcusdt",
    side: "BUY",
    type: "LIMIT",
    quantity: "1",
    price: "100",
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.id, "123")
  assert.equal(result.data.status, "OPEN")
  assert.equal(result.mutationOutcome, "CONFIRMED")
  assert.deepEqual(calls[0].options.body, {
    symbol: "BTCUSDT",
    side: 2,
    type: 1,
    volume: "1",
    price: "100",
  })
  assert.equal(calls[0].path, "/api/spot/v1/order/place_order")
  assert.equal(calls[0].options.stateChanging, true)
  assert.deepEqual(calls[1].options.queryParams, { orderId: "123" })
})

test("Bitunix Spot MARKET placement sends quoteQuantity as quote volume", async () => {
  const { broker, calls } = createBroker({
    responses: {
      "/api/spot/v1/order/place_order": {
        orderId: "124",
        symbol: "BTCUSDT",
        side: 2,
        type: 2,
        volume: "100",
        price: "0",
        placeStatus: "1",
      },
      "/api/spot/v1/order/detail": {
        orderId: "124",
        symbol: "BTCUSDT",
        side: "2",
        type: "2",
        status: "2",
        volume: "1",
        dealVolume: "1",
        price: "100",
        ctime: "2026-11-15T12:00:00Z",
        utime: "2026-11-15T12:00:01Z",
        avgPrice: "100",
      },
    },
  })

  const result = await broker.createOrder({
    symbol: "BTCUSDT",
    side: "BUY",
    type: "MARKET",
    quoteQuantity: "100",
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.status, "FILLED")
  assert.equal(result.data.originalQuantity, "1")
  assert.equal(result.mutationOutcome, "CONFIRMED")
  assert.deepEqual(calls[0].options.body, {
    symbol: "BTCUSDT",
    side: 2,
    type: 2,
    volume: "100",
    price: "0",
  })
})

test("Bitunix Spot MARKET placement rejects base quantity before dispatch", async () => {
  const { broker, calls } = createBroker()

  const result = await broker.createOrder({
    symbol: "BTCUSDT",
    side: "BUY",
    type: "MARKET",
    quantity: "0.01",
  })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.match(result.errors[0].message, /require[s]? quoteQuantity/i)
  assert.equal(calls.length, 0)
})

test("Bitunix Spot quote quantities in scientific notation are expanded before exact REST serialization", async () => {
  const { broker, calls } = createBroker({
    responses: {
      "/api/spot/v1/order/place_order": {
        orderId: "126",
        symbol: "BTCUSDT",
        side: 2,
        type: 2,
        volume: "0.00000001",
        price: "0",
        placeStatus: "1",
      },
      "/api/spot/v1/order/detail": {
        orderId: "126",
        symbol: "BTCUSDT",
        side: "2",
        type: "2",
        status: "1",
        volume: "0.00000001",
        dealVolume: "0",
        price: "100",
        ctime: "2026-11-15T12:00:00Z",
        utime: "2026-11-15T12:00:00Z",
        avgPrice: "100",
      },
    },
  })

  const result = await broker.createOrder({
    symbol: "BTCUSDT",
    side: "BUY",
    type: "MARKET",
    quoteQuantity: 1e-8,
  })

  assert.equal(result.ok, true)
  assert.equal(calls[0].options.body.volume, "0.00000001")
})

test("Bitunix Spot placement preserves synthetic numeric matching-engine rejection metadata", async () => {
  const { broker } = createBroker({
    responses: {
      "/api/spot/v1/order/place_order": {
        orderId: "127",
        symbol: "BTCUSDT",
        side: 2,
        type: 1,
        volume: "1",
        price: "100",
        placeStatus: "0",
        placeCode: 987654321,
        placeMsg: "synthetic insufficient-balance rejection",
      },
    },
  })

  const result = await broker.createOrder({
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    quantity: "1",
    price: "100",
  })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "REJECTED")
  assert.equal(result.errors[0].exchangeCode, "987654321")
  assert.equal(result.errors[0].code, "BITUNIX_REST_EXCHANGE_REJECTED")
  assert.equal(result.errors[0].message, "synthetic insufficient-balance rejection")
  assert.equal(result.errors[0].path, "/api/spot/v1/order/place_order")
})

test("Bitunix Spot placement rejects unsupported identity and order fields before dispatch", async () => {
  const { broker, calls } = createBroker()

  const withClientId = await broker.createOrder({
    symbol: "BTCUSDT",
    side: "BUY",
    quantity: "1",
    price: "100",
    clientOrderId: "caller-order-1",
  })
  const unsupportedType = await broker.createOrder({
    symbol: "BTCUSDT",
    side: "BUY",
    type: "STOP_LIMIT",
    quantity: "1",
    price: "100",
  })
  const missingType = await broker.createOrder({
    symbol: "BTCUSDT",
    side: "BUY",
    quantity: "1",
    price: "100",
  })

  assert.equal(withClientId.ok, false)
  assert.equal(withClientId.mutationOutcome, "NOT_SENT")
  assert.match(withClientId.errors[0].message, /does not accept a caller-supplied client order ID/i)
  assert.equal(unsupportedType.ok, false)
  assert.equal(unsupportedType.mutationOutcome, "NOT_SENT")
  assert.equal(missingType.ok, false)
  assert.equal(missingType.mutationOutcome, "NOT_SENT")
  assert.match(missingType.errors[0].message, /supports only LIMIT and MARKET orders/i)
  assert.equal(calls.length, 0)
})

test("Bitunix Spot placement reports unknown after a dispatched transport failure and never retries", async () => {
  const { broker } = createBroker()
  broker.restClient.request = async () => {
    throw Object.assign(new Error("placement response timeout"), {
      outcomeUnknown: true,
    })
  }

  const result = await broker.createOrder({
    symbol: "BTCUSDT",
    side: "BUY",
    type: "MARKET",
    quoteQuantity: "100",
  })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "OUTCOME_UNKNOWN")
  assert.match(result.errors[0].message, /placement response timeout/i)
})

test("Bitunix Spot placement reports confirmed acceptance if order-detail reconciliation fails", async () => {
  const { broker } = createBroker({
    responses: {
      "/api/spot/v1/order/place_order": {
        orderId: "125",
        symbol: "BTCUSDT",
        side: 2,
        type: 1,
        volume: "1",
        price: "100",
        placeStatus: "1",
      },
      "/api/spot/v1/order/detail": new Error("order detail unavailable"),
    },
  })

  const result = await broker.createOrder({
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    quantity: "1",
    price: "100",
  })

  assert.equal(result.ok, false)
  assert.equal(result.data.orderId, "125")
  assert.equal(result.mutationOutcome, "CONFIRMED")
  assert.match(result.errors[0].message, /order detail unavailable/i)
})

test("Bitunix Spot createOrder classifies non-JSON HTTP failures through the real REST client", async () => {
  const scenarios = [
    {
      status: 400,
      mutationOutcome: "REJECTED",
    },
    {
      status: 408,
      mutationOutcome: "OUTCOME_UNKNOWN",
    },
    {
      status: 409,
      mutationOutcome: "OUTCOME_UNKNOWN",
    },
    {
      status: 429,
      mutationOutcome: "REJECTED",
    },
    {
      status: 500,
      mutationOutcome: "OUTCOME_UNKNOWN",
    },
    {
      status: 502,
      mutationOutcome: "OUTCOME_UNKNOWN",
    },
  ]

  for (const scenario of scenarios) {
    const requests = []
    const broker = createSignedPlacementTestBroker({
      requests,
      responses: [],
      fetchFn: async () => new Response("Bitunix HTTP gateway failure", {
        status: scenario.status,
        headers: { "content-type": "text/plain" },
      }),
    })

    const result = await broker.createOrder({
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      quantity: "1",
      price: "100",
    })

    assert.equal(result.ok, false)
    assert.equal(result.mutationOutcome, scenario.mutationOutcome, `HTTP ${scenario.status} must have the correct order outcome`)
    assert.equal(result.errors[0].kind, "http")
    assert.equal(result.errors[0].status, scenario.status)
    assert.equal(requests.length, 1, `HTTP ${scenario.status} must produce exactly one placement request`)
    assert.equal(requests[0].url.pathname, "/api/spot/v1/order/place_order")
    assert.equal(requests[0].options.method, "POST")
  }
})

async function assertCreateOrderLifecycleScenario({
  name,
  mutationOutcome,
  expectedRequests,
  expectedPosts,
  expectedGets,
  responses = [],
  fetchFn,
  nonceFactory,
}) {
  const requests = []
  const broker = createSignedPlacementTestBroker({
    requests,
    responses,
    fetchFn,
    nonceFactory,
  })
  const result = await broker.createOrder({
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    quantity: "1",
    price: "100",
  })

  assert.equal(result.mutationOutcome, mutationOutcome, name)
  assert.equal(requests.length, expectedRequests, `${name}: exact transport-call count`)
  assert.equal(
    requests.filter(({ options }) => options.method === "POST").length,
    expectedPosts,
    `${name}: no duplicate placement POST`,
  )
  assert.equal(
    requests.filter(({ options }) => options.method === "GET").length,
    expectedGets,
    `${name}: only the expected detail reconciliation GET`,
  )
  assert.equal(result.ok, false, `${name}: incomplete or rejected placement must not report a completed Order`)
  return {
    result,
    requests,
  }
}

test("Bitunix Spot createOrder classifies unknown top-level exchange rejections", async () => {
  await assertCreateOrderLifecycleScenario({
    name: "unknown top-level exchange rejection",
    mutationOutcome: "REJECTED",
    expectedRequests: 1,
    expectedPosts: 1,
    expectedGets: 0,
    responses: [
      {
        code: "987654321",
        msg: "synthetic exchange rejection",
        data: null,
      },
    ],
  })
})

test("Bitunix Spot createOrder classifies matching-engine placement rejections", async () => {
  await assertCreateOrderLifecycleScenario({
    name: "matching-engine placement rejection",
    mutationOutcome: "REJECTED",
    expectedRequests: 1,
    expectedPosts: 1,
    expectedGets: 0,
    responses: [
      {
        code: "0",
        msg: "success",
        data: {
          placeStatus: "0",
          placeCode: "opaque-test-code",
          placeMsg: "synthetic matching-engine rejection",
        },
      },
    ],
  })
})

test("Bitunix Spot createOrder keeps conflicting placement status and placeCode unknown", async () => {
  const { result, requests } = await assertCreateOrderLifecycleScenario({
    name: "conflicting successful placement status and non-zero matching-engine code",
    mutationOutcome: "OUTCOME_UNKNOWN",
    expectedRequests: 1,
    expectedPosts: 1,
    expectedGets: 0,
    responses: [
      {
        code: "0",
        msg: "success",
        data: {
          orderId: "12345678901234567890",
          symbol: "BTCUSDT",
          side: 2,
          type: 1,
          volume: "1",
          price: "100",
          placeStatus: "1",
          placeCode: "opaque-engine-rejection",
          placeMsg: "synthetic matching-engine rejection",
        },
      },
    ],
  })

  assert.equal(result.errors[0].kind, "response", "conflicting exchange acknowledgement fields must remain an ambiguous response")
  assert.equal(result.errors[0].exchangeCode, "opaque-engine-rejection", "createOrder must preserve the non-zero matching-engine code")
  assert.match(result.errors[0].message, /synthetic matching-engine rejection/, "createOrder must preserve the matching-engine message")
  assert.equal(requests[0].url.pathname, "/api/spot/v1/order/place_order", "the rejection must come from the single placement request")
})

test("Bitunix Spot createOrder keeps malformed placeCode unknown after dispatch", async () => {
  const { result, requests } = await assertCreateOrderLifecycleScenario({
    name: "malformed matching-engine placement code",
    mutationOutcome: "OUTCOME_UNKNOWN",
    expectedRequests: 1,
    expectedPosts: 1,
    expectedGets: 0,
    responses: [
      {
        code: "0",
        msg: "success",
        data: {
          orderId: "12345678901234567890",
          symbol: "BTCUSDT",
          side: 2,
          type: 1,
          volume: "1",
          price: "100",
          placeStatus: "1",
          placeCode: {},
          placeMsg: "synthetic malformed matching-engine code",
        },
      },
    ],
  })

  assert.equal(result.errors[0].kind, "response", "malformed placement metadata must remain a response error")
  assert.equal(result.errors[0].outcomeUnknown, true, "a malformed code after dispatch must not be treated as a rejection")
  assert.equal(requests[0].url.pathname, "/api/spot/v1/order/place_order", "the ambiguous result must follow the single placement POST")
})

test("Bitunix Spot createOrder keeps malformed success envelopes unknown", async () => {
  await assertCreateOrderLifecycleScenario({
    name: "malformed success envelope",
    mutationOutcome: "OUTCOME_UNKNOWN",
    expectedRequests: 1,
    expectedPosts: 1,
    expectedGets: 0,
    fetchFn: async () => new Response(JSON.stringify({
      code: "0",
      data: null,
    }), {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    }),
  })
})

test("Bitunix Spot createOrder keeps mismatched placement acknowledgements unknown", async () => {
  const [acceptedPlacement] = createSuccessfulPlacementResponses()
  await assertCreateOrderLifecycleScenario({
    name: "mismatched placement acknowledgement",
    mutationOutcome: "OUTCOME_UNKNOWN",
    expectedRequests: 1,
    expectedPosts: 1,
    expectedGets: 0,
    responses: [
      {
        ...acceptedPlacement,
        data: {
          ...acceptedPlacement.data,
          symbol: "ETHUSDT",
        },
      },
    ],
  })
})

test("Bitunix Spot createOrder preserves confirmed acceptance when detail reconciliation fails", async () => {
  const [acceptedPlacement] = createSuccessfulPlacementResponses()
  const { result } = await assertCreateOrderLifecycleScenario({
    name: "accepted placement with failed detail reconciliation",
    mutationOutcome: "CONFIRMED",
    expectedRequests: 2,
    expectedPosts: 1,
    expectedGets: 1,
    fetchFn: async (url) => {
      if (new URL(url).pathname === "/api/spot/v1/order/place_order") {
        return new Response(JSON.stringify(acceptedPlacement), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        })
      }
      return new Response("detail temporarily unavailable", {
        status: 503,
        headers: {
          "content-type": "text/plain",
        },
      })
    },
  })
  assert.equal(result.data.orderId, "12345678901234567890")
})

test("Bitunix Spot createOrder keeps transport loss after dispatch unknown", async () => {
  await assertCreateOrderLifecycleScenario({
    name: "transport loss after placement dispatch",
    mutationOutcome: "OUTCOME_UNKNOWN",
    expectedRequests: 1,
    expectedPosts: 1,
    expectedGets: 0,
    fetchFn: async () => {
      throw new Error("synthetic connection reset")
    },
  })
})

test("Bitunix Spot createOrder classifies local signing failures as not sent", async () => {
  await assertCreateOrderLifecycleScenario({
    name: "local signing failure before placement dispatch",
    mutationOutcome: "NOT_SENT",
    expectedRequests: 0,
    expectedPosts: 0,
    expectedGets: 0,
    nonceFactory: () => "",
  })
})

test("Bitunix Spot canonical placement remains unsupported because client order identity is absent", async () => {
  const { broker, calls } = createBroker()
  const result = await broker.createCanonicalOrder({
    symbol: "BTCUSDT",
    clientOrderId: "caller-order-1",
  })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.match(result.errors[0].message, /clientOrderId/i)
  assert.equal(calls.length, 0)
})

test("Bitunix Spot cancels a known order and verifies its terminal exchange status", async () => {
  const cancelledOrder = {
    orderId: "123",
    symbol: "BTCUSDT",
    side: "2",
    type: "1",
    status: "4",
    volume: "1",
    dealVolume: "0.25",
    price: "10",
    ctime: "2026-11-15T12:00:00Z",
    utime: "2026-11-15T12:01:00Z",
  }
  const { broker, calls } = createBroker({
    responses: {
      "/api/spot/v1/order/cancel": null,
      "/api/spot/v1/order/detail": cancelledOrder,
    },
  })

  const result = await broker.cancelOrder({
    symbol: "btcusdt",
    orderId: "123",
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.status, "CANCELED")
  assert.equal(result.data.executedQuantity, "0.25")
  assert.equal(result.cancellationOutcome, "CONFIRMED")
  assert.equal(result.mutationOutcome, "CONFIRMED")
  assert.deepEqual(calls[0], {
    method: "POST",
    path: "/api/spot/v1/order/cancel",
    options: {
      body: {
        orderIdList: [{
          orderId: "123",
          symbol: "BTCUSDT",
        }],
      },
      authenticated: true,
      stateChanging: true,
    },
  })
  assert.equal(calls[1].method, "GET")
  assert.equal(calls[1].path, "/api/spot/v1/order/detail")
  assert.deepEqual(calls[1].options.queryParams, { orderId: "123" })
})

test("Bitunix Spot cancellation reports unknown when the order remains open after acknowledgement", async () => {
  const openOrder = {
    orderId: "123",
    symbol: "BTCUSDT",
    side: "2",
    type: "1",
    status: "1",
    volume: "1",
    dealVolume: "0",
    price: "10",
    ctime: "2026-11-15T12:00:00Z",
    utime: "2026-11-15T12:01:00Z",
  }
  const { broker } = createBroker({
    responses: {
      "/api/spot/v1/order/cancel": null,
      "/api/spot/v1/order/detail": openOrder,
    },
  })

  const result = await broker.cancelOrder({
    symbol: "BTCUSDT",
    orderId: "123",
  })

  assert.equal(result.ok, false)
  assert.equal(result.data.status, "OPEN")
  assert.equal(result.mutationOutcome, "CONFIRMED")
  assert.equal(result.cancellationOutcome, "OUTCOME_UNKNOWN")
  assert.match(result.errors[0].message, /reconcile order 123/i)
})

test("Bitunix Spot cancellation reports an exchange rejection after dispatch without claiming NOT_SENT", async () => {
  const { broker, calls } = createBroker()
  broker.restClient.request = async (input) => {
    calls.push({
      method: input.method,
      path: input.path,
      options: {
        ...(input.body === undefined ? {} : { body: input.body }),
        authenticated: input.authenticated,
        stateChanging: input.stateChanging,
      },
    })
    if (input.path === "/api/spot/v1/order/cancel") {
      throw Object.assign(new Error("exchange rejected cancellation"), {
        kind: "exchange",
      })
    }
    throw new Error("unexpected request")
  }

  const result = await broker.cancelOrder({
    symbol: "BTCUSDT",
    orderId: "123",
  })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "REJECTED")
  assert.equal(result.cancellationOutcome, "OUTCOME_UNKNOWN")
  assert.equal(calls.length, 1)
})

test("Bitunix Spot cancellation preserves acknowledged mutation when detail verification fails", async () => {
  const { broker } = createBroker({
    responses: {
      "/api/spot/v1/order/cancel": null,
      "/api/spot/v1/order/detail": new Error("detail endpoint unavailable"),
    },
  })

  const result = await broker.cancelOrder({
    symbol: "BTCUSDT",
    orderId: "123",
  })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "CONFIRMED")
  assert.equal(result.cancellationOutcome, "OUTCOME_UNKNOWN")
  assert.match(result.errors[0].message, /detail endpoint unavailable/i)
})

test("Bitunix Spot cancellation validates identity before sending a mutation", async () => {
  const { broker, calls } = createBroker()

  const result = await broker.cancelOrder({ symbol: "BTCUSDT" })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.equal(result.cancellationOutcome, "NOT_SENT")
  assert.equal(calls.length, 0)
})

test("Bitunix Spot cancelAllOpenOrders cancels and verifies every open order for one symbol", async () => {
  const order = (orderId) => ({
    orderId,
    symbol: "BTCUSDT",
    side: "2",
    type: "1",
    status: "1",
    volume: "1",
    dealVolume: "0",
    price: "10",
    ctime: "2026-11-15T12:00:00Z",
    utime: "2026-11-15T12:00:01Z",
  })
  const cancelled = (orderId) => ({
    ...order(orderId),
    status: "4",
    utime: "2026-11-15T12:01:00Z",
  })
  const { broker, calls } = createBroker({
    responses: {
      "/api/spot/v1/order/pending/list": [order("101"), order("102")],
      "/api/spot/v1/order/cancel": null,
      "/api/spot/v1/order/detail": cancelled("102"),
    },
  })
  let detailReads = 0
  const originalRequest = broker.restClient.request.bind(broker.restClient)
  broker.restClient.request = async (input) => {
    if (input.path === "/api/spot/v1/order/detail") {
      detailReads += 1
      return { data: cancelled(detailReads === 1 ? "101" : "102") }
    }
    return originalRequest(input)
  }

  const result = await broker.cancelAllOpenOrders({ symbol: "btcusdt" })

  assert.equal(result.ok, true)
  assert.equal(result.data.length, 2)
  assert.deepEqual(result.data.map((item) => item.status), ["CANCELED", "CANCELED"])
  assert.equal(result.mutationOutcome, "CONFIRMED")
  assert.equal(result.cancellationOutcome, "CONFIRMED")
  assert.equal(calls.filter((call) => call.path === "/api/spot/v1/order/cancel").length, 2)
})

test("Bitunix Spot cancelAllOpenOrders requires a symbol and sends no request", async () => {
  const { broker, calls } = createBroker()

  const result = await broker.cancelAllOpenOrders()

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.equal(result.cancellationOutcome, "NOT_SENT")
  assert.equal(calls.length, 0)
})


test("Bitunix Spot broker exposes symbol metadata, price, order detail and history reads", async () => {
  const order = {
    orderId: "123",
    symbol: "BTCUSDT",
    side: "2",
    type: "1",
    status: "2",
    volume: "0.5",
    dealVolume: "0.5",
    price: "10",
    ctime: "2026-11-15T12:00:00Z",
    utime: "2026-11-15T12:00:01Z",
  }
  const { broker, calls } = createBroker({
    responses: {
      "/api/spot/v1/common/coin_pair/list": [
        { base: "BTC",
          quote: "USDT",
          basePrecision: 8,
          isOpen: "1" },
      ],
      "/api/spot/v1/market/last_price": "10.25",
      "/api/spot/v1/order/detail": order,
      "/api/spot/v1/order/history/page": { data: [order],
        total: 1,
        pageNum: "1" },
    },
  })

  const metadata = await broker.getSymbolFilters({ symbol: "btcusdt" })
  const price = await broker.getPrice({ symbol: "btcusdt" })
  const detail = await broker.getOrder({ symbol: "BTCUSDT",
    orderId: "123" })
  const history = await broker.getOrderHistory({ symbol: "BTCUSDT",
    limit: 25 })

  assert.equal(metadata.data.basePrecision, 8)
  assert.equal(metadata.data.symbol, "BTCUSDT")
  assert.equal(price.data.symbol, "BTCUSDT")
  assert.equal(price.data.price, "10.25")
  assert.equal(detail.data.id, "123")
  assert.equal(history.data.length, 1)
  assert.equal(history.data[0].id, "123")
  assert.deepEqual(calls[3].options.body, { symbol: "BTCUSDT",
    page: 1,
    pageSize: 25 })
})

test("Bitunix Spot broker validates order history query boundaries", async () => {
  const { broker, calls } = createBroker()

  const missingSymbol = await broker.getOrderHistory()
  const exactOrderId = await broker.getOrderHistory({ symbol: "BTCUSDT",
    orderId: "123" })
  const invalidLimit = await broker.getOrderHistory({ symbol: "BTCUSDT",
    limit: 0 })
  const invalidRange = await broker.getOrderHistory({
    symbol: "BTCUSDT",
    startTime: 20,
    endTime: 10,
  })

  assert.equal(missingSymbol.ok, false)
  assert.equal(exactOrderId.ok, false)
  assert.equal(invalidLimit.ok, false)
  assert.equal(invalidRange.ok, false)
  assert.equal(calls.length, 0)
})

test("Bitunix Spot broker keeps lifecycle and unsupported read capabilities explicit", async () => {
  const { broker, calls } = createBroker()

  await broker.connect()
  assert.equal(broker.connected, true)
  await broker.disconnect()
  assert.equal(broker.connected, false)

  const unsupportedResults = await Promise.all([
    broker.getMyTrades(),
    broker.getCanonicalOrder(),
    broker.getCanonicalOrderHistory(),
    broker.getServerTime(),
    broker.getCandles(),
  ])
  for (const result of unsupportedResults) {
    assert.equal(result.ok, false)
  }
  const unsupportedSubscriptions = await Promise.all([
    broker.subscribeForBookTicker(),
    broker.subscribeForCandles(),
    broker.subscribeForPrices(),
  ])
  for (const result of unsupportedSubscriptions) {
    assert.equal(result.ok, false)
    assert.ok(result.errors[0] instanceof BrokerUnsupportedOperationError)
    assert.equal(result.errors[0].code, "BROKER_OPERATION_UNSUPPORTED")
    assert.equal(result.errors[0].retryable, false)
  }
  assert.equal(calls.length, 0)
})

test("Bitunix Spot broker rejects order detail identity mismatches", async () => {
  const { broker } = createBroker({
    responses: {
      "/api/spot/v1/order/detail": {
        orderId: "different",
        symbol: "BTCUSDT",
        side: "2",
        type: "1",
        status: "2",
        volume: "1",
        dealVolume: "1",
        price: "10",
      },
    },
  })

  const result = await broker.getOrder({ symbol: "BTCUSDT",
    orderId: "123" })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /identity/i)
})


test("Bitunix Spot broker normalizes a single pending-order response row", async () => {
  const { broker } = createBroker({
    responses: {
      "/api/spot/v1/order/pending/list": {
        orderId: "123",
        symbol: "BTCUSDT",
        side: "2",
        type: "1",
        status: "1",
        volume: "1",
        dealVolume: "0",
        price: "10",
        ctime: "2026-11-15T12:00:00Z",
        utime: "2026-11-15T12:00:01Z",
      },
    },
  })

  const result = await broker.getOpenOrders({ symbol: "BTCUSDT" })

  assert.equal(result.ok, true)
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].id, "123")
})

test("Bitunix Spot pending-order fetch preserves the exact accepted HYPEUSDT order identity", async () => {
  const orderId = "2124329325141426176"
  const order = {
    orderId,
    symbol: "HYPEUSDT",
    side: "2",
    type: "1",
    status: "1",
    volume: "0.366",
    dealVolume: "0",
    price: "30",
    ctime: "2026-11-22T02:28:54Z",
    utime: "2026-11-22T02:28:54Z",
  }
  const requests = []
  const broker = createSignedPlacementTestBroker({
    requests,
    responses: [{
      code: "0",
      msg: "success",
      data: [order],
    }],
  })

  const result = await broker.getOpenOrders({ symbol: "hypeusdt" })
  const matchedOrder = result.data?.find(({ id }) => id === orderId)

  assert.equal(result.ok, true, "a valid pending-order response must normalize successfully")
  assert.equal(result.data.length, 1, "the pending endpoint must return the expected HYPE order row")
  assert.ok(matchedOrder, "the exact 19-digit exchange order ID must be found without numeric coercion")
  assert.equal(matchedOrder.id, orderId, "the exchange order ID must remain an exact string")
  assert.equal(matchedOrder.symbol, "HYPEUSDT")
  assert.equal(matchedOrder.side, "BUY")
  assert.equal(matchedOrder.status, "OPEN")
  assert.equal(matchedOrder.originalQuantity, "0.366")
  assert.equal(matchedOrder.price, 30)
  assert.equal(requests.length, 1, "fetching pending orders must issue exactly one read")
  assert.equal(requests[0].url.pathname, "/api/spot/v1/order/pending/list")
  assert.equal(requests[0].options.method, "POST")
  assert.equal(requests[0].options.headers["api-key"], "test-api-key")
  assert.equal(requests[0].options.body, '{"symbol":"HYPEUSDT"}')
  assert.equal(
    requests[0].options.headers.sign,
    createRestSignature({
      nonce: "test-nonce-0",
      timestamp: "1795262400000",
      apiKey: "test-api-key",
      secretKey: "test-api-secret",
      body: requests[0].options.body,
      bodyIsSerialized: true,
    }),
    "the pending-order POST must be signed over the exact serialized request body",
  )
})

test("Bitunix Spot pending-order fetch preserves a 64-bit numeric JSON order ID token", async () => {
  const requests = []
  const rawResponse = '{"code":"0","msg":"success","data":[{"orderId":2124329325141426176,"symbol":"HYPEUSDT","side":"2","type":"1","status":"1","volume":"0.366","dealVolume":"0","price":"30","ctime":"2026-11-22T00:00:00Z"}]}'
  const broker = createSignedPlacementTestBroker({
    requests,
    responses: [],
    fetchFn: async () => new Response(rawResponse, {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    }),
  })

  const result = await broker.getOpenOrders({ symbol: "HYPEUSDT" })

  assert.equal(result.ok, true, "a numeric 64-bit orderId token must be normalized losslessly")
  assert.equal(result.data[0].id, "2124329325141426176")
  assert.equal(typeof result.data[0].id, "string")
  assert.equal(requests.length, 1, "the pending-order read must not retry")
})

test("Bitunix Spot broker supports explicit history page selection", async () => {
  const { broker, calls } = createBroker({
    responses: {
      "/api/spot/v1/order/history/page": { data: [],
        total: 0,
        pageNum: "3" },
    },
  })

  const result = await broker.getOrderHistory({ symbol: "BTCUSDT",
    page: 3,
    limit: 20 })

  assert.equal(result.ok, true)
  assert.deepEqual(calls[0].options.body, { symbol: "BTCUSDT",
    page: 3,
    pageSize: 20 })
})


test("Bitunix Spot order history maps exchange-neutral filters to documented API codes", async () => {
  const { broker, calls } = createBroker({
    responses: {
      "/api/spot/v1/order/history/page": { data: [],
        total: 0,
        pageNum: "1" },
    },
  })

  const result = await broker.getOrderHistory({
    symbol: "BTCUSDT",
    status: "PARTIALLY_FILLED",
    side: "BUY",
    type: "LIMIT",
  })

  assert.equal(result.ok, true, "valid canonical history filters must return a successful broker result")
  assert.deepEqual(calls[0].options.body, {
    symbol: "BTCUSDT",
    page: 1,
    status: "3",
    side: "2",
    type: "1",
  }, "history filters must be translated to Bitunix wire codes without leaking exchange codes to callers")
})

test("Bitunix Spot order history rejects unsupported canonical filters before sending a request", async () => {
  const { broker, calls } = createBroker()

  const unsupportedStatus = await broker.getOrderHistory({
    symbol: "BTCUSDT",
    status: "UNKNOWN",
  })
  const unsupportedSide = await broker.getOrderHistory({
    symbol: "BTCUSDT",
    side: "BID",
  })
  const unsupportedType = await broker.getOrderHistory({
    symbol: "BTCUSDT",
    type: "STOP_LIMIT",
  })

  assert.equal(unsupportedStatus.ok, false, "unknown order statuses must not be sent as undocumented Bitunix filters")
  assert.equal(unsupportedSide.ok, false, "unknown order sides must not be sent as undocumented Bitunix filters")
  assert.equal(unsupportedType.ok, false, "unknown order types must not be sent as undocumented Bitunix filters")
  assert.equal(calls.length, 0, "invalid history filters must be rejected before any exchange request")
})


test("Bitunix Spot market catalog excludes pairs without an explicit open status", async () => {
  const { broker } = createBroker({
    responses: {
      "/api/spot/v1/common/coin_pair/list": [
        { base: "BTC",
          quote: "USDT",
          isOpen: "1" },
        { base: "OLD",
          quote: "USDT",
          isOpen: "0" },
        { base: "UNKNOWN",
          quote: "USDT" },
        { base: "UNSURE",
          quote: "USDT",
          isOpen: "unknown" },
      ],
    },
  })

  const result = await broker.getExchangeMarkets()

  assert.equal(result.ok, true, "a catalog containing unknown market states should remain readable")
  assert.deepEqual(result.data.map(({ symbol }) => symbol), ["BTCUSDT"], "only explicitly open Bitunix markets may enter the active catalog")
})


async function assertOrderHistoryPageRejected({ response, requestedPage = 1, message }) {
  const { broker } = createBroker({
    responses: {
      "/api/spot/v1/order/history/page": response,
    },
  })
  const result = await broker.getOrderHistory({
    symbol: "BTCUSDT",
    page: requestedPage,
  })

  assert.equal(result.ok, false, message)
}

test("Bitunix Spot order history rejects missing or invalid total metadata", async () => {
  const cases = [
    {
      name: "missing total",
      response: {
        pageNum: "1",
        data: [],
      },
    },
    {
      name: "string total",
      response: {
        total: "0",
        pageNum: "1",
        data: [],
      },
    },
    {
      name: "negative total",
      response: {
        total: -1,
        pageNum: "1",
        data: [],
      },
    },
    {
      name: "fractional total",
      response: {
        total: 0.5,
        pageNum: "1",
        data: [],
      },
    },
  ]

  for (const entry of cases) {
    await assertOrderHistoryPageRejected({
      response: entry.response,
      message: `history page with ${entry.name} must fail closed`,
    })
  }
})

test("Bitunix Spot order history tolerates malformed redundant page metadata on page one", async () => {
  for (const pageNum of ["one", "0"]) {
    const { broker: spotBroker } = createBroker({
      responses: {
        "/api/spot/v1/order/history/page": {
          total: 0,
          pageNum,
          data: [],
        },
      },
    })

    const result = await spotBroker.getOrderHistory({ symbol: "BTCUSDT" })

    assert.equal(result.ok, true, `malformed first-page echo ${pageNum} must not block page one`)
    assert.deepEqual(result.data, [], "first-page history must preserve the order array contract")
  }
})

test("Bitunix Spot order history rejects a response for a different page", async () => {
  await assertOrderHistoryPageRejected({
    response: {
      total: 0,
      pageNum: "2",
      data: [],
    },
    requestedPage: 1,
    message: "returned pageNum must match the requested page",
  })
})

test("Bitunix Spot order history rejects more rows than the reported total", async () => {
  const order = {
    orderId: "123",
    symbol: "BTCUSDT",
    side: "2",
    type: "1",
    status: "2",
    volume: "1",
    dealVolume: "1",
    price: "10",
  }

  await assertOrderHistoryPageRejected({
    response: {
      total: 0,
      pageNum: "1",
      data: [order],
    },
    message: "page row count cannot exceed the reported total",
  })
})

test("Bitunix Spot order history rejects omitted data when total is positive", async () => {
  await assertOrderHistoryPageRejected({
    response: {
      total: 1,
      pageNum: "1",
    },
    message: "an omitted data array with a positive total must fail closed",
  })
})

test("Bitunix Spot order history accepts a numeric page number", async () => {
  const { broker } = createBroker({
    responses: {
      "/api/spot/v1/order/history/page": {
        total: 0,
        pageNum: 1,
        data: [],
      },
    },
  })

  const result = await broker.getOrderHistory({ symbol: "BTCUSDT" })

  assert.equal(result.ok, true, "the official Spot WebSocket example uses a numeric pageNum")
  assert.deepEqual(result.data, [], "a numeric pageNum must preserve the one-page order array contract")
})

test("Bitunix Spot order history accepts an omitted data array only for an empty result set", async () => {
  const { broker, calls } = createBroker({
    responses: {
      "/api/spot/v1/order/history/page": {
        total: 0,
        pageNum: "1",
      },
    },
  })

  const result = await broker.getOrderHistory({ symbol: "BTCUSDT" })

  assert.equal(result.ok, true, "an omitted optional data array is valid when total is zero")
  assert.deepEqual(result.data, [], "an empty history page must normalize to an empty order array")
  assert.equal(calls.length, 1, "history validation must not trigger extra exchange requests")
})


test("Bitunix Spot symbol metadata rejects ambiguous duplicate catalog entries", async () => {
  const { broker } = createBroker({
    responses: {
      "/api/spot/v1/common/coin_pair/list": [
        {
          base: "BTC",
          quote: "USDT",
          isOpen: "1",
          minVolume: "0.001",
        },
        {
          base: "BTC",
          quote: "USDT",
          isOpen: "1",
          minVolume: "0.01",
        },
      ],
    },
  })

  const result = await broker.getSymbolFilters({ symbol: "BTCUSDT" })

  assert.equal(result.ok, false, "ambiguous market metadata must not silently select one row")
  assert.match(result.errors[0].message, /duplicate.*BTCUSDT|ambiguous.*BTCUSDT/i)
})


test("Bitunix Spot broker exposes legacy Coin assets from free and locked account balances", async () => {
  const { broker, calls } = createBroker({
    responses: {
      "/api/spot/v1/user/account": [
        {
          coin: "BTC",
          balance: "0.2",
          balanceLocked: "0.05",
        },
        {
          coin: "USDT",
          balance: "12.5",
          balanceLocked: "0",
        },
        {
          coin: "ZERO",
          balance: "0",
          balanceLocked: "0",
        },
      ],
    },
  })

  const result = await broker.getAssets()

  assert.equal(result.ok, true)
  assert.deepEqual(result.data, [
    {
      ticker: "BTC",
      quantity: 0.25,
    },
    {
      ticker: "USDT",
      quantity: 12.5,
    },
  ])
  assert.deepEqual(calls, [
    {
      method: "GET",
      path: "/api/spot/v1/user/account",
      options: {},
    },
  ])
})

test("Bitunix Spot last price rejects non-positive values and preserves positive decimal strings", async () => {
  for (const invalidPrice of ["0", "-0.01"]) {
    const { broker, calls } = createBroker({
      responses: {
        "/api/spot/v1/market/last_price": invalidPrice,
      },
    })

    const result = await broker.getPrice({ symbol: "BTCUSDT" })

    assert.equal(result.ok, false, `last price ${invalidPrice} must be rejected`)
    assert.equal(calls.length, 1)
  }

  const { broker } = createBroker({
    responses: {
      "/api/spot/v1/market/last_price": "0.0000000100",
    },
  })
  const result = await broker.getPrice({ symbol: "BTCUSDT" })

  assert.equal(result.ok, true)
  assert.equal(result.data.price, "0.0000000100")
})

test("Bitunix Spot pending orders reject missing or null response data", async () => {
  const cases = [
    {
      name: "missing data",
      responses: {},
    },
    {
      name: "null data",
      responses: {
        "/api/spot/v1/order/pending/list": null,
      },
    },
  ]

  for (const entry of cases) {
    const { broker, calls } = createBroker({
      responses: entry.responses,
    })
    const result = await broker.getOpenOrders({ symbol: "BTCUSDT" })

    assert.equal(result.ok, false, `pending orders with ${entry.name} must fail closed`)
    assert.match(result.errors[0].message, /pending orders response/i)
    assert.equal(calls.length, 1)
  }
})


test("Bitunix Spot order detail rejects unsafe numeric order IDs before making a request", async () => {
  const { broker, calls } = createBroker()
  const unsafeNumericOrderId = Number.MAX_SAFE_INTEGER + 1

  const result = await broker.getOrder({
    symbol: "BTCUSDT",
    orderId: unsafeNumericOrderId,
  })

  assert.equal(result.ok, false, "An unsafe numeric order ID must not be treated as a reliable broker identity.")
  assert.match(result.errors[0].message, /safe integer/i, "The failure must explain that numeric order IDs require safe integer precision.")
  assert.equal(calls.length, 0, "Invalid numeric order IDs must be rejected before any REST request is sent.")
})


test("Bitunix Spot order history rejects unsafe numeric page and page-size inputs before sending a request", async () => {
  const { broker, calls } = createBroker()
  const unsafeInteger = Number.MAX_SAFE_INTEGER + 1

  const unsafePage = await broker.getOrderHistory({
    symbol: "BTCUSDT",
    page: unsafeInteger,
  })
  const unsafePageSize = await broker.getOrderHistory({
    symbol: "BTCUSDT",
    limit: unsafeInteger,
  })

  assert.equal(unsafePage.ok, false, "an unsafe page number must not be sent with a potentially rounded numeric identity")
  assert.equal(unsafePageSize.ok, false, "an unsafe page size must not be sent with a potentially rounded numeric value")
  assert.match(unsafePage.errors[0].message, /safe integer/i, "the page validation error must identify the safe-integer boundary")
  assert.match(unsafePageSize.errors[0].message, /safe integer/i, "the page-size validation error must identify the safe-integer boundary")
  assert.equal(calls.length, 0, "unsafe history pagination values must be rejected before any exchange request")
})

test("Bitunix Spot order history accepts the largest safely representable page and page-size values", async () => {
  const maximumSafeInteger = Number.MAX_SAFE_INTEGER
  const { broker, calls } = createBroker({
    responses: {
      "/api/spot/v1/order/history/page": {
        total: 0,
        pageNum: String(maximumSafeInteger),
        data: [],
      },
    },
  })

  const result = await broker.getOrderHistory({
    symbol: "BTCUSDT",
    page: maximumSafeInteger,
    limit: maximumSafeInteger,
  })

  assert.equal(result.ok, true, "the maximum safe integer remains exactly representable and valid as a numeric request value")
  assert.deepEqual(calls[0].options.body, {
    symbol: "BTCUSDT",
    page: maximumSafeInteger,
    pageSize: maximumSafeInteger,
  }, "safe pagination values must be preserved exactly in the Bitunix request")
})

const EXCHANGE_RATE_PATH = "/api/spot/v1/common/rate/list"

const INVALID_EXCHANGE_RATE_RESPONSES = [
  undefined,
  null,
  {},
  [null],
  [
    {
      baseSymbol: "USDT",
      quoteSymbol: "AUD",
      rate: 1.5,
    },
  ],
  [
    {
      baseSymbol: "",
      quoteSymbol: "AUD",
      rate: "1.5",
    },
  ],
  [
    {
      baseSymbol: "USDT",
      quoteSymbol: " ",
      rate: "1.5",
    },
  ],
  [
    {
      baseSymbol: "USDT",
      quoteSymbol: "AUD",
      rate: "0",
    },
  ],
  [
    {
      baseSymbol: "USDT",
      quoteSymbol: "AUD",
      rate: "-1",
    },
  ],
  [
    {
      baseSymbol: "USDT",
      quoteSymbol: "AUD",
      rate: "not-a-rate",
    },
  ],
]

test("Bitunix Spot exchange rates preserve exact decimal strings and immutable records", async () => {
  const { broker, calls } = createBroker({
    responses: {
      [EXCHANGE_RATE_PATH]: [
        {
          baseSymbol: "USDT",
          quoteSymbol: "AUD",
          rate: "1.4452976228500000",
        },
      ],
    },
  })

  const result = await broker.getExchangeRates()

  assert.equal(result.ok, true, "a valid exchange-rate catalog must return a successful result")
  assert.deepEqual(result.data, [
    {
      baseSymbol: "USDT",
      quoteSymbol: "AUD",
      rate: "1.4452976228500000",
    },
  ], "the adapter must preserve the exact rate string without Number conversion")
  assert.equal(Object.isFrozen(result.data), true, "the returned exchange-rate array must be immutable")
  assert.equal(Object.isFrozen(result.data[0]), true, "each returned exchange-rate record must be immutable")
  assert.deepEqual(calls[0], {
    method: "GET",
    path: EXCHANGE_RATE_PATH,
    options: {
      authenticated: false,
    },
  }, "the broker must issue the documented public GET without parameters or authentication")
})

test("Bitunix Spot exchange rates accept an explicitly empty catalog", async () => {
  const { broker, calls } = createBroker({
    responses: {
      [EXCHANGE_RATE_PATH]: [],
    },
  })

  const result = await broker.getExchangeRates()

  assert.equal(result.ok, true, "an explicit empty rate catalog is a valid exchange response")
  assert.deepEqual(result.data, [], "an empty rate catalog must remain an empty array")
  assert.equal(calls.length, 1, "reading the exchange-rate catalog must make exactly one request")
})

test("Bitunix Spot exchange rates reject missing data and malformed or non-positive records", async () => {
  for (const response of INVALID_EXCHANGE_RATE_RESPONSES) {
    const { broker } = createBroker({
      responses: {
        [EXCHANGE_RATE_PATH]: response,
      },
    })
    const result = await broker.getExchangeRates()

    assert.equal(
      result.ok,
      false,
      `invalid exchange-rate response must fail closed: ${JSON.stringify(response)}`,
    )
    assert.ok(result.errors.length > 0, "a malformed exchange-rate response must include a useful error")
  }
})

test("Bitunix Spot exchange rates preserve REST failures instead of returning an empty catalog", async () => {
  const { broker, calls } = createBroker({
    responses: {
      [EXCHANGE_RATE_PATH]: new Error("exchange unavailable"),
    },
  })

  const result = await broker.getExchangeRates()

  assert.equal(result.ok, false, "a failed exchange-rate request must not appear successful")
  assert.match(result.errors[0].message, /exchange unavailable/, "the REST failure must remain visible to the caller")
  assert.equal(calls.length, 1, "a failed exchange-rate request must not trigger retries")
})


function createSymbolMetadata({ overrides = {} } = {}) {
  return {
    base: "BTC",
    quote: "USDT",
    isOpen: "1",
    minPrice: "0.01",
    minVolume: "0.001",
    basePrecision: "8",
    quotePrecision: "2",
    precisions: ["0.01", "0.001"],
    ...overrides,
  }
}

test("Bitunix Spot market catalog reads use unsigned public GET requests", async () => {
  const symbolMetadata = createSymbolMetadata()
  const { broker, calls } = createBroker({
    responses: {
      "/api/spot/v1/common/coin_pair/list": [symbolMetadata],
    },
  })

  const markets = await broker.getExchangeMarkets()
  const filters = await broker.getSymbolFilters({ symbol: "BTCUSDT" })

  assert.equal(markets.ok, true, "the public market catalog must remain readable without private signing")
  assert.equal(filters.ok, true, "symbol metadata must remain readable without private signing")
  assert.equal(calls.length, 2, "each catalog operation must issue exactly one request")
  for (const call of calls) {
    assert.equal(call.method, "GET", "the public coin-pair catalog must use GET")
    assert.deepEqual(call.options, {
      authenticated: false,
    }, "the public coin-pair catalog must not request private authentication or signing")
  }
})

test("Bitunix Spot symbol metadata selects the matching pair and preserves exact exchange fields", async () => {
  const expectedMetadata = createSymbolMetadata({
    overrides: {
      symbol: "btcusdt",
      minPrice: "0",
      minVolume: "0",
      basePrecision: 0,
      quotePrecision: "0",
      precisions: ["0.01", "0.001"],
      maxAmount: "500000",
      maxLimitOrderAmount: "1500000",
    },
  })
  const { broker } = createBroker({
    responses: {
      "/api/spot/v1/common/coin_pair/list": [
        createSymbolMetadata({
          overrides: {
            base: "ETH",
          },
        }),
        expectedMetadata,
      ],
    },
  })

  const result = await broker.getSymbolFilters({ symbol: "btcusdt" })

  assert.equal(result.ok, true, "a unique valid matching pair must be returned")
  assert.deepEqual(result.data, {
    ...expectedMetadata,
    symbol: "BTCUSDT",
  }, "the matching raw row must retain exact values while exposing the normalized requested symbol")
  assert.equal(Object.hasOwn(result.data, "tickSize"), false, "precision metadata must not be invented as a tick size")
  assert.equal(Object.hasOwn(result.data, "stepSize"), false, "precision metadata must not be invented as a quantity step")
  assert.equal(Object.hasOwn(result.data, "maxQuantity"), false, "reference-only maximum amount fields must not become canonical maximum quantity")
  assert.equal(result.data.minPrice, "0", "an explicitly documented zero minimum trading value must remain zero")
  assert.equal(result.data.minVolume, "0", "an explicitly documented zero minimum trading quantity must remain zero")
})

test("Bitunix Spot symbol metadata leaves omitted optional trading rules unknown", async () => {
  const symbolMetadata = createSymbolMetadata({
    overrides: {
      minPrice: undefined,
      minVolume: undefined,
      basePrecision: undefined,
      quotePrecision: undefined,
      precisions: undefined,
    },
  })
  const { broker } = createBroker({
    responses: {
      "/api/spot/v1/common/coin_pair/list": [symbolMetadata],
    },
  })

  const result = await broker.getSymbolFilters({ symbol: "BTCUSDT" })

  assert.equal(result.ok, true, "optional Bitunix metadata may be absent without fabricating trading rules")
  assert.equal(result.data.minPrice, undefined, "an omitted minimum trading value must remain unknown rather than becoming zero")
  assert.equal(result.data.minVolume, undefined, "an omitted minimum trading quantity must remain unknown rather than becoming zero")
  assert.equal(result.data.basePrecision, undefined, "an omitted base precision must remain absent")
  assert.equal(result.data.quotePrecision, undefined, "an omitted quote precision must remain absent")
})

test("Bitunix Spot symbol metadata preserves explicit null optional fields as unknown", async () => {
  const symbolMetadata = createSymbolMetadata({
    overrides: {
      minPrice: null,
      minVolume: null,
      basePrecision: null,
      quotePrecision: null,
      precisions: null,
    },
  })
  const { broker } = createBroker({
    responses: {
      "/api/spot/v1/common/coin_pair/list": [symbolMetadata],
    },
  })

  const result = await broker.getSymbolFilters({ symbol: "BTCUSDT" })

  assert.equal(result.ok, true, "explicit null optional metadata must remain unknown rather than being coerced")
  assert.equal(result.data.minPrice, null, "a null minimum trading value must remain null")
  assert.equal(result.data.minVolume, null, "a null minimum quantity must remain null")
  assert.equal(result.data.basePrecision, null, "a null base precision must remain null")
  assert.equal(result.data.quotePrecision, null, "a null quote precision must remain null")
  assert.equal(result.data.precisions, null, "a null precision list must remain null")
})

test("Bitunix Spot symbol metadata preserves a closed pair without advertising it as an active market", async () => {
  const closedMetadata = createSymbolMetadata({
    overrides: {
      isOpen: "0",
    },
  })
  const { broker } = createBroker({
    responses: {
      "/api/spot/v1/common/coin_pair/list": [closedMetadata],
    },
  })

  const result = await broker.getSymbolFilters({ symbol: "BTCUSDT" })
  const markets = await broker.getExchangeMarkets()

  assert.equal(result.ok, true, "read-only metadata lookup must preserve a known closed pair")
  assert.equal(result.data.isOpen, "0", "the source closed-market status must remain unchanged")
  assert.deepEqual(markets.data, [], "closed pairs must remain excluded from the active market catalog")
})


const invalidSymbolMetadataCases = [
  {
    field: "minPrice",
    value: "NaN",
    name: "non-finite minimum trading values",
  },
  {
    field: "minPrice",
    value: "-0.01",
    name: "negative minimum trading values",
  },
  {
    field: "minPrice",
    value: 0.01,
    name: "numeric minimum trading values that could lose decimal precision",
  },
  {
    field: "minVolume",
    value: "Infinity",
    name: "non-finite minimum quantities",
  },
  {
    field: "minVolume",
    value: "-0.001",
    name: "negative minimum quantities",
  },
  {
    field: "basePrecision",
    value: "-1",
    name: "negative base precision counts",
  },
  {
    field: "basePrecision",
    value: "1.5",
    name: "fractional base precision counts",
  },
  {
    field: "basePrecision",
    value: Infinity,
    name: "non-finite base precision numbers",
  },
  {
    field: "quotePrecision",
    value: 9007199254740992,
    name: "unsafe quote precision integers",
  },
  {
    field: "precisions",
    value: "0.01",
    name: "non-array trading precision metadata",
  },
  {
    field: "precisions",
    value: ["0.01", "NaN"],
    name: "malformed trading precision entries",
  },
  {
    field: "precisions",
    value: ["0.01", 0.001],
    name: "non-string trading precision entries",
  },
  {
    field: "precisions",
    value: ["-0.001"],
    name: "negative trading precision entries",
  },
  {
    field: "symbol",
    value: 42,
    name: "non-string compatibility symbols",
  },
  {
    field: "symbol",
    value: "ETHUSDT",
    name: "symbols that conflict with base and quote identity",
  },
  {
    field: "base",
    value: undefined,
    name: "missing base asset codes",
  },
  {
    field: "quote",
    value: undefined,
    name: "missing quote asset codes",
  },
]

for (const scenario of invalidSymbolMetadataCases) {
  test(`Bitunix Spot symbol metadata rejects ${scenario.name}`, async () => {
    const { broker } = createBroker({
      responses: {
        "/api/spot/v1/common/coin_pair/list": [
          createSymbolMetadata({
            overrides: {
              [scenario.field]: scenario.value,
            },
          }),
        ],
      },
    })
    const result = await broker.getSymbolFilters({ symbol: "BTCUSDT" })

    assert.equal(result.ok, false, `${scenario.name} must fail closed before metadata is returned`)
    assert.ok(result.errors?.[0] instanceof Error, `Invalid ${scenario.field} metadata must return a diagnostic error`)
  })
}

test("Bitunix Spot symbol metadata rejects missing symbols, missing catalog rows and malformed response arrays", async () => {
  const missingSymbol = createBroker()
  const invalidInput = await missingSymbol.broker.getSymbolFilters({ symbol: " " })

  assert.equal(invalidInput.ok, false, "an empty requested symbol must be rejected before exchange I/O")
  assert.equal(missingSymbol.calls.length, 0, "invalid symbol input must not trigger a catalog request")

  const missingRow = createBroker({
    responses: {
      "/api/spot/v1/common/coin_pair/list": [
        createSymbolMetadata({
          overrides: {
            base: "ETH",
          },
        }),
      ],
    },
  })
  const notFound = await missingRow.broker.getSymbolFilters({ symbol: "BTCUSDT" })

  assert.equal(notFound.ok, false, "a catalog without the requested pair must fail closed")

  const malformedEnvelope = createBroker({
    responses: {
      "/api/spot/v1/common/coin_pair/list": null,
    },
  })
  const malformed = await malformedEnvelope.broker.getSymbolFilters({ symbol: "BTCUSDT" })

  assert.equal(malformed.ok, false, "missing or null catalog data must not be treated as an empty successful response")
})

test("Bitunix Spot symbol metadata propagates catalog transport failures without retrying", async () => {
  const transportFailure = new Error("socket closed")
  const { broker, calls } = createBroker({
    responses: {
      "/api/spot/v1/common/coin_pair/list": transportFailure,
    },
  })

  const result = await broker.getSymbolFilters({ symbol: "BTCUSDT" })

  assert.equal(result.ok, false, "a catalog transport failure must never become successful metadata")
  assert.equal(result.errors[0], transportFailure, "the original transport failure must remain available to the caller")
  assert.equal(calls.length, 1, "a failed metadata read must not retry implicitly")
})


test("Bitunix Spot broker exposes immutable canonical capabilities", () => {
  const { broker } = createBroker()

  assert.equal(broker.capabilities.provider, "bitunix")
  assert.equal(broker.capabilities.product, "spot")
  assert.equal(broker.capabilities.getStatus({ type: "READ_BALANCES" }), "SUPPORTED")
  assert.equal(broker.capabilities.getStatus({ type: "PLACE_LIMIT_ORDER" }), "SUPPORTED")
  assert.equal(Object.isFrozen(broker.capabilities), true)
})

test("Bitunix Spot broker reports unsupported client-order-ID lookup explicitly", async () => {
  const { broker, calls } = createBroker()
  const result = await broker.getOrder({
    symbol: "BTCUSDT",
    clientOrderId: "client-123",
  })

  assert.equal(result.ok, false)
  assert.ok(result.errors[0] instanceof BrokerUnsupportedOperationError)
  assert.equal(result.errors[0].context.operation, "getOrder")
  assert.equal(calls.length, 0)
})

test("Bitunix canonical order placement remains unsupported because client order identity is absent", async () => {
  const { broker, calls } = createBroker()
  const result = await broker.createCanonicalOrder()

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.ok(result.errors[0] instanceof BrokerUnsupportedOperationError)
  assert.equal(calls.length, 0)
})
const TOKEN_NETWORK_PATH = "/api/spot/v1/common/coin/coin_network/list"
const USER_INFO_PATH = "/api/spot/v1/user/info"

test("Bitunix Spot token-network metadata uses one unsigned public REST request and preserves exact source fields", async () => {
  const tokenMetadata = [{
    name: "USDT",
    fullName: "Tether",
    quotePrecision: "6",
    withdrawOpen: 1,
    withdrawMin: "0.000001",
    withdrawMax: null,
    networks: [{
      contractPrecision: 6,
      contractAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      requireMemo: 0,
      chain: "TRON",
      network: "Tron (TRC-20)",
      isOpen: 1,
      depositOpen: 1,
      withdrawOpen: 1,
      withdrawMin: "0.000001",
      withdrawMax: "3000000",
      depositMin: "0.000001",
    }],
  }]
  const { broker, calls } = createBroker({
    responses: {
      [TOKEN_NETWORK_PATH]: tokenMetadata,
    },
  })

  const result = await broker.getTokenNetworks()

  assert.equal(result.ok, true, "a valid token-network catalog must return a successful result")
  assert.deepEqual(result.data, tokenMetadata, "the adapter must preserve source fields and exact decimal strings without coercion")
  assert.equal(Object.isFrozen(result.data), true, "the token-network catalog must be immutable")
  assert.equal(Object.isFrozen(result.data[0]), true, "each token metadata record must be immutable")
  assert.equal(Object.isFrozen(result.data[0].networks), true, "each token's network collection must be immutable")
  assert.equal(Object.isFrozen(result.data[0].networks[0]), true, "each network metadata record must be immutable")
  assert.deepEqual(calls, [{
    method: "GET",
    path: TOKEN_NETWORK_PATH,
    options: {
      authenticated: false,
    },
  }], "token-network metadata must use one unsigned public GET request")
})

test("Bitunix Spot token-network metadata accepts an explicit empty catalog", async () => {
  const { broker, calls } = createBroker({
    responses: {
      [TOKEN_NETWORK_PATH]: [],
    },
  })

  const result = await broker.getTokenNetworks()

  assert.equal(result.ok, true, "an explicitly empty token-network catalog is a valid exchange response")
  assert.deepEqual(result.data, [], "an empty token-network catalog must remain empty")
  assert.equal(calls.length, 1, "an empty catalog read must make exactly one REST request")
})

test("Bitunix Spot token-network metadata preserves omitted and null optional values", async () => {
  const tokenMetadata = [{
    name: "USDT",
    networks: [{
      network: "Tron (TRC-20)",
      withdrawMax: null,
    }],
  }]
  const { broker } = createBroker({
    responses: {
      [TOKEN_NETWORK_PATH]: tokenMetadata,
    },
  })

  const result = await broker.getTokenNetworks()

  assert.equal(result.ok, true, "documented optional token and network metadata may be absent or null")
  assert.equal(Object.hasOwn(result.data[0], "fullName"), false, "omitted token metadata must not be synthesized")
  assert.equal(result.data[0].networks[0].withdrawMax, null, "an explicit null withdrawal maximum must remain null")
  assert.equal(Object.hasOwn(result.data[0].networks[0], "depositMin"), false, "omitted network deposit minimum must remain unknown")
})

test("Bitunix Spot token-network metadata rejects malformed catalog rows and decimal constraints", async () => {
  const invalidResponses = [
    null,
    {},
    [null],
    [{ name: " " }],
    [{
      name: "USDT",
      networks: {},
    }],
    [{
      name: "USDT",
      withdrawMin: 0.000001,
    }],
    [{
      name: "USDT",
      withdrawMax: "NaN",
    }],
    [{
      name: "USDT",
      networks: [null],
    }],
    [{
      name: "USDT",
      networks: [{
        network: "TRC-20",
        depositMin: "-0.1",
      }],
    }],
  ]

  for (const invalidResponse of invalidResponses) {
    const { broker } = createBroker({
      responses: {
        [TOKEN_NETWORK_PATH]: invalidResponse,
      },
    })
    const result = await broker.getTokenNetworks()

    assert.equal(
      result.ok,
      false,
      `malformed token-network metadata must fail closed: ${JSON.stringify(invalidResponse)}`,
    )
    assert.ok(result.errors?.[0] instanceof Error, "invalid token-network metadata must include a diagnostic error")
  }
})

test("Bitunix Spot token-network metadata propagates REST failures without retrying", async () => {
  const transportFailure = new Error("token-network endpoint unavailable")
  const { broker, calls } = createBroker({
    responses: {
      [TOKEN_NETWORK_PATH]: transportFailure,
    },
  })

  const result = await broker.getTokenNetworks()

  assert.equal(result.ok, false, "a failed token-network request must never appear as a successful empty catalog")
  assert.equal(result.errors[0], transportFailure, "the original token-network transport error must remain available")
  assert.equal(calls.length, 1, "a failed token-network read must not be retried implicitly")
})


test("Bitunix Spot broker reads authenticated user information and preserves UID identity", async () => {
  const { broker, calls } = createBroker({
    responses: {
      [USER_INFO_PATH]: {
        uid: "9223372036854775807",
      },
    },
  })

  const result = await broker.getUserInfo()

  assert.equal(result.ok, true, "a valid user-info response must return a successful result")
  assert.deepEqual(result.data, {
    uid: "9223372036854775807",
  }, "an int64 UID must remain an exact string identifier")
  assert.equal(Object.isFrozen(result.data), true, "the user-info record must be immutable")
  assert.deepEqual(calls, [{
    method: "GET",
    path: USER_INFO_PATH,
    options: {
      authenticated: true,
    },
  }], "user information must use one signed private GET request")
})

test("Bitunix Spot broker preserves nullable and omitted optional user identity", async () => {
  const { broker: nullUidBroker } = createBroker({
    responses: {
      [USER_INFO_PATH]: {
        uid: null,
      },
    },
  })
  const nullUidResult = await nullUidBroker.getUserInfo()

  assert.equal(nullUidResult.ok, true, "a documented null UID must remain a successful user-info result")
  assert.deepEqual(nullUidResult.data, {
    uid: null,
  }, "an explicit null UID must remain null")

  const { broker: omittedUidBroker } = createBroker({
    responses: {
      [USER_INFO_PATH]: {},
    },
  })
  const omittedUidResult = await omittedUidBroker.getUserInfo()

  assert.equal(omittedUidResult.ok, true, "the documented optional UID may be omitted")
  assert.equal(Object.hasOwn(omittedUidResult.data, "uid"), false, "an omitted UID must not be synthesized")
})

test("Bitunix Spot broker rejects malformed user-info payloads and UID values", async () => {
  const invalidResponses = [
    [],
    "user",
    { uid: -1 },
    { uid: 1.5 },
    { uid: "not-a-uid" },
    { uid: true },
    { uid: "9223372036854775808" },
  ]

  for (const invalidResponse of invalidResponses) {
    const { broker } = createBroker({
      responses: {
        [USER_INFO_PATH]: invalidResponse,
      },
    })
    const result = await broker.getUserInfo()

    assert.equal(result.ok, false, `malformed user information must fail closed: ${JSON.stringify(invalidResponse)}`)
    assert.ok(result.errors?.[0] instanceof Error, "invalid user-info data must include a diagnostic error")
  }
})

test("Bitunix Spot broker normalizes safe numeric UIDs to exact identifier strings", async () => {
  const { broker } = createBroker({
    responses: {
      [USER_INFO_PATH]: {
        uid: 681979174,
      },
    },
  })

  const result = await broker.getUserInfo()

  assert.equal(result.ok, true, "a safe numeric UID from the official example must be accepted")
  assert.equal(result.data.uid, "681979174", "UIDs must have one stable string identifier representation")
})

test("Bitunix Spot broker preserves an absent optional user-info data object as null", async () => {
  const { broker } = createBroker({
    responses: {
      [USER_INFO_PATH]: null,
    },
  })

  const result = await broker.getUserInfo()

  assert.equal(result.ok, true, "the optional user-info data object may be null")
  assert.equal(result.data, null, "an absent user-info object must remain explicitly absent")
})

test("Bitunix Spot broker propagates user-info REST failures without retrying", async () => {
  const transportFailure = new Error("user-info endpoint unavailable")
  const { broker, calls } = createBroker({
    responses: {
      [USER_INFO_PATH]: transportFailure,
    },
  })

  const result = await broker.getUserInfo()

  assert.equal(result.ok, false, "a failed user-info request must not appear as a successful empty record")
  assert.equal(result.errors[0], transportFailure, "the original user-info transport error must remain available")
  assert.equal(calls.length, 1, "a failed user-info read must not be retried implicitly")
})


const TAX_FILING_PATH = "/api/spot/v1/tax/filing/page"
const TAX_FILING_RECORD = {
  date: "2024-01-01T00:00:00Z",
  labelEn: "Buy Order",
  account: "Spot",
  outgoingAsset: "USDT",
  outgoingAmount: "100.00000000",
  incomingAsset: "BTC",
  incomingAmount: "0.00100000",
  feeAsset: "USDT",
  feeAmount: "0.10000000",
  typeId: "BUY_ORDER",
  txId: "—",
  fromAddress: "—",
  toAddress: "—",
  network: "—",
  referenceId: "order-123",
  comment: "—",
}

function createTaxFilingPage({
  records = [TAX_FILING_RECORD],
  total = records.length,
  current = 1,
  size = 1000,
  pages = total === 0 ? 0 : 1,
} = {}) {
  return {
    records,
    total,
    current,
    size,
    pages,
  }
}

test("Bitunix Spot broker reads one authenticated tax-filing page and preserves exact records", async () => {
  const page = createTaxFilingPage()
  const { broker, calls } = createBroker({
    responses: {
      [TAX_FILING_PATH]: page,
    },
  })

  const result = await broker.getTaxFilingHistory({
    startTime: "2024-01-01T00:00:00Z",
    endTime: "2024-01-31T23:59:59Z",
  })

  assert.equal(result.ok, true, "a valid tax-filing page must return a successful result")
  assert.deepEqual(result.data, page, "tax-filing records and pagination metadata must be preserved")
  assert.equal(Object.isFrozen(result.data), true, "the tax-filing page must be immutable")
  assert.equal(Object.isFrozen(result.data.records), true, "tax-filing records must be immutable")
  assert.equal(Object.isFrozen(result.data.records[0]), true, "each tax-filing record must be immutable")
  assert.deepEqual(calls, [{
    method: "POST",
    path: TAX_FILING_PATH,
    options: {
      body: {
        startTime: "2024-01-01T00:00:00Z",
        endTime: "2024-01-31T23:59:59Z",
        page: 1,
        pageSize: 1000,
      },
      authenticated: true,
      stateChanging: false,
    },
  }], "tax-filing history must use one signed read-only POST with the documented defaults")
})

test("Bitunix Spot broker passes tax data type filters and explicit pagination unchanged", async () => {
  const page = createTaxFilingPage({
    current: 2,
    size: 50,
    total: 101,
    pages: 3,
    records: [{
      ...TAX_FILING_RECORD,
      typeId: "FUNDING_COST",
      outgoingAsset: "USDT",
      outgoingAmount: "0.012345678901234567",
    }],
  })
  const { broker, calls } = createBroker({
    responses: {
      [TAX_FILING_PATH]: page,
    },
  })

  const result = await broker.getTaxFilingHistory({
    startTime: "2024-01-01T00:00:00Z",
    endTime: "2024-12-31T00:00:00Z",
    dataTypeCodes: ["BUY_ORDER", "FUNDING_COST"],
    page: 2,
    pageSize: 50,
  })

  assert.equal(result.ok, true, "a valid later tax-filing page must be returned")
  assert.equal(result.data.records[0].outgoingAmount, "0.012345678901234567", "financial amounts must remain exact strings")
  assert.deepEqual(calls[0].options.body, {
    startTime: "2024-01-01T00:00:00Z",
    endTime: "2024-12-31T00:00:00Z",
    dataTypeCodes: ["BUY_ORDER", "FUNDING_COST"],
    page: 2,
    pageSize: 50,
  }, "tax type filters and pagination must be sent exactly as requested")
})

test("Bitunix Spot broker accepts UTC ISO-8601 timestamps with a zero offset", async () => {
  const { broker, calls } = createBroker({
    responses: {
      [TAX_FILING_PATH]: createTaxFilingPage(),
    },
  })

  const result = await broker.getTaxFilingHistory({
    startTime: "2024-01-01T00:00:00+00:00",
    endTime: "2024-01-02T00:00:00+00:00",
  })

  assert.equal(result.ok, true, "an explicit zero UTC offset is a valid UTC ISO-8601 timestamp")
  assert.equal(calls[0].options.body.startTime, "2024-01-01T00:00:00+00:00", "valid UTC offsets must be preserved exactly")
})

test("Bitunix Spot broker accepts an empty tax type filter as all transaction types", async () => {
  const { broker, calls } = createBroker({
    responses: {
      [TAX_FILING_PATH]: createTaxFilingPage(),
    },
  })

  const result = await broker.getTaxFilingHistory({
    startTime: "2024-01-01T00:00:00Z",
    endTime: "2024-01-02T00:00:00Z",
    dataTypeCodes: [],
  })

  assert.equal(result.ok, true, "an explicit empty dataTypeCodes list is documented as all transaction types")
  assert.deepEqual(calls[0].options.body.dataTypeCodes, [], "an explicit empty type list must not be rewritten")
})

function createInvalidTaxFilingDateQueries({ valid }) {
  return [
    null,
    {},
    {
      ...valid,
      startTime: "2024-01-01",
    },
    {
      ...valid,
      endTime: "2024-01-02T00:00:00+01:00",
    },
    {
      ...valid,
      startTime: "not-a-date",
    },
    {
      ...valid,
      startTime: "2024-02-30T00:00:00Z",
    },
    {
      ...valid,
      startTime: "2024-01-03T00:00:00Z",
    },
    {
      startTime: "2024-01-01T00:00:00Z",
      endTime: "2025-01-02T00:00:00Z",
    },
  ]
}

function createInvalidTaxFilingPaginationQueries({ valid }) {
  return [
    {
      ...valid,
      page: 0,
    },
    {
      ...valid,
      page: 1.5,
    },
    {
      ...valid,
      pageSize: 0,
    },
    {
      ...valid,
      pageSize: 1001,
    },
  ]
}

function createInvalidTaxFilingTypeQueries({ valid }) {
  return [
    {
      ...valid,
      dataTypeCodes: "BUY_ORDER",
    },
    {
      ...valid,
      dataTypeCodes: [""],
    },
    {
      ...valid,
      dataTypeCodes: [null],
    },
    {
      ...valid,
      dataTypeCodes: null,
    },
  ]
}

function createInvalidTaxFilingQueries() {
  const valid = {
    startTime: "2024-01-01T00:00:00Z",
    endTime: "2024-01-02T00:00:00Z",
  }
  return [
    ...createInvalidTaxFilingDateQueries({ valid }),
    ...createInvalidTaxFilingPaginationQueries({ valid }),
    ...createInvalidTaxFilingTypeQueries({ valid }),
  ]
}

test("Bitunix Spot broker rejects invalid tax-filing query ranges and pagination before I/O", async () => {
  for (const query of createInvalidTaxFilingQueries()) {
    const { broker, calls } = createBroker()
    const result = await broker.getTaxFilingHistory(query)

    assert.equal(result.ok, false, `invalid tax-filing query must fail: ${JSON.stringify(query)}`)
    assert.equal(calls.length, 0, "invalid tax-filing queries must be rejected before network I/O")
  }
})

function createInvalidTaxFilingPages() {
  return [
    null,
    [],
    {},
    {
      ...createTaxFilingPage(),
      records: {},
    },
    {
      ...createTaxFilingPage(),
      total: -1,
    },
    {
      ...createTaxFilingPage(),
      total: 0,
    },
    {
      ...createTaxFilingPage(),
      current: 2,
    },
    {
      ...createTaxFilingPage(),
      current: -1,
    },
    {
      ...createTaxFilingPage(),
      size: 1001,
    },
    {
      ...createTaxFilingPage(),
      size: 0,
    },
    {
      ...createTaxFilingPage(),
      pages: -1,
    },
    {
      ...createTaxFilingPage(),
      pages: 0,
    },
    {
      ...createTaxFilingPage(),
      records: [{
        ...TAX_FILING_RECORD,
        outgoingAmount: 1,
      }],
    },
    {
      ...createTaxFilingPage(),
      records: [null],
    },
  ]
}

test("Bitunix Spot broker rejects malformed tax-filing pagination and records", async () => {
  const validQuery = {
    startTime: "2024-01-01T00:00:00Z",
    endTime: "2024-01-02T00:00:00Z",
  }
  for (const page of createInvalidTaxFilingPages()) {
    const { broker } = createBroker({
      responses: {
        [TAX_FILING_PATH]: page,
      },
    })
    const result = await broker.getTaxFilingHistory(validQuery)

    assert.equal(result.ok, false, "malformed tax-filing pages must fail closed without partial records")
    assert.ok(result.errors?.[0] instanceof Error, "invalid tax-filing pages must include a diagnostic error")
  }
})

test("Bitunix Spot broker accepts an explicit empty tax-filing page", async () => {
  const page = createTaxFilingPage({
    records: [],
    total: 0,
    current: 1,
    size: 1000,
    pages: 0,
  })
  const { broker } = createBroker({
    responses: {
      [TAX_FILING_PATH]: page,
    },
  })

  const result = await broker.getTaxFilingHistory({
    startTime: "2024-01-01T00:00:00Z",
    endTime: "2024-01-02T00:00:00Z",
  })

  assert.equal(result.ok, true, "an explicit empty tax-filing page must remain a valid response")
  assert.deepEqual(result.data.records, [], "an empty tax-filing page must not be converted to an error")
})

test("Bitunix Spot broker propagates tax-filing REST failures without retrying", async () => {
  const transportFailure = new Error("tax-filing endpoint unavailable")
  const { broker, calls } = createBroker({
    responses: {
      [TAX_FILING_PATH]: transportFailure,
    },
  })

  const result = await broker.getTaxFilingHistory({
    startTime: "2024-01-01T00:00:00Z",
    endTime: "2024-01-02T00:00:00Z",
  })

  assert.equal(result.ok, false, "a failed tax-filing request must not appear as a successful empty page")
  assert.equal(result.errors[0], transportFailure, "the original tax-filing transport error must remain available")
  assert.equal(calls.length, 1, "a failed tax-filing read must not be retried implicitly")
})



const POLLING_OBSERVATION = Object.freeze({
  provider: "bitunix",
  product: "spot",
  mode: "POLLING",
  observedAt: 1234,
  sourceTime: null,
  balances: Object.freeze([]),
  symbols: Object.freeze([]),
  matchingOrderObservations: Object.freeze([]),
  guarantees: Object.freeze({
    accountSnapshotAuthoritative: false,
    historyCoverage: "FIRST_PAGE_ONLY",
    fillsCanonical: false,
    nativePush: false,
  }),
})
const POLLING_STATUS = Object.freeze({
  mode: "POLLING",
  nativePush: false,
  running: true,
  freshness: "FRESH",
  lastSuccessAt: 1234,
  ageMs: 0,
})

test("Bitunix Spot user-data subscription delivers polling observations separately from native events", async () => {
  let reconcilerInput
  let stopped = 0
  const { broker, calls } = createBroker({
    reconcilerFactory: () => ({
      start: (input) => {
        reconcilerInput = input
        input.onSnapshot(POLLING_OBSERVATION)
        input.onStatus(POLLING_STATUS)
        return {
          stop: () => { stopped += 1 },
          getStatus: () => POLLING_STATUS,
        }
      },
    }),
  })
  const events = []
  const observations = []
  const statuses = []
  await broker.connect()

  const result = await broker.subscribeForUserData({
    symbols: ["BTCUSDT"],
    trackedOrders: [
      {
        symbol: "BTCUSDT",
        orderId: "order-1",
      },
    ],
    intervalMs: 1000,
    onEvent: ({ event }) => events.push(event),
    onObservation: ({ observation }) => observations.push(observation),
    onStatus: (status) => statuses.push(status),
  })

  assert.equal(result.ok, true, "A valid polling observation subscription must succeed.")
  assert.equal(result.data.deliveryMode, "POLLING_OBSERVATIONS", "The subscription must identify its non-native delivery semantics.")
  assert.equal(result.data.nativePush, false, "Polling observations must never claim native push.")
  assert.deepEqual(reconcilerInput.symbols, ["BTCUSDT"], "Polling must use only explicitly supplied symbols.")
  assert.deepEqual(
    reconcilerInput.trackedOrders,
    [{
      symbol: "BTCUSDT",
      orderId: "order-1",
    }],
    "Only explicitly tracked order identities may be queried.",
  )
  assert.deepEqual(events, [], "Polling observations must never be converted into native execution events.")
  assert.deepEqual(observations, [POLLING_OBSERVATION], "The snapshot must be delivered only through onObservation.")
  assert.deepEqual(statuses, [POLLING_STATUS], "Polling lifecycle status must use the separate status callback.")
  assert.equal(calls.length, 0, "Subscription setup must not submit or cancel exchange orders.")

  await result.data.disconnect()
  assert.equal(stopped, 1, "Disconnect must stop the private polling lifecycle.")
})


test("Bitunix Spot polling subscription requires explicit symbol scope", async () => {
  const { broker, calls } = createBroker()
  await broker.connect()

  const result = await broker.subscribeForUserData({
    onObservation: () => {},
  })

  assert.equal(result.ok, false, "Polling must not start without an explicit symbol scope.")
  assert.match(result.errors[0].message, /symbol/i, "The failure must identify the missing polling scope.")
  assert.equal(calls.length, 0, "Invalid observation scope must not issue authenticated reads.")
})


test("Bitunix Spot placement is NOT_SENT when local request signing fails before fetch", async () => {
  let fetchCalls = 0
  const broker = new BitunixSpotBroker({
    apiKey: "test-api-key",
    apiSecret: "test-api-secret",
    tradingMode: "live",
    allowLiveOrderMutations: true,
    dependencies: {
      restClientFactory: (config) => new BitunixRestClient({
        ...config,
        nonceFactory: () => "",
        fetchFn: async () => {
          fetchCalls += 1
          throw new Error("invalid local signing input must not reach fetch")
        },
      }),
    },
  })

  const result = await broker.createOrder({
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    quantity: "1",
    price: "100",
  })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.equal(fetchCalls, 0)
})

test("Bitunix Spot placement treats a mismatched acknowledgement as unknown and does not read order detail", async () => {
  const { broker, calls } = createBroker({
    responses: {
      "/api/spot/v1/order/place_order": {
        orderId: "128",
        symbol: "BTCUSDT",
        side: 2,
        type: 1,
        volume: "0.9",
        price: "100",
        placeStatus: "1",
      },
    },
  })

  const result = await broker.createOrder({
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    quantity: "1",
    price: "100",
  })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "OUTCOME_UNKNOWN")
  assert.match(result.errors[0].message, /volume does not match/i)
  assert.equal(calls.length, 1)
})

test("Bitunix Spot createOrder completes signed REST placement and order-detail reconciliation offline", async () => {
  const requests = []
  const broker = createSignedPlacementTestBroker({
    requests,
    responses: createSuccessfulPlacementResponses(),
  })
  const result = await broker.createOrder({
    symbol: "btcusdt",
    side: "BUY",
    type: "LIMIT",
    quantity: "1.00",
    price: "100.00",
  })

  assert.equal(result.ok, true)
  assert.equal(result.mutationOutcome, "CONFIRMED")
  assert.equal(result.data.id, "12345678901234567890")
  assert.equal(result.data.status, "OPEN")
  assert.equal(requests.length, 2)
  assert.equal(requests[0].url.pathname, "/api/spot/v1/order/place_order")
  assert.equal(requests[0].options.method, "POST")
  assert.equal(requests[0].options.headers["api-key"], "test-api-key")
  assert.equal(
    requests[0].options.headers.sign,
    createRestSignature({
      nonce: "test-nonce-0",
      timestamp: "1795262400000",
      apiKey: "test-api-key",
      secretKey: "test-api-secret",
      body: requests[0].options.body,
      bodyIsSerialized: true,
    }),
  )
  assert.equal(requests[0].options.body, '{"symbol":"BTCUSDT","side":2,"type":1,"volume":"1.00","price":"100.00"}')
  assert.equal(requests[1].url.pathname, "/api/spot/v1/order/detail")
  assert.equal(requests[1].url.searchParams.get("orderId"), "12345678901234567890")
  assert.equal(requests[1].options.method, "GET")
})


test("Bitunix Spot Broker API emits structured order-read diagnostics", async () => {
  const events = []
  const logger = {
    debug: (event) => events.push(event),
    error: (event) => events.push(event),
  }
  const { broker } = createBroker({
    logger,
    responses: {
      "/api/spot/v1/common/coin_pair/list": [
        {
          base: "HYPE",
          quote: "USDT",
          isOpen: "1",
        },
      ],
      "/api/spot/v1/order/pending/list": [{
        orderId: "2124329325141426176",
        symbol: "HYPEUSDT",
        side: "2",
        type: "1",
        status: "1",
        volume: "0.366",
        dealVolume: "0",
        price: "30",
      }],
      "/api/spot/v1/order/detail": new Error("synthetic detail lookup failure"),
    },
  })

  const markets = await broker.getExchangeMarkets()
  const pending = await broker.getOpenOrders({ symbol: "HYPEUSDT" })
  const detail = await broker.getOrder({
    symbol: "HYPEUSDT",
    orderId: "2124329325141426176",
  })

  assert.equal(markets.ok, true)
  assert.equal(pending.ok, true)
  assert.equal(detail.ok, false)
  assert.ok(events.some((event) => event.event === "getExchangeMarkets.completed" && event.marketCount === 1))
  assert.ok(events.some((event) => event.event === "getOpenOrders.completed" && event.orderIds[0] === "2124329325141426176"))
  assert.ok(events.some((event) => event.event === "getOrder.failed" && event.orderId === "2124329325141426176"))
  assert.ok(events.every((event) => event.layer === "broker-api" && event.provider === "bitunix"))
})


test("Bitunix Spot Broker passes the common logger into its REST client factory", async () => {
  const events = []
  const logger = {
    debug: (event) => events.push(event),
    error: (event) => events.push(event),
  }
  let restClientLogger
  const broker = new BitunixSpotBroker({
    apiKey: "key",
    apiSecret: "secret",
    tradingMode: "live",
    logger,
    dependencies: {
      restClientFactory: (config) => {
        restClientLogger = config.logger
        return {
          request: async () => ({
            data: [],
          }),
        }
      },
    },
  })

  const result = await broker.getOpenOrders({
    symbol: "HYPEUSDT",
  })

  assert.equal(result.ok, true)
  assert.equal(restClientLogger, logger)
  assert.ok(events.some((event) => event.event === "getOpenOrders.completed"))
})
