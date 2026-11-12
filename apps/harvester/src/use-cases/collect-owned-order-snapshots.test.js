import test from "node:test"
import assert from "node:assert/strict"
import {
  Asset,
  CanonicalOrder,
  Fill,
  Market,
  Money,
  Order,
  Quantity,
} from "@coinzilla/entities"
import { makeCollectOwnedOrderSnapshots } from "./collect-owned-order-snapshots.js"

const baseAsset = new Asset({ id: "doge", code: "DOGE" })
const quoteAsset = new Asset({ id: "usdt", code: "USDT" })
const market = new Market({ venue: "binance", symbol: "DOGEUSDT", baseAsset, quoteAsset })

function makeCanonicalOrder({
  status = "OPEN",
  executedQuantity = "0",
  brokerOrderId = "broker-order-1",
  clientOrderId = "h-dogeusdt-order-1",
} = {}) {
  return new CanonicalOrder({
    clientOrderId,
    brokerOrderId,
    market,
    side: "BUY",
    type: "LIMIT",
    limitPrice: new Money({ amount: "100", asset: quoteAsset }),
    originalQuantity: new Quantity({ amount: "1", asset: baseAsset }),
    executedQuantity: new Quantity({ amount: executedQuantity, asset: baseAsset }),
    status,
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 2,
    ...(status === "FILLED" ? { completedAt: 2 } : {}),
  })
}

function makeOpenOrder({ brokerOrderId = "broker-order-1", clientOrderId = "h-dogeusdt-order-1" } = {}) {
  const order = new Order({
    symbol: market.symbol,
    type: "LIMIT",
    side: "BUY",
    quantity: 1,
    price: 100,
    id: brokerOrderId,
    clientOrderId,
  })
  order.originalQuantity = "1"
  order.executedQuantity = "0"
  order.status = "NEW"
  return order
}

function makeFill({ tradeId = "1", price = "100" } = {}) {
  return new Fill({
    tradeId,
    brokerOrderId: "broker-order-1",
    clientOrderId: "h-dogeusdt-order-1",
    market,
    side: "BUY",
    price: new Money({ amount: price, asset: quoteAsset }),
    quantity: new Quantity({ amount: "1", asset: baseAsset }),
    quoteQuantity: new Money({ amount: "100", asset: quoteAsset }),
    executedAt: 10,
    commissions: [],
    commissionStatus: "COMPLETE",
  })
}

function makeCollector({
  openOrders = [],
  historyOrder = makeCanonicalOrder(),
  fills = [],
  journalFillsById = new Map(),
} = {}) {
  const calls = []
  const broker = {
    getOpenOrders: async ({ symbol }) => {
      calls.push(["open-orders", symbol])
      return { ok: true, data: openOrders }
    },
    getCanonicalOrderHistory: async ({ symbol, orderId }) => {
      calls.push(["order-history", symbol, orderId])
      return { ok: true, data: [historyOrder] }
    },
    getFills: async ({ symbol, orderId, fromId, limit }) => {
      calls.push(["fills", symbol, orderId, fromId, limit])
      return { ok: true, data: fills }
    },
  }
  return {
    calls,
    collect: makeCollectOwnedOrderSnapshots({ broker, journalFillsById }),
  }
}

test("collects canonical snapshots for owned orders without adopting unrelated open orders", async () => {
  const ownedOrder = makeCanonicalOrder()
  const unrelatedOrder = makeOpenOrder({
    brokerOrderId: "manual-order",
    clientOrderId: "manual-client-order",
  })
  const openOrder = makeOpenOrder()
  const { collect, calls } = makeCollector({
    openOrders: [unrelatedOrder, openOrder],
    historyOrder: ownedOrder,
  })

  const result = await collect({ ownedOrders: [ownedOrder] })

  assert.deepEqual(result.symbols, ["DOGEUSDT"], "The result must retain the exact affected market set.")
  assert.equal(result.snapshots.length, 1, "Only registered Harvester-owned orders may produce reconciliation snapshots.")
  assert.equal(result.snapshots[0].ownedOrder, ownedOrder, "The snapshot must retain the registered order identity.")
  assert.equal(result.snapshots[0].historyOrder, ownedOrder, "The canonical REST history must be retained for the apply transition.")
  assert.deepEqual(result.snapshots[0].fills, [], "An order with zero executed quantity must have an empty complete fill history.")
  assert.deepEqual([...result.snapshots[0].fillIds], [], "The fill identity set must match the complete history.")
  assert.deepEqual(calls, [
    ["open-orders", "DOGEUSDT"],
    ["order-history", "DOGEUSDT", "broker-order-1"],
    ["fills", "DOGEUSDT", "broker-order-1", undefined, 1000],
  ], "Open orders must be read before canonical order and fill history.")
})

test("fails closed when canonical history says an owned order is active but it is absent from open orders", async () => {
  const ownedOrder = makeCanonicalOrder()
  const { collect } = makeCollector({ historyOrder: ownedOrder })

  await assert.rejects(
    () => collect({ ownedOrders: [ownedOrder] }),
    (error) => {
      assert.match(error.message, /missing from the open-order snapshot/, "The failure must identify the missing active order.")
      assert.equal(error.recoveryFailure?.category, "REST_RECONCILIATION", "Missing active-order evidence is a retryable REST reconciliation failure.")
      assert.equal(error.recoveryFailure?.stage, "OWNED_OPEN_ORDER_SNAPSHOT_PARITY", "The failure must retain its stable stage.")
      assert.equal(error.recoveryFailure?.retryable, true, "A missing authoritative open-order observation must remain retryable.")
      assert.equal(error.reconciliationSymbol, "DOGEUSDT", "The failure must identify the affected market.")
      return true
    },
  )
})

test("rejects canonical REST fills that conflict with durable Journal execution facts", async () => {
  const ownedOrder = makeCanonicalOrder({ status: "FILLED", executedQuantity: "1" })
  const historyOrder = makeCanonicalOrder({ status: "FILLED", executedQuantity: "1" })
  const fill = makeFill()
  const journalFill = {
    fillId: fill.id,
    tradeId: String(fill.tradeId),
    brokerOrderId: fill.brokerOrderId,
    clientOrderId: fill.clientOrderId,
    symbol: market.symbol,
    side: fill.side,
    liquidityRole: fill.liquidityRole,
    commissionStatus: fill.commissionStatus,
    price: "99",
    quantity: "1",
    quoteQuantity: "100",
    executedAt: fill.executedAt,
    commissions: [],
  }
  const { collect } = makeCollector({
    historyOrder,
    fills: [fill],
    journalFillsById: new Map([[fill.id, journalFill]]),
  })

  await assert.rejects(
    () => collect({ ownedOrders: [ownedOrder] }),
    (error) => {
      assert.match(error.message, /conflicts with durable Journal price/, "A price mismatch must be identified as a durable-fact conflict.")
      assert.equal(error.reconciliationSymbol, "DOGEUSDT", "The failure must retain its affected market.")
      return true
    },
  )
})

test("rejects a full fill-history page that cannot be paginated by numeric trade ID", async () => {
  const ownedOrder = makeCanonicalOrder({ status: "FILLED", executedQuantity: "1" })
  const historyOrder = makeCanonicalOrder({ status: "FILLED", executedQuantity: "1" })
  const nonNumericFill = makeFill({ tradeId: "non-numeric" })
  const { collect } = makeCollector({
    historyOrder,
    fills: Array.from({ length: 1000 }, () => nonNumericFill),
  })

  await assert.rejects(
    () => collect({ ownedOrders: [ownedOrder] }),
    (error) => {
      assert.match(error.message, /cannot be paginated safely/, "A full page without a numeric cursor must not be treated as complete.")
      assert.equal(error.reconciliationSymbol, "DOGEUSDT", "Pagination failures must retain their affected market.")
      return true
    },
  )
})

test("returns an empty snapshot set without broker reads when no owned orders exist", async () => {
  const { collect, calls } = makeCollector()

  const result = await collect({ ownedOrders: [] })

  assert.deepEqual(result, { snapshots: [], symbols: [] }, "An empty registry must produce an empty, successful reconciliation input.")
  assert.deepEqual(calls, [], "No exchange reads are needed when there are no owned orders.")
})
