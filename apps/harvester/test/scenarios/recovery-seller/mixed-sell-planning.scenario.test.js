import test from "node:test"
import assert from "node:assert/strict"
import { divideDecimal } from "@coinzilla/utils"
import { Asset, Balance, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { Portfolio } from "../../../src/domain/portfolio/portfolio.js"
import { StrategyId } from "../../../src/domain/strategies/strategy-ids.js"
import { calculateVerifiedLegacySpotAllocation } from "../../../src/domain/strategies/recovery-seller/legacy-spot-allocation.js"
import { calculateRecoverySellerSellPlan } from "../../../src/domain/strategies/recovery-seller/calculate-sell-plan.js"
import {
  recoverySellerScenarioRegistry,
} from "./registry/index.js"
import { recoverySellerMixedSellPlanningScenarios } from "./scenarios/mixed-sell-planning.js"
import { runRecoverySellerDomainScenario } from "./runners/run-domain-scenario.js"

function calculatePlan({ input }) {
  const legacyAverageCost = divideDecimal({
    left: input.legacyInvested,
    right: input.originalLegacyQuantity,
    scale: 36,
    rounding: "toward-zero",
  })
  return calculateRecoverySellerSellPlan({
    recoveryQuantity: input.recoveryQuantity,
    configuredLegacyQuantity: input.configuredLegacyQuantity,
    legacyRemainingQuantity: input.legacyRemainingQuantity,
    verifiedUnreservedLegacyQuantity: input.verifiedUnreservedLegacyQuantity,
    recoveryCostBasis: input.recoveryCostBasis,
    legacyAverageCost,
    minProfit: input.minProfit,
    quoteFeeRate: input.quoteFeeRate,
    baseFeeRate: input.baseFeeRate,
    thirdAssetFeeQuoteValue: input.thirdAssetFeeQuoteValue,
    priceTickSize: input.priceTickSize,
    quantityStepSize: input.quantityStepSize,
  })
}

function selectPlan(plan) {
  return {
    recoveryQuantity: plan.recoveryQuantity,
    legacyQuantity: plan.legacyQuantity,
    quantity: plan.quantity,
    recoverySellQuantity: plan.recoverySellQuantity,
    legacySellQuantity: plan.legacySellQuantity,
    recoveryRequiredNetQuoteProceeds: plan.recoveryRequiredNetQuoteProceeds,
    legacyRequiredNetQuoteProceeds: plan.legacyRequiredNetQuoteProceeds,
    combinedRequiredNetQuoteProceeds: plan.combinedRequiredNetQuoteProceeds,
    requiredNetQuoteProceeds: plan.requiredNetQuoteProceeds,
    price: plan.price,
  }
}

async function assertRegisteredScenario({ id }) {
  const scenario = recoverySellerMixedSellPlanningScenarios.find((item) => item.id === id)
  assert.ok(scenario,
    `The business matrix scenario ${id} must exist as a declarative RS-003 registry record.`)
  assert.ok(recoverySellerScenarioRegistry.includes(scenario),
    `The shared RS registry must include ${id} so schema validation and reporting cannot omit it.`)

  const result = await runRecoverySellerDomainScenario({
    scenario,
    handlers: {
      "calculate-mixed-sell-plan": calculatePlan,
    },
  })
  assert.deepEqual(
    selectPlan(result.results[0]),
    scenario.then,
    `The real SELL planner output for ${id} must match the independently specified exact-decimal business oracle.`,
  )
}

test("RS-003-001: the mixed SELL adds the authorized legacy slice to canonical recovery inventory", async () => {
  await assertRegisteredScenario({ id: "RS-003-001" })
})

test("RS-003-002: the mixed SELL uses only the smaller authorized legacy remainder", async () => {
  await assertRegisteredScenario({ id: "RS-003-002" })
})

test("RS-003-003: exhausted legacy inventory produces a recovery-only SELL plan", async () => {
  await assertRegisteredScenario({ id: "RS-003-003" })
})

test("the shared RS registry includes the first five mixed SELL planning and custody scenarios", () => {
  const actualIds = recoverySellerScenarioRegistry
    .filter((scenario) => scenario.family === "RS-003")
    .map((scenario) => scenario.id)
    .sort()
  assert.deepEqual(actualIds, [
    "RS-003-001",
    "RS-003-002",
    "RS-003-003",
    "RS-003-004",
    "RS-003-005",
  ], "The RS registry must expose each mapped RS-003 planning and custody scenario exactly once.")
})


function createSpotMarket({ baseAsset, symbol, quoteCode }) {
  const quoteAsset = new Asset({
    id: `binance:${quoteCode}`,
    code: quoteCode,
  })
  return new Market({
    venue: "binance",
    symbol,
    baseAsset,
    quoteAsset,
  })
}

function applyPortfolioAcquisition({ portfolio, acquisition, baseAsset, getMarket }) {
  const market = getMarket(acquisition)
  const fill = new Fill({
    tradeId: acquisition.tradeId,
    brokerOrderId: `broker-${acquisition.tradeId}`,
    market,
    side: "BUY",
    price: new Money({
      amount: "10",
      asset: market.quoteAsset,
    }),
    quantity: new Quantity({
      amount: acquisition.quantity,
      asset: baseAsset,
    }),
    quoteQuantity: new Money({
      amount: acquisition.quoteQuantity,
      asset: market.quoteAsset,
    }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
  const { portfolio: nextPortfolio } = portfolio.applyFill({
    fill,
    positionId: acquisition.positionId,
    strategyId: acquisition.strategy === "CG"
      ? StrategyId.COIN_GRABBER
      : StrategyId.RECOVERY_SELLER,
  })
  return nextPortfolio
}

function createSpotBalance({ input, baseAsset }) {
  return new Balance({
    free: new Quantity({
      amount: input.spotFreeQuantity,
      asset: baseAsset,
    }),
    locked: new Quantity({
      amount: input.spotLockedQuantity ?? "0",
      asset: baseAsset,
    }),
  })
}

function calculateSpotAllocation({ input }) {
  const baseAsset = new Asset({
    id: "binance:ZRO",
    code: "ZRO",
  })
  const marketBySymbol = new Map()
  const getMarket = ({ symbol, quoteCode }) => {
    if (!marketBySymbol.has(symbol)) {
      marketBySymbol.set(symbol, createSpotMarket({
        baseAsset,
        symbol,
        quoteCode,
      }))
    }
    return marketBySymbol.get(symbol)
  }
  const portfolio = input.acquisitions.reduce((current, acquisition) =>
    applyPortfolioAcquisition({
      portfolio: current,
      acquisition,
      baseAsset,
      getMarket,
    }), new Portfolio())
  const legacyPositions = input.legacyPositions.map((legacyPosition) => ({
    market: getMarket(legacyPosition),
    originalQuantity: legacyPosition.originalQuantity,
    remainingQuantity: legacyPosition.remainingQuantity,
  }))
  const allocations = calculateVerifiedLegacySpotAllocation({
    balances: [createSpotBalance({ input, baseAsset })],
    portfolio,
    legacyPositions,
  })
  return allocations.map(({ assetId, amount }) => ({
    assetId,
    amount,
  }))
}

test("verified Spot availability below, equal to, and above the required legacy slice is capped exactly", () => {
  const cases = [
    {
      spotFreeQuantity: "1.005",
      expectedLegacySpotQuantity: "0.005",
    },
    {
      spotFreeQuantity: "1.01",
      expectedLegacySpotQuantity: "0.01",
    },
    {
      spotFreeQuantity: "1.02",
      expectedLegacySpotQuantity: "0.01",
    },
  ]

  for (const [index, scenarioCase] of cases.entries()) {
    const allocations = calculateSpotAllocation({
      input: {
        spotFreeQuantity: scenarioCase.spotFreeQuantity,
        acquisitions: [{
          marketSymbol: "ZROUSDT",
          symbol: "ZROUSDT",
          quoteCode: "USDT",
          tradeId: `spot-boundary-${index}`,
          positionId: "rs-recovery-position",
          strategy: "RS",
          quantity: "1",
          quoteQuantity: "10",
        }],
        legacyPositions: [{
          marketSymbol: "ZROUSDT",
          symbol: "ZROUSDT",
          quoteCode: "USDT",
          originalQuantity: "0.01",
          remainingQuantity: "0.01",
        }],
      },
    })

    assert.deepEqual(allocations, [{
      assetId: "binance:ZRO",
      amount: scenarioCase.expectedLegacySpotQuantity,
    }], `The ${scenarioCase.spotFreeQuantity} ZRO Spot snapshot must yield only the additional amount above the one ZRO already owned in Portfolio, capped at the 0.01 ZRO authorized legacy slice.`)
  }
})

test("verified Spot allocation subtracts every shared Portfolio position across markets and strategies", () => {
  const allocations = calculateSpotAllocation({
    input: {
      spotFreeQuantity: "5",
      spotLockedQuantity: "0.5",
      acquisitions: [
        {
          symbol: "ZROUSDT",
          quoteCode: "USDT",
          tradeId: "cg-zro-usdt",
          positionId: "cg-zro-usdt-position",
          strategy: "CG",
          quantity: "2",
          quoteQuantity: "20",
        },
        {
          symbol: "ZROFDUSD",
          quoteCode: "FDUSD",
          tradeId: "rs-zro-fdusd",
          positionId: "rs-zro-fdusd-position",
          strategy: "RS",
          quantity: "3",
          quoteQuantity: "30",
        },
      ],
      legacyPositions: [
        {
          symbol: "ZROUSDT",
          quoteCode: "USDT",
          originalQuantity: "40",
          remainingQuantity: "40",
        },
        {
          symbol: "ZROFDUSD",
          quoteCode: "FDUSD",
          originalQuantity: "10",
          remainingQuantity: "10",
        },
      ],
    },
  })

  assert.deepEqual(allocations, [{
    assetId: "binance:ZRO",
    amount: "0.5",
  }], "The 5.5 ZRO Spot total must subtract all five ZRO in CG and RS Portfolio positions across both markets, then cap the remaining 0.5 ZRO by the 50 ZRO authorized legacy remainder.")
})

async function assertRegisteredSpotScenario({ id }) {
  const scenario = recoverySellerMixedSellPlanningScenarios.find((item) => item.id === id)
  assert.ok(scenario,
    `The business matrix scenario ${id} must exist as a declarative RS-003 registry record.`)
  assert.ok(recoverySellerScenarioRegistry.includes(scenario),
    `The shared RS registry must include ${id} so schema validation and reporting cannot omit it.`)

  const result = await runRecoverySellerDomainScenario({
    scenario,
    handlers: {
      "calculate-mixed-sell-plan": calculatePlan,
      "calculate-verified-legacy-spot-allocation": ({ input }) => {
        if (Array.isArray(input.cases)) {
          return input.cases.map(({ id: caseId, ...caseInput }) => ({
            id: caseId,
            allocations: calculateSpotAllocation({
              input: caseInput,
            }),
          }))
        }
        return {
          allocations: calculateSpotAllocation({ input }),
        }
      },
    },
  })
  assert.deepEqual(
    result.results[0],
    scenario.then,
    `The real shared Portfolio/Spot allocation output for ${id} must match the independently specified custody oracle.`,
  )
}

test("RS-003-004: verified Spot availability below, equal to, and above the required legacy slice is capped exactly", async () => {
  await assertRegisteredSpotScenario({ id: "RS-003-004" })
})

test("RS-003-005: verified Spot allocation subtracts every shared Portfolio position across markets and strategies", async () => {
  await assertRegisteredSpotScenario({ id: "RS-003-005" })
})
