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
import { synchronizeAccountHistory } from "./synchronize-account-history.js"

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

function createOrder({
  orderId = "10",
  executed = "0.1",
  orderMarket = market,
  clientOrderId,
  updatedAt = 200,
} = {}) {
  return new CanonicalOrder({
    ...identity,
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
    updatedAt,
    completedAt: updatedAt,
  })
}

function createFill({ tradeId = "1", orderId = "10", fillMarket = market, clientOrderId, executedAt = 200 } = {}) {
  return new Fill({
    ...identity,
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
    executedAt,
    commissions: [],
    commissionStatus: "COMPLETE",
  })
}

function createRepositories() {
  const orders = []
  const fills = []
  const cursors = new Map()
  const orderIdentities = new Map()
  const orderCursorSaves = []
  return {
    orders,
    fills,
    orderCursorSaves,
    orderRepository: {
      upsertHistorical: async (record) => {
        orders.push(record)
        orderIdentities.set(`${record.market.id}:${record.brokerOrderId}`, record.clientOrderId)
      },
      findByExchangeOrderIdentity: async ({ marketId, brokerOrderId }) =>
        orderIdentities.get(`${marketId}:${brokerOrderId}`) ?? null,
      listPendingOrderIds: async ({ symbol }) => orders
        .filter((order) =>
          order.market.symbol === symbol &&
          ["NEW", "OPEN", "PENDING", "PARTIALLY_FILLED", "UNKNOWN"].includes(order.status),
        )
        .map(({ brokerOrderId }) => brokerOrderId),
    },
    fillRepository: {
      upsert: async (input) => fills.push(input),
    },
    cursorRepository: {
      get: async ({ symbol }) => cursors.get(symbol) ?? {
        lastOrderId: null,
        lastOrderSyncAt: null,
        lastTradeId: null,
      },
      saveOrderCursor: async ({ symbol, lastOrderId, lastOrderSyncAt }) => {
        orderCursorSaves.push({ symbol, lastOrderId, lastOrderSyncAt })
        const current = cursors.get(symbol) ?? {}
        cursors.set(symbol, {
          ...current,
          lastOrderId,
          lastOrderSyncAt,
        })
      },
      saveTradeCursor: async ({ symbol, lastTradeId }) => {
        const current = cursors.get(symbol) ?? {}
        cursors.set(symbol, {
          ...current,
          lastTradeId,
        })
      },
    },
  }
}

function createPagedBroker({ orders, fills, calls }) {
  return {
    getCanonicalOrderHistory: async ({ symbol, orderId, startTime, endTime, limit }) => {
      calls.orders.push({
        symbol,
        orderId,
        startTime,
        endTime,
        limit,
      })
      const matchingOrders = orders
        .filter((order) => order.market.symbol === symbol)
        .filter((order) => orderId === undefined
          ? order.updatedAt >= startTime && order.updatedAt <= endTime
          : order.brokerOrderId === String(orderId))
        .sort((left, right) => Number(left.brokerOrderId) - Number(right.brokerOrderId))
      return {
        ok: true,
        data: matchingOrders.slice(0, limit),
      }
    },
    getFills: async ({ symbol, fromId, limit }) => {
      calls.fills.push({
        symbol,
        fromId,
        limit,
      })
      const matchingFills = fills
        .filter((fill) =>
          fill.market.symbol === symbol && Number(fill.tradeId) >= fromId,
        )
        .sort((left, right) => Number(left.tradeId) - Number(right.tradeId))
      return {
        ok: true,
        data: matchingFills.slice(0, limit),
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
    orders: [
      createOrder({ orderId: "11", updatedAt: 100 }),
      createOrder({ orderId: "10", updatedAt: 200 }),
      createOrder({ orderId: "12", updatedAt: 300 }),
    ],
    fills: [
      createFill({ tradeId: "1", orderId: "11" }),
      createFill({ tradeId: "2", orderId: "10" }),
      createFill({ tradeId: "3", orderId: "12" }),
    ],
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
    limit: 2,
    requestDelayMs: 0,
    now: () => 300,
  })

  assert.equal(result.ok, true, result.errors?.map((error) => error.message).join("; "))
  assert.equal(result.data.historyScope, "CONFIGURED_MARKETS", "History diagnostics must describe the configured-market scope.")
  assert.equal(result.data.marketUniverseComplete, false, "Configured symbols must not be presented as the complete account market universe.")
  assert.equal(result.data.retentionCoverageConfirmed, false, "Exchange page exhaustion must not be presented as proof of retention completeness.")
  assert.equal(result.data.ordersPersisted, 3, "Time-window splitting must persist all three orders returned by the bounded exchange queries.")
  assert.deepEqual(repositories.orders.map(({ brokerOrderId }) => brokerOrderId), ["11", "10", "12"], "Order IDs may be observed out of numeric order when older orders receive later status updates.")
  assert.equal(result.data.fillsPersisted, 3, "Trade-history pagination must persist all three executions returned by the exchange.")
  assert.equal(repositories.orders[0].ownership, undefined, "Exchange history must not invent strategy ownership for a previously external order.")
  assert.equal(repositories.fills[0].ingestionSource, "exchange_history", "Backfilled executions must retain exchange-history provenance.")
  assert.equal(repositories.fills[0].fill.clientOrderId, "harvester-11", "A fill must retain the client-order identity verified from its exchange order.")
  assert.equal(calls.orders[0].orderId, undefined, "Symbol-wide order-history pages must not use the exact-order lookup parameter as a cursor.")
  assert.equal(calls.orders[0].startTime, 0, "The initial order-history scan must begin at the configured lookback boundary.")
  assert.equal(calls.orders[0].endTime, 300, "The initial order-history scan must end at the injected startup time.")
  assert.deepEqual(
    calls.fills.map(({ fromId }) => fromId),
    [0, 3],
    "Trade-history pagination must advance by the last persisted trade ID plus one.",
  )
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
    limit: 3,
    requestDelayMs: 0,
    now: () => 300,
  })

  assert.equal(result.ok, false, "Duplicate order identities in one exchange-history page must fail closed.")
  assert.match(result.errors[0].message, /duplicate order identity/, "The failure must identify the repeated exchange order identity.")
  assert.deepEqual(result.errors[0].historyDiagnostics.marketsAttempted, ["BTCUSDT"], "Failure diagnostics must identify the market whose history scan was attempted.")
  assert.equal(result.errors[0].historyDiagnostics.orderPagesChecked, 1, "Failure diagnostics must count the malformed order-history page.")
  assert.equal(result.errors[0].historyDiagnostics.historyPagesComplete, false, "A malformed page must never be reported as complete history.")
  assert.equal(repositories.orders.length, 0, "No order from an invalid page may be persisted.")
  assert.equal(repositories.fills.length, 0, "Trade history must not continue after an invalid order-history page.")
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
    limit: 2,
    requestDelayMs: 0,
    now: () => 300,
  })

  assert.equal(result.ok, true, "History synchronization must complete for every configured market when all exchange pages succeed.")
  assert.deepEqual(result.data.marketsQueried, ["BTCUSDT", "ETHUSDT"], "Diagnostics must list each successfully queried market in configured order.")
  assert.equal(result.data.ordersPersisted, 2, "Repeated exchange order IDs in different markets must persist as distinct scoped orders.")
  assert.equal(result.data.fillsPersisted, 2, "Repeated trade IDs in different markets must persist as distinct scoped fills.")
  assert.deepEqual(
    repositories.fills.map(({ fill }) => fill.clientOrderId),
    ["btc-order", "eth-order"],
    "Each market fill must link only to the matching market order identity.",
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
    now: () => 864000000,
  }
  const first = await synchronizeAccountHistory(input)
  const second = await synchronizeAccountHistory(input)

  assert.equal(first.ok, true, first.errors?.map((error) => error.message).join("; "))
  assert.equal(second.ok, true, second.errors?.map((error) => error.message).join("; "))
  assert.equal(
    calls.orders.at(-1).startTime,
    777600000,
    "A completed order-history scan must resume from its durable checkpoint with the configured overlap.",
  )
  assert.deepEqual(
    calls.fills.map(({ fromId }) => fromId),
    [0, 2],
    "A completed trade-history cursor must resume after the last persisted execution without replaying earlier pages.",
  )
  assert.equal(second.data.ordersPersisted, 0, "A resumed scan must not re-persist orders outside its overlap window.")
  assert.equal(second.data.fillsPersisted, 0, "A resumed trade scan must not re-persist executions before its durable cursor.")
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
    now: () => 864000000,
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
  assert.equal(first.data.ordersPersisted, 1, "The initial scan must persist the unfilled order before its later offline execution.")
  assert.equal(second.ok, true, second.errors?.map((error) => error.message).join("; "))
  assert.equal(second.data.ordersObserved, 1, "The next startup must refresh the older pending order by its exact exchange order ID.")
  assert.equal(second.data.fillsPersisted, 1, "The offline execution must be persisted when the trade cursor is scanned.")
  assert.equal(repositories.orders.at(-1).status, "FILLED", "The refreshed order must reflect the exchange-confirmed terminal status.")
  assert.equal(repositories.fills[0].fill.clientOrderId, "harvester-10", "The later fill must link to the client-order identity persisted before shutdown.")
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
    now: () => 864000000,
  }
  const first = await synchronizeAccountHistory(input)
  fills.push(createFill({
    clientOrderId: null,
  }))
  const second = await synchronizeAccountHistory(input)

  assert.equal(first.ok, true)
  assert.equal(second.ok, true, second.errors?.map((error) => error.message).join("; "))
  assert.equal(
    calls.orders.some(({ orderId }) => orderId === "10"),
    false,
    "A terminal order outside the overlap window must not be requeried when its durable order record already exists.",
  )
  assert.equal(second.data.ordersObserved, 0, "No old terminal order should be re-observed when its update time predates the overlap.")
  assert.equal(second.data.fillsPersisted, 1, "A newly available trade must still be persisted after the order cursor has advanced.")
  assert.equal(repositories.fills[0].fill.clientOrderId, "harvester-10", "The fill must link through the previously persisted scoped exchange-order identity.")
})


test("does not advance the order-history checkpoint when a later bounded window fails", async () => {
  const repositories = createRepositories()
  let orderPage = 0
  let fillRequests = 0
  const broker = {
    getCanonicalOrderHistory: async () => {
      orderPage += 1
      if (orderPage === 1) {
        return {
          ok: true,
          data: [createOrder({ updatedAt: 100 })],
        }
      }
      return {
        ok: false,
        errors: [new Error("second order-history window failed")],
      }
    },
    getFills: async () => {
      fillRequests += 1
      return {
        ok: true,
        data: [],
      }
    },
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
    now: () => 86400001,
  })

  assert.equal(result.ok, false, "A failed order-history window must fail the market scan.")
  assert.equal(repositories.orders.length, 1, "Successfully persisted earlier windows may remain for idempotent replay.")
  assert.equal(repositories.orderCursorSaves.length, 0, "The durable order checkpoint must advance only after every window succeeds.")
  assert.equal(fillRequests, 0, "Trade-history pagination must not start after an incomplete order-history scan.")
  assert.equal(result.errors[0].historyDiagnostics.orderPagesChecked, 2, "Diagnostics must include the failed bounded order-history request.")
  assert.equal(result.errors[0].historyDiagnostics.historyPagesComplete, false, "A partial order scan must never be reported complete.")
})


test("resolves older fill orders by exact exchange identity when outside the initial order lookback", async () => {
  const repositories = createRepositories()
  const calls = {
    orders: [],
    fills: [],
  }
  const now = 200 * 24 * 60 * 60 * 1000
  const oldOrder = createOrder({
    orderId: "10",
    updatedAt: 80 * 24 * 60 * 60 * 1000,
  })
  const oldFill = createFill({
    tradeId: "1",
    orderId: "10",
    executedAt: 80 * 24 * 60 * 60 * 1000,
    clientOrderId: null,
  })
  const broker = createPagedBroker({
    orders: [oldOrder],
    fills: [oldFill],
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
    limit: 2,
    requestDelayMs: 0,
    now: () => now,
  })

  assert.equal(result.ok, true, result.errors?.map((error) => error.message).join("; "))
  assert.equal(repositories.orders.length, 1, "An older order must be fetched by exact exchange order identity when the time-window backfill cannot include it.")
  assert.equal(repositories.fills.length, 1, "The older exchange execution must still be imported from its durable trade cursor.")
  assert.equal(repositories.fills[0].fill.clientOrderId, "harvester-10", "The exact historical order lookup must provide the verified client-order identity for the fill.")
  assert.equal(
    calls.orders.some(({ orderId }) => orderId === "10"),
    true,
    "The fallback order lookup must use the exact exchange order ID, not reinterpret it as a page cursor.",
  )
})
