import assert from "node:assert/strict"
import test from "node:test"

const API_TOKEN = "test-token-with-more-than-thirty-two-characters"

async function loadApi() {
  return import("./trading-history-api.js").catch(() => null)
}

function createQueries(overrides = {}) {
  const calls = []
  const emptyPage = {
    items: [],
    pagination: {
      limit: 50,
      offset: 0,
      total: 0,
      hasMore: false,
    },
  }
  const queries = {
    getSummary: () => ({
      ok: true,
      data: {
        orders: 3,
        fills: 2,
        commissions: 1,
      },
    }),
    listOrders: (input) => {
      calls.push({
        operation: "listOrders",
        input,
      })
      return {
        ok: true,
        data: emptyPage,
      }
    },
    getOrder: ({ id }) => {
      calls.push({
        operation: "getOrder",
        id,
      })
      return {
        ok: true,
        data: null,
      }
    },
    listFills: (input) => {
      calls.push({
        operation: "listFills",
        input,
      })
      return {
        ok: true,
        data: emptyPage,
      }
    },
    getFill: ({ id }) => {
      calls.push({
        operation: "getFill",
        id,
      })
      return {
        ok: true,
        data: {
          id,
          commissions: [{
            amount: "0.00025000",
            assetCode: "BNB",
            quoteValueAmount: null,
          }],
        },
      }
    },
    listCommissions: (input) => {
      calls.push({
        operation: "listCommissions",
        input,
      })
      return {
        ok: true,
        data: emptyPage,
      }
    },
    ...overrides,
  }
  return {
    queries,
    calls,
  }
}

async function startApi({ t, queries, token = API_TOKEN } = {}) {
  const module = await loadApi()
  assert.ok(module, "Harvester must provide a versioned trading-history HTTP adapter.")
  const api = await module.startTradingHistoryApiServer({
    queries,
    token,
    environment: "testnet",
    port: 0,
    logger: {
      error() {},
    },
  })
  t.after(async () => {
    await api.close()
  })
  return {
    module,
    api,
    baseUrl: "http://127.0.0.1:" + api.address.port,
  }
}

test("requires a bearer token and returns selected environment metadata", async (t) => {
  const { queries } = createQueries()
  const { baseUrl } = await startApi({
    t,
    queries,
  })

  const missingToken = await fetch(baseUrl + "/api/v1/trading/metadata")
  assert.equal(missingToken.status, 401, "Metadata must require a valid bearer token.")

  const invalidToken = await fetch(baseUrl + "/api/v1/trading/metadata", {
    headers: {
      Authorization: "Bearer invalid-token",
    },
  })
  assert.equal(invalidToken.status, 401, "An invalid bearer token must be rejected.")

  const response = await fetch(baseUrl + "/api/v1/trading/metadata", {
    headers: {
      Authorization: "Bearer " + API_TOKEN,
    },
  })
  assert.equal(response.status, 200, "A valid bearer token must access API metadata.")
  assert.equal(response.headers.get("access-control-allow-origin"), "*", "Token-authenticated clients must not require a consumer-specific CORS allowlist.")
  assert.deepEqual((await response.json()).data, {
    environment: "testnet",
    records: {
      orders: 3,
      fills: 2,
      commissions: 1,
    },
  }, "Metadata must identify the selected database environment and actual persisted record counts.")
});

test("routes order list filters and bounded pagination to the application query facade", async (t) => {
  const { queries, calls } = createQueries()
  const { baseUrl } = await startApi({
    t,
    queries,
  })
  const response = await fetch(
    baseUrl + "/api/v1/trading/orders?symbol=BTCUSDT&side=BUY&status=FILLED&limit=25&offset=50",
    {
      headers: {
        Authorization: "Bearer " + API_TOKEN,
      },
    },
  )

  assert.equal(response.status, 200, "A valid order-list request must return its application result.")
  assert.deepEqual(calls[0], {
    operation: "listOrders",
    input: {
      filters: {
        symbol: "BTCUSDT",
        side: "BUY",
        status: "FILLED",
      },
      pagination: {
        limit: 25,
        offset: 50,
      },
    },
  }, "The HTTP adapter must translate query parameters into the transport-independent application query shape.")
});

test("decodes record identifiers, returns fill commissions, and reports missing records", async (t) => {
  const { queries, calls } = createQueries()
  const { baseUrl } = await startApi({
    t,
    queries,
  })

  const fillResponse = await fetch(baseUrl + "/api/v1/trading/fills/fill%2F001", {
    headers: {
      Authorization: "Bearer " + API_TOKEN,
    },
  })
  assert.equal(fillResponse.status, 200, "A fill detail request must return its persisted commission facts.")
  const fillPayload = await fillResponse.json()
  assert.equal(fillPayload.data.id, "fill/001")
  assert.equal(fillPayload.data.commissions[0].amount, "0.00025000")
  assert.deepEqual(calls[0], {
    operation: "getFill",
    id: "fill/001",
  }, "The adapter must decode the record identifier before calling the application query.")

  const missingOrder = await fetch(baseUrl + "/api/v1/trading/orders/missing-order", {
    headers: {
      Authorization: "Bearer " + API_TOKEN,
    },
  })
  assert.equal(missingOrder.status, 404, "A missing persisted record must use the not-found HTTP status.")
  assert.equal((await missingOrder.json()).error.code, "HARVESTER_TRADING_HISTORY_RECORD_NOT_FOUND")
});

test("rejects unsupported query parameters, methods, and unimplemented resources", async (t) => {
  const { queries } = createQueries()
  const { baseUrl } = await startApi({
    t,
    queries,
  })
  const headers = {
    Authorization: "Bearer " + API_TOKEN,
  }

  const invalidFilter = await fetch(baseUrl + "/api/v1/trading/orders?rawSql=DROP", {
    headers,
  })
  assert.equal(invalidFilter.status, 400, "Unsupported query parameters must be rejected before application access.")
  assert.equal((await invalidFilter.json()).error.code, "HARVESTER_TRADING_HISTORY_QUERY_INVALID")

  const unsupportedMethod = await fetch(baseUrl + "/api/v1/trading/orders", {
    method: "POST",
    headers,
  })
  assert.equal(unsupportedMethod.status, 405, "The trading-history API must reject unsupported HTTP methods.")

  const unimplementedResource = await fetch(baseUrl + "/api/v1/trading/sessions", {
    headers,
  })
  assert.equal(unimplementedResource.status, 404, "The API must not invent a sessions resource.")
});

test("supports browser preflight and validates server authentication configuration", async (t) => {
  const { queries } = createQueries()
  const { baseUrl, module } = await startApi({
    t,
    queries,
  })
  const preflight = await fetch(baseUrl + "/api/v1/trading/orders", {
    method: "OPTIONS",
    headers: {
      Origin: "http://127.0.0.1:4200",
      "Access-Control-Request-Headers": "authorization",
    },
  })
  assert.equal(preflight.status, 204, "Browser preflight must complete without requiring a token.")
  assert.match(preflight.headers.get("access-control-allow-headers"), /authorization/i)

  await assert.rejects(
    () => module.startTradingHistoryApiServer({
      queries,
      token: "too-short",
      environment: "testnet",
      port: 0,
    }),
    /HARVESTER_API_TOKEN/,
    "The API must reject weak or missing bearer-token configuration.",
  )
});
