import test from "node:test"
import assert from "node:assert/strict"
import {
  Asset,
  CanonicalOrder,
  Commission,
  Fill,
  Market,
  Money,
  Quantity,
} from "@coinzilla/entities"
import { OrderRegistry } from "../../src/domain/orders/order-registry.js"
import { StrategyId } from "../../src/domain/strategies/strategy-ids.js"
import { Portfolio } from "../../src/domain/portfolio/portfolio.js"
import { Position } from "../../src/domain/portfolio/position.js"
import {
  createLegacyPosition,
  createLegacyPositionAccounting,
} from "../../src/domain/strategies/recovery-seller/legacy-position.js"
import { createMixedSellFillAllocation } from "../../src/domain/strategies/recovery-seller/mixed-sell-fill-allocation.js"
import {
  createMixedSellFillReconciliation,
  reconcileMixedSellFillOrder,
  stageMixedSellFillAllocation,
} from "../../src/domain/strategies/recovery-seller/mixed-sell-fill-reconciliation.js"
import { applyReconciledMixedSellOrder } from "../../src/domain/strategies/recovery-seller/mixed-sell-fill-accounting.js"

const positionId = "rs-doge-position-001"
const cycleId = "rs-doge-cycle-001"
const clientOrderId = "rs-doge-mixed-sell-001"
const brokerOrderId = "binance-order-001"

function createScenario({ legacyRemainingQuantity = "1" } = {}) {
  const baseAsset = new Asset({ id: "doge-asset", code: "DOGE" })
  const quoteAsset = new Asset({ id: "usdt-asset", code: "USDT" })
  const market = new Market({
    venue: "binance",
    symbol: "DOGEUSDT",
    baseAsset,
    quoteAsset,
  })
  const order = new CanonicalOrder({
    clientOrderId,
    brokerOrderId,
    market,
    side: "SELL",
    type: "LIMIT",
    limitPrice: new Money({ amount: "10", asset: quoteAsset }),
    originalQuantity: new Quantity({ amount: "401", asset: baseAsset }),
    executedQuantity: new Quantity({ amount: "401", asset: baseAsset }),
    status: "FILLED",
    createdAt: 1,
    acknowledgedAt: 2,
    updatedAt: 3,
    completedAt: 3,
  })
  const orderRegistry = new OrderRegistry({
    orders: [order],
    ownerships: [{
      clientOrderId,
      strategyId: StrategyId.RECOVERY_SELLER,
      positionId,
      purpose: "RECOVERY_SELL",
      cycleId,
    }],
  })
  const fill = new Fill({
    tradeId: "trade-001",
    brokerOrderId,
    clientOrderId,
    market,
    side: "SELL",
    price: new Money({ amount: "10", asset: quoteAsset }),
    quantity: new Quantity({ amount: "401", asset: baseAsset }),
    quoteQuantity: new Money({ amount: "4010", asset: quoteAsset }),
    liquidityRole: "MAKER",
    executedAt: 4,
    commissions: [
      new Commission({
        amount: new Money({ amount: "4.01", asset: quoteAsset }),
      }),
    ],
    commissionStatus: "COMPLETE",
  })
  const allocation = createMixedSellFillAllocation({
    fill,
    orderRegistry,
    recoveryQuantity: "400",
    legacyQuantity: "1",
  })
  const initialRecoveryPosition = new Position({
    positionId,
    strategyId: StrategyId.RECOVERY_SELLER,
    market,
    baseQuantity: new Quantity({ amount: "400", asset: baseAsset }),
    freeBaseQuantity: new Quantity({ amount: "0", asset: baseAsset }),
    quoteNetCashFlow: new Money({ amount: "0", asset: quoteAsset }),
    spent: new Money({ amount: "4000", asset: quoteAsset }),
  })
  const portfolio = new Portfolio({
    positions: [initialRecoveryPosition],
  })
  const createdLegacyPosition = createLegacyPosition({
    invested: "0.1",
    quantity: "1",
  })
  const legacyPosition = Object.freeze({
    ...createdLegacyPosition,
    remainingQuantity: legacyRemainingQuantity,
  })
  const legacyAccounting = createLegacyPositionAccounting()
  const initialReconciliation = createMixedSellFillReconciliation({
    order,
    orderRegistry,
  })
  const staged = stageMixedSellFillAllocation({
    reconciliation: initialReconciliation,
    allocation,
  })
  const terminal = reconcileMixedSellFillOrder({
    reconciliation: staged.reconciliation,
    terminalOrder: order,
    orderRegistry,
    canonicalFillAllocations: [allocation],
  })

  return Object.freeze({
    baseAsset,
    quoteAsset,
    market,
    order,
    orderRegistry,
    fill,
    allocation,
    portfolio,
    legacyPosition,
    legacyAccounting,
    reconciliation: terminal.reconciliation,
  })
}

function applyScenario(scenario, overrides = {}) {
  return applyReconciledMixedSellOrder({
    portfolio: scenario.portfolio,
    legacyPosition: scenario.legacyPosition,
    legacyAccounting: scenario.legacyAccounting,
    reconciliation: scenario.reconciliation,
    terminalOrder: scenario.order,
    orderRegistry: scenario.orderRegistry,
    canonicalFills: [scenario.fill],
    canonicalFillAllocations: [scenario.allocation],
    ...overrides,
  })
}

test("one 401 DOGE canonical SELL Fill allocates 400 DOGE to recovery and 1 DOGE to legacy", () => {
  const scenario = createScenario()
  const { allocation, fill } = scenario

  assert.equal(fill.quantity.amount, "401",
    "The exchange execution fact must remain one canonical 401 DOGE SELL Fill.")
  assert.equal(allocation.fillId, fill.id,
    "Both accounting allocations must remain tied to the original canonical Fill identity.")
  assert.equal(allocation.recovery.grossBaseQuantity, "400",
    "The recovery allocation must receive exactly the 400 DOGE recovery slice.")
  assert.equal(allocation.legacy.grossBaseQuantity, "1",
    "The legacy allocation must receive the additional configured 1 DOGE slice.")
  assert.equal(allocation.recovery.baseDebit, "400",
    "Recovery base debit must equal its gross slice when no base-asset commission was charged.")
  assert.equal(allocation.legacy.baseDebit, "1",
    "Legacy base debit must equal its gross slice when no base-asset commission was charged.")
  assert.equal(allocation.recovery.quoteProceeds, "4000",
    "The recovery allocation must receive 400 of the 401 DOGE execution's 4,010 USDT gross proceeds.")
  assert.equal(allocation.legacy.quoteProceeds, "10",
    "The legacy allocation must receive 10 USDT gross proceeds for its 1 DOGE slice.")
  assert.equal(allocation.recovery.commissions[0].amount, "4",
    "The 4.01 USDT actual quote commission must be split proportionally to recovery quantity.")
  assert.equal(allocation.legacy.commissions[0].amount, "0.01",
    "The legacy slice must retain its proportional 0.01 USDT actual quote commission.")
  assert.equal(allocation.orderOwnership.cycleId, cycleId,
    "Allocation metadata must retain the registered Recovery Seller cycle identity.")
  assert.equal(allocation.orderOwnership.positionId, positionId,
    "Allocation metadata must retain the registered Recovery Seller Position identity.")
})

test("a reconciled mixed SELL commits recovery and legacy accounting from the same canonical Fill", () => {
  const scenario = createScenario()
  const result = applyScenario(scenario)
  const recoveryPosition = result.portfolio.getPosition({ positionId })

  assert.equal(result.applied, true,
    "A new terminal mixed SELL must apply both accounting projections.")
  assert.equal(result.duplicate, false,
    "The first application of this canonical Fill must not be classified as a replay.")
  assert.equal(result.reconciliation.status, "RECONCILED",
    "The order-scoped SELL reconciliation must be terminal before accounting is committed.")
  assert.equal(recoveryPosition.baseQuantity.amount, "0",
    "The recovery Position must debit its complete 400 DOGE allocation.")
  assert.equal(recoveryPosition.quoteNetCashFlow.amount, "3996",
    "Recovery net proceeds must subtract its 4 USDT share of the actual quote commission.")
  assert.equal(recoveryPosition.spent.amount, "4000",
    "The recovery Position must preserve its original 4,000 USDT invested basis.")
  assert.equal(result.legacyPosition.remainingQuantity, "0",
    "The legacy Position must debit its complete 1 DOGE allocation.")
  assert.equal(result.legacyAccounting.realizedQuoteProceeds, "9.99",
    "Legacy realized proceeds must subtract its 0.01 USDT share of the actual quote commission.")
  assert.equal(result.legacyAccounting.realizedCostBasis, "0.1",
    "Legacy realized cost basis must use its fixed 0.1 USDT historical basis.")
  assert.equal(result.legacyAccounting.realizedProfit, "9.89",
    "Legacy realized profit must equal 9.99 USDT net proceeds less 0.10 USDT basis.")
  assert.deepEqual(result.portfolio.appliedFillIds, [scenario.fill.id],
    "The recovery Portfolio must record the canonical Fill exactly once.")
  assert.deepEqual(result.legacyAccounting.appliedFillIds, [scenario.fill.id],
    "Legacy accounting must record the same canonical Fill exactly once.")
})

test("replaying the same terminal mixed SELL is an exact no-op in both accounting projections", () => {
  const scenario = createScenario()
  const first = applyScenario(scenario)
  const replay = applyScenario(scenario, {
    portfolio: first.portfolio,
    legacyPosition: first.legacyPosition,
    legacyAccounting: first.legacyAccounting,
    reconciliation: first.reconciliation,
  })

  assert.equal(replay.applied, false,
    "A repeated terminal reconciliation must not apply the same Fill again.")
  assert.equal(replay.duplicate, true,
    "An identical canonical Fill and allocation replay must be recognized as a duplicate.")
  assert.strictEqual(replay.portfolio, first.portfolio,
    "Recovery Portfolio must retain the exact immutable snapshot on duplicate replay.")
  assert.strictEqual(replay.legacyPosition, first.legacyPosition,
    "Legacy Position must retain the exact immutable snapshot on duplicate replay.")
  assert.strictEqual(replay.legacyAccounting, first.legacyAccounting,
    "Legacy accounting must retain the exact immutable snapshot on duplicate replay.")
  assert.equal(replay.portfolio.appliedFillIds.length, 1,
    "Duplicate replay must not append a second recovery Fill identity.")
  assert.equal(replay.legacyAccounting.appliedFillIds.length, 1,
    "Duplicate replay must not append a second legacy Fill identity.")
})

test("a failed legacy projection leaves the recovery Portfolio and both original inputs unchanged", () => {
  const scenario = createScenario({ legacyRemainingQuantity: "0.5" })
  const portfolioBefore = scenario.portfolio
  const recoveryBefore = scenario.portfolio.getPosition({ positionId }).value
  const legacyPositionBefore = scenario.legacyPosition
  const legacyAccountingBefore = scenario.legacyAccounting

  assert.throws(
    () => applyScenario(scenario),
    /could not be applied atomically/,
    "An allocation larger than remaining legacy inventory must reject the entire mixed SELL accounting commit.",
  )
  assert.strictEqual(scenario.portfolio, portfolioBefore,
    "A failed legacy debit must not publish the already-calculated recovery Portfolio snapshot.")
  assert.deepEqual(scenario.portfolio.getPosition({ positionId }).value, recoveryBefore,
    "The original recovery Position quantity and accounting must remain unchanged after failure.")
  assert.strictEqual(scenario.legacyPosition, legacyPositionBefore,
    "A failed mixed SELL must not mutate the original legacy Position.")
  assert.strictEqual(scenario.legacyAccounting, legacyAccountingBefore,
    "A failed mixed SELL must not mutate the original legacy accounting projection.")
  assert.equal(scenario.legacyPosition.remainingQuantity, "0.5",
    "The insufficient legacy inventory must remain visible rather than being partially consumed.")
  assert.deepEqual(scenario.legacyAccounting.appliedFillIds, [],
    "Neither projection may record the canonical Fill after a failed atomic commit.")
})

test("a duplicate staged Fill is idempotent and conflicting allocation facts are rejected", () => {
  const scenario = createScenario()
  const initial = createMixedSellFillReconciliation({
    order: scenario.order,
    orderRegistry: scenario.orderRegistry,
  })
  const first = stageMixedSellFillAllocation({
    reconciliation: initial,
    allocation: scenario.allocation,
  })
  const duplicate = stageMixedSellFillAllocation({
    reconciliation: first.reconciliation,
    allocation: scenario.allocation,
  })
  const conflictingAllocation = createMixedSellFillAllocation({
    fill: scenario.fill,
    orderRegistry: scenario.orderRegistry,
    recoveryQuantity: "399",
    legacyQuantity: "2",
  })

  assert.equal(first.applied, true,
    "The first canonical Fill allocation must be staged.")
  assert.equal(duplicate.applied, false,
    "Replaying the identical Fill allocation must not change staging state.")
  assert.equal(duplicate.duplicate, true,
    "The identical Fill identity and allocation fingerprint must be recognized as a duplicate.")
  assert.strictEqual(duplicate.reconciliation, first.reconciliation,
    "Duplicate staging must return the exact prior immutable reconciliation snapshot.")
  assert.equal(duplicate.reconciliation.stagedQuantity, "401",
    "Duplicate staging must not double-count the 401 DOGE execution quantity.")
  assert.throws(
    () => stageMixedSellFillAllocation({
      reconciliation: first.reconciliation,
      allocation: conflictingAllocation,
    }),
    /replayed with conflicting execution or allocation facts/,
    "The same canonical Fill identity must reject a different recovery/legacy allocation split.",
  )
})

test("recovery and legacy allocations must sum exactly to the canonical SELL Fill quantity", () => {
  const scenario = createScenario()

  assert.throws(
    () => createMixedSellFillAllocation({
      fill: scenario.fill,
      orderRegistry: scenario.orderRegistry,
      recoveryQuantity: "400",
      legacyQuantity: "0.99",
    }),
    /must sum to the canonical Fill quantity/,
    "A 400 DOGE recovery allocation plus 0.99 DOGE legacy allocation must not account for a 401 DOGE canonical execution.",
  )
})
