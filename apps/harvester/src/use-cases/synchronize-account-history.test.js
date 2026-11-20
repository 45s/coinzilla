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

function createOrder({ orderId = "10", executed = "0.1", orderMarket = market, clientOrderId } = {}) {
  return new CanonicalOrder({
    ...identity,
    clientOrderId: clientOrderId ?? `harvester-${orderId}`,
    brokerOrderId: orderId,
    market: orderMarket,
    side: "BUY",
    type: "LIMIT",
    limitPrice: new Money({
      amount: "100",
      asset: quoteAsset,
    }),
    originalQuantity: new Quantity({
      amount: "0.1",
      asset: baseAsset,
    }),
    executedQuantity: new Quantity({
      amount: executed,
      asset: baseAsset,
    }),
    status: "FILLED",
    createdAt: 100,
    updatedAt: 200,
    completedAt: 200,
  })
}

function createFill({ tradeId = "1", orderId = "10", fillMarket = market, clientOrderId } = {}) {
  return new Fill({
    ...identity,
    tradeId,
    brokerOrderId: orderId,
    clientOrderId: clientOrderId ?? `harvester-${orderId}`,
    market: fillMarket,
    side: "BUY",
    price: new Money({
      amount: "100",
      asset: quoteAsset,
    }),
    quantity: new Quantity({
      amount: "0.1",
      asset: baseAsset,
    }),
    quoteQuantity: new Money({
      amount: "10",
      asset: quoteAsset,
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
  return {
    orders,
    fills,
    orderRepository: {
      upsertHistorical: async (record) => orders.push(record),
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
      const next = orders.find((order) =>
        order.market.symbol === symbol && Number(order.brokerOrderId) >= orderId,
      )
      return {
        ok: true,
        data: next ? [next] : [],
      }
    },
    getFills: async ({ symbol, fromId, limit }) => {
      calls.fills.push({
        symbol,
        fromId,
        limit,
      })
      const next = fills.find((fill) =>
        fill.market.symbol === symbol && Number(fill.tradeId) >= fromId,
      )
      return {
        ok: true,
        data: next ? [next] : [],
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

  assert.equal(result.ok, true)
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

  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
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
