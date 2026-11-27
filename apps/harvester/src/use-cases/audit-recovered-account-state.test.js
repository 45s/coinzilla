import assert from "node:assert/strict"
import test from "node:test"
import { Asset, Balance, CanonicalOrder, Commission, Fill, Market, Money, Order, Quantity } from "@coinzilla/entities"
import { AccountSnapshot } from "../domain/account/account-snapshot.js"
import { StrategyId } from "../domain/strategies/strategy-ids.js"
import { OrderRegistry } from "../domain/orders/order-registry.js"
import { projectHarvesterJournalRecovery } from "../infrastructure/journal/project-harvester-journal-recovery-with-deferrals.js"
import { restoreHarvesterJournalState } from "./restore-harvester-journal-state.js"
import { auditRecoveredAccountState } from "./audit-recovered-account-state.js"

const market = new Market({
  venue: "binance",
  symbol: "BTCUSDT",
  baseAsset: new Asset({ id: "binance:BTC",
code: "BTC" }),
  quoteAsset: new Asset({ id: "binance:USDT",
code: "USDT" }),
})
const feeAsset = new Asset({ id: "binance:BNB",
code: "BNB" })

const record = (...[name, data, lineNumber]) => {
  const id = `record-${lineNumber}-${name}-${data.clientOrderId ?? data.fillId ?? data.phase ?? "event"}`
  return {
    id,
    payload: {
      id,
      name,
      data,
    },
    position: {
      fileName: "2026-11-05_08-00-00.jsonl",
      lineNumber,
    },
  }
}

function createOpeningRecords() {
  const balances = [
    { asset: "BTC", 
      
      
      
      free: "0", 
   
         
      
      locked: "0", 
      total: "0" },
    { asset: "USDT", 
      free: "1000", 
      locked: "0", 
      total: "1000" },
  ]
  return [
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
  ]
}

  
  
  
function createCommissionBaselineRecord({ lineNumber = 5 } = {}) {
  return record("account.snapshot_captured", {
    phase: "COMMISSION_BASELINE",
    sourceTime: 1000,
    auditStatus: "COMPLETE",
    balances: [{ asset: "BNB", 
      free: "0.75", 
      locked: "0.25", 
      total: "1" }],
    auditReasons: [],
  }, lineNumber)
}

function createBuyFillRecord({ thirdAssetCommission, lineOffset = 0 }) {
  return record("execution.fill_applied", {
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
      { amount: "0.0004", 
        assetId: "binance:BTC", 
        asset: "BTC" },
      ...(thirdAssetCommission ? [{
        amount: "0.0001",
        assetId: "binance:BNB",
        asset: "BNB",
        quoteValue: { amount: "0.01", 
          assetId: "binance:USDT", 
          asset: "USDT" },
      }] : []),
    ],
    commissionStatus: "COMPLETE",
  }, (thirdAssetCommission ? 6 : 5) + lineOffset)
}

function createSellCycleRecords({ freeQuantity, thirdAssetCommission, lineOffset = 0 }) {
  return [
    record("order.submission_requested", {
      clientOrderId: "h-BTCUSDT-sell-1",
      symbol: "BTCUSDT",
      side: "SELL",
      type: "LIMIT",
      price: "102.757352941176470588",
      quantity: "0.4896",
      status: "PENDING",
    }, (thirdAssetCommission ? 7 : 6) + lineOffset),
    record("order.submitted", {
      clientOrderId: "h-BTCUSDT-sell-1",
      brokerOrderId: "9002",
      symbol: "BTCUSDT",
      side: "SELL",
      type: "LIMIT",
      price: "102.757352941176470588",
      quantity: "0.4896",
      status: "FILLED",
    }, (thirdAssetCommission ? 8 : 7) + lineOffset),
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
    }, (thirdAssetCommission ? 9 : 8) + lineOffset),
    record("recovery.cycle_completed", {
      symbol: "BTCUSDT",
      marketId: "binance:BTCUSDT",
      freeQuantity,
      keepQuantity: "0.01",
      minProfit: "0.01",
      
      
      
      realizedNetProfit: thirdAssetCommission ? "0.24" : "0.25",
    }, (thirdAssetCommission ? 10 : 9) + lineOffset),
  ]
}


function getClosingBaseBalance({ recoverySellerBuy }) {
  if (recoverySellerBuy) {
    return "0.11"
  }
  return "0.01"
}

function getClosingQuoteBalance({ thirdAssetCommission, recoverySellerBuy }) {
  if (recoverySellerBuy) {
    return thirdAssetCommission ? "990.24" : "990.25"
  }
  return thirdAssetCommission ? "1000.24" : "1000.25"
}

function getClosingRecordLineNumber({ thirdAssetCommission, lineOffset }) {
  const baseLineNumber = thirdAssetCommission ? 11 : 10
  return baseLineNumber + lineOffset
}

function createClosingRecords({ thirdAssetCommission, recoverySellerBuy = false, lineOffset = 0 }) {
  const baseBalance = getClosingBaseBalance({ recoverySellerBuy })
  const quoteBalance = getClosingQuoteBalance({
    thirdAssetCommission,
    recoverySellerBuy,
  })
  const closingLineNumber = getClosingRecordLineNumber({
    thirdAssetCommission,
    lineOffset,
  })
  const stoppedLineNumber = closingLineNumber + 1
  return [
    record("account.snapshot_captured", {
      phase: "CLOSING",
      sourceTime: 2000,
      auditStatus: "COMPLETE",
      balances: [
        {
          asset: "BTC",
          free: baseBalance,
          locked: "0",
          total: baseBalance,
        },
        {
          asset: "USDT",
          free: quoteBalance,
          locked: "0",
          total: quoteBalance,
        },
        ...(thirdAssetCommission ? [{
          asset: "BNB",
          free: "0.7499",
          locked: "0.25",
          total: "0.9999",
        }] : []),
      ],
      auditReasons: [],
    }, closingLineNumber),
    record("harvester.stopped", {
      reason: "SIGTERM",
      outcome: "success",
    }, stoppedLineNumber),
  ]
}

function createRecoverySellerBuyFillRecord({
  ownership,
  clientOrderId,
  brokerOrderId,
  fillId,
  tradeId,
  quantity,
  quoteQuantity,
  lineNumber,
}) {
  return record("execution.fill_applied", {
    fillId,
    tradeId,
    brokerOrderId,
    clientOrderId,
    symbol: "BTCUSDT",
    side: "BUY",
    price: "100",
    quantity,
    quoteQuantity,
    liquidityRole: "MAKER",
    commissions: [],
    commissionStatus: "COMPLETE",
    ...ownership,
  }, lineNumber)
}

function createRecoverySellerBuyRecords({
  status = "FILLED",
  includeFill = true,
} = {}) {
  const ownership = {
    purpose: "RECOVERY_BUY",
    strategyId: StrategyId.RECOVERY_SELLER,
    positionId: "rs-position-1",
    cycleId: "rs-cycle-1",
  }
  const clientOrderId = "rs-BTCUSDT-buy-1"
  const brokerOrderId = "9003"
  const intent = {
    clientOrderId,
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    price: "100",
    quantity: "0.1",
    ...ownership,
  }
  const records = [
    record("order.submission_requested", {
      ...intent,
      status: "PENDING",
    }, 5),
    record("order.submitted", {
      ...intent,
      brokerOrderId,
      status,
    }, 6),
  ]
  if (includeFill) {
    records.push(createRecoverySellerBuyFillRecord({
      ownership,
      clientOrderId,
      brokerOrderId,
      fillId: "binance:BTCUSDT:trade-rs-buy-1",
      tradeId: "trade-rs-buy-1",
      quantity: "0.06",
      quoteQuantity: "6",
      lineNumber: 7,
    }))
    records.push(createRecoverySellerBuyFillRecord({
      ownership,
      clientOrderId,
      brokerOrderId,
      fillId: "binance:BTCUSDT:trade-rs-buy-2",
      tradeId: "trade-rs-buy-2",
      quantity: "0.04",
      quoteQuantity: "4",
      lineNumber: 8,
    }))
  }
  return records
}
function createRecoverySellerSellRecords() {
  const ownership = {
    purpose: "RECOVERY_SELL",
    strategyId: StrategyId.RECOVERY_SELLER,
    positionId: "rs-position-1",
    cycleId: "rs-cycle-1",
  }
  const clientOrderId = "rs-BTCUSDT-sell-1"
  const brokerOrderId = "9004"
  const intent = {
    clientOrderId,
    symbol: "BTCUSDT",
    side: "SELL",
    type: "LIMIT",
    price: "100",
    quantity: "0.05",
    ...ownership,
  }
  return [
    record("order.submission_requested", {
      ...intent,
      status: "PENDING",
    }, 5),
    record("order.submitted", {
      ...intent,
      brokerOrderId,
      status: "FILLED",
    }, 6),
    record("execution.fill_applied", {
      fillId: "binance:BTCUSDT:trade-rs-sell-1",
      tradeId: "trade-rs-sell-1",
      brokerOrderId,
      clientOrderId,
      symbol: "BTCUSDT",
      side: "SELL",
      price: "100",
      quantity: "0.05",
      quoteQuantity: "5",
      liquidityRole: "MAKER",
      commissions: [],
      commissionStatus: "COMPLETE",
      ...ownership,
    }, 7),
  ]
}


function getRecoverySellerOrderRecords(options) {
  if (options.recoverySellerBuy) {
    return createRecoverySellerBuyRecords({
      status: options.recoverySellerBuyStatus,
      includeFill: options.recoverySellerBuyFill,
    })
  }
  if (options.recoverySellerSell) {
    return createRecoverySellerSellRecords()
  }
  return []
}

function getCommissionBaselineRecords(options) {
  if (!options.thirdAssetCommission || !options.includeCommissionBaseline) {
    return []
  }
  let lineNumber = 5
  if (options.recoverySellerBuy) {
    lineNumber = 9
  } else if (options.recoverySellerSell) {
    lineNumber = 8
  }
  return [createCommissionBaselineRecord({ lineNumber })]
}

function getRecoveryProjectionLineOffset({ recoverySellerBuy, recoverySellerSell }) {
  if (recoverySellerBuy) {
    return 5
  }
  if (recoverySellerSell) {
    return 4
  }
  return 0
}

function createRecoveryProjectionRecords(options) {
  const lineOffset = getRecoveryProjectionLineOffset(options)
  return [
    ...createOpeningRecords(),
    ...getRecoverySellerOrderRecords(options),
    ...getCommissionBaselineRecords(options),
    createBuyFillRecord({
      thirdAssetCommission: options.thirdAssetCommission,
      lineOffset,
    }),
    ...createSellCycleRecords({
      freeQuantity: options.freeQuantity ?? "0.01",
      thirdAssetCommission: options.thirdAssetCommission,
      lineOffset,
    }),
    ...createClosingRecords({
      thirdAssetCommission: options.thirdAssetCommission,
      recoverySellerBuy: options.recoverySellerBuy && options.recoverySellerBuyFill,
      lineOffset,
    }),
  ]
}


function hasThirdAssetCommission(fill) {
  return fill.commissions.some(({ asset }) => asset === "BNB")
}

function shiftCommissionBaselineSequence({ accountSnapshot, sequence }) {
  if (accountSnapshot.phase !== "COMMISSION_BASELINE") {
    return accountSnapshot
  }
  return {
    ...accountSnapshot,
    sequence,
  }
}

function isNotAsset({
      balance,
      assetCode,
    }) {
  return balance.asset !== assetCode
}

function removeAssetFromPreflightSnapshot({ entry, assetCode }) {
  if (entry.phase !== "PREFLIGHT") {
    return entry
  }
  return {
    ...entry,
    balances: entry.balances.filter((balance) => isNotAsset({
      balance,
      assetCode,
    })),
  }
}

function createEthMarket() {
  const ethAsset = new Asset({
    id: "binance:ETH",
    code: "ETH",
  })
  return new Market({
    venue: "binance",
    symbol: "ETHUSDT",
    baseAsset: ethAsset,
    quoteAsset: market.quoteAsset,
  })
}

function addEthBalanceToPreflightProjection({ projection }) {
  return {
    ...projection,
    data: {
      ...projection.data,
      accountSnapshots: projection.data.accountSnapshots.map((entry) => {
        if (entry.phase !== "PREFLIGHT") {
          return entry
        }
        return {
          ...entry,
          balances: [...entry.balances, {
            asset: "ETH",
            free: "0.5",
            locked: "0",
            total: "0.5",
          }],
        }
      }),
    },
  }
}

function createExternalEthOrder({ ethMarket }) {
  return new CanonicalOrder({
    clientOrderId: "manual-eth-sell",
    brokerOrderId: "9900",
    market: ethMarket,
    side: "SELL",
    type: "LIMIT",
    limitPrice: new Money({
      amount: "10",
      asset: market.quoteAsset,
    }),
    originalQuantity: new Quantity({
      amount: "0.1",
      asset: ethMarket.baseAsset,
    }),
    executedQuantity: new Quantity({
      amount: "0",
      asset: ethMarket.baseAsset,
    }),
    status: "OPEN",
  })
}

function createEthAccountSnapshot({ ethAsset }) {
  return new AccountSnapshot({
    sourceTime: 3000,
    balances: [
      new Balance({
        free: new Quantity({
          amount: "0.01",
          asset: market.baseAsset,
        }),
        locked: new Quantity({
          amount: "0",
          asset: market.baseAsset,
        }),
      }),
      new Balance({
        free: new Quantity({
          amount: "1000.25",
          asset: market.quoteAsset,
        }),
        locked: new Quantity({
          amount: "0",
          asset: market.quoteAsset,
        }),
      }),
      new Balance({
        free: new Quantity({
          amount: "0.4",
          asset: ethAsset,
        }),
        locked: new Quantity({
          amount: "0.1",
          asset: ethAsset,
        }),
      }),
    ],
  })
}
const recoveryProjection = (options = {}) => projectHarvesterJournalRecovery({
  records: createRecoveryProjectionRecords({
    includeCommissionBaseline: true,
    ...options,
  }),
})
const restoreState = (options) => {
  const projection = recoveryProjection(options)
  assert.equal(projection.ok, true, projection.errors?.map(({ message }) => message).join('; '))
  const restored = restoreHarvesterJournalState({
    projection,
    marketMetadata: new Map([["BTCUSDT", market]]),
  })
  assert.equal(restored.ok, true, restored.errors?.map(({ message }) => message).join('; '))
  return { projection,
restored: restored.data }
}

const exchangeFillsFromJournal = (journalFills) => journalFills.map((entry) => new Fill({
  tradeId: entry.tradeId,
  brokerOrderId: entry.brokerOrderId,
  clientOrderId: entry.clientOrderId,
  market,
  side: entry.side,
  price: new Money({ amount: entry.price,
asset: market.quoteAsset }),
  quantity: new Quantity({ amount: entry.quantity,
asset: market.baseAsset }),
  quoteQuantity: new Money({ amount: entry.quoteQuantity,
asset: market.quoteAsset }),
  liquidityRole: entry.liquidityRole,
  ...(entry.executedAt === undefined ? {} : { executedAt: entry.executedAt }),
  commissions: entry.commissions.map((commission) => new Commission({
    amount: new Money({
      amount: commission.amount,
      asset: new Asset({ id: commission.assetId,
code: commission.asset }),
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
        free: new Quantity({ amount: btcFree,
asset: market.baseAsset }),
        locked: new Quantity({ amount: btcLocked,
asset: market.baseAsset }),
      }),
      new Balance({
        free: new Quantity({ amount: usdtFree,
asset: market.quoteAsset }),
        locked: new Quantity({ amount: usdtLocked,
asset: market.quoteAsset }),
      }),
      ...(bnbFree === undefined ? [] : [new Balance({
        free: new Quantity({ amount: bnbFree,
asset: feeAsset }),
        locked: new Quantity({ amount: bnbLocked,
asset: feeAsset }),
      })]),
    ],
  })

const openBuyOrder = ({ type = "LIMIT" } = {}) => new CanonicalOrder({
  clientOrderId: "h-BTCUSDT-buy-open",
  brokerOrderId: "9003",
  market,
  side: "BUY",
  type,
  limitPrice: new Money({ amount: "100",
asset: market.quoteAsset }),
  originalQuantity: new Quantity({ amount: "1",
asset: market.baseAsset }),
  executedQuantity: new Quantity({ amount: "0",
asset: market.baseAsset }),
  status: "OPEN",
})

test("replays terminal Recovery Seller BUY fills and includes their inventory in offline account audit", () => {
  const { projection, restored } = restoreState({ recoverySellerBuy: true })
  const recoverySellerPosition = restored.portfolio.getPosition({
    marketId: market.id,
    strategyId: StrategyId.RECOVERY_SELLER,
  })
  assert.equal(recoverySellerPosition.totalBaseQuantity.amount, "0.1")
  const buyExecution = restored.recoverySellerBuyExecutionByCycle.get("rs-cycle-1")
  assert.equal(buyExecution.quantity, "0.1")
  assert.equal(buyExecution.quoteQuantity, "10")
  assert.equal(buyExecution.fillIds.size, 2)

  const result = auditRecoveredAccountState({
    projection,
    recoveredState: resolveRestoredOrdersAsFilled({ recoveredState: restored }),
    currentAccountSnapshot: snapshot({
      btcFree: "0.11",
      usdtFree: "990.25",
    }),
    openOrders: [],
    markets: [market],
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.equal(result.data.balancesChecked, 2)
  assert.equal(result.data.recoverySellerPositionsChecked, 1)
})

test("keeps Recovery Seller SELL fill replay deferred without mixed-sell allocation evidence", () => {
  const projection = recoveryProjection({ recoverySellerSell: true })
  assert.equal(projection.ok, true, projection.errors?.map(({ message }) => message).join("; "))
  const restored = restoreHarvesterJournalState({
    projection,
    marketMetadata: new Map([["BTCUSDT", market]]),
  })

  assert.equal(restored.ok, false)
  assert.match(restored.errors?.[0]?.message ?? "", /Recovery Seller Journal replay is deferred/)
})

test("keeps an unresolved Recovery Seller BUY order deferred until canonical reconciliation", () => {
  const projection = recoveryProjection({
    recoverySellerBuy: true,
    recoverySellerBuyStatus: "NEW",
    recoverySellerBuyFill: false,
  })
  assert.equal(projection.ok, true, projection.errors?.map(({ message }) => message).join("; "))
  const restored = restoreHarvesterJournalState({
    projection,
    marketMetadata: new Map([["BTCUSDT", market]]),
  })

  assert.equal(restored.ok, false)
  assert.match(restored.errors?.[0]?.message ?? "", /Recovery Seller Journal replay is deferred/)
})

test("defers a FILLED Recovery Seller BUY when Journal fill evidence is incomplete", () => {
  const projection = recoveryProjection({
    recoverySellerBuy: true,
    recoverySellerBuyStatus: "FILLED",
    recoverySellerBuyFill: false,
  })
  assert.equal(projection.ok, true, projection.errors?.map(({ message }) => message).join("; "))
  const restored = restoreHarvesterJournalState({
    projection,
    marketMetadata: new Map([["BTCUSDT", market]]),
  })
  assert.equal(restored.ok, false)
  assert.match(restored.errors?.[0]?.message ?? "", /Recovery Seller Journal replay is deferred/)
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
  assert.equal(result.data.recoverySellerPositionsChecked, 0)
  assert.equal(result.data.openOrdersChecked, 0)
  assert.equal(result.data.reservationsChecked, 0)
})

test("handles market-asset, malformed, negative, and missing-market Journal commissions", () => {
  const { projection, restored } = restoreState({})
  const recoveredState = resolveRestoredOrdersAsFilled({ recoveredState: restored })
  const firstFillId = recoveredState.journalFills[0]?.fillId
  const runAudit = (state) => auditRecoveredAccountState({
    projection,
    recoveredState: state,
    currentAccountSnapshot: snapshot(),
    openOrders: [],
    markets: [market],
  })
  const withCommission = (commission) => ({
    ...recoveredState,
    journalFills: recoveredState.journalFills.map((fill) =>
      fill.fillId === firstFillId
        ? {
          ...fill,
          commissions: [commission],
        }
        : fill
    ),
  })
  const marketAssetCommission = runAudit(withCommission({
    assetId: market.quoteAsset.id,
    asset: market.quoteAsset.code,
    amount: "0.01",
  }))
  assert.equal(marketAssetCommission.ok, true,
    marketAssetCommission.errors?.map(({ message }) => message).join("; "))

  const negativeCommission = runAudit(withCommission({
    assetId: feeAsset.id,
    asset: feeAsset.code,
    amount: "-0.001",
  }))
  assert.equal(negativeCommission.ok, false)
  assert.match(negativeCommission.errors?.[0]?.message ?? "", /cannot be negative/)

  const malformedFill = {
    ...recoveredState,
    journalFills: recoveredState.journalFills.map((fill) =>
      fill.fillId === firstFillId
        ? {
          ...fill,
          commissions: null,
        }
        : fill
    ),
  }
  const malformedCommission = runAudit(malformedFill)
  assert.equal(malformedCommission.ok, false)
  assert.match(malformedCommission.errors?.[0]?.message ?? "", /missing symbol or commission facts/)

  const missingMarketFill = {
    ...recoveredState,
    journalFills: [
      ...recoveredState.journalFills,
      {
        ...recoveredState.journalFills[0],
        symbol: "ETHUSDT",
        commissions: [],
      },
    ],
  }
  const missingMarket = runAudit(missingMarketFill)
  assert.equal(missingMarket.ok, false)
  assert.match(missingMarket.errors?.[0]?.message ?? "", /Canonical Market metadata is missing for recovered fill ETHUSDT/)
})

test("accounts for third-asset commission debits during recovered account reconciliation", () => {
  const { projection, restored } = restoreState({ thirdAssetCommission: true })
  const result = auditRecoveredAccountState({
    projection,
    recoveredState: resolveRestoredOrdersAsFilled({ recoveredState: restored }),
    currentAccountSnapshot: snapshot({ usdtFree: "1000.24",
bnbFree: "0.7499",
bnbLocked: "0.25" }),
    openOrders: [],
    markets: [market],
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.equal(result.data.recoverySellerPositionsChecked, 0)
  assert.equal(result.data.balancesChecked, 3)
})

test("fails closed when the third-asset baseline is journaled after the applied fill", () => {
  const { projection, restored } = restoreState({ thirdAssetCommission: true })
  const fill = restored.journalFills.find(hasThirdAssetCommission)
  const lateBaselineProjection = {
    ...projection,
    data: {
      ...projection.data,
      accountSnapshots: projection.data.accountSnapshots.map((accountSnapshot) =>
        shiftCommissionBaselineSequence({
          accountSnapshot,
          sequence: fill.sequence + 1,
        })
      ),
    },
  }
  const result = auditRecoveredAccountState({
    projection: lateBaselineProjection,
    recoveredState: resolveRestoredOrdersAsFilled({ recoveredState: restored }),
    currentAccountSnapshot: snapshot({ usdtFree: "1000.24",
bnbFree: "0.7499",
bnbLocked: "0.25" }),
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
    currentAccountSnapshot: snapshot({ usdtFree: "1000.24",
bnbFree: "0.7499",
bnbLocked: "0.25" }),
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
    currentAccountSnapshot: snapshot({ usdtFree: "1000.24",
bnbFree: "0.75",
bnbLocked: "0.25" }),
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
    currentAccountSnapshot: snapshot({ usdtFree: "900.25",
usdtLocked: "100" }),
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
    currentAccountSnapshot: snapshot({ usdtFree: "900.25",
usdtLocked: "100" }),
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
      accountSnapshots: [...projection.data.accountSnapshots.entries()].map(([index, accountSnapshot]) =>
        index === 0
          ? { ...accountSnapshot,
auditStatus: "INCOMPLETE",
auditReasons: ["MISSING_ASSET_COVERAGE"] }
          : accountSnapshot
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
    currentAccountSnapshot: snapshot({ usdtFree: "900.25",
usdtLocked: "100" }),
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
    currentAccountSnapshot: snapshot({ usdtFree: "900.25",
usdtLocked: "100" }),
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
  const ethMarket = createEthMarket()
  const ethAsset = ethMarket.baseAsset
  const { projection, restored } = restoreState()
  const expandedProjection = addEthBalanceToPreflightProjection({ projection })
  const externalOrder = createExternalEthOrder({ ethMarket })
  const currentAccountSnapshot = createEthAccountSnapshot({ ethAsset })
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
        free: new Quantity({ amount: "1000.25",
asset: market.quoteAsset }),
        locked: new Quantity({ amount: "0",
asset: market.quoteAsset }),
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
        removeAssetFromPreflightSnapshot({
          entry,
          assetCode: "BTC",
        })
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
  const ethAsset = new Asset({ id: "binance:ETH",
code: "ETH" })
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
    limitPrice: new Money({ amount: "10",
asset: market.quoteAsset }),
    originalQuantity: new Quantity({ amount: "0.1",
asset: ethAsset }),
    executedQuantity: new Quantity({ amount: "0",
asset: ethAsset }),
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
  const exchangeFills = exchangeFillsFromJournal(restored.journalFills)
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
      evidenceDigest: "a".repeat(64),
      verifiedBy: "operator:trader",
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
    limitPrice: new Money({ amount: "100",
asset: market.quoteAsset }),
    originalQuantity: new Quantity({ amount: "0.1",
asset: market.baseAsset }),
    executedQuantity: new Quantity({ amount: "0",
asset: market.baseAsset }),
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
    limitPrice: new Money({ amount: "100",
asset: market.quoteAsset }),
    originalQuantity: new Quantity({ amount: "0.1",
asset: market.baseAsset }),
    executedQuantity: new Quantity({ amount: "0",
asset: market.baseAsset }),
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
    fills: exchangeFillsFromJournal(restored.journalFills),
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
      evidenceDigest: "b".repeat(64),
      verifiedBy: "operator:trader",
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
