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

function createRepositories() {
  const orders = []
  const fills = []
  const cursors = new Map()
  const orderIdentities = new Map()
  return {
    orders,
    fills,
    cursors,
    orderRepository: {
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
    },
    fillRepository: {
      upsert: async (input) => fills.push(input),
    },
    cursorRepository: {
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
    },
  }
}

function createPagedBroker({ orders, fills, calls }) {
  return {
    getCanonicalOrderHistory: async ({ symbol, orderId, limit }) => {
      calls.orders.push({
        symbol,
        orderId,
        limit,
      })
      const page = orders
        .filter((order) => order.market.symbol === symbol && Number(order.brokerOrderId) >= orderId)
        .sort((left, right) => Number(left.brokerOrderId) - Number(right.brokerOrderId))
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
        .sort((left, right) => Number(left.tradeId) - Number(right.tradeId))
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
  assert.equal(repositories.cursors.get("BTCUSDT")?.lastOrderId, undefined, "The order cursor must remain unchanged after a partial page write.")
  assert.equal(repositories.orders.length, 1, "A successfully written record may remain available for idempotent replay.")

  failSecondOrder = false
  const retried = await synchronizeAccountHistory(input)
  assert.equal(retried.ok, true, "A retried page must complete after persistence recovers.")
  assert.deepEqual(calls.orders.map(({ orderId }) => orderId), [0, 0], "The failed page must be requested again from its original cursor.")
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
  assert.equal(repositories.cursors.get("BTCUSDT")?.lastTradeId, undefined, "The trade cursor must remain unchanged after a partial page write.")
  assert.equal(repositories.fills.length, 1, "A successfully written fill may remain available for idempotent replay.")

  failSecondFill = false
  const retried = await synchronizeAccountHistory(input)
  assert.equal(retried.ok, true, "A retried trade page must complete after persistence recovers.")
  assert.deepEqual(calls.fills.map(({ fromId }) => fromId), [0, 0], "The failed trade page must be requested again from its original cursor.")
  assert.equal(repositories.fills.length, 3, "The repository receives the replayed first fill and the previously failed second fill.")
  assert.equal(repositories.cursors.get("BTCUSDT").lastTradeId, "2", "The trade cursor may advance only after every fill in the page is persisted.")
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
