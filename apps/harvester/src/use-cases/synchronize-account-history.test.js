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

function createOrder({ orderId = "10", executed = "0.1" } = {}) {
  return new CanonicalOrder({
    ...identity,
    clientOrderId: `harvester-${orderId}`,
    brokerOrderId: orderId,
    market,
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

function createFill({ tradeId = "1", orderId = "10" } = {}) {
  return new Fill({
    ...identity,
    tradeId,
    brokerOrderId: orderId,
    clientOrderId: `harvester-${orderId}`,
    market,
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
  return {
    orders,
    fills,
    orderRepository: {
      upsertHistorical: async (record) => orders.push(record),
    },
    fillRepository: {
      upsert: async (input) => fills.push(input),
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
      const next = orders.find((order) => Number(order.brokerOrderId) >= orderId)
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
      const next = fills.find((fill) => Number(fill.tradeId) >= fromId)
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
    limit: 2,
    requestDelayMs: 0,
    now: () => 300,
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /strictly increasing/)
  assert.equal(repositories.orders.length, 0)
  assert.equal(repositories.fills.length, 0)
})
