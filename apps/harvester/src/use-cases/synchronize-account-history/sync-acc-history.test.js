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
const secondBaseAsset = new Asset({
  id: "eth",
  code: "ETH",
})
const secondMarket = new Market({
  venue: "binance",
  symbol: "ETHUSDT",
  baseAsset: secondBaseAsset,
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
  assert.match(result.errors[0].message, /provider identity conflicts/i, "The failure must identify the provider-identity conflict.")
  assert.equal(repositories.orders.length, 0, "A foreign-account order must never be persisted under the configured account.")
  assert.equal(repositories.fills.length, 0, "No fill scan may proceed after an identity-conflicting order page.")
})

test("replays a page after an order write failure without advancing its durable cursor", async () => {
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
  const input = {
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
  }

  const failed = await synchronizeAccountHistory(input)
  assert.equal(failed.ok, false, "A failed record write must fail the current history page.")
  const diagnostics = failed.errors[0].historyDiagnostics
  assert.equal(diagnostics.failureCount, 1, "The failed page must be represented in startup diagnostics.")
  const failure = diagnostics.failures[0]
  assert.equal(failure.market, "BTCUSDT", "Diagnostics must identify the market whose page failed.")
  assert.equal(failure.historyType, "orders", "Diagnostics must identify the failed history type.")
  assert.equal(failure.failureStage, "ORDER_RECORD_PERSIST", "Diagnostics must identify the failed persistence stage.")
  assert.equal(failure.pageCursor, "0", "Diagnostics must retain the original page cursor.")
  assert.equal(failure.recordIndex, 2, "Diagnostics must identify the 1-based failing record position.")
  assert.equal(failure.brokerOrderId, "11", "Diagnostics must retain the failing exchange order ID.")
  assert.equal(failure.clientOrderId, "second-order", "Diagnostics must retain the failing client order ID.")
  assert.equal(failure.lastPersistedOrderId, "10", "Diagnostics must retain the last successfully persisted order ID.")
  assert.equal(diagnostics.orderPagesChecked, 1, "Diagnostics must count the page request before persistence failed.")
  assert.equal(diagnostics.ordersPersisted, 1, "Diagnostics must report records persisted before the failure.")
  assert.equal(repositories.cursors.get("BTCUSDT")?.lastOrderId, undefined, "The order cursor must remain unchanged after a partial page write.")
  assert.equal(repositories.orders.length, 1, "A successfully written record may remain available for idempotent replay.")

  failSecondOrder = false
  const retried = await synchronizeAccountHistory(input)
  assert.equal(retried.ok, true, "A retried page must complete after persistence recovers.")
  assert.deepEqual(calls.orders.slice(0, 2).map(({ orderId }) => orderId), [0, 0], "The failed page must be requested again from its original cursor.")
  assert.equal(repositories.orders.length, 2, "Page replay must leave one relational order per canonical identity.")
  assert.equal(repositories.cursors.get("BTCUSDT").lastOrderId, "11", "The cursor may advance only after every order in the page is persisted.")
})

test("replays a trade page after a fill write failure without advancing its durable cursor", async () => {
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
  const input = {
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
  }

  const failed = await synchronizeAccountHistory(input)
  assert.equal(failed.ok, false, "A failed fill write must fail the current trade-history page.")
  const diagnostics = failed.errors[0].historyDiagnostics
  assert.equal(diagnostics.failureCount, 1, "A failed trade page must be represented in startup diagnostics.")
  const failure = diagnostics.failures[0]
  assert.equal(failure.historyType, "trades", "Diagnostics must identify the failed history type.")
  assert.equal(failure.failureStage, "FILL_RECORD_PERSIST", "Diagnostics must identify the failed fill persistence stage.")
  assert.equal(failure.pageCursor, "0", "Diagnostics must retain the original trade page cursor.")
  assert.equal(failure.recordIndex, 2, "Diagnostics must identify the 1-based failing trade position.")
  assert.equal(failure.tradeId, "2", "Diagnostics must retain the failing exchange trade ID.")
  assert.equal(failure.brokerOrderId, "11", "Diagnostics must retain the exchange order ID for the failing fill.")
  assert.equal(failure.lastPersistedTradeId, "1", "Diagnostics must retain the last successfully persisted trade ID.")
  assert.equal(diagnostics.fillPagesChecked, 1, "Diagnostics must count the trade page request before persistence failed.")
  assert.equal(diagnostics.fillsPersisted, 1, "Diagnostics must report fills persisted before the failure.")
  assert.equal(repositories.cursors.get("BTCUSDT")?.lastTradeId, undefined, "The trade cursor must remain unchanged after a partial page write.")
  assert.equal(repositories.fills.length, 1, "A successfully written fill may remain available for idempotent replay.")

  failSecondFill = false
  const retried = await synchronizeAccountHistory(input)
  assert.equal(retried.ok, true, "A retried trade page must complete after persistence recovers.")
  assert.deepEqual(calls.fills.slice(0, 2).map(({ fromId }) => fromId), [0, 0], "The failed trade page must be requested again from its original cursor.")
  assert.equal(repositories.fills.length, 2, "Idempotent fill upserts must leave one row per execution after replay.")
  assert.equal(repositories.cursors.get("BTCUSDT").lastTradeId, "2", "The trade cursor may advance only after every fill in the page is persisted.")
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
  assert.match(result.errors[0].message, /provider identity conflicts/i, "The failure must identify the provider-identity conflict.")
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
  const failure = failed.errors[0].historyDiagnostics.failures[0]
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
  const failure = failed.errors[0].historyDiagnostics.failures[0]
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

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /strictly increasing/)
  assert.deepEqual(result.errors[0].historyDiagnostics.marketsAttempted, ["BTCUSDT"])
  assert.equal(result.errors[0].historyDiagnostics.orderPagesChecked, 1)
  assert.equal(result.errors[0].historyDiagnostics.historyPagesComplete, false)
  assert.equal(repositories.orders.length, 0)
  assert.equal(repositories.fills.length, 0)
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


test("continues independent markets after an order-history failure", async () => {
  const repositories = createRepositories()
  const calls = {
    orders: [],
    fills: [],
  }
  const orderFailure = new Error("simulated BTC order-history request failure")
  const broker = {
    getCanonicalOrderHistory: async ({ symbol, orderId }) => {
      calls.orders.push({ symbol, orderId })
      if (symbol === "BTCUSDT") {
        throw orderFailure
      }
      return { ok: true, data: [] }
    },
    getFills: async ({ symbol, fromId }) => {
      calls.fills.push({ symbol, fromId })
      return { ok: true, data: [] }
    },
  }
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

  assert.equal(result.ok, false, "Any failed market must keep the overall history result incomplete.")
  const error = result.errors[0]
  const diagnostics = error.historyDiagnostics
  assert.equal(error.code, "HARVESTER_ACCOUNT_HISTORY_SYNC_FAILED", "The use case must expose its stable operation error code.")
  assert.ok(error.cause instanceof AggregateError, "The operation error must retain all original market failures.")
  assert.equal(error.cause.errors[0], orderFailure, "The original broker failure identity must be preserved.")
  assert.deepEqual(calls.orders.map(({ symbol }) => symbol), ["BTCUSDT", "ETHUSDT"], "The order scan must continue with later independent markets.")
  assert.deepEqual(calls.fills.map(({ symbol }) => symbol), ["ETHUSDT"], "A market with incomplete order history must skip its fill scan, while later markets continue.")
  assert.deepEqual(diagnostics.marketsAttempted, ["BTCUSDT", "ETHUSDT"])
  assert.deepEqual(diagnostics.orderMarketsQueried, ["ETHUSDT"])
  assert.deepEqual(diagnostics.fillMarketsQueried, ["ETHUSDT"])
  assert.deepEqual(diagnostics.marketsQueried, ["ETHUSDT"])
  assert.deepEqual(diagnostics.marketsFailed, ["BTCUSDT"])
  assert.equal(diagnostics.currentMarket, null, "The completed orchestration must not leave a failed market marked active.")
  assert.equal(diagnostics.failureCount, 1)
  assert.equal(diagnostics.historyPagesComplete, false)
  assert.equal(diagnostics.failures[0].historyType, "orders")
  assert.equal(diagnostics.failures[0].failureStage, "ORDER_PAGE_FETCH")
  assert.equal(diagnostics.failures[0].pageCursor, "0")
  assert.equal(repositories.cursors.has("BTCUSDT"), false, "A failed order page must not create or advance its cursor.")
})

test("continues independent markets after a trade-history failure", async () => {
  const repositories = createRepositories()
  const calls = {
    orders: [],
    fills: [],
  }
  const tradeFailure = new Error("simulated BTC trade-history request failure")
  const broker = {
    getCanonicalOrderHistory: async ({ symbol, orderId }) => {
      calls.orders.push({ symbol, orderId })
      return { ok: true, data: [] }
    },
    getFills: async ({ symbol, fromId }) => {
      calls.fills.push({ symbol, fromId })
      if (symbol === "BTCUSDT") {
        throw tradeFailure
      }
      return { ok: true, data: [] }
    },
  }
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

  assert.equal(result.ok, false, "Any failed trade-history page must keep the overall result incomplete.")
  const error = result.errors[0]
  const diagnostics = error.historyDiagnostics
  assert.ok(error.cause instanceof AggregateError, "The use case must preserve the original trade-history failure.")
  assert.equal(error.cause.errors[0], tradeFailure, "The original trade-history error identity must be retained.")
  assert.deepEqual(calls.orders.map(({ symbol }) => symbol), ["BTCUSDT", "ETHUSDT"], "Both markets must complete their independent order scans.")
  assert.deepEqual(calls.fills.map(({ symbol }) => symbol), ["BTCUSDT", "ETHUSDT"], "A trade-history failure must not prevent the next market's fill scan.")
  assert.deepEqual(diagnostics.orderMarketsQueried, ["BTCUSDT", "ETHUSDT"])
  assert.deepEqual(diagnostics.fillMarketsQueried, ["ETHUSDT"])
  assert.deepEqual(diagnostics.marketsQueried, ["ETHUSDT"])
  assert.deepEqual(diagnostics.marketsFailed, ["BTCUSDT"])
  assert.equal(diagnostics.failures[0].historyType, "trades")
  assert.equal(diagnostics.failures[0].failureStage, "TRADE_PAGE_FETCH")
  assert.equal(diagnostics.failures[0].pageCursor, "0")
  assert.equal(repositories.cursors.has("BTCUSDT"), false, "The failed trade scan must not create or advance its trade cursor.")
})
