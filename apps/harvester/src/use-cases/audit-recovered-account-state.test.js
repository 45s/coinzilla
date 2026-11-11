import assert from "node:assert/strict"
import test from "node:test"
import { Asset, Balance, CanonicalOrder, Commission, Fill, Market, Money, Order, Quantity } from "@coinzilla/entities"
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
const feeAsset = new Asset({ id: "binance:BNB", code: "BNB" })

const record = (name, data, lineNumber) => ({
  id: "record-" + lineNumber,
  payload: { id: "record-" + lineNumber, name, data },
  position: { fileName: "2026-11-05_08-00-00.jsonl", lineNumber },
})

const recoveryProjection = ({ freeQuantity = "0.01", thirdAssetCommission = false, includeCommissionBaseline = true } = {}) => {
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
    ...(thirdAssetCommission && includeCommissionBaseline ? [record("account.snapshot_captured", {
      phase: "COMMISSION_BASELINE",
      sourceTime: 1000,
      auditStatus: "COMPLETE",
      balances: [{ asset: "BNB", free: "0.75", locked: "0.25", total: "1" }],
      auditReasons: [],
    }, 5)] : []),
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
      commissions: [
        { amount: "0.0004", assetId: "binance:BTC", asset: "BTC" },
        ...(thirdAssetCommission ? [{
          amount: "0.0001",
          assetId: "binance:BNB",
          asset: "BNB",
          quoteValue: { amount: "0.01", assetId: "binance:USDT", asset: "USDT" },
        }] : []),
      ],
      commissionStatus: "COMPLETE",
    }, thirdAssetCommission ? 6 : 5),
    record("order.submission_requested", {
      clientOrderId: "h-BTCUSDT-sell-1",
      symbol: "BTCUSDT",
      side: "SELL",
      type: "LIMIT",
      price: "102.757352941176470588",
      quantity: "0.4896",
      status: "PENDING",
    }, thirdAssetCommission ? 7 : 6),
    record("order.submitted", {
      clientOrderId: "h-BTCUSDT-sell-1",
      brokerOrderId: "9002",
      symbol: "BTCUSDT",
      side: "SELL",
      type: "LIMIT",
      price: "102.757352941176470588",
      quantity: "0.4896",
      status: "FILLED",
    }, thirdAssetCommission ? 8 : 7),
    record("execution.fill_applied", {
      fillId: "binance:BTCUSDT:trade-2",
      tradeId: "trade-2",
      brokerOrderId: "9002",
      clientOrderId: "h-BTCUSDT-sell-1",
      symbol: "BTCUSDT",
      side: "SELL",
      price: "102.757352941176470588",
      quantity: "0.4896",
      quoteQuantity: "50.25",
      liquidityRole: "MAKER",
      commissions: [],
      commissionStatus: "COMPLETE",
    }, thirdAssetCommission ? 9 : 8),
    record("recovery.cycle_completed", {
      symbol: "BTCUSDT",
      marketId: "binance:BTCUSDT",
      freeQuantity,
      keepQuantity: "0.01",
      minProfit: "0.01",
      realizedNetProfit: thirdAssetCommission ? "0.24" : "0.25",
    }, thirdAssetCommission ? 10 : 9),
    record("account.snapshot_captured", {
      phase: "CLOSING",
      sourceTime: 2000,
      auditStatus: "COMPLETE",
      balances: [
        { asset: "BTC", free: "0.01", locked: "0", total: "0.01" },
        { asset: "USDT", free: thirdAssetCommission ? "1000.24" : "1000.25", locked: "0", total: thirdAssetCommission ? "1000.24" : "1000.25" },
        ...(thirdAssetCommission ? [{ asset: "BNB", free: "0.7499", locked: "0.25", total: "0.9999" }] : []),
      ],
      auditReasons: [],
    }, thirdAssetCommission ? 11 : 10),
    record("harvester.stopped", { reason: "SIGTERM", outcome: "success" }, thirdAssetCommission ? 12 : 11),
  ]
  return projectHarvesterJournalRecovery({ records })
}

const restoreState = (options) => {
  const projection = recoveryProjection(options)
  assert.equal(projection.ok, true, projection.errors?.map(({ message }) => message).join('; '))
  const restored = restoreHarvesterJournalState({
    projection,
    marketMetadata: new Map([["BTCUSDT", market]]),
  })
  assert.equal(restored.ok, true, restored.errors?.map(({ message }) => message).join('; '))
  return { projection, restored: restored.data }
}

test("replays recovery completion only after all sellable inventory is sold and keepQuantity is retained", () => {
  const { restored } = restoreState()
  const position = restored.portfolio.getPosition({ marketId: market.id })
  const ledger = restored.recoveryLedgers.get(market.id)

  assert.equal(position.baseQuantity.amount, "0", "A completed cycle must not leave sellable active inventory behind.")
  assert.equal(position.freeBaseQuantity.amount, "0.01", "The configured keepQuantity must be transferred into the free inventory bucket.")
  assert.equal(position.spent.amount, "0", "A replayed completed cycle must reset the authoritative Position recovery basis just like live completion.")
  assert.equal(position.quoteNetCashFlow.amount, "0.25", "Resetting recovery basis must preserve cumulative realized quote cash flow.")
  assert.equal(ledger.buyCost, "0", "The RecoveryLedger cycle cost mirror must be reset with the Portfolio basis.")
  assert.equal(ledger.netSellProceeds, "0", "The completed cycle's proceeds must be cleared.")
  assert.deepEqual(ledger.appliedFillIds, restored.portfolio.appliedFillIds, "Fill identities must survive the cycle reset for duplicate protection.")
})

test("rejects a journal completion projection that leaves active sellable inventory unallocated", () => {
  const validProjection = recoveryProjection()
  assert.equal(validProjection.ok, true, validProjection.errors?.map(({ message }) => message).join("; "))
  const projection = {
    ...validProjection,
    data: {
      ...validProjection.data,
      recoveryCycles: validProjection.data.recoveryCycles.map((cycle) => ({
        ...cycle,
        freeQuantity: "0.009",
      })),
    },
  }

  const restored = restoreHarvesterJournalState({
    projection,
    marketMetadata: new Map([["BTCUSDT", market]]),
  })

  assert.equal(restored.ok, false)
  assert.match(restored.errors?.[0]?.message ?? "", /must allocate all replayed active inventory/)
})

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

const snapshot = ({ btcFree = "0.01", btcLocked = "0", usdtFree = "1000.25", usdtLocked = "0", bnbFree, bnbLocked = "0", sourceTime = 3000 } = {}) =>
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
      ...(bnbFree === undefined ? [] : [new Balance({
        free: new Quantity({ amount: bnbFree, asset: feeAsset }),
        locked: new Quantity({ amount: bnbLocked, asset: feeAsset }),
      })]),
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

test("accounts for third-asset commission debits during recovered account reconciliation", () => {
  const { projection, restored } = restoreState({ thirdAssetCommission: true })
  const result = auditRecoveredAccountState({
    projection,
    recoveredState: resolveRestoredOrdersAsFilled({ recoveredState: restored }),
    currentAccountSnapshot: snapshot({ usdtFree: "1000.24", bnbFree: "0.7499", bnbLocked: "0.25" }),
    openOrders: [],
    markets: [market],
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.equal(result.data.balancesChecked, 3)
})

test("fails closed when the third-asset baseline is journaled after the applied fill", () => {
  const { projection, restored } = restoreState({ thirdAssetCommission: true })
  const fill = restored.journalFills.find(({ commissions }) =>
    commissions.some(({ asset }) => asset === "BNB"))
  const lateBaselineProjection = {
    ...projection,
    data: {
      ...projection.data,
      accountSnapshots: projection.data.accountSnapshots.map((snapshot) =>
        snapshot.phase === "COMMISSION_BASELINE"
          ? { ...snapshot, sequence: fill.sequence + 1 }
          : snapshot
      ),
    },
  }
  const result = auditRecoveredAccountState({
    projection: lateBaselineProjection,
    recoveredState: resolveRestoredOrdersAsFilled({ recoveredState: restored }),
    currentAccountSnapshot: snapshot({ usdtFree: "1000.24", bnbFree: "0.7499", bnbLocked: "0.25" }),
    openOrders: [],
    markets: [market],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /must be durably recorded before its applied fill/)
})

test("fails closed when a positive third-asset commission has no durable baseline", () => {
  const { projection, restored } = restoreState({
    thirdAssetCommission: true,
    includeCommissionBaseline: false,
  })
  const result = auditRecoveredAccountState({
    projection,
    recoveredState: resolveRestoredOrdersAsFilled({ recoveredState: restored }),
    currentAccountSnapshot: snapshot({ usdtFree: "1000.24", bnbFree: "0.7499", bnbLocked: "0.25" }),
    openOrders: [],
    markets: [market],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /missing required third-asset commission baseline for BNB/)
})

test("rejects an unexplained third-asset balance movement despite matching market balances", () => {
  const { projection, restored } = restoreState({ thirdAssetCommission: true })
  const result = auditRecoveredAccountState({
    projection,
    recoveredState: resolveRestoredOrdersAsFilled({ recoveredState: restored }),
    currentAccountSnapshot: snapshot({ usdtFree: "1000.24", bnbFree: "0.75", bnbLocked: "0.25" }),
    openOrders: [],
    markets: [market],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /BNB/)
  assert.match(result.errors[0].message, /does not match replayed Harvester ownership/)
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

test("keeps a reconciled external open order unowned and reports its symbol conflict", () => {
  const { projection, restored } = restoreState()
  const externalOrder = openBuyOrder()
  const result = auditRecoveredAccountState({
    projection,
    recoveredState: resolveRestoredOrdersAsFilled({ recoveredState: restored }),
    currentAccountSnapshot: snapshot({ usdtFree: "900.25", usdtLocked: "100" }),
    openOrders: [externalOrder],
    markets: [market],
    targetMarket: market,
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.deepEqual(result.data.blockedMarkets, ["BTCUSDT"])
  assert.equal(result.data.targetMarketBlocked, true)
  assert.equal(result.data.unownedOpenOrders.length, 1)
  assert.equal(
    restored.orderRegistry.orders.some(({ brokerOrderId }) => brokerOrderId === externalOrder.brokerOrderId),
    false,
  )
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


test("reports an unowned same-market open order as a narrow market blocker without adopting it", () => {
  const { projection, restored } = restoreState()
  const externalOrder = openBuyOrder()
  const result = auditRecoveredAccountState({
    projection,
    recoveredState: resolveRestoredOrdersAsFilled({ recoveredState: restored }),
    currentAccountSnapshot: snapshot({ usdtFree: "900.25", usdtLocked: "100" }),
    openOrders: [externalOrder],
    markets: [market],
    targetMarket: market,
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.deepEqual(result.data.blockedMarkets, ["BTCUSDT"])
  assert.equal(result.data.unownedOpenOrders.length, 1)
  assert.equal(result.data.unownedOpenOrders[0].brokerOrderId, externalOrder.brokerOrderId)
  assert.equal(result.data.unownedOpenOrders[0].symbol, "BTCUSDT")
  assert.equal(result.data.openOrdersChecked, 1)
  assert.equal(
    restored.orderRegistry.orders.some(({ brokerOrderId }) => brokerOrderId === externalOrder.brokerOrderId),
    false,
  )
})

test("keeps an unrelated external order unowned and does not block the reconciled market", () => {
  const ethAsset = new Asset({ id: "binance:ETH", code: "ETH" })
  const ethMarket = new Market({
    venue: "binance",
    symbol: "ETHUSDT",
    baseAsset: ethAsset,
    quoteAsset: market.quoteAsset,
  })
  const { projection, restored } = restoreState()
  const expandedProjection = {
    ...projection,
    data: {
      ...projection.data,
      accountSnapshots: projection.data.accountSnapshots.map((entry) =>
        entry.phase === "PREFLIGHT"
          ? {
              ...entry,
              balances: [...entry.balances, {
                asset: "ETH",
                free: "0.5",
                locked: "0",
                total: "0.5",
              }],
            }
          : entry
      ),
    },
  }
  const externalOrder = new CanonicalOrder({
    clientOrderId: "manual-eth-sell",
    brokerOrderId: "9900",
    market: ethMarket,
    side: "SELL",
    type: "LIMIT",
    limitPrice: new Money({ amount: "10", asset: market.quoteAsset }),
    originalQuantity: new Quantity({ amount: "0.1", asset: ethAsset }),
    executedQuantity: new Quantity({ amount: "0", asset: ethAsset }),
    status: "OPEN",
  })
  const currentAccountSnapshot = new AccountSnapshot({
    sourceTime: 3000,
    balances: [
      new Balance({
        free: new Quantity({ amount: "0.01", asset: market.baseAsset }),
        locked: new Quantity({ amount: "0", asset: market.baseAsset }),
      }),
      new Balance({
        free: new Quantity({ amount: "1000.25", asset: market.quoteAsset }),
        locked: new Quantity({ amount: "0", asset: market.quoteAsset }),
      }),
      new Balance({
        free: new Quantity({ amount: "0.4", asset: ethAsset }),
        locked: new Quantity({ amount: "0.1", asset: ethAsset }),
      }),
    ],
  })
  const result = auditRecoveredAccountState({
    projection: expandedProjection,
    recoveredState: resolveRestoredOrdersAsFilled({ recoveredState: restored }),
    currentAccountSnapshot,
    openOrders: [externalOrder],
    markets: [market, ethMarket],
    targetMarket: market,
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.deepEqual(result.data.blockedMarkets, ["ETHUSDT"])
  assert.equal(result.data.targetMarketBlocked, false)
  assert.equal(result.data.unownedOpenOrders.length, 1)
  assert.equal(result.data.unownedOpenOrders[0].symbol, "ETHUSDT")
})

test("fails closed when a relevant market asset is absent from the current account snapshot", () => {
  const { projection, restored } = restoreState()
  const currentAccountSnapshot = new AccountSnapshot({
    sourceTime: 3000,
    balances: [
      new Balance({
        free: new Quantity({ amount: "1000.25", asset: market.quoteAsset }),
        locked: new Quantity({ amount: "0", asset: market.quoteAsset }),
      }),
    ],
  })
  const result = auditRecoveredAccountState({
    projection,
    recoveredState: resolveRestoredOrdersAsFilled({ recoveredState: restored }),
    currentAccountSnapshot,
    openOrders: [],
    markets: [market],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /current account snapshot is missing required asset BTC/i)
})

test("fails closed when the durable baseline omits a relevant market asset", () => {
  const { projection, restored } = restoreState()
  const incompleteProjection = {
    ...projection,
    data: {
      ...projection.data,
      accountSnapshots: projection.data.accountSnapshots.map((entry) =>
        entry.phase === "PREFLIGHT"
          ? { ...entry, balances: entry.balances.filter(({ asset }) => asset !== "BTC") }
          : entry
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
  assert.match(result.errors[0].message, /initial account snapshot is missing required asset BTC/i)
})

test("fails closed when an unowned open order has no canonical market metadata", () => {
  const ethAsset = new Asset({ id: "binance:ETH", code: "ETH" })
  const ethMarket = new Market({
    venue: "binance",
    symbol: "ETHUSDT",
    baseAsset: ethAsset,
    quoteAsset: market.quoteAsset,
  })
  const { projection, restored } = restoreState()
  const externalOrder = new CanonicalOrder({
    clientOrderId: "manual-eth-sell",
    brokerOrderId: "9901",
    market: ethMarket,
    side: "SELL",
    type: "LIMIT",
    limitPrice: new Money({ amount: "10", asset: market.quoteAsset }),
    originalQuantity: new Quantity({ amount: "0.1", asset: ethAsset }),
    executedQuantity: new Quantity({ amount: "0", asset: ethAsset }),
    status: "OPEN",
  })
  const result = auditRecoveredAccountState({
    projection,
    recoveredState: resolveRestoredOrdersAsFilled({ recoveredState: restored }),
    currentAccountSnapshot: snapshot(),
    openOrders: [externalOrder],
    markets: [market],
    targetMarket: market,
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /canonical Market metadata is missing for unowned open order ETHUSDT/i)
})


test("integrates structured one-market history evidence with account balance and order reconciliation", () => {
  const { projection, restored } = restoreState()
  const exchangeFills = restored.journalFills.map((entry) => new Fill({
    tradeId: entry.tradeId,
    brokerOrderId: entry.brokerOrderId,
    clientOrderId: entry.clientOrderId,
    market,
    side: entry.side,
    price: new Money({ amount: entry.price, asset: market.quoteAsset }),
    quantity: new Quantity({ amount: entry.quantity, asset: market.baseAsset }),
    quoteQuantity: new Money({ amount: entry.quoteQuantity, asset: market.quoteAsset }),
    liquidityRole: entry.liquidityRole,
    ...(entry.executedAt === undefined ? {} : { executedAt: entry.executedAt }),
    commissions: entry.commissions.map((commission) => new Commission({
      amount: new Money({
        amount: commission.amount,
        asset: new Asset({ id: commission.assetId, code: commission.asset }),
      }),
      ...(commission.quoteValue === undefined ? {} : {
        quoteValue: new Money({
          amount: commission.quoteValue.amount,
          asset: new Asset({
            id: commission.quoteValue.assetId,
            code: commission.quoteValue.asset,
          }),
        }),
      }),
    })),
    commissionStatus: entry.commissionStatus,
  }))
  const exchangeTradeHistory = {
    fills: exchangeFills,
    historyPagesComplete: true,
    marketHistoryPagesComplete: true,
    historyScope: "MARKET",
    marketsQueried: ["BTCUSDT"],
    historyStartTime: 1000,
    marketUniverseComplete: false,
    historyRetentionEvidence: {
      factType: "MARKET_HISTORY_COVERAGE_CONFIRMED",
      baselineFactId: "history-baseline-btc-1",
      symbol: "BTCUSDT",
      coveredFromTime: 1000,
      verifiedAt: 1100,
    },
  }
  const result = auditRecoveredAccountState({
    projection,
    recoveredState: resolveRestoredOrdersAsFilled({ recoveredState: restored }),
    currentAccountSnapshot: snapshot(),
    openOrders: [],
    markets: [market],
    targetMarket: market,
    exchangeTradeHistory,
    requireCompleteTradeHistory: true,
    tradeHistoryScope: "MARKET",
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.equal(result.data.tradeHistory.scope, "MARKET")
  assert.equal(result.data.tradeHistory.marketSymbol, "BTCUSDT")
  assert.equal(result.data.tradeHistory.marketUniverseComplete, false)
})


test("fails closed when an exchange open order reuses a terminal recovered brokerOrderId", () => {
  const { projection, restored } = restoreState()
  const conflictingOrder = new CanonicalOrder({
    clientOrderId: "manual-replacement",
    brokerOrderId: "9001",
    market,
    side: "BUY",
    type: "LIMIT",
    limitPrice: new Money({ amount: "100", asset: market.quoteAsset }),
    originalQuantity: new Quantity({ amount: "0.1", asset: market.baseAsset }),
    executedQuantity: new Quantity({ amount: "0", asset: market.baseAsset }),
    status: "OPEN",
  })
  const result = auditRecoveredAccountState({
    projection,
    recoveredState: resolveRestoredOrdersAsFilled({ recoveredState: restored }),
    currentAccountSnapshot: snapshot(),
    openOrders: [conflictingOrder],
    markets: [market],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /non-active recovered order as open/)
})

test("fails closed when an unowned open order reuses a recovered clientOrderId", () => {
  const { projection, restored } = restoreState()
  const conflictingOrder = new CanonicalOrder({
    clientOrderId: "h-BTCUSDT-buy-1",
    brokerOrderId: "9902",
    market,
    side: "BUY",
    type: "LIMIT",
    limitPrice: new Money({ amount: "100", asset: market.quoteAsset }),
    originalQuantity: new Quantity({ amount: "0.1", asset: market.baseAsset }),
    executedQuantity: new Quantity({ amount: "0", asset: market.baseAsset }),
    status: "OPEN",
  })
  const result = auditRecoveredAccountState({
    projection,
    recoveredState: resolveRestoredOrdersAsFilled({ recoveredState: restored }),
    currentAccountSnapshot: snapshot(),
    openOrders: [conflictingOrder],
    markets: [market],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /clientOrderId conflicts with recovered order ownership/)
})


test("rejects a market-history baseline verified after the current account snapshot", () => {
  const { projection, restored } = restoreState()
  const exchangeTradeHistory = {
    fills: [],
    historyPagesComplete: true,
    marketHistoryPagesComplete: true,
    historyScope: "MARKET",
    marketsQueried: ["BTCUSDT"],
    historyStartTime: 1000,
    marketUniverseComplete: false,
    historyRetentionEvidence: {
      factType: "MARKET_HISTORY_COVERAGE_CONFIRMED",
      baselineFactId: "history-baseline-btc-future",
      symbol: "BTCUSDT",
      coveredFromTime: 1000,
      verifiedAt: 4000,
    },
  }
  const result = auditRecoveredAccountState({
    projection,
    recoveredState: resolveRestoredOrdersAsFilled({ recoveredState: restored }),
    currentAccountSnapshot: snapshot({ sourceTime: 3000 }),
    openOrders: [],
    markets: [market],
    targetMarket: market,
    exchangeTradeHistory,
    requireCompleteTradeHistory: true,
    tradeHistoryScope: "MARKET",
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /verified after the current account snapshot/)
})
