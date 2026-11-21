import assert from "node:assert/strict"
import test from "node:test"
import {
  Asset,
  CanonicalOrder,
  Fill,
  Market,
  Money,
  Quantity,
} from "@coinzilla/entities"
import { synchronizeAccountHistory } from "./index.js"

const identity = Object.freeze({
  providerInstanceId: "binance-primary",
  providerType: "binance",
  accountId: "binance-account",
})
const baseAsset = new Asset({
  id: "btc",
  code: "BTC",
})
const quoteAsset = new Asset({
  id: "usdt",
  code: "USDT",
})
const market = new Market({
  venue: "binance",
  symbol: "BTCUSDT",
  baseAsset,
  quoteAsset,
})

function createOrder({ orderId = "10", executed = "0.1", orderMarket = market, clientOrderId, providerIdentity = identity } = {}) {
  return new CanonicalOrder({
    ...providerIdentity,
    clientOrderId: clientOrderId ?? `harvester-${orderId}`,
    brokerOrderId: orderId,
    market: orderMarket,
    side: "BUY",
    type: "LIMIT",
    limitPrice: new Money({
      amount: "100",
      asset: orderMarket.quoteAsset,
    }),
    originalQuantity: new Quantity({
      amount: "0.1",
      asset: orderMarket.baseAsset,
    }),
    executedQuantity: new Quantity({
      amount: executed,
      asset: orderMarket.baseAsset,
    }),
    status: executed === "0" ? "OPEN" : "FILLED",
    createdAt: 100,
    updatedAt: 200,
    completedAt: 200,
  })
}

function createFill({ tradeId = "1", orderId = "10", fillMarket = market, clientOrderId, providerIdentity = identity } = {}) {
  return new Fill({
    ...providerIdentity,
    tradeId,
    brokerOrderId: orderId,
    clientOrderId: clientOrderId === null ? undefined : clientOrderId ?? `harvester-${orderId}`,
    market: fillMarket,
    side: "BUY",
    price: new Money({
      amount: "100",
      asset: fillMarket.quoteAsset,
    }),
    quantity: new Quantity({
      amount: "0.1",
      asset: fillMarket.baseAsset,
    }),
    quoteQuantity: new Money({
      amount: "10",
      asset: fillMarket.quoteAsset,
    }),
    liquidityRole: "MAKER",
    executedAt: 200,
    commissions: [],
    commissionStatus: "COMPLETE",
  })
}

function createOrderRepository({ orders, orderIdentities }) {
  return {
    upsertHistorical: async (record) => {
      const existingIndex = orders.findIndex(({ id }) => id === record.id)
      if (existingIndex === -1) {
        orders.push(record)
      } else {
        orders[existingIndex] = record
      }
      orderIdentities.set(`${record.market.id}:${record.brokerOrderId}`, record.clientOrderId)
    },
    findByExchangeOrderIdentity: async ({ marketId, brokerOrderId }) =>
      orderIdentities.get(`${marketId}:${brokerOrderId}`) ?? null,
    getOldestPendingOrderId: async ({ symbol }) => {
      const pendingOrders = orders.filter((order) =>
        order.market.symbol === symbol &&
        ["NEW", "OPEN", "PENDING", "PARTIALLY_FILLED", "UNKNOWN"].includes(order.status),
      )
      const oldestOrderId = Math.min(
        ...pendingOrders.map(({ brokerOrderId }) => Number(brokerOrderId)),
      )
      return Number.isFinite(oldestOrderId) ? String(oldestOrderId) : null
    },
  }
}

function createFillRepository({ fills }) {
  return {
    upsert: async (input) => {
      const existingIndex = fills.findIndex(({ fill }) => fill.fillId === input.fill.fillId)
      if (existingIndex === -1) {
        fills.push(input)
      } else {
        fills[existingIndex] = input
      }
    },
  }
}

function createCursorRepository({ cursors }) {
  return {
    get: async ({ symbol }) => cursors.get(symbol) ?? {
      lastOrderId: null,
      lastTradeId: null,
    },
    saveOrderCursor: async ({ symbol, lastOrderId }) => {
      const current = cursors.get(symbol) ?? {}
      cursors.set(symbol, {
        ...current,
        lastOrderId,
      })
    },
    saveTradeCursor: async ({ symbol, lastTradeId }) => {
      const current = cursors.get(symbol) ?? {}
      cursors.set(symbol, {
        ...current,
        lastTradeId,
      })
    },
  }
}

function createRepositories() {
  const orders = []
  const fills = []
  const cursors = new Map()
  const orderIdentities = new Map()
  return {
    orders,
    fills,
    cursors,
    orderRepository: createOrderRepository({
      orders,
      orderIdentities,
    }),
    fillRepository: createFillRepository({
      fills,
    }),
    cursorRepository: createCursorRepository({
      cursors,
    }),
  }
}

function createPagedBroker({ orders, fills, calls }) {
  return {
    getCanonicalOrderHistory: async ({ symbol, orderId, limit, includeFollowingOrders }) => {
      calls.orders.push({
        symbol,
        orderId,
        limit,
        includeFollowingOrders,
      })
      const page = orders
        .filter((order) => order.market.symbol === symbol && Number(order.brokerOrderId) >= orderId)
        .slice(0, limit)
      return {
        ok: true,
        data: page,
      }
    },
    getFills: async ({ symbol, fromId, limit }) => {
      calls.fills.push({
        symbol,
        fromId,
        limit,
      })
      const page = fills
        .filter((fill) => fill.market.symbol === symbol && Number(fill.tradeId) >= fromId)
        .slice(0, limit)
      return {
        ok: true,
        data: page,
      }
    },
  }
}

test("paginates configured-market order and trade history and persists exchange provenance", async () => {
  const repositories = createRepositories()
  const calls = {
    orders: [],
    fills: [],
  }
  const broker = createPagedBroker({
    orders: [createOrder()],
    fills: [createFill()],
    calls,
  })
  const result = await synchronizeAccountHistory({
    broker,
    symbols: ["BTCUSDT"],
    providerIdentity: identity,
    environment: "testnet",
    orderRepository: repositories.orderRepository,
    fillRepository: repositories.fillRepository,
    cursorRepository: repositories.cursorRepository,
    limit: 1,
    requestDelayMs: 0,
    now: () => 300,
  })

  assert.equal(result.ok, true, result.errors?.map((error) => error.message).join("; "))
  assert.equal(result.data.historyScope, "CONFIGURED_MARKETS")
  assert.equal(result.data.marketUniverseComplete, false)
  assert.equal(result.data.retentionCoverageConfirmed, false)
  assert.equal(result.data.ordersPersisted, 1)
  assert.equal(result.data.fillsPersisted, 1)
  assert.ok(
    calls.orders.every(({ includeFollowingOrders }) => includeFollowingOrders === true),
    "Every historical order scan must explicitly request inclusive lower-bound pagination.",
  )
  assert.equal(repositories.orders[0].ownership, undefined)
  assert.equal(repositories.fills[0].ingestionSource, "exchange_history")
  assert.equal(repositories.fills[0].fill.clientOrderId, "harvester-10")
  assert.deepEqual(
    calls.orders.map(({ orderId }) => orderId),
    [0, 11],
  )
  assert.deepEqual(
    calls.fills.map(({ fromId }) => fromId),
    [0, 2],
  )
})

test("rejects exchange orders carrying a different provider or account identity", async () => {
  const repositories = createRepositories()
  const calls = {
    orders: [],
    fills: [],
  }
  const broker = createPagedBroker({
    orders: [createOrder({
      providerIdentity: {
        ...identity,
        accountId: "different-account",
      },
    })],
    fills: [],
    calls,
  })
  const result = await synchronizeAccountHistory({
    broker,
    symbols: ["BTCUSDT"],
    providerIdentity: identity,
    environment: "testnet",
    orderRepository: repositories.orderRepository,
    fillRepository: repositories.fillRepository,
    cursorRepository: repositories.cursorRepository,
    limit: 1,
    requestDelayMs: 0,
    now: () => 300,
  })

  assert.equal(result.ok, false, "A mismatched exchange account must fail history synchronization.")
  const [error] = result.errors
  assert.match(error.cause.errors[0].message, /provider identity conflicts/i, "The failure must identify the provider-identity conflict.")
  assert.equal(repositories.orders.length, 0, "A foreign-account order must never be persisted under the configured account.")
  assert.equal(repositories.fills.length, 0, "No fill scan may proceed after an identity-conflicting order page.")
})

function createOrderWriteFailureScenario() {
  const repositories = createRepositories()
  const calls = {
    orders: [],
    fills: [],
  }
  const broker = createPagedBroker({
    orders: [
      createOrder({
        orderId: "10",
        clientOrderId: "first-order",
      }),
      createOrder({
        orderId: "11",
        clientOrderId: "second-order",
      }),
    ],
    fills: [],
    calls,
  })
  const originalUpsert = repositories.orderRepository.upsertHistorical
  let failSecondOrder = true
  repositories.orderRepository.upsertHistorical = async (record) => {
    if (failSecondOrder && record.brokerOrderId === "11") {
      throw new Error("simulated second-order persistence failure")
    }
    await originalUpsert(record)
  }
  return {
    repositories,
    calls,
    input: {
      broker,
      symbols: ["BTCUSDT"],
      providerIdentity: identity,
      environment: "testnet",
      orderRepository: repositories.orderRepository,
      fillRepository: repositories.fillRepository,
      cursorRepository: repositories.cursorRepository,
      limit: 2,
      requestDelayMs: 0,
      now: () => 300,
    },
    allowRetry: () => {
      failSecondOrder = false
    },
  }
}

function assertOrderWriteFailure({ failed, repositories }) {
  assert.equal(failed.ok, false, "A failed record write must fail the current history page.")
  const [failureResult] = failed.errors
  const { historyDiagnostics: diagnostics } = failureResult
  const [failure] = diagnostics.failures
  assert.equal(diagnostics.failureCount, 1, "The failed order page must produce one market failure.")
  assert.equal(failure.market, "BTCUSDT", "The failed order page must identify its market.")
  assert.equal(failure.historyType, "orders", "The failure must identify order history.")
  assert.equal(failure.failureStage, "ORDER_RECORD_PERSIST", "The failure must identify the record persistence stage.")
  assert.equal(failure.pageCursor, "0", "The failed order page must retain its original cursor.")
  assert.equal(failure.recordIndex, 2, "The failure must identify the 1-based second record position.")
  assert.equal(failure.brokerOrderId, "11", "The failure must retain the exchange order ID.")
  assert.equal(failure.clientOrderId, "second-order", "The failure must retain the client order ID.")
  assert.equal(failure.lastPersistedOrderId, "10", "The failure must retain the last successfully persisted order ID.")
  assert.equal(diagnostics.orderPagesChecked, 1, "The failed page request must count as checked.")
  assert.equal(diagnostics.ordersPersisted, 1, "The successful first order write must be counted.")
  assert.equal(repositories.cursors.get("BTCUSDT")?.lastOrderId, undefined, "A partial page write must not advance the order cursor.")
  assert.equal(repositories.orders.length, 1, "The successful first order must remain available for idempotent replay.")
}

function assertOrderWriteReplay({ retried, calls, repositories }) {
  assert.equal(retried.ok, true, "A retried page must complete after persistence recovers.")
  assert.deepEqual(
    calls.orders.slice(0, 2).map(({ orderId }) => orderId),
    [0, 0],
    "The failed order page must be requested again from its original cursor.",
  )
  assert.equal(repositories.orders.length, 2, "Replay must leave exactly one row for each canonical order.")
  assert.equal(repositories.cursors.get("BTCUSDT").lastOrderId, "11", "The cursor may advance only after the complete order page is persisted.")
}

test("replays a page after an order write failure without advancing its durable cursor", async () => {
  const scenario = createOrderWriteFailureScenario()
  const failed = await synchronizeAccountHistory(scenario.input)
  assertOrderWriteFailure({
    failed,
    repositories: scenario.repositories,
  })
  scenario.allowRetry()
  const retried = await synchronizeAccountHistory(scenario.input)
  assertOrderWriteReplay({
    retried,
    calls: scenario.calls,
    repositories: scenario.repositories,
  })
})



function createFillWriteFailureScenario() {
  const repositories = createRepositories()
  const calls = {
    orders: [],
    fills: [],
  }
  const broker = createPagedBroker({
    orders: [],
    fills: [
      createFill({
        tradeId: "1",
        orderId: "10",
        clientOrderId: null,
      }),
      createFill({
        tradeId: "2",
        orderId: "11",
        clientOrderId: null,
      }),
    ],
    calls,
  })
  const originalUpsert = repositories.fillRepository.upsert
  let failSecondFill = true
  repositories.fillRepository.upsert = async (input) => {
    if (failSecondFill && input.fill.tradeId === "2") {
      throw new Error("simulated second-fill persistence failure")
    }
    await originalUpsert(input)
  }
  return {
    repositories,
    calls,
    input: {
      broker,
      symbols: ["BTCUSDT"],
      providerIdentity: identity,
      environment: "testnet",
      orderRepository: repositories.orderRepository,
      fillRepository: repositories.fillRepository,
      cursorRepository: repositories.cursorRepository,
      limit: 2,
      requestDelayMs: 0,
      now: () => 300,
    },
    allowRetry: () => {
      failSecondFill = false
    },
  }
}

function assertFillWriteFailure({ failed, repositories }) {
  assert.equal(failed.ok, false, "A failed fill write must fail the current trade-history page.")
  const [failureResult] = failed.errors
  const { historyDiagnostics: diagnostics } = failureResult
  const [failure] = diagnostics.failures
  assert.equal(diagnostics.failureCount, 1, "The failed trade page must produce one market failure.")
  assert.equal(failure.historyType, "trades", "The failure must identify trade history.")
  assert.equal(failure.failureStage, "FILL_RECORD_PERSIST", "The failure must identify fill-record persistence.")
  assert.equal(failure.pageCursor, "0", "The failed trade page must retain its original cursor.")
  assert.equal(failure.recordIndex, 2, "The failure must identify the 1-based second fill position.")
  assert.equal(failure.tradeId, "2", "The failure must retain the exchange trade ID.")
  assert.equal(failure.brokerOrderId, "11", "The failed fill must retain its exchange order ID.")
  assert.equal(failure.lastPersistedTradeId, "1", "The failure must retain the last successfully persisted trade ID.")
  assert.equal(diagnostics.fillPagesChecked, 1, "The failed trade page request must count as checked.")
  assert.equal(diagnostics.fillsPersisted, 1, "The successful first fill write must be counted.")
  assert.equal(repositories.cursors.get("BTCUSDT")?.lastTradeId, undefined, "A partial fill page write must not advance the trade cursor.")
  assert.equal(repositories.fills.length, 1, "The successful first fill must remain available for idempotent replay.")
}

function assertFillWriteReplay({ retried, calls, repositories }) {
  assert.equal(retried.ok, true, "A retried trade page must complete after persistence recovers.")
  assert.deepEqual(
    calls.fills.slice(0, 2).map(({ fromId }) => fromId),
    [0, 0],
    "The failed trade page must be requested again from its original cursor.",
  )
  assert.equal(repositories.fills.length, 2, "Replay must leave exactly one row for each canonical fill.")
  assert.equal(repositories.cursors.get("BTCUSDT").lastTradeId, "2", "The cursor may advance only after the complete trade page is persisted.")
}

test("replays a trade page after a fill write failure without advancing its durable cursor", async () => {
  const scenario = createFillWriteFailureScenario()
  const failed = await synchronizeAccountHistory(scenario.input)
  assertFillWriteFailure({
    failed,
    repositories: scenario.repositories,
  })
  scenario.allowRetry()
  const retried = await synchronizeAccountHistory(scenario.input)
  assertFillWriteReplay({
    retried,
    calls: scenario.calls,
    repositories: scenario.repositories,
  })
})

test("rejects a historical fill carrying a different provider or account identity", async () => {
  const repositories = createRepositories()
  const calls = {
    orders: [],
    fills: [],
  }
  const broker = createPagedBroker({
    orders: [],
    fills: [createFill({
      providerIdentity: {
        ...identity,
        accountId: "different-account",
      },
    })],
    calls,
  })
  const result = await synchronizeAccountHistory({
    broker,
    symbols: ["BTCUSDT"],
    providerIdentity: identity,
    environment: "testnet",
    orderRepository: repositories.orderRepository,
    fillRepository: repositories.fillRepository,
    cursorRepository: repositories.cursorRepository,
    limit: 1,
    requestDelayMs: 0,
    now: () => 300,
  })

  assert.equal(result.ok, false, "A foreign-account execution must fail closed.")
  const [error] = result.errors
  assert.match(error.cause.errors[0].message, /provider identity conflicts/i, "The failure must identify the provider-identity conflict.")
  assert.equal(repositories.fills.length, 0, "A foreign-account fill must never be persisted under the configured account.")
  assert.equal(repositories.cursors.get("BTCUSDT")?.lastTradeId, undefined, "A rejected fill must not advance the trade cursor.")
})

test("replays a fully persisted order page when its cursor write fails", async () => {
  const repositories = createRepositories()
  const calls = {
    orders: [],
    fills: [],
  }
  const broker = createPagedBroker({
    orders: [createOrder()],
    fills: [],
    calls,
  })
  const { saveOrderCursor } = repositories.cursorRepository
  let failCursorWrite = true
  repositories.cursorRepository.saveOrderCursor = async (input) => {
    if (failCursorWrite) {
      throw new Error("simulated order cursor write failure")
    }
    await saveOrderCursor(input)
  }
  const input = {
    broker,
    symbols: ["BTCUSDT"],
    providerIdentity: identity,
    environment: "testnet",
    orderRepository: repositories.orderRepository,
    fillRepository: repositories.fillRepository,
    cursorRepository: repositories.cursorRepository,
    limit: 1,
    requestDelayMs: 0,
    now: () => 300,
  }

  const failed = await synchronizeAccountHistory(input)
  assert.equal(failed.ok, false, "A failed cursor write must leave the page retryable.")
  const [failureResult] = failed.errors
  const [failure] = failureResult.historyDiagnostics.failures
  assert.equal(failure.failureStage, "ORDER_CURSOR_SAVE", "Diagnostics must distinguish cursor persistence from order-record persistence.")
  assert.equal(failure.pageCursor, "0", "Cursor failures must retain the original page start.")
  assert.equal(failure.lastPersistedOrderId, "10", "Cursor failures must report the final persisted order before advancement.")
  assert.equal(repositories.orders.length, 1, "The order page may be fully persisted before its cursor write fails.")
  assert.equal(repositories.cursors.get("BTCUSDT")?.lastOrderId, undefined, "The failed cursor write must leave the durable cursor unchanged.")

  failCursorWrite = false
  const retried = await synchronizeAccountHistory(input)
  assert.equal(retried.ok, true, "The fully persisted page must replay successfully after cursor storage recovers.")
  assert.deepEqual(calls.orders.map(({ orderId }) => orderId), [0, 0, 11], "The page must replay from its original cursor before advancing.")
  assert.equal(repositories.orders.length, 1, "The replay must remain idempotent at the order identity.")
  assert.equal(repositories.cursors.get("BTCUSDT").lastOrderId, "10", "The cursor may advance after the replayed page is complete.")
})

test("replays a fully persisted trade page when its cursor write fails", async () => {
  const repositories = createRepositories()
  const calls = {
    orders: [],
    fills: [],
  }
  const broker = createPagedBroker({
    orders: [],
    fills: [createFill({
      clientOrderId: null,
    })],
    calls,
  })
  const { saveTradeCursor } = repositories.cursorRepository
  let failCursorWrite = true
  repositories.cursorRepository.saveTradeCursor = async (input) => {
    if (failCursorWrite) {
      throw new Error("simulated trade cursor write failure")
    }
    await saveTradeCursor(input)
  }
  const input = {
    broker,
    symbols: ["BTCUSDT"],
    providerIdentity: identity,
    environment: "testnet",
    orderRepository: repositories.orderRepository,
    fillRepository: repositories.fillRepository,
    cursorRepository: repositories.cursorRepository,
    limit: 1,
    requestDelayMs: 0,
    now: () => 300,
  }

  const failed = await synchronizeAccountHistory(input)
  assert.equal(failed.ok, false, "A failed trade cursor write must leave the page retryable.")
  const [failureResult] = failed.errors
  const [failure] = failureResult.historyDiagnostics.failures
  assert.equal(failure.failureStage, "TRADE_CURSOR_SAVE", "Diagnostics must distinguish cursor persistence from fill-record persistence.")
  assert.equal(failure.pageCursor, "0", "Trade cursor failures must retain the original page start.")
  assert.equal(failure.lastPersistedTradeId, "1", "Trade cursor failures must report the final persisted trade before advancement.")
  assert.equal(repositories.fills.length, 1, "The fill page may be fully persisted before its cursor write fails.")
  assert.equal(repositories.cursors.get("BTCUSDT")?.lastTradeId, undefined, "The failed trade cursor write must leave the durable cursor unchanged.")

  failCursorWrite = false
  const retried = await synchronizeAccountHistory(input)
  assert.equal(retried.ok, true, "The fully persisted trade page must replay successfully after cursor storage recovers.")
  assert.deepEqual(calls.fills.map(({ fromId }) => fromId), [0, 0, 2], "The trade page must replay from its original cursor before advancing.")
  assert.equal(repositories.fills.length, 1, "The replay must remain idempotent at the execution identity.")
  assert.equal(repositories.cursors.get("BTCUSDT").lastTradeId, "1", "The trade cursor may advance after the replayed page is complete.")
})

test("fails closed when an exchange history cursor does not advance", async () => {
  const repositories = createRepositories()
  const broker = {
    getCanonicalOrderHistory: async () => ({
      ok: true,
      data: [
        createOrder({
          orderId: "10",
        }),
        createOrder({
          orderId: "10",
        }),
      ],
    }),
    getFills: async () => ({
      ok: true,
      data: [],
    }),
  }
  const result = await synchronizeAccountHistory({
    broker,
    symbols: ["BTCUSDT"],
    providerIdentity: identity,
    environment: "testnet",
    orderRepository: repositories.orderRepository,
    fillRepository: repositories.fillRepository,
    cursorRepository: repositories.cursorRepository,
    limit: 2,
    requestDelayMs: 0,
    now: () => 300,
  })

  assert.equal(result.ok, false, "A non-advancing exchange cursor must fail history synchronization.")
  const [error] = result.errors
  assert.match(error.cause.errors[0].message, /strictly increasing/, "A repeated exchange ID must fail the monotonic cursor guard.")
  assert.deepEqual(error.historyDiagnostics.marketsAttempted, ["BTCUSDT"], "The failed cursor scan must report the attempted market.")
  assert.equal(error.historyDiagnostics.orderPagesChecked, 1, "The repeated-ID page request must be counted.")
  assert.equal(error.historyDiagnostics.historyPagesComplete, false, "A non-advancing page must leave history incomplete.")
  assert.equal(repositories.orders.length, 0, "A page with non-advancing IDs must not persist records.")
  assert.equal(repositories.fills.length, 0, "A rejected order page must prevent fill persistence.")
})


test("scopes repeated exchange order and trade IDs independently by configured market", async () => {
  const ethAsset = new Asset({
    id: "eth",
    code: "ETH",
  })
  const ethMarket = new Market({
    venue: "binance",
    symbol: "ETHUSDT",
    baseAsset: ethAsset,
    quoteAsset,
  })
  const repositories = createRepositories()
  const calls = {
    orders: [],
    fills: [],
  }
  const broker = createPagedBroker({
    orders: [
      createOrder({
        orderMarket: market,
        clientOrderId: "btc-order",
      }),
      createOrder({
        orderMarket: ethMarket,
        clientOrderId: "eth-order",
      }),
    ],
    fills: [
      createFill({
        fillMarket: market,
        clientOrderId: "btc-order",
      }),
      createFill({
        fillMarket: ethMarket,
        clientOrderId: "eth-order",
      }),
    ],
    calls,
  })
  const result = await synchronizeAccountHistory({
    broker,
    symbols: ["BTCUSDT", "ETHUSDT"],
    providerIdentity: identity,
    environment: "testnet",
    orderRepository: repositories.orderRepository,
    fillRepository: repositories.fillRepository,
    cursorRepository: repositories.cursorRepository,
    limit: 1,
    requestDelayMs: 0,
    now: () => 300,
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.data.marketsQueried, ["BTCUSDT", "ETHUSDT"])
  assert.equal(result.data.ordersPersisted, 2)
  assert.equal(result.data.fillsPersisted, 2)
  assert.deepEqual(
    repositories.fills.map(({ fill }) => fill.clientOrderId),
    ["btc-order", "eth-order"],
  )
})


test("resumes from durable per-market cursors without re-persisting prior pages", async () => {
  const repositories = createRepositories()
  const calls = {
    orders: [],
    fills: [],
  }
  const broker = createPagedBroker({
    orders: [createOrder()],
    fills: [createFill()],
    calls,
  })
  const input = {
    broker,
    symbols: ["BTCUSDT"],
    providerIdentity: identity,
    environment: "testnet",
    orderRepository: repositories.orderRepository,
    fillRepository: repositories.fillRepository,
    cursorRepository: repositories.cursorRepository,
    limit: 1,
    requestDelayMs: 0,
    now: () => 300,
  }
  const first = await synchronizeAccountHistory(input)
  const second = await synchronizeAccountHistory(input)

  assert.equal(first.ok, true, first.errors?.map((error) => error.message).join("; "))
  assert.equal(second.ok, true, second.errors?.map((error) => error.message).join("; "))
  assert.deepEqual(
    calls.orders.map(({ orderId }) => orderId),
    [0, 11, 11],
  )
  assert.deepEqual(
    calls.fills.map(({ fromId }) => fromId),
    [0, 2, 2],
  )
  assert.equal(second.data.ordersPersisted, 0)
  assert.equal(second.data.fillsPersisted, 0)
})


test("rechecks a pending order behind the cursor and links its later offline fill", async () => {
  const repositories = createRepositories()
  const calls = {
    orders: [],
    fills: [],
  }
  const orders = [
    createOrder({
      executed: "0",
    }),
  ]
  const fills = []
  const broker = createPagedBroker({
    orders,
    fills,
    calls,
  })
  const input = {
    broker,
    symbols: ["BTCUSDT"],
    providerIdentity: identity,
    environment: "testnet",
    orderRepository: repositories.orderRepository,
    fillRepository: repositories.fillRepository,
    cursorRepository: repositories.cursorRepository,
    limit: 1,
    requestDelayMs: 0,
    now: () => 300,
  }
  const first = await synchronizeAccountHistory(input)
  orders[0] = createOrder({
    executed: "0.1",
  })
  fills.push(createFill({
    clientOrderId: null,
  }))
  const second = await synchronizeAccountHistory(input)

  assert.equal(first.ok, true, first.errors?.map((error) => error.message).join("; "))
  assert.equal(first.data.ordersPersisted, 1)
  assert.equal(second.ok, true, second.errors?.map((error) => error.message).join("; "))
  assert.equal(second.data.ordersObserved, 1)
  assert.equal(second.data.fillsPersisted, 1)
  assert.equal(repositories.orders.at(-1).status, "FILLED")
  assert.equal(repositories.fills[0].fill.clientOrderId, "harvester-10")
})


test("links later fills to a stored order after its order cursor has advanced", async () => {
  const repositories = createRepositories()
  const calls = {
    orders: [],
    fills: [],
  }
  const orders = [createOrder()]
  const fills = []
  const broker = createPagedBroker({
    orders,
    fills,
    calls,
  })
  const input = {
    broker,
    symbols: ["BTCUSDT"],
    providerIdentity: identity,
    environment: "testnet",
    orderRepository: repositories.orderRepository,
    fillRepository: repositories.fillRepository,
    cursorRepository: repositories.cursorRepository,
    limit: 1,
    requestDelayMs: 0,
    now: () => 300,
  }
  const first = await synchronizeAccountHistory(input)
  fills.push(createFill({
    clientOrderId: null,
  }))
  const second = await synchronizeAccountHistory(input)

  assert.equal(first.ok, true)
  assert.equal(second.ok, true, second.errors?.map((error) => error.message).join("; "))
  assert.deepEqual(
    calls.orders.map(({ orderId }) => orderId),
    [0, 11, 11],
  )
  assert.equal(second.data.ordersObserved, 0)
  assert.equal(second.data.fillsPersisted, 1)
  assert.equal(repositories.fills[0].fill.clientOrderId, "harvester-10")
})



function createMarketFailureBroker({ calls, orderFailure, tradeFailure }) {
  return {
    getCanonicalOrderHistory: async ({ symbol, orderId }) => {
      calls.orders.push({
        symbol,
        orderId,
      })
      if (orderFailure && symbol === "BTCUSDT") {
        throw orderFailure
      }
      return {
        ok: true,
        data: [],
      }
    },
    getFills: async ({ symbol, fromId }) => {
      calls.fills.push({
        symbol,
        fromId,
      })
      if (tradeFailure && symbol === "BTCUSDT") {
        throw tradeFailure
      }
      return {
        ok: true,
        data: [],
      }
    },
  }
}

test("continues independent markets after an order-history failure", async () => {
  const repositories = createRepositories()
  const calls = {
    orders: [],
    fills: [],
  }
  const orderFailure = new Error("simulated BTC order-history request failure")
  const broker = createMarketFailureBroker({
    calls,
    orderFailure,
  })
  const result = await synchronizeAccountHistory({
    broker,
    symbols: ["BTCUSDT", "ETHUSDT"],
    providerIdentity: identity,
    environment: "testnet",
    orderRepository: repositories.orderRepository,
    fillRepository: repositories.fillRepository,
    cursorRepository: repositories.cursorRepository,
    requestDelayMs: 0,
    now: () => 300,
  })

  assert.equal(result.ok, false, "A failed market must keep the overall history result incomplete.")
  const [error] = result.errors
  const { historyDiagnostics: diagnostics } = error
  assert.equal(error.code, "HARVESTER_ACCOUNT_HISTORY_SYNC_FAILED", "The operation must expose its stable error code.")
  assert.ok(error.cause instanceof AggregateError, "The aggregate error must retain an AggregateError cause.")
  assert.equal(error.cause.errors[0], orderFailure, "The original order-history error object must remain the cause.")
  assert.deepEqual(calls.orders.map(({ symbol }) => symbol), ["BTCUSDT", "ETHUSDT"], "Every configured market must receive an order-history attempt.")
  assert.deepEqual(calls.fills.map(({ symbol }) => symbol), ["ETHUSDT"], "The failed market must skip fills while the next market continues.")
  assert.deepEqual(diagnostics.marketsAttempted, ["BTCUSDT", "ETHUSDT"], "Diagnostics must preserve every attempted market in order.")
  assert.deepEqual(diagnostics.orderMarketsQueried, ["ETHUSDT"], "Only the later market may complete order history.")
  assert.deepEqual(diagnostics.fillMarketsQueried, ["ETHUSDT"], "The later market must complete fill history.")
  assert.deepEqual(diagnostics.marketsQueried, ["ETHUSDT"], "Only fully synchronized markets may be marked queried.")
  assert.deepEqual(diagnostics.marketsFailed, ["BTCUSDT"], "The failed market must remain in diagnostics.")
  assert.equal(diagnostics.currentMarket, null, "The scan must clear its active-market marker after completion.")
  assert.equal(diagnostics.failureCount, 1, "The order failure must be counted once.")
  assert.equal(diagnostics.historyPagesComplete, false, "One failed market must keep the overall history scan incomplete.")
  assert.equal(diagnostics.failures[0].historyType, "orders", "The failure record must identify order history.")
  assert.equal(diagnostics.failures[0].failureStage, "ORDER_PAGE_FETCH", "The failure record must identify the order-page fetch stage.")
  assert.equal(diagnostics.failures[0].pageCursor, "0", "The failure record must preserve the failed order-page cursor.")
  assert.equal(repositories.cursors.has("BTCUSDT"), false, "A failed market must not persist a cursor.")
})

test("continues independent markets after a trade-history failure", async () => {
  const repositories = createRepositories()
  const calls = {
    orders: [],
    fills: [],
  }
  const tradeFailure = new Error("simulated BTC trade-history request failure")
  const broker = createMarketFailureBroker({
    calls,
    tradeFailure,
  })
  const result = await synchronizeAccountHistory({
    broker,
    symbols: ["BTCUSDT", "ETHUSDT"],
    providerIdentity: identity,
    environment: "testnet",
    orderRepository: repositories.orderRepository,
    fillRepository: repositories.fillRepository,
    cursorRepository: repositories.cursorRepository,
    requestDelayMs: 0,
    now: () => 300,
  })

  assert.equal(result.ok, false, "A failed trade-history page must keep the overall result incomplete.")
  const [error] = result.errors
  const { historyDiagnostics: diagnostics } = error
  assert.ok(error.cause instanceof AggregateError, "The aggregate error must retain an AggregateError cause.")
  assert.equal(error.cause.errors[0], tradeFailure, "The original trade-history error object must remain the cause.")
  assert.deepEqual(calls.orders.map(({ symbol }) => symbol), ["BTCUSDT", "ETHUSDT"], "Both configured markets must receive an order-history attempt.")
  assert.deepEqual(calls.fills.map(({ symbol }) => symbol), ["BTCUSDT", "ETHUSDT"], "The later market must still receive a fill-history attempt.")
  assert.deepEqual(diagnostics.orderMarketsQueried, ["BTCUSDT", "ETHUSDT"], "Both markets must complete order history before fill scanning.")
  assert.deepEqual(diagnostics.fillMarketsQueried, ["ETHUSDT"], "Only the later market may complete fill history.")
  assert.deepEqual(diagnostics.marketsQueried, ["ETHUSDT"], "Only fully synchronized markets may be marked queried.")
  assert.deepEqual(diagnostics.marketsFailed, ["BTCUSDT"], "The failed market must remain in diagnostics.")
  assert.equal(diagnostics.failures[0].historyType, "trades", "The failure record must identify trade history.")
  assert.equal(diagnostics.failures[0].failureStage, "TRADE_PAGE_FETCH", "The failure record must identify the trade-page fetch stage.")
  assert.equal(diagnostics.failures[0].pageCursor, "0", "The failure record must preserve the failed trade-page cursor.")
  assert.equal(repositories.cursors.has("BTCUSDT"), false, "A failed market must not persist a cursor.")
})
