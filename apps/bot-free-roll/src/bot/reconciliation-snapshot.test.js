import assert from "node:assert/strict"
import test from "node:test"
import {
  Asset,
  Balance,
  CanonicalOrder,
  Fill,
  Market,
  Money,
  Quantity,
} from "@coinzilla/entities"
import {
  collectReconciliationSnapshot,
  validateReconciliationSnapshot,
} from "./reconciliation-snapshot.js"

const baseAsset = new Asset({ id: "doge", code: "DOGE" })
const quoteAsset = new Asset({ id: "fdusd", code: "FDUSD" })
const market = new Market({
  venue: "binance",
  symbol: "DOGEFDUSD",
  baseAsset,
  quoteAsset,
})

function createCanonicalOrder({
  brokerOrderId = "11",
  status = "FILLED",
  originalQuantity = "3",
  executedQuantity = "3",
} = {}) {
  return new CanonicalOrder({
    clientOrderId: `client-${brokerOrderId}`,
    brokerOrderId,
    market,
    side: "BUY",
    type: "LIMIT",
    limitPrice: new Money({ amount: "0.05", asset: quoteAsset }),
    originalQuantity: new Quantity({ amount: originalQuantity, asset: baseAsset }),
    executedQuantity: new Quantity({ amount: executedQuantity, asset: baseAsset }),
    status,
    createdAt: 1000,
    updatedAt: 1010,
    ...(status === "FILLED" ? { completedAt: 1010 } : {}),
  })
}

function createFill({ tradeId, brokerOrderId = "11" }) {
  return new Fill({
    tradeId: String(tradeId),
    brokerOrderId,
    market,
    side: "BUY",
    price: new Money({ amount: "0.05", asset: quoteAsset }),
    quantity: new Quantity({ amount: "1", asset: baseAsset }),
    quoteQuantity: new Money({ amount: "0.05", asset: quoteAsset }),
    liquidityRole: "MAKER",
    executedAt: 1000,
    commissions: [],
    commissionStatus: "COMPLETE",
  })
}

function createBroker({ fillsByCursor, trackedOrder, openOrders = [] } = {}) {
  const calls = []
  let serverTime = 1000
  return {
    calls,
    async getServerTime() {
      calls.push({ method: "getServerTime" })
      serverTime += 10
      return { ok: true, data: { serverTime } }
    },
    async getAccountSnapshot() {
      calls.push({ method: "getAccountSnapshot" })
      return {
        ok: true,
        data: {
          sourceTime: 1015,
          balances: [new Balance({
            free: new Quantity({ amount: "100", asset: quoteAsset }),
            locked: new Quantity({ amount: "0", asset: quoteAsset }),
          })],
        },
      }
    },
    async getOpenOrders({ symbol }) {
      calls.push({ method: "getOpenOrders", symbol })
      return { ok: true, data: openOrders }
    },
    async getCanonicalOrderHistory({ symbol, orderId, limit }) {
      calls.push({ method: "getCanonicalOrderHistory", symbol, orderId, limit })
      return { ok: true, data: [trackedOrder ?? createCanonicalOrder({ brokerOrderId: orderId })] }
    },
    async getFills({ symbol, orderId, fromId, limit }) {
      calls.push({ method: "getFills", symbol, orderId, fromId, limit })
      const key = fromId ?? "first"
      return { ok: true, data: fillsByCursor?.[key] ?? [] }
    },
  }
}

test("collects and validates a complete tracked-order snapshot with gap-free fill pagination", async () => {
  const broker = createBroker({
    trackedOrder: createCanonicalOrder(),
    fillsByCursor: {
      first: [createFill({ tradeId: "100" }), createFill({ tradeId: "101" })],
      102: [createFill({ tradeId: "102" })],
    },
  })

  const result = await collectReconciliationSnapshot({
    broker,
    trackedOrdersBySymbol: {
      DOGEFDUSD: [{ id: "11", side: "BUY", quantity: "3" }],
    },
    pageLimit: 2,
  })

  assert.equal(result.ok, true)
  const { snapshot } = result
  assert.equal(snapshot.schemaVersion, 1)
  assert.deepEqual(snapshot.window, {
    startedAtServerTime: 1010,
    completedAtServerTime: 1040,
  })
  assert.equal(snapshot.account.sourceTime, 1015)
  assert.equal(snapshot.symbols.DOGEFDUSD.orderHistory.items[0].brokerOrderId, "11")
  assert.deepEqual(
    snapshot.symbols.DOGEFDUSD.fills.items.map((fill) => fill.tradeId),
    ["100", "101", "102"],
  )
  assert.equal(snapshot.symbols.DOGEFDUSD.fills.firstTradeId, "100")
  assert.equal(snapshot.symbols.DOGEFDUSD.fills.pagesFetched, 2)
  assert.equal(snapshot.symbols.DOGEFDUSD.fills.nextTradeId, null)
  assert.equal(validateReconciliationSnapshot({
    snapshot,
    symbols: ["DOGEFDUSD"],
  }).ok, true)
  assert.ok(Object.isFrozen(snapshot))
  assert.ok(Object.isFrozen(snapshot.symbols.DOGEFDUSD.fills.items))
  assert.ok(Object.isFrozen(snapshot.symbols.DOGEFDUSD.openOrders.items))

  const fillCalls = broker.calls.filter((call) => call.method === "getFills")
  assert.deepEqual(fillCalls.map((call) => call.fromId), [undefined, 102])
})

test("collects an empty tracked-order history without claiming account-wide history", async () => {
  const broker = createBroker({})

  const result = await collectReconciliationSnapshot({
    broker,
    trackedOrdersBySymbol: { DOGEFDUSD: [] },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.snapshot.symbols.DOGEFDUSD.orderHistory.items, [])
  assert.deepEqual(result.snapshot.symbols.DOGEFDUSD.orderHistory.trackedOrderIds, [])
  assert.deepEqual(result.snapshot.symbols.DOGEFDUSD.fills.items, [])
  assert.equal(result.snapshot.symbols.DOGEFDUSD.fills.pagesFetched, 0)
  assert.equal(broker.calls.some((call) => call.method === "getFills"), false)
  assert.equal(broker.calls.some((call) => call.method === "getCanonicalOrderHistory"), false)
})

test("preserves exact open-order remaining quantity and rejects unresolved fee data", async () => {
  const broker = createBroker({
    trackedOrder: createCanonicalOrder({
      status: "PARTIALLY_FILLED",
      originalQuantity: "3",
      executedQuantity: "2",
    }),
    openOrders: [{
      id: "11",
      symbol: "DOGEFDUSD",
      side: "BUY",
      originalQuantity: "3.000",
      executedQuantity: "2.000",
      status: "PARTIALLY_FILLED",
    }],
    fillsByCursor: { first: [createFill({ tradeId: "100" })] },
  })

  const result = await collectReconciliationSnapshot({
    broker,
    trackedOrdersBySymbol: { DOGEFDUSD: [{ id: "11" }] },
  })

  assert.equal(result.ok, true)
  assert.equal(result.snapshot.symbols.DOGEFDUSD.openOrders.items[0].remainingQuantity, "1")

  const invalidOpenOrderSnapshot = {
    ...result.snapshot,
    symbols: {
      ...result.snapshot.symbols,
      DOGEFDUSD: {
        ...result.snapshot.symbols.DOGEFDUSD,
        openOrders: {
          ...result.snapshot.symbols.DOGEFDUSD.openOrders,
          items: [{
            ...result.snapshot.symbols.DOGEFDUSD.openOrders.items[0],
            remainingQuantity: "0",
          }],
        },
      },
    },
  }
  assert.equal(validateReconciliationSnapshot({
    snapshot: invalidOpenOrderSnapshot,
    symbols: ["DOGEFDUSD"],
  }).ok, false)

  const unresolvedFeeFill = new Fill({
    tradeId: "101",
    brokerOrderId: "11",
    market,
    side: "BUY",
    price: new Money({ amount: "0.05", asset: quoteAsset }),
    quantity: new Quantity({ amount: "1", asset: baseAsset }),
    quoteQuantity: new Money({ amount: "0.05", asset: quoteAsset }),
    liquidityRole: "MAKER",
    executedAt: 1100,
    commissions: [],
    commissionStatus: "UNKNOWN",
  })
  const invalidFeeSnapshot = {
    ...result.snapshot,
    symbols: {
      ...result.snapshot.symbols,
      DOGEFDUSD: {
        ...result.snapshot.symbols.DOGEFDUSD,
        fills: {
          ...result.snapshot.symbols.DOGEFDUSD.fills,
          items: [unresolvedFeeFill],
          firstTradeId: "101",
        },
      },
    },
  }
  assert.equal(validateReconciliationSnapshot({
    snapshot: invalidFeeSnapshot,
    symbols: ["DOGEFDUSD"],
  }).ok, false)
})

test("fails closed when a full page cannot be exhausted within the configured page limit", async () => {
  const broker = createBroker({
    fillsByCursor: {
      first: [createFill({ tradeId: "100" })],
    },
  })

  const result = await collectReconciliationSnapshot({
    broker,
    trackedOrdersBySymbol: {
      DOGEFDUSD: [{ id: "11", side: "BUY", quantity: "3" }],
    },
    pageLimit: 1,
    maxPages: 1,
  })

  assert.equal(result.ok, false)
  assert.match(result.reason, /safety limit/)
})

test("fails closed for missing tracked order history and unsupported broker ports", async () => {
  const missingHistoryBroker = createBroker({
    trackedOrder: null,
  })
  missingHistoryBroker.getCanonicalOrderHistory = async () => ({ ok: true, data: [] })

  const missingHistory = await collectReconciliationSnapshot({
    broker: missingHistoryBroker,
    trackedOrdersBySymbol: { DOGEFDUSD: [{ id: "11" }] },
  })
  assert.equal(missingHistory.ok, false)
  assert.match(missingHistory.reason, /missing or ambiguous/)

  const unsupported = await collectReconciliationSnapshot({
    broker: { getServerTime() {} },
    trackedOrdersBySymbol: { DOGEFDUSD: [] },
  })
  assert.equal(unsupported.ok, false)
  assert.match(unsupported.reason, /required reconciliation snapshot ports/)
})

test("fails closed for unsafe or unordered trade cursors", async () => {
  const broker = createBroker({
    fillsByCursor: {
      first: [
        createFill({ tradeId: "100" }),
        createFill({ tradeId: String(Number.MAX_SAFE_INTEGER) }),
      ],
    },
  })

  const result = await collectReconciliationSnapshot({
    broker,
    trackedOrdersBySymbol: { DOGEFDUSD: [{ id: "11" }] },
    pageLimit: 2,
  })

  assert.equal(result.ok, false)
  assert.match(result.reason, /cursor cannot advance safely/)
})

test("validator rejects missing symbols, invalid completeness, and decreasing timestamps", async () => {
  const broker = createBroker({ trackedOrder: createCanonicalOrder(), fillsByCursor: {} })
  const result = await collectReconciliationSnapshot({
    broker,
    trackedOrdersBySymbol: { DOGEFDUSD: [{ id: "11" }] },
  })
  assert.equal(result.ok, true)

  assert.equal(validateReconciliationSnapshot({
    snapshot: result.snapshot,
    symbols: ["DOGEFDUSD", "BTCFDUSD"],
  }).ok, false)

  const incomplete = {
    ...result.snapshot,
    symbols: {
      ...result.snapshot.symbols,
      DOGEFDUSD: {
        ...result.snapshot.symbols.DOGEFDUSD,
        fills: {
          ...result.snapshot.symbols.DOGEFDUSD.fills,
          completeness: "UNKNOWN",
        },
      },
    },
  }
  assert.equal(validateReconciliationSnapshot({
    snapshot: incomplete,
    symbols: ["DOGEFDUSD"],
  }).ok, false)

  const decreasing = {
    ...result.snapshot,
    window: {
      startedAtServerTime: 2000,
      completedAtServerTime: 1000,
    },
  }
  assert.equal(validateReconciliationSnapshot({
    snapshot: decreasing,
    symbols: ["DOGEFDUSD"],
  }).ok, false)
})
