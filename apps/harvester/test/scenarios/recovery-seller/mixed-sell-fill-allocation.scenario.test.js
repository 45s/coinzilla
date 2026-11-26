import test from "node:test"
import assert from "node:assert/strict"
import { addDecimal } from "@coinzilla/utils"
import {
  Asset,
  CanonicalOrder,
  Commission,
  Commission,
  Fill,
  Market,
  Money,
  Quantity,
} from "@coinzilla/entities"
import { OrderRegistry } from "../../../src/domain/orders/order-registry.js"
import { StrategyId } from "../../../src/domain/strategies/strategy-ids.js"
import { createMixedSellFillAllocation } from "../../../src/domain/strategies/recovery-seller/mixed-sell-fill-allocation.js"
import { recoverySellerScenarioRegistry } from "./registry/index.js"
import { recoverySellerMixedSellPlanningScenarios } from "./scenarios/mixed-sell-planning.js"
import { runRecoverySellerDomainScenario } from "./runners/run-domain-scenario.js"
import { Portfolio } from "../../../src/domain/portfolio/portfolio.js"
import { createOrderOwnership } from "../../../src/domain/orders/order-ownership.js"
import {
  createLegacyPosition,
  createLegacyPositionAccounting,
} from "../../../src/domain/strategies/recovery-seller/legacy-position.js"
import {
  createMixedSellFillReconciliation,
  stageMixedSellFillAllocation,
} from "../../../src/domain/strategies/recovery-seller/mixed-sell-fill-reconciliation.js"
import { createRecoverySellerAccountingWorkflow } from "../../../src/use-cases/create-recovery-seller-accounting-workflow.js"

function createMarket({ input }) {
  const baseAsset = new Asset({
    id: input.baseAssetId,
    code: input.baseAssetCode,
  })
  const quoteAsset = new Asset({
    id: input.quoteAssetId,
    code: input.quoteAssetCode,
  })
  const market = new Market({
    venue: input.venue,
    symbol: input.marketSymbol,
    baseAsset,
    quoteAsset,
  })
  return {
    baseAsset,
    quoteAsset,
    market,
  }
}

function createRegisteredSellOrder({ input, marketData }) {
  return new CanonicalOrder({
    clientOrderId: input.clientOrderId,
    brokerOrderId: input.brokerOrderId,
    market: marketData.market,
    side: "SELL",
    type: "LIMIT",
    limitPrice: new Money({
      amount: input.price,
      asset: marketData.quoteAsset,
    }),
    originalQuantity: new Quantity({
      amount: input.fillQuantity,
      asset: marketData.baseAsset,
    }),
    executedQuantity: new Quantity({
      amount: input.fillQuantity,
      asset: marketData.baseAsset,
    }),
    status: "FILLED",
    createdAt: 1,
    acknowledgedAt: 2,
    updatedAt: 3,
    completedAt: 3,
  })
}

function createOrderRegistry({ input, order }) {
  return new OrderRegistry({
    orders: [order],
    ownerships: [{
      clientOrderId: input.clientOrderId,
      strategyId: StrategyId.RECOVERY_SELLER,
      positionId: input.positionId,
      purpose: "RECOVERY_SELL",
      cycleId: input.cycleId,
    }],
  })
}

function createCanonicalSellFill({ input, marketData }) {
  return new Fill({
    tradeId: input.tradeId,
    brokerOrderId: input.brokerOrderId,
    clientOrderId: input.clientOrderId,
    market: marketData.market,
    side: "SELL",
    price: new Money({
      amount: input.price,
      asset: marketData.quoteAsset,
    }),
    quantity: new Quantity({
      amount: input.fillQuantity,
      asset: marketData.baseAsset,
    }),
    quoteQuantity: new Money({
      amount: input.quoteProceeds,
      asset: marketData.quoteAsset,
    }),
    liquidityRole: "MAKER",
    executedAt: 4,
    commissions: [
      new Commission({
        amount: new Money({
          amount: input.quoteCommission,
          asset: marketData.quoteAsset,
        }),
      }),
    ],
    commissionStatus: "COMPLETE",
  })
}

function createMixedSellAllocationFixture({ input }) {
  const marketData = createMarket({ input })
  const order = createRegisteredSellOrder({
    input,
    marketData,
  })
  const orderRegistry = createOrderRegistry({
    input,
    order,
  })
  const fill = createCanonicalSellFill({
    input,
    marketData,
  })
  const allocation = createMixedSellFillAllocation({
    fill,
    orderRegistry,
    recoveryQuantity: input.recoveryQuantity,
    legacyQuantity: input.legacyQuantity,
  })
  return {
    fill,
    allocation,
  }
}

function evaluateMixedSellFillAllocation({ input }) {
  const { fill, allocation } = createMixedSellAllocationFixture({ input })
  const [recoveryCommission] = allocation.recovery.commissions
  const [legacyCommission] = allocation.legacy.commissions
  return {
    fillIdentityPreserved: allocation.fillId === fill.id,
    orderOwnership: {
      strategyId: allocation.orderOwnership.strategyId,
      positionId: allocation.orderOwnership.positionId,
      purpose: allocation.orderOwnership.purpose,
      cycleId: allocation.orderOwnership.cycleId,
    },
    recovery: allocation.recovery,
    legacy: allocation.legacy,
    baseQuantityConserved: addDecimal({
      left: allocation.recovery.grossBaseQuantity,
      right: allocation.legacy.grossBaseQuantity,
    }) === fill.quantity.amount,
    quoteProceedsConserved: addDecimal({
      left: allocation.recovery.quoteProceeds,
      right: allocation.legacy.quoteProceeds,
    }) === fill.quoteQuantity.amount,
    quoteCommissionConserved: addDecimal({
      left: recoveryCommission.amount,
      right: legacyCommission.amount,
    }) === input.quoteCommission,
  }
}

test("RS-003-008: one canonical SELL Fill is split exactly between recovery and legacy with quantity conservation", async () => {
  const scenario = recoverySellerMixedSellPlanningScenarios.find((item) => item.id === "RS-003-008")
  assert.ok(scenario,
    "RS-003-008 must exist as a declarative exact recovery/legacy allocation scenario.")
  assert.ok(recoverySellerScenarioRegistry.includes(scenario),
    "The shared RS registry must include RS-003-008.")
  const result = await runRecoverySellerDomainScenario({
    scenario,
    handlers: {
      "allocate-mixed-sell-fill": ({ input }) => evaluateMixedSellFillAllocation({ input }),
    },
  })
  assert.deepEqual(
    result.results[0],
    scenario.then,
    "The canonical Fill allocation must preserve both exact ownership slices and all conservation identities.",
  )
})


const multiFillScenarioPositionId = "rs-multi-fill-position"
const multiFillScenarioCycleId = "rs-multi-fill-cycle"

function createMultiFillAccountingScenarioFixture() {
  const scenarioBaseAsset = new Asset({
    id: "binance:ZRO",
    code: "ZRO",
  })
  const scenarioQuoteAsset = new Asset({
    id: "binance:USDT",
    code: "USDT",
  })
  const scenarioMarket = new Market({
    venue: "binance",
    symbol: "ZROUSDT",
    baseAsset: scenarioBaseAsset,
    quoteAsset: scenarioQuoteAsset,
  })
  const buyFill = new Fill({
    tradeId: "rs-multi-fill-buy-trade",
    brokerOrderId: "rs-multi-fill-buy-order",
    clientOrderId: "rs-multi-fill-buy-client",
    market: scenarioMarket,
    side: "BUY",
    price: new Money({ amount: "2", asset: scenarioQuoteAsset }),
    quantity: new Quantity({ amount: "5.01", asset: scenarioBaseAsset }),
    quoteQuantity: new Money({ amount: "10.02", asset: scenarioQuoteAsset }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
  const initialPortfolio = new Portfolio().applyFill({
    fill: buyFill,
    positionId: multiFillScenarioPositionId,
    strategyId: StrategyId.RECOVERY_SELLER,
  }).portfolio
  const openSellOrder = new CanonicalOrder({
    clientOrderId: "rs-multi-fill-sell-client",
    brokerOrderId: "rs-multi-fill-sell-order",
    market: scenarioMarket,
    side: "SELL",
    type: "LIMIT_MAKER",
    limitPrice: new Money({ amount: "2", asset: scenarioQuoteAsset }),
    originalQuantity: new Quantity({ amount: "5.01", asset: scenarioBaseAsset }),
    executedQuantity: new Quantity({ amount: "0", asset: scenarioBaseAsset }),
    status: "OPEN",
    createdAt: 10,
    acknowledgedAt: 11,
    updatedAt: 11,
  })
  const terminalSellOrder = new CanonicalOrder({
    clientOrderId: openSellOrder.clientOrderId,
    brokerOrderId: openSellOrder.brokerOrderId,
    market: scenarioMarket,
    side: "SELL",
    type: "LIMIT_MAKER",
    limitPrice: openSellOrder.limitPrice,
    originalQuantity: openSellOrder.originalQuantity,
    executedQuantity: new Quantity({ amount: "5.01", asset: scenarioBaseAsset }),
    status: "FILLED",
    createdAt: 10,
    acknowledgedAt: 11,
    updatedAt: 12,
    completedAt: 12,
  })
  const ownership = createOrderOwnership({
    ownership: {
      strategyId: StrategyId.RECOVERY_SELLER,
      positionId: multiFillScenarioPositionId,
      purpose: "RECOVERY_SELL",
      cycleId: multiFillScenarioCycleId,
    },
    clientOrderId: openSellOrder.clientOrderId,
    brokerOrderId: openSellOrder.brokerOrderId,
  })
  const openOrderRegistry = new OrderRegistry({
    orders: [openSellOrder],
    ownerships: [ownership],
  })
  const terminalOrderRegistry = new OrderRegistry({
    orders: [terminalSellOrder],
    ownerships: [ownership],
  })
  const canonicalFills = [
    new Fill({
      tradeId: "rs-multi-fill-sell-trade-1",
      brokerOrderId: openSellOrder.brokerOrderId,
      clientOrderId: openSellOrder.clientOrderId,
      market: scenarioMarket,
      side: "SELL",
      price: new Money({ amount: "2.1", asset: scenarioQuoteAsset }),
      quantity: new Quantity({ amount: "2.5", asset: scenarioBaseAsset }),
      quoteQuantity: new Money({ amount: "5.25", asset: scenarioQuoteAsset }),
      commissions: [new Commission({
        amount: new Money({ amount: "0.001", asset: scenarioQuoteAsset }),
      })],
      commissionStatus: "COMPLETE",
      executedAt: 12,
    }),
    new Fill({
      tradeId: "rs-multi-fill-sell-trade-2",
      brokerOrderId: openSellOrder.brokerOrderId,
      clientOrderId: openSellOrder.clientOrderId,
      market: scenarioMarket,
      side: "SELL",
      price: new Money({ amount: "2.1", asset: scenarioQuoteAsset }),
      quantity: new Quantity({ amount: "2.51", asset: scenarioBaseAsset }),
      quoteQuantity: new Money({ amount: "5.25", asset: scenarioQuoteAsset }),
      commissions: [new Commission({
        amount: new Money({ amount: "0.002", asset: scenarioQuoteAsset }),
      })],
      commissionStatus: "COMPLETE",
      executedAt: 13,
    }),
  ]
  const canonicalFillAllocations = [
    createMixedSellFillAllocation({
      fill: canonicalFills[0],
      orderRegistry: terminalOrderRegistry,
      recoveryQuantity: "2.5",
      legacyQuantity: "0",
    }),
    createMixedSellFillAllocation({
      fill: canonicalFills[1],
      orderRegistry: terminalOrderRegistry,
      recoveryQuantity: "2.5",
      legacyQuantity: "0.01",
    }),
  ]
  let reconciliation = createMixedSellFillReconciliation({
    order: openSellOrder,
    orderRegistry: openOrderRegistry,
  })
  for (const allocation of canonicalFillAllocations) {
    const staged = stageMixedSellFillAllocation({
      reconciliation,
      allocation,
    })
    assert.equal(staged.applied, true,
      "Each distinct canonical partial SELL Fill must be staged exactly once before terminal reconciliation.")
    reconciliation = staged.reconciliation
  }
  let durableCommitCount = 0
  const workflow = createRecoverySellerAccountingWorkflow({
    initialPortfolio,
    initialOrderRegistry: openOrderRegistry,
    initialLegacyPositions: [{
      market: scenarioMarket,
      position: createLegacyPosition({ invested: "100", quantity: "50" }),
      accounting: createLegacyPositionAccounting(),
    }],
    onOperationalStateRecoverySellerMixedSellReconciled: async () => {
      durableCommitCount += 1
      return { ok: true, data: { durable: true } }
    },
  })
  return {
    canonicalFills,
    canonicalFillAllocations,
    durableCommitCount: () => durableCommitCount,
    market: scenarioMarket,
    openSellOrder,
    ownership,
    reconciliation,
    terminalSellOrder,
    workflow,
  }
}

async function commitMultiFillAccountingScenario(fixture) {
  const reservation = await fixture.workflow.reserveSellCycle({
    order: fixture.openSellOrder,
    ownership: fixture.ownership,
    durableIntent: true,
  })
  assert.equal(reservation.ok, true,
    reservation.errors?.[0]?.message ?? "The sole mixed SELL must be durably reserved before reconciliation.")
  return fixture.workflow.reconcileTerminalMixedSell({
    reconciliation: fixture.reconciliation,
    terminalOrder: fixture.terminalSellOrder,
    canonicalFills: fixture.canonicalFills,
    canonicalFillAllocations: fixture.canonicalFillAllocations,
    minProfit: "0.2",
  })
}

test("RS-006-003-A: multiple partial SELL fills are accumulated and reconciled exactly", async () => {
  const fixture = createMultiFillAccountingScenarioFixture()
  const result = await commitMultiFillAccountingScenario(fixture)

  assert.equal(result.ok, true,
    result.errors?.[0]?.message ?? "The complete canonical partial-fill history must reconcile successfully.")
  assert.equal(result.data.applied, true,
    "The terminal reconciliation must commit both strategy accounting projections from the complete canonical Fill set.")
  assert.equal(result.data.profitability.eligible, true,
    "Recovery, legacy and combined profitability must pass using the accumulated net proceeds.")
  assert.equal(addDecimal({
    left: result.data.profitability.recovery.netQuoteProceeds,
    right: result.data.profitability.legacy.netQuoteProceeds,
  }), "10.497",
  "Both partial fills must contribute gross proceeds less their actual quote commissions exactly once.")
  assert.equal(fixture.workflow.getPortfolio().getPosition({
    positionId: multiFillScenarioPositionId,
  }).baseQuantity.amount, "0.01",
  "The accumulated recovery allocation must debit exactly 5 base units from the 5.01-unit recovery Position.")
  assert.equal(fixture.workflow.getLegacyPosition({
    marketId: fixture.market.id,
  }).remainingQuantity, "49.99",
  "Only the 0.01-unit legacy allocation from the second partial Fill may debit legacy inventory.")
  assert.equal(fixture.workflow.getPortfolio().appliedFillIds.filter((fillId) =>
    fixture.canonicalFills.some((fill) => fill.id === fillId)).length, 2,
  "Both distinct canonical partial SELL Fill identities must be applied exactly once.")
  assert.equal(fixture.workflow.getOrderRegistry().getActiveOrders().length, 0,
    "The shared SELL reservation may be released only after the two projections commit.")
  assert.equal(fixture.durableCommitCount(), 1,
    "The durable mixed-SELL reconciliation boundary must be acknowledged once for the complete Fill set.")
})

test("RS-006-003-B: duplicate terminal mixed-SELL replay is an exact no-op", async () => {
  const fixture = createMultiFillAccountingScenarioFixture()
  const first = await commitMultiFillAccountingScenario(fixture)
  assert.equal(first.ok, true,
    first.errors?.[0]?.message ?? "The initial complete partial-fill history must commit.")
  const portfolioAfterFirst = fixture.workflow.getPortfolio()
  const legacyPositionAfterFirst = fixture.workflow.getLegacyPosition({ marketId: fixture.market.id })
  const legacyAccountingAfterFirst = fixture.workflow.getLegacyAccounting({ marketId: fixture.market.id })
  const registryAfterFirst = fixture.workflow.getOrderRegistry()

  const replay = await fixture.workflow.reconcileTerminalMixedSell({
    reconciliation: fixture.reconciliation,
    terminalOrder: fixture.terminalSellOrder,
    canonicalFills: fixture.canonicalFills,
    canonicalFillAllocations: fixture.canonicalFillAllocations,
    minProfit: "0.2",
  })

  assert.equal(replay.ok, true,
    replay.errors?.[0]?.message ?? "An identical terminal mixed-SELL replay must be accepted as an exact duplicate.")
  assert.equal(replay.data.duplicate, true,
    "The replay must be identified as a duplicate rather than applying either projection again.")
  assert.strictEqual(fixture.workflow.getPortfolio(), portfolioAfterFirst,
    "Duplicate replay must preserve the exact shared Portfolio snapshot.")
  assert.strictEqual(fixture.workflow.getLegacyPosition({ marketId: fixture.market.id }), legacyPositionAfterFirst,
    "Duplicate replay must preserve the exact legacy Position snapshot.")
  assert.strictEqual(fixture.workflow.getLegacyAccounting({ marketId: fixture.market.id }), legacyAccountingAfterFirst,
    "Duplicate replay must preserve the exact legacy P&L snapshot.")
  assert.strictEqual(fixture.workflow.getOrderRegistry(), registryAfterFirst,
    "Duplicate replay must not release or recreate the terminal order reservation.")
  assert.equal(fixture.durableCommitCount(), 1,
    "Duplicate replay must not append a second durable terminal reconciliation fact.")
})
