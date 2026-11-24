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
import { StrategyId } from "../../../src/domain/strategies/strategy-ids.js"
import { Portfolio } from "../../../src/domain/portfolio/portfolio.js"
import { createOrderOwnership } from "../../../src/domain/orders/order-ownership.js"
import { OrderRegistry } from "../../../src/domain/orders/order-registry.js"
import { createRecoverySellerAccountingWorkflow } from "../../../src/use-cases/create-recovery-seller-accounting-workflow.js"
import { runRecoverySellerApplicationScenario } from "./runners/run-application-scenario.js"
import { recoverySellerBuyAccountingScenarios } from "./scenarios/buy-accounting.js"

const baseAsset = new Asset({
  id: "binance:ZRO",
  code: "ZRO",
})
const quoteAsset = new Asset({
  id: "binance:USDT",
  code: "USDT",
})
const market = new Market({
  venue: "binance",
  symbol: "ZROUSDT",
  baseAsset,
  quoteAsset,
})

function createCommissions({ fillInput }) {
  const commissions = []
  const baseAmounts = fillInput.baseCommissions ?? [fillInput.baseCommission].filter(Boolean)
  const quoteAmounts = fillInput.quoteCommissions ?? [fillInput.quoteCommission].filter(Boolean)
  for (const amount of baseAmounts) {
    commissions.push(new Commission({
      amount: new Money({
        amount,
        asset: baseAsset,
      }),
    }))
  }
  for (const amount of quoteAmounts) {
    commissions.push(new Commission({
      amount: new Money({
        amount,
        asset: quoteAsset,
      }),
    }))
  }
  if (fillInput.thirdAssetCommission) {
    const feeAsset = new Asset({
      id: "binance:BNB",
      code: "BNB",
    })
    commissions.push(new Commission({
      amount: new Money({
        amount: fillInput.thirdAssetCommission,
        asset: feeAsset,
      }),
      ...(fillInput.thirdAssetQuoteValue === undefined ? {} : {
        quoteValue: new Money({
          amount: fillInput.thirdAssetQuoteValue,
          asset: quoteAsset,
        }),
      }),
    }))
  }
  return commissions
}

function createScenarioWorkflow({ input }) {
  const clientOrderId = "rs-buy-scenario-order"
  const brokerOrderId = "broker-rs-buy-scenario"
  const positionId = "rs-buy-scenario-position"
  const cycleId = "rs-buy-scenario-cycle"
  const order = new CanonicalOrder({
    clientOrderId,
    brokerOrderId,
    market,
    side: "BUY",
    type: "LIMIT_MAKER",
    limitPrice: new Money({
      amount: input.limitPrice ?? "4",
      asset: quoteAsset,
    }),
    originalQuantity: new Quantity({
      amount: "5.01",
      asset: baseAsset,
    }),
    executedQuantity: new Quantity({
      amount: "0",
      asset: baseAsset,
    }),
    status: "OPEN",
    createdAt: 100,
    acknowledgedAt: 101,
    updatedAt: 101,
  })
  const ownerships = input.owned === false
    ? []
    : [createOrderOwnership({
        ownership: {
          strategyId: StrategyId.RECOVERY_SELLER,
          positionId,
          purpose: "RECOVERY_BUY",
          cycleId,
        },
        clientOrderId,
        brokerOrderId,
      })]
  const workflow = createRecoverySellerAccountingWorkflow({
    initialPortfolio: new Portfolio(),
    initialOrderRegistry: new OrderRegistry({
      orders: [order],
      ownerships,
    }),
  })
  return {
    workflow,
    order,
    positionId,
    cycleId,
  }
}

function createScenarioFill({ fillInput, order }) {
  return new Fill({
    tradeId: fillInput.tradeId,
    brokerOrderId: fillInput.brokerOrderId ?? order.brokerOrderId,
    clientOrderId: order.clientOrderId,
    market: order.market,
    side: "BUY",
    price: new Money({
      amount: fillInput.price ?? "2",
      asset: order.market.quoteAsset,
    }),
    quantity: new Quantity({
      amount: fillInput.quantity,
      asset: order.market.baseAsset,
    }),
    quoteQuantity: new Money({
      amount: fillInput.quoteQuantity,
      asset: order.market.quoteAsset,
    }),
    commissions: createCommissions({ fillInput }),
    commissionStatus: "COMPLETE",
  })
}

async function applyConflictingFill({ workflow, firstFill, order }) {
  const conflictFill = createScenarioFill({
    fillInput: {
      tradeId: firstFill.tradeId,
      quantity: firstFill.quantity.amount,
      quoteQuantity: "5.01",
    },
    order,
  })
  const result = await workflow.applyBuyFill({ fill: conflictFill })
  return {
    ok: result.ok,
    applied: result.data?.applied === true,
  }
}

async function applyScenarioFills({ workflow, fills }) {
  const results = []
  for (const fill of fills) {
    const result = await workflow.applyBuyFill({ fill })
    results.push({
      ok: result.ok,
      applied: result.data?.applied === true,
    })
  }
  return results
}

async function replayScenarioFill({ workflow, fills, input }) {
  if (input.replayFirstFill !== true || !fills[0]) {
    return undefined
  }
  return workflow.applyBuyFill({ fill: fills[0] })
}

async function applyScenarioConflict({ workflow, fills, order, input }) {
  if (input.conflictFirstFill !== true) {
    return undefined
  }
  return applyConflictingFill({
    workflow,
    firstFill: fills[0],
    order,
  })
}

async function runBuyScenario({ input }) {
  const { workflow, order, positionId, cycleId } = createScenarioWorkflow({ input })
  const fills = input.fills.map((fillInput) => createScenarioFill({
    fillInput,
    order,
  }))
  const results = await applyScenarioFills({
    workflow,
    fills,
  })
  const replay = await replayScenarioFill({
    workflow,
    fills,
    input,
  })
  const conflict = await applyScenarioConflict({
    workflow,
    fills,
    order,
    input,
  })
  const portfolio = workflow.getPortfolio()
  const position = portfolio.getPosition({ positionId })
  return {
    appliedFillIds: portfolio.appliedFillIds.length,
    position: position
      ? {
          quantity: position.baseQuantity.amount,
          spent: position.spent.amount,
        }
      : null,
    executionQuantity: workflow.getBuyExecutionQuantity({ cycleId }) ?? null,
    executionVwap: workflow.getBuyExecutionVwap({ cycleId }) ?? null,
    ...(input.assertStrategyOwnership === true ? {
      positionStrategyId: position?.strategyId ?? null,
    } : {}),
    ...(replay ? {
      replay: {
        ok: replay.ok,
        applied: replay.data?.applied === true,
        duplicate: replay.data?.duplicate === true,
      },
    } : {}),
    ...(conflict ? { conflict } : {}),
    ...(results.some((result) => !result.ok) ? { results } : {}),
  }
}

const applicationHandlers = {
  "apply-recovery-buy-scenario": runBuyScenario,
}

for (const scenario of recoverySellerBuyAccountingScenarios.filter((item) => item.status !== "BLOCKED")) {
  test(scenario.test.title, async () => {
    const result = await runRecoverySellerApplicationScenario({
      scenario,
      handlers: applicationHandlers,
    })
    assert.deepEqual(result.results[0], scenario.then,
      `${scenario.id} must match its independent BUY accounting oracle.`)
  })
}
