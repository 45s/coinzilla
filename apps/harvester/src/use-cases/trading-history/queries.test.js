import assert from "node:assert/strict"
import test from "node:test"

async function loadTradingHistoryQueries() {
  return import("./queries.js").catch(() => null)
}

function createRepository(overrides = {}) {
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
  const repository = {
    getSummary: () => ({
      orders: 3,
      fills: 2,
      commissions: 1,
    }),
    listOrders: (input) => {
      calls.push({
        operation: "listOrders",
        input,
      })
      return emptyPage
    },
    findOrderById: ({ id }) => {
      calls.push({
        operation: "findOrderById",
        id,
      })
      return null
    },
    listFills: (input) => {
      calls.push({
        operation: "listFills",
        input,
      })
      return emptyPage
    },
    findFillById: ({ id }) => {
      calls.push({
        operation: "findFillById",
        id,
      })
      return null
    },
    listCommissions: (input) => {
      calls.push({
        operation: "listCommissions",
        input,
      })
      return emptyPage
    },
    ...overrides,
  }
  return {
    repository,
    calls,
  }
}

test("creates transport-independent trading-history query operations", async () => {
  const module = await loadTradingHistoryQueries()
  assert.ok(module, "Harvester must provide an application query module independent of HTTP transports.")
  assert.equal(typeof module.createTradingHistoryQueries, "function", "The application module must export its query factory.")
  const { repository } = createRepository()
  const queries = module.createTradingHistoryQueries({ repository })

  for (const operation of ["getSummary", "listOrders", "getOrder", "listFills", "getFill", "listCommissions"]) {
    assert.equal(typeof queries[operation], "function", `The application query facade must expose ${operation}.`)
  }
  assert.equal(Object.isFrozen(queries), true, "The composed application query facade must be immutable.")
});

test("validates and normalizes list filters and bounded pagination before repository access", async () => {
  const module = await loadTradingHistoryQueries()
  assert.ok(module, "Harvester must provide the application query module before query behavior can be verified.")
  const { repository, calls } = createRepository()
  const queries = module.createTradingHistoryQueries({ repository })

  const result = queries.listOrders({
    filters: {
      symbol: "BTCUSDT",
      side: "BUY",
      status: "FILLED",
      providerInstanceId: "binanceTestnet",
      accountId: "binance-primary",
    },
    pagination: {
      limit: 25,
      offset: 50,
    },
  })
  assert.equal(result.ok, true, "A valid order query must return a successful application result.")
  assert.deepEqual(calls[0], {
    operation: "listOrders",
    input: {
      filters: {
        symbol: "BTCUSDT",
        side: "BUY",
        status: "FILLED",
        providerInstanceId: "binanceTestnet",
        accountId: "binance-primary",
      },
      pagination: {
        limit: 25,
        offset: 50,
      },
    },
  }, "The application must pass validated query criteria and pagination to the repository without HTTP-specific values.")

  const defaults = queries.listFills()
  assert.equal(defaults.ok, true, "A fill query without optional filters must use the bounded default page.")
  assert.deepEqual(calls[1].input, {
    filters: {},
    pagination: {
      limit: 50,
      offset: 0,
    },
  }, "The application must apply consistent default filters and pagination for every list operation.")
});

test("rejects unsupported filters, invalid sides, and out-of-range pagination with stable query errors", async () => {
  const module = await loadTradingHistoryQueries()
  assert.ok(module, "Harvester must provide the application query module before invalid input can be verified.")
  const { repository, calls } = createRepository()
  const queries = module.createTradingHistoryQueries({ repository })

  const unsupportedFilter = queries.listOrders({
    filters: {
      rawSql: "DROP TABLE orders",
    },
  })
  assert.equal(unsupportedFilter.ok, false, "An unsupported filter must be rejected before repository access.")
  assert.equal(unsupportedFilter.errors[0].code, "HARVESTER_TRADING_HISTORY_QUERY_INVALID", "Invalid filters must use the stable trading-history query error code.")

  const invalidSide = queries.listFills({
    filters: {
      side: "LONG",
    },
  })
  assert.equal(invalidSide.ok, false, "A side outside the persisted BUY/SELL vocabulary must be rejected.")
  assert.equal(invalidSide.errors[0].code, "HARVESTER_TRADING_HISTORY_QUERY_INVALID", "Invalid side values must use the stable query validation code.")

  const invalidLimit = queries.listCommissions({
    pagination: {
      limit: 101,
      offset: 0,
    },
  })
  assert.equal(invalidLimit.ok, false, "A page size above the server-side bound must be rejected.")
  assert.equal(invalidLimit.errors[0].code, "HARVESTER_TRADING_HISTORY_QUERY_INVALID", "Invalid pagination must use the stable query validation code.")
  assert.equal(calls.length, 0, "Invalid query inputs must not reach the persistence repository.")
});

test("wraps persistence failures with a stable application error while preserving the cause", async () => {
  const module = await loadTradingHistoryQueries()
  assert.ok(module, "Harvester must provide the application query module before persistence failure behavior can be verified.")
  const persistenceFailure = new Error("sqlite details must not be serialized by the transport")
  const { repository } = createRepository({
    listOrders: () => {
      throw persistenceFailure
    },
  })
  const queries = module.createTradingHistoryQueries({ repository })
  const result = queries.listOrders()

  assert.equal(result.ok, false, "A failed persistence query must return a failed application result.")
  assert.equal(result.errors[0].code, "HARVESTER_TRADING_HISTORY_QUERY_FAILED", "Persistence failures must use the stable application query failure code.")
  assert.equal(result.errors[0].cause, persistenceFailure, "The application error must preserve the original persistence failure for diagnostics.")
});

test("rejects incomplete query repository ports at application composition", async () => {
  const module = await loadTradingHistoryQueries()
  assert.ok(module, "Harvester must provide the application query module before repository-port validation can be verified.")
  assert.throws(
    () => module.createTradingHistoryQueries({
      repository: {
        listOrders() {},
      },
    }),
    /TradingHistoryQueryRepository/,
    "Application composition must fail when the query repository does not implement its complete contract.",
  )
});
