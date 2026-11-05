import assert from "node:assert/strict"
import test from "node:test"
import { Asset, Balance, CanonicalOrder, Market, Money, Order, Quantity } from "@coinzilla/entities"
import { AccountSnapshot } from "../domain/account/account-snapshot.js"
import { OrderRegistry } from "../domain/orders/order-registry.js"
import { projectHarvesterJournalRecovery } from "../infrastructure/journal/project-harvester-journal-recovery.js"
import { restoreHarvesterJournalState } from "./restore-harvester-journal-state.js"
import { auditRecoveredAccountState } from "./audit-recovered-account-state.js"

const market = new Market({
  venue: "binance",
  symbol: "BTCUSDT",
  baseAsset: new Asset({ id: "binance:BTC", code: "BTC" }),
  quoteAsset: new Asset({ id: "binance:USDT", code: "USDT" }),
})

const record = (name, data, lineNumber) => ({
  id: "record-" + lineNumber,
  payload: { id: "record-" + lineNumber, name, data },
  position: { fileName: "2026-11-05_08-00-00.jsonl", lineNumber },
})

const recoveryProjection = () => {
  const balances = [
    { asset: "BTC", free: "0", locked: "0", total: "0" },
    { asset: "USDT", free: "1000", locked: "0", total: "1000" },
  ]
  const records = [
    record("account.snapshot_captured", {
      phase: "PREFLIGHT",
      sourceTime: 1000,
      auditStatus: "COMPLETE",
      balances,
      auditReasons: [],
    }, 1),
    record("harvester.started", {
      broker: "binance",
      strategyMode: "conservative",
      enabledMarkets: ["BTCUSDT"],
      tradingEnabled: true,
    }, 2),
    record("order.submission_requested", {
      clientOrderId: "h-BTCUSDT-buy-1",
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      price: "100",
      quantity: "0.5",
      status: "PENDING",
    }, 3),
    record("order.submitted", {
      clientOrderId: "h-BTCUSDT-buy-1",
      brokerOrderId: "9001",
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      price: "100",
      quantity: "0.5",
      status: "FILLED",
    }, 4),
    record("execution.fill_applied", {
      fillId: "binance:BTCUSDT:trade-1",
      tradeId: "trade-1",
      brokerOrderId: "9001",
      clientOrderId: "h-BTCUSDT-buy-1",
      symbol: "BTCUSDT",
      side: "BUY",
      price: "100",
      quantity: "0.5",
      quoteQuantity: "50",
      liquidityRole: "MAKER",
      commissions: [{ amount: "0.0004", assetId: "binance:BTC", asset: "BTC" }],
      commissionStatus: "COMPLETE",
    }, 5),
    record("order.submission_requested", {
      clientOrderId: "h-BTCUSDT-sell-1",
      symbol: "BTCUSDT",
      side: "SELL",
      type: "LIMIT",
      price: "100",
      quantity: "0.4",
      status: "PENDING",
    }, 6),
    record("order.submitted", {
      clientOrderId: "h-BTCUSDT-sell-1",
      brokerOrderId: "9002",
      symbol: "BTCUSDT",
      side: "SELL",
      type: "LIMIT",
      price: "100",
      quantity: "0.4",
      status: "FILLED",
    }, 7),
    record("execution.fill_applied", {
      fillId: "binance:BTCUSDT:trade-2",
      tradeId: "trade-2",
      brokerOrderId: "9002",
      clientOrderId: "h-BTCUSDT-sell-1",
      symbol: "BTCUSDT",
      side: "SELL",
      price: "125.625",
      quantity: "0.4",
      quoteQuantity: "50.25",
      liquidityRole: "MAKER",
      commissions: [],
      commissionStatus: "COMPLETE",
    }, 8),
    record("recovery.cycle_completed", {
      symbol: "BTCUSDT",
      marketId: "binance:BTCUSDT",
      freeQuantity: "0.01",
      realizedNetProfit: "0.25",
    }, 9),
    record("account.snapshot_captured", {
      phase: "CLOSING",
      sourceTime: 2000,
      auditStatus: "COMPLETE",
      balances: [
        { asset: "BTC", free: "0.0996", locked: "0", total: "0.0996" },
        { asset: "USDT", free: "1000.25", locked: "0", total: "1000.25" },
      ],
      auditReasons: [],
    }, 10),
    record("harvester.stopped", { reason: "SIGTERM", outcome: "success" }, 11),
  ]
  return projectHarvesterJournalRecovery({ records })
}

const restoreState = () => {
  const projection = recoveryProjection()
  assert.equal(projection.ok, true)
  const restored = restoreHarvesterJournalState({
    projection,
    marketMetadata: new Map([["BTCUSDT", market]]),
  })
  assert.equal(restored.ok, true)
  return { projection, restored: restored.data }
}

const resolveRestoredOrdersAsFilled = ({ recoveredState }) => ({
  ...recoveredState,
  orderRegistry: new OrderRegistry({
    orders: recoveredState.orderRegistry.orders.map((order) => new CanonicalOrder({
      clientOrderId: order.clientOrderId,
      brokerOrderId: order.brokerOrderId,
      market: order.market,
      side: order.side,
      type: order.type,
      limitPrice: order.limitPrice,
      originalQuantity: order.originalQuantity,
      executedQuantity: order.executedQuantity,
      status: "FILLED",
    })),
  }),
})

const snapshot = ({ btcFree = "0.0996", btcLocked = "0", usdtFree = "1000.25", usdtLocked = "0", sourceTime = 3000 } = {}) =>
  new AccountSnapshot({
    sourceTime,
    balances: [
      new Balance({
        free: new Quantity({ amount: btcFree, asset: market.baseAsset }),
        locked: new Quantity({ amount: btcLocked, asset: market.baseAsset }),
      }),
      new Balance({
        free: new Quantity({ amount: usdtFree, asset: market.quoteAsset }),
        locked: new Quantity({ amount: usdtLocked, asset: market.quoteAsset }),
      }),
    ],
  })

const openBuyOrder = ({ type = "LIMIT" } = {}) => new CanonicalOrder({
  clientOrderId: "h-BTCUSDT-buy-open",
  brokerOrderId: "9003",
  market,
  side: "BUY",
  type,
  limitPrice: new Money({ amount: "100", asset: market.quoteAsset }),
  originalQuantity: new Quantity({ amount: "1", asset: market.baseAsset }),
  executedQuantity: new Quantity({ amount: "0", asset: market.baseAsset }),
  status: "OPEN",
})

test("accepts balances and reservations that exactly match replayed strategy ownership", () => {
  const { projection, restored } = restoreState()
  const result = auditRecoveredAccountState({
    projection,
    recoveredState: resolveRestoredOrdersAsFilled({ recoveredState: restored }),
    currentAccountSnapshot: snapshot(),
    openOrders: [],
    markets: [market],
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.balancesChecked, 2)
  assert.equal(result.data.openOrdersChecked, 0)
  assert.equal(result.data.reservationsChecked, 0)
})

test("rejects unexplained external balance changes", () => {
  const { projection, restored } = restoreState()
  const result = auditRecoveredAccountState({
    projection,
    recoveredState: resolveRestoredOrdersAsFilled({ recoveredState: restored }),
    currentAccountSnapshot: snapshot({ usdtFree: "1001" }),
    openOrders: [],
    markets: [market],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /does not match replayed Harvester ownership/)
})

test("rejects exchange open orders that are not owned by the recovered registry", () => {
  const { projection, restored } = restoreState()
  const result = auditRecoveredAccountState({
    projection,
    recoveredState: resolveRestoredOrdersAsFilled({ recoveredState: restored }),
    currentAccountSnapshot: snapshot(),
    openOrders: [openBuyOrder()],
    markets: [market],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /not owned by the recovered Harvester registry/)
})

test("checks locked balances against exact open-order commitments", () => {
  const { projection, restored } = restoreState()
  const order = openBuyOrder()
  const recoveredState = {
    ...restored,
    orderRegistry: new OrderRegistry({ orders: [order] }),
  }
  const result = auditRecoveredAccountState({
    projection,
    recoveredState,
    currentAccountSnapshot: snapshot({
      usdtFree: "900.25",
      usdtLocked: "100",
    }),
    openOrders: [order],
    markets: [market],
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.openOrdersChecked, 1)
  assert.equal(result.data.reservationsChecked, 1)
})

test("rejects a reservation balance that differs from the exact remaining order commitment", () => {
  const { projection, restored } = restoreState()
  const order = openBuyOrder()
  const recoveredState = {
    ...restored,
    orderRegistry: new OrderRegistry({ orders: [order] }),
  }
  const result = auditRecoveredAccountState({
    projection,
    recoveredState,
    currentAccountSnapshot: snapshot({
      usdtFree: "900.26",
      usdtLocked: "99.99",
    }),
    openOrders: [order],
    markets: [market],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /locked balance does not match recovered order commitments/)
})

test("rejects a recovered active order that remains UNKNOWN after canonical reconciliation", () => {
  const { projection, restored } = restoreState()
  const result = auditRecoveredAccountState({
    projection,
    recoveredState: restored,
    currentAccountSnapshot: snapshot(),
    openOrders: [],
    markets: [market],
  })

  // Restored orders intentionally remain UNKNOWN until the broker has supplied
  // canonical history; the test state therefore cannot pass the final audit.
  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /remains unresolved/)
})

test("rejects a current account snapshot older than the latest durable Journal snapshot", () => {
  const { projection, restored } = restoreState()
  const result = auditRecoveredAccountState({
    projection,
    recoveredState: resolveRestoredOrdersAsFilled({ recoveredState: restored }),
    currentAccountSnapshot: snapshot({ sourceTime: 1500 }),
    openOrders: [],
    markets: [market],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /older than the latest durable Journal/)
})


test("accepts the broker Order shape with exact raw quantity and price fields", () => {
  const { projection, restored } = restoreState()
  const canonicalOrder = openBuyOrder()
  const brokerOrder = new Order({
    id: canonicalOrder.brokerOrderId,
    clientOrderId: canonicalOrder.clientOrderId,
    symbol: canonicalOrder.market.symbol,
    side: canonicalOrder.side,
    type: canonicalOrder.type,
    quantity: 1,
    price: 100,
  })
  brokerOrder.originalPrice = "100"
  brokerOrder.originalQuantity = "1"
  brokerOrder.executedQuantity = "0"
  brokerOrder.status = "NEW"

  const recoveredState = {
    ...restored,
    orderRegistry: new OrderRegistry({ orders: [canonicalOrder] }),
  }
  const result = auditRecoveredAccountState({
    projection,
    recoveredState,
    currentAccountSnapshot: snapshot({ usdtFree: "900.25", usdtLocked: "100" }),
    openOrders: [brokerOrder],
    markets: [market],
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.openOrdersChecked, 1)
  assert.equal(result.data.reservationsChecked, 1)
})


test("uses the durable PREFLIGHT baseline when a crash occurs before harvester.started is journaled", () => {
  const { projection, restored } = restoreState()
  const crashProjection = {
    ...projection,
    data: {
      ...projection.data,
      sessions: projection.data.sessions.map((session) => ({
        ...session,
        tradingEnabled: false,
        hasTradingActivity: true,
      })),
    },
  }
  const result = auditRecoveredAccountState({
    projection: crashProjection,
    recoveredState: resolveRestoredOrdersAsFilled({ recoveredState: restored }),
    currentAccountSnapshot: snapshot(),
    openOrders: [],
    markets: [market],
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.balancesChecked, 2)
})


test("rejects an incomplete durable PREFLIGHT baseline even when current balances happen to match", () => {
  const { projection, restored } = restoreState()
  const incompleteProjection = {
    ...projection,
    data: {
      ...projection.data,
      accountSnapshots: projection.data.accountSnapshots.map((snapshot, index) =>
        index === 0
          ? { ...snapshot, auditStatus: "INCOMPLETE", auditReasons: ["MISSING_ASSET_COVERAGE"] }
          : snapshot
      ),
    },
  }
  const result = auditRecoveredAccountState({
    projection: incompleteProjection,
    recoveredState: resolveRestoredOrdersAsFilled({ recoveredState: restored }),
    currentAccountSnapshot: snapshot(),
    openOrders: [],
    markets: [market],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /PREFLIGHT account snapshot is incomplete/)
})


test("accepts a recovered LIMIT_MAKER commitment with exact quote reservation", () => {
  const { projection, restored } = restoreState()
  const order = openBuyOrder({ type: "LIMIT_MAKER" })
  const recoveredState = {
    ...restored,
    orderRegistry: new OrderRegistry({ orders: [order] }),
  }
  const result = auditRecoveredAccountState({
    projection,
    recoveredState,
    currentAccountSnapshot: snapshot({ usdtFree: "900.25", usdtLocked: "100" }),
    openOrders: [order],
    markets: [market],
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.reservationsChecked, 1)
})
