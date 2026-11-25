import test from "node:test"
import assert from "node:assert/strict"
import { addDecimal } from "@coinzilla/utils"
import {
  Asset,
  CanonicalOrder,
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
