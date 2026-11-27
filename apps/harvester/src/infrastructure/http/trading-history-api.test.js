import assert from "node:assert/strict"
import test from "node:test"
import { EventBus } from "@coinzilla/event-bus"
import { startTradingHistoryApi } from "./start-trading-history-api.js"

async function loadApi() {
  return import("./trading-history-api.js").catch(() => null)
}

function createMetadataQueries() {
  return {
    getSummary: () => ({
      ok: true,
      data: {
        orders: 3,
        fills: 2,
        commissions: 1,
      },
    }),
  }
}

function createOrderQueries({ calls, emptyPage } = {}) {
  return {
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
  }
}

function createFillQueries({ calls, emptyPage } = {}) {
  return {
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
  }
}

function createCommissionQueries({ calls, emptyPage } = {}) {
  return {
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
  }
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
    ...createMetadataQueries(),
    ...createOrderQueries({
      calls,
      emptyPage,
    }),
    ...createFillQueries({
      calls,
      emptyPage,
    }),
    ...createCommissionQueries({
      calls,
      emptyPage,
    }),
    ...overrides,
  }
  return {
    queries,
    calls,
  }
}

async function startApi({ t, queries, exchangeAccounts = [] } = {}) {
  const module = await loadApi()
  assert.ok(module, "Harvester must provide a versioned trading-history HTTP adapter.")
  const api = await module.startTradingHistoryApiServer({
    queries,
    environment: "testnet",
    port: 0,
    exchangeAccounts,
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
    baseUrl: `http://127.0.0.1:${api.address.port}`,
  }
}

test("serves local metadata without bearer authentication", async (t) => {
  const { queries } = createQueries()
  const { baseUrl } = await startApi({
    t,
    queries,
  })

  const response = await fetch(`${baseUrl}/api/v1/trading/metadata`, {
    headers: { Origin: "http://127.0.0.1:4200" },
  })
  assert.equal(response.status, 200, "Local API metadata must be available without a bearer token.")
  assert.equal(response.headers.get("access-control-allow-origin"), "http://127.0.0.1:4200", "The local API must allow only the Dashboard browser origin.")
  const untrustedOrigin = await fetch(`${baseUrl}/api/v1/trading/metadata`, {
    headers: { Origin: "https://attacker.example" },
  })
  assert.equal(untrustedOrigin.headers.get("access-control-allow-origin"), null, "Untrusted websites must not read local trading history.")

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
    `${baseUrl}/api/v1/trading/orders?symbol=BTCUSDT&side=BUY&status=FILLED&limit=25&offset=50`,
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

  const fillResponse = await fetch(`${baseUrl}/api/v1/trading/fills/fill%2F001`)
  assert.equal(fillResponse.status, 200, "A fill detail request must return its persisted commission facts.")
  const fillPayload = await fillResponse.json()
  assert.equal(fillPayload.data.id, "fill/001")
  assert.equal(fillPayload.data.commissions[0].amount, "0.00025000")
  assert.deepEqual(calls[0], {
    operation: "getFill",
    id: "fill/001",
  }, "The adapter must decode the record identifier before calling the application query.")

  const missingOrder = await fetch(`${baseUrl}/api/v1/trading/orders/missing-order`)
  assert.equal(missingOrder.status, 404, "A missing persisted record must use the not-found HTTP status.")
  assert.equal((await missingOrder.json()).error.code, "HARVESTER_TRADING_HISTORY_RECORD_NOT_FOUND")
});

test("rejects unsupported query parameters, methods, and unimplemented resources", async (t) => {
  const { queries } = createQueries()
  const { baseUrl } = await startApi({
    t,
    queries,
  })
  const invalidFilter = await fetch(`${baseUrl}/api/v1/trading/orders?rawSql=DROP`)
  assert.equal(invalidFilter.status, 400, "Unsupported query parameters must be rejected before application access.")
  assert.equal((await invalidFilter.json()).error.code, "HARVESTER_TRADING_HISTORY_QUERY_INVALID")

  const unsupportedMethod = await fetch(`${baseUrl}/api/v1/trading/orders`, {
    method: "POST",
  })
  assert.equal(unsupportedMethod.status, 405, "The trading-history API must reject unsupported HTTP methods.")

  const unimplementedResource = await fetch(`${baseUrl}/api/v1/trading/sessions`)
  assert.equal(unimplementedResource.status, 404, "The API must not invent a sessions resource.")
});

test("supports browser preflight and validates server configuration", async (t) => {
  const { queries } = createQueries()
  const { baseUrl, module } = await startApi({
    t,
    queries,
  })
  const preflight = await fetch(`${baseUrl}/api/v1/trading/orders`, {
    method: "OPTIONS",
    headers: {
      Origin: "http://127.0.0.1:4200",
      "Access-Control-Request-Headers": "content-type",
    },
  })
  assert.equal(preflight.status, 204, "Browser preflight must complete without requiring a token.")
  assert.match(preflight.headers.get("access-control-allow-headers"), /content-type/i)

  await assert.rejects(
    () => module.startTradingHistoryApiServer({
      queries,
      environment: "testnet",
      host: "0.0.0.0",
      port: 0,
    }),
    /127\.0\.0\.1/,
    "The unauthenticated local API must reject non-loopback binding.",
  )

  await assert.rejects(
    () => module.startTradingHistoryApiServer({
      queries,
      environment: "sandbox",
      port: 0,
    }),
    /environment/,
    "The API must reject invalid environment configuration.",
  )
});

test("serves only active Harvester provider accounts through the read-only exchange API", async (t) => {
  const { queries } = createQueries()
  const exchangeAccounts = [{
    providerInstanceId: "binance-live",
    providerType: "binance",
    accountId: "primary",
    environment: "live",
    connected: true,
    readAccountSnapshot: async () => ({
      ok: true,
      data: {
        sourceTime: 123,
        balances: [{
          value: {
            asset: { code: "USDT" },
            free: { amount: "12.5" },
            locked: { amount: "0" },
            total: { amount: "12.5" },
          },
        }],
      },
    }),
    readOpenOrders: async () => ({
      ok: true,
      data: [{
        value: {
          symbol: "BTCUSDT",
          side: "BUY",
        },
      }],
    }),
  }]
  const { baseUrl } = await startApi({
    t,
    queries,
    exchangeAccounts,
  })

  const list = await fetch(`${baseUrl}/api/v1/exchanges/accounts`)
  assert.equal(list.status, 200)
  assert.deepEqual((await list.json()).data, [{
    providerInstanceId: "binance-live",
    providerType: "binance",
    accountId: "primary",
    environment: "live",
    connected: true,
  }])

  const detail = await fetch(`${baseUrl}/api/v1/exchanges/accounts/binance-live`)
  assert.equal(detail.status, 200)
  const payload = await detail.json()
  assert.equal(payload.data.accountSnapshot.sourceTime, 123)
  assert.equal(payload.data.accountSnapshot.balances[0].total.amount, "12.5")
  assert.deepEqual(payload.data.openOrders, [{
    symbol: "BTCUSDT",
    side: "BUY",
  }])

  const missing = await fetch(`${baseUrl}/api/v1/exchanges/accounts/bitunix-live`)
  assert.equal(missing.status, 404)
})

test("allows the Dashboard HTTP API from a dynamically selected localhost port", async (t) => {
  const { queries } = createQueries()
  const { baseUrl } = await startApi({
    t,
    queries,
  })
  for (const origin of ["http://127.0.0.1:4300", "http://localhost:4317"]) {
    const response = await fetch(`${baseUrl}/api/v1/trading/metadata`, {
      headers: { Origin: origin },
    })
    assert.equal(response.status, 200, `The local API must serve a Dashboard on ${origin}.`)
    assert.equal(
      response.headers.get("access-control-allow-origin"),
      origin,
      `The API must grant CORS only to the exact local Dashboard origin ${origin}.`,
    )
    await response.text()
  }
})

test("serves runtime operator status while persisted history reports database unavailability", async (t) => {
  const eventBus = new EventBus()
  const service = await startTradingHistoryApi({
    eventBus,
    operator: {
      async getStatus() {
        return {
          ok: true,
          data: {
            runtimeState: "RUNNING",
          },
        }
      },
    },
    env: {
      TRADING_MODE: "testnet",
      HARVESTER_API_PORT: "0",
    },
    logger: {
      info() {},
    },
  })
  t.after(async () => {
    await service.close()
    await eventBus.close()
  })
  const baseUrl = `http://127.0.0.1:${service.address.port}`

  const runtimeStatus = await fetch(`${baseUrl}/api/v1/trading/operator/status`)
  assert.equal(runtimeStatus.status, 200,
    "The local runtime status endpoint must work without relational trading-history persistence.")
  assert.equal((await runtimeStatus.json()).data.runtimeState, "RUNNING",
    "The Dashboard must receive the actual Harvester runtime status.")

  const historyMetadata = await fetch(`${baseUrl}/api/v1/trading/metadata`)
  assert.equal(historyMetadata.status, 503,
    "Persisted-history metadata must report service unavailable rather than an empty successful result.")
  const historyFailure = await historyMetadata.json()
  assert.equal(historyFailure.error.code, "HARVESTER_TRADING_HISTORY_PERSISTENCE_UNAVAILABLE",
    "The history response must identify the missing relational persistence explicitly.")
})
