import test from "node:test"
import assert from "node:assert/strict"
import { divideDecimal } from "@coinzilla/utils"
import { Asset, Balance, CanonicalOrder, Fill, Market, Money, Quantity, TradingRules } from "@coinzilla/entities"
import { AccountSnapshot } from "../../../src/domain/account/account-snapshot.js"
import { Portfolio } from "../../../src/domain/portfolio/portfolio.js"
import { calculateAccountSnapshotBaselines } from "../../../src/domain/account/calculate-account-snapshot-baselines.js"
import { allocateOrderCommitments } from "../../../src/domain/orders/allocate-order-commitments.js"
import { allocateStrategyOrderCommitments } from "../../../src/use-cases/strategy-order-commitments.js"
import { StrategyId } from "../../../src/domain/strategies/strategy-ids.js"
import { evaluateRecoverySellerSellDecision } from "../../../src/domain/strategies/recovery-seller/evaluate-sell-decision.js"
import { createRecoverySellerCycleState } from "../../../src/domain/strategies/recovery-seller/cycle-state.js"
import { createRecoverySellerStopState } from "../../../src/domain/strategies/recovery-seller/stop-decision.js"
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

test("the shared RS registry includes the first eight RS-003 planning, custody, reservation and Fill-allocation scenarios", () => {
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
    "RS-003-006",
    "RS-003-007",
    "RS-003-008",
    "RS-003-009",
    "RS-003-010",
    "RS-003-011",
  ], "The RS registry must expose each mapped RS-003 planning, custody, reservation and Fill allocation scenario exactly once.")
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
  let portfolio = new Portfolio()
  for (const acquisition of input.acquisitions) {
    portfolio = applyPortfolioAcquisition({
      portfolio,
      acquisition,
      baseAsset,
      getMarket,
    })
  }
  const legacyPositions = input.legacyPositions.map((legacyPosition) => ({
    market: getMarket(legacyPosition),
    originalQuantity: legacyPosition.originalQuantity,
    remainingQuantity: legacyPosition.remainingQuantity,
  }))
  const allocations = calculateVerifiedLegacySpotAllocation({
    balances: [
      createSpotBalance({
        input,
        baseAsset,
      }),
    ],
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
          return {
            cases: input.cases.map(({ id: caseId, ...caseInput }) => ({
              id: caseId,
              allocations: calculateSpotAllocation({
                input: caseInput,
              }),
            })),
          }
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


function createSellReservationOrder({ market, orderId, originalQuantity = "1", executedQuantity = "0.5" }) {
  return new CanonicalOrder({
    clientOrderId: orderId,
    brokerOrderId: `broker-${orderId}`,
    market,
    side: "SELL",
    type: "LIMIT",
    limitPrice: new Money({
      amount: "10",
      asset: market.quoteAsset,
    }),
    originalQuantity: new Quantity({
      amount: originalQuantity,
      asset: market.baseAsset,
    }),
    executedQuantity: new Quantity({
      amount: executedQuantity,
      asset: market.baseAsset,
    }),
    status: "PARTIALLY_FILLED",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 2,
  })
}

function createReservationMarkets({ input }) {
  const baseAsset = new Asset({
    id: "binance:ZRO",
    code: "ZRO",
  })
  const quoteAsset = new Asset({
    id: "binance:USDT",
    code: "USDT",
  })
  const otherQuoteAsset = new Asset({
    id: "binance:FDUSD",
    code: "FDUSD",
  })
  const targetMarket = new Market({
    venue: "binance",
    symbol: "ZROUSDT",
    baseAsset,
    quoteAsset,
  })
  const reservationMarket = input.reservationMarketSymbol === targetMarket.symbol
    ? targetMarket
    : new Market({
      venue: "binance",
      symbol: "ZROFDUSD",
      baseAsset,
      quoteAsset: otherQuoteAsset,
    })
  return {
    baseAsset,
    quoteAsset,
    targetMarket,
    reservationMarket,
  }
}

function createReservationPortfolio({ baseAsset, targetMarket }) {
  return applyPortfolioAcquisition({
    portfolio: new Portfolio(),
    acquisition: {
      symbol: targetMarket.symbol,
      quoteCode: "USDT",
      tradeId: "rs-reservation-recovery-buy",
      positionId: "rs-reservation-recovery-position",
      strategy: "RS",
      quantity: "1",
      quoteQuantity: "10",
    },
    baseAsset,
    getMarket: () => targetMarket,
  })
}

function createReservationAccountSnapshot({
  input,
  baseAsset,
  quoteAsset,
  targetMarket,
  portfolio,
  reservation,
}) {
  const balance = new Balance({
    free: new Quantity({
      amount: input.freeBaseBalance,
      asset: baseAsset,
    }),
    locked: new Quantity({
      amount: input.lockedBaseBalance,
      asset: baseAsset,
    }),
  })
  const trackedLegacy = calculateVerifiedLegacySpotAllocation({
    balances: [balance],
    portfolio,
    legacyPositions: [{
      market: targetMarket,
      originalQuantity: "0.01",
      remainingQuantity: "0.01",
    }],
  }).map(({ assetId, amount }) => ({
    assetId,
    amount,
  }))
  const snapshotOrders = input.snapshotIncludesReservation ? [reservation] : []
  const baselines = calculateAccountSnapshotBaselines({
    portfolio,
    activeOrders: snapshotOrders,
    additionalTrackedBaseQuantity: trackedLegacy,
  })
  const accountSnapshot = new AccountSnapshot({
    balances: [
      balance,
      new Balance({
        free: new Quantity({
          amount: "1000",
          asset: quoteAsset,
        }),
        locked: new Quantity({
          amount: "0",
          asset: quoteAsset,
        }),
      }),
    ],
    sourceTime: 1,
    portfolioBaseQuantityBaseline: baselines.data.portfolioBaseQuantityBaseline,
    additionalTrackedBaseQuantityBaseline: baselines.data.additionalTrackedBaseQuantityBaseline,
    committedBaseBalanceBaseline: baselines.data.committedBaseBalanceBaseline,
  })
  return {
    accountSnapshot,
    trackedLegacy,
  }
}

function createReservationScenarioContext({ input }) {
  const markets = createReservationMarkets({ input })
  const portfolio = createReservationPortfolio(markets)
  const reservation = createSellReservationOrder({
    market: markets.reservationMarket,
    orderId: input.reservationId,
  })
  const snapshot = createReservationAccountSnapshot({
    input,
    ...markets,
    portfolio,
    reservation,
  })
  const dependencies = {
    strategyId: StrategyId.RECOVERY_SELLER,
    state: {
      registry: {
        getActiveOrders: () => [reservation],
      },
    },
    getAccountSnapshot: () => snapshot.accountSnapshot,
    getAdditionalTrackedBaseQuantity: () => snapshot.trackedLegacy,
    allocateOrderCommitments,
  }
  const activeOrders = input.reservationOwner === "RS" &&
    markets.reservationMarket.id === markets.targetMarket.id
    ? [reservation]
    : []
  return {
    dependencies,
    targetMarket: markets.targetMarket,
    portfolio,
    activeOrders,
  }
}

function allocateReservationScenario({ context, quantity }) {
  return allocateStrategyOrderCommitments({
    dependencies: context.dependencies,
    strategyId: StrategyId.RECOVERY_SELLER,
    symbol: context.targetMarket.symbol,
    metadata: {
      market: context.targetMarket,
    },
    portfolio: context.portfolio,
    activeOrders: context.activeOrders,
    pairConfig: {
      investment: 1000,
    },
    activeBaseQuantity: "1.01",
    outstandingRecoveryAmount: "0",
    actions: [{
      side: "SELL",
      quantity,
    }],
  })
}

function summarizeReservationResult({ result }) {
  if (!result.ok) {
    return {
      ok: false,
      reason: result.errors[0].message,
    }
  }
  return {
    ok: true,
    executableActions: result.data.allocation.executableActions,
    remainingBaseBalance: result.data.allocation.remainingBaseBalance,
    remainingActiveBase: result.data.allocation.remainingActiveBase,
  }
}

function createAccountWideReservationOrders({ markets }) {
  const btcAsset = new Asset({
    id: "binance:BTC",
    code: "BTC",
  })
  const btcMarket = new Market({
    venue: "binance",
    symbol: "ZROBTC",
    baseAsset: markets.baseAsset,
    quoteAsset: btcAsset,
  })
  return [
    createSellReservationOrder({
      market: markets.reservationMarket,
      orderId: "cg-existing-zro-fdusd",
      originalQuantity: "1",
      executedQuantity: "0.5",
    }),
    createSellReservationOrder({
      market: btcMarket,
      orderId: "rs-existing-zro-btc",
      originalQuantity: "0.5",
      executedQuantity: "0.25",
    }),
  ]
}

function createAccountWideReservationSnapshot({ markets, portfolio, reservations, freeBaseBalance = "0.26" }) {
  const balance = new Balance({
    free: new Quantity({
      amount: freeBaseBalance,
      asset: markets.baseAsset,
    }),
    locked: new Quantity({
      amount: "0.75",
      asset: markets.baseAsset,
    }),
  })
  const trackedLegacy = calculateVerifiedLegacySpotAllocation({
    balances: [balance],
    portfolio,
    legacyPositions: [{
      market: markets.targetMarket,
      originalQuantity: "0.01",
      remainingQuantity: "0.01",
    }],
  }).map(({ assetId, amount }) => ({
    assetId,
    amount,
  }))
  const baselines = calculateAccountSnapshotBaselines({
    portfolio,
    activeOrders: reservations,
    additionalTrackedBaseQuantity: trackedLegacy,
  })
  const accountSnapshot = new AccountSnapshot({
    balances: [
      balance,
      new Balance({
        free: new Quantity({
          amount: "1000",
          asset: markets.quoteAsset,
        }),
        locked: new Quantity({
          amount: "0",
          asset: markets.quoteAsset,
        }),
      }),
    ],
    sourceTime: 1,
    portfolioBaseQuantityBaseline: baselines.data.portfolioBaseQuantityBaseline,
    additionalTrackedBaseQuantityBaseline: baselines.data.additionalTrackedBaseQuantityBaseline,
    committedBaseBalanceBaseline: baselines.data.committedBaseBalanceBaseline,
  })
  return {
    accountSnapshot,
    trackedLegacy,
  }
}

function createAccountWideReservationScenarioContext() {
  const markets = createReservationMarkets({
    input: {
      reservationMarketSymbol: "ZROFDUSD",
    },
  })
  const portfolio = createReservationPortfolio(markets)
  const reservations = createAccountWideReservationOrders({ markets })
  const snapshot = createAccountWideReservationSnapshot({
    markets,
    portfolio,
    reservations,
  })
  const dependencies = {
    strategyId: StrategyId.RECOVERY_SELLER,
    state: {
      registry: {
        getActiveOrders: () => reservations,
      },
    },
    getAccountSnapshot: () => snapshot.accountSnapshot,
    getAdditionalTrackedBaseQuantity: () => snapshot.trackedLegacy,
    allocateOrderCommitments,
  }
  return {
    dependencies,
    targetMarket: markets.targetMarket,
    portfolio,
    activeOrders: [],
  }
}


function createConcurrentReservationScenarioContext() {
  const markets = createReservationMarkets({
    input: {
      reservationMarketSymbol: "ZROFDUSD",
    },
  })
  const portfolio = createReservationPortfolio(markets)
  const portfolioWithCgBase = applyPortfolioAcquisition({
    portfolio,
    acquisition: {
      symbol: markets.reservationMarket.symbol,
      quoteCode: markets.reservationMarket.quoteAsset.code,
      tradeId: "cg-post-snapshot-inventory-buy",
      positionId: "cg-post-snapshot-inventory-position",
      strategy: "CG",
      quantity: "0.5",
      quoteQuantity: "5",
    },
    baseAsset: markets.baseAsset,
    getMarket: () => markets.reservationMarket,
  })
  const snapshotReservations = createAccountWideReservationOrders({ markets })
  const snapshot = createAccountWideReservationSnapshot({
    markets,
    portfolio: portfolioWithCgBase,
    reservations: snapshotReservations,
    freeBaseBalance: "0.76",
  })
  const lateReservation = createSellReservationOrder({
    market: markets.reservationMarket,
    orderId: "cg-post-snapshot-zro-sell",
    originalQuantity: "1",
    executedQuantity: "0.5",
  })
  const activeOrders = [...snapshotReservations, lateReservation]
  const dependencies = {
    strategyId: StrategyId.RECOVERY_SELLER,
    state: {
      registry: {
        getActiveOrders: () => activeOrders,
      },
    },
    getAccountSnapshot: () => snapshot.accountSnapshot,
    getAdditionalTrackedBaseQuantity: () => snapshot.trackedLegacy,
    allocateOrderCommitments,
  }
  return {
    dependencies,
    targetMarket: markets.targetMarket,
    portfolio: portfolioWithCgBase,
    activeOrders: [],
  }
}

function evaluateConcurrentReservationScenario() {
  const context = createConcurrentReservationScenarioContext()
  const atLimit = allocateReservationScenario({
    context,
    quantity: "0.26",
  })
  const overLimit = allocateReservationScenario({
    context,
    quantity: "0.27",
  })
  return {
    atLimit: summarizeReservationResult({ result: atLimit }),
    overLimit: summarizeReservationResult({ result: overLimit }),
  }
}

function evaluateAccountWideReservationScenario() {
  const context = createAccountWideReservationScenarioContext()
  const atLimit = allocateReservationScenario({
    context,
    quantity: "0.26",
  })
  const overLimit = allocateReservationScenario({
    context,
    quantity: "0.27",
  })
  return {
    atLimit: summarizeReservationResult({ result: atLimit }),
    overLimit: summarizeReservationResult({ result: overLimit }),
  }
}

function evaluateReservationScenario({ input }) {
  const context = createReservationScenarioContext({ input })
  const atLimit = allocateReservationScenario({
    context,
    quantity: "0.51",
  })
  const overLimit = allocateReservationScenario({
    context,
    quantity: "0.52",
  })
  return {
    atLimit: summarizeReservationResult({ result: atLimit }),
    overLimit: summarizeReservationResult({ result: overLimit }),
  }
}

function assertReservationBoundary({ input }) {
  const actual = evaluateReservationScenario({ input })
  assert.equal(actual.atLimit.ok, true,
    "The exact base quantity remaining after the existing reservation must remain executable.")
  assert.deepEqual(actual.atLimit.executableActions, [{
    side: "SELL",
    quantity: "0.51",
  }])
  assert.equal(actual.atLimit.remainingBaseBalance, input.expectedRemainingBaseBalance)
  assert.equal(actual.atLimit.remainingActiveBase, input.expectedRemainingActiveBase)
  assert.equal(actual.overLimit.ok, false,
    "An additional SELL above the reservation-adjusted shared/owned quantity must fail closed.")
  assert.equal(actual.overLimit.reason, input.expectedFailure)
}

test("RS-003-007-A: a same-market RS reservation reduces owned active SELL inventory exactly once", () => {
  assertReservationBoundary({
    input: {
      reservationId: "rs-same-market-sell",
      reservationMarketSymbol: "ZROUSDT",
      reservationOwner: "RS",
      snapshotIncludesReservation: true,
      freeBaseBalance: "2",
      lockedBaseBalance: "0.5",
      expectedRemainingBaseBalance: "1.49",
      expectedRemainingActiveBase: "0",
      expectedFailure: "Strategy SELL quantity exceeds Harvester-owned active inventory after commitments",
    },
  })
})

test("RS-003-007-B: a same-market CG reservation reduces shared account base availability", () => {
  assertReservationBoundary({
    input: {
      reservationId: "cg-same-market-sell",
      reservationMarketSymbol: "ZROUSDT",
      reservationOwner: "CG",
      snapshotIncludesReservation: true,
      freeBaseBalance: "0.51",
      lockedBaseBalance: "0.5",
      expectedRemainingBaseBalance: "0",
      expectedRemainingActiveBase: "0.5",
      expectedFailure: "Strategy SELL quantity exceeds available free base balance after commitments",
    },
  })
})

test("RS-003-007-C: a cross-market CG reservation reduces shared base availability after the account snapshot", () => {
  assertReservationBoundary({
    input: {
      reservationId: "cg-cross-market-sell",
      reservationMarketSymbol: "ZROFDUSD",
      reservationOwner: "CG",
      snapshotIncludesReservation: false,
      freeBaseBalance: "1.01",
      lockedBaseBalance: "0",
      expectedRemainingBaseBalance: "0",
      expectedRemainingActiveBase: "0.5",
      expectedFailure: "Strategy SELL quantity exceeds available free base balance after commitments",
    },
  })
})

async function assertRegisteredReservationScenario() {
  const scenario = recoverySellerMixedSellPlanningScenarios.find((item) => item.id === "RS-003-007")
  assert.ok(scenario,
    "RS-003-007 must exist as a declarative same-/cross-market reservation scenario.")
  assert.ok(recoverySellerScenarioRegistry.includes(scenario),
    "The shared RS registry must include RS-003-007.")

  const result = await runRecoverySellerDomainScenario({
    scenario,
    handlers: {
      "calculate-same-cross-market-sell-reservation": ({ input }) => ({
        cases: input.cases.map(({ id, ...caseInput }) => ({
          id,
          ...evaluateReservationScenario({ input: caseInput }),
        })),
      }),
    },
  })
  assert.deepEqual(
    result.results[0],
    scenario.then,
    "The real strategy/account commitment allocator must match the same-market and cross-market reservation oracle.",
  )
}

test("RS-003-007: registered same-market and cross-market SELL reservations are accounted exactly once", async () => {
  await assertRegisteredReservationScenario()
})

function assertAccountWideReservationBoundary() {
  const actual = evaluateAccountWideReservationScenario()
  assert.equal(actual.atLimit.ok, true,
    "The account-wide remaining base quantity must be executable at its exact boundary.")
  assert.deepEqual(actual.atLimit.executableActions, [{
    side: "SELL",
    quantity: "0.26",
  }])
  assert.equal(actual.atLimit.remainingBaseBalance, "0")
  assert.equal(actual.atLimit.remainingActiveBase, "0.75")
  assert.equal(actual.overLimit.ok, false,
    "A SELL above the sum of shared account commitments must fail closed.")
  assert.equal(
    actual.overLimit.reason,
    "Strategy SELL quantity exceeds available free base balance after commitments",
  )
}

async function assertRegisteredAccountWideReservationScenario() {
  const scenario = recoverySellerMixedSellPlanningScenarios.find((item) => item.id === "RS-003-006")
  assert.ok(scenario,
    "RS-003-006 must exist as a declarative account-wide reservation scenario.")
  assert.ok(recoverySellerScenarioRegistry.includes(scenario),
    "The shared RS registry must include RS-003-006.")
  const result = await runRecoverySellerDomainScenario({
    scenario,
    handlers: {
      "calculate-account-wide-sell-reservation": () => evaluateAccountWideReservationScenario(),
    },
  })
  assert.deepEqual(
    result.results[0],
    scenario.then,
    "The real account-wide commitment allocator must subtract the existing shared base commitments exactly once.",
  )
}


test("RS-003-009: a SELL commitment created after the account snapshot is subtracted once at the exact shared-base boundary", () => {
  const actual = evaluateConcurrentReservationScenario()
  assert.equal(actual.atLimit.ok, true,
    "The free base remaining after a post-snapshot account-wide SELL commitment must be executable at its exact boundary.")
  assert.deepEqual(actual.atLimit.executableActions, [{
    side: "SELL",
    quantity: "0.26",
  }])
  assert.equal(actual.atLimit.remainingBaseBalance, "0",
    "The exact 0.26 ZRO candidate must consume only the free base left after the 0.5 ZRO post-snapshot commitment.")
  assert.equal(actual.atLimit.remainingActiveBase, "0.75",
    "The cross-market commitment must reduce account availability, not RS-owned active inventory.")
  assert.equal(actual.overLimit.ok, false,
    "A 0.27 ZRO candidate must fail closed when only 0.26 ZRO remains after the late commitment.")
  assert.equal(actual.overLimit.reason,
    "Strategy SELL quantity exceeds available free base balance after commitments",
    "The excess must be rejected by the shared account-base commitment guard.")
})


test("RS-003-009: registered post-snapshot SELL reservation reduces shared base availability exactly once", async () => {
  const scenario = recoverySellerMixedSellPlanningScenarios.find((item) => item.id === "RS-003-009")
  assert.ok(scenario,
    "RS-003-009 must exist as a declarative post-snapshot account commitment scenario.")
  assert.ok(recoverySellerScenarioRegistry.includes(scenario),
    "The shared RS registry must include RS-003-009.")
  const result = await runRecoverySellerDomainScenario({
    scenario,
    handlers: {
      "calculate-post-snapshot-sell-reservation": () => evaluateConcurrentReservationScenario(),
    },
  })
  assert.deepEqual(
    result.results[0],
    scenario.then,
    "The production account allocator must subtract the active reservation delta created after the snapshot exactly once.",
  )
})


test("RS-003-009-A: tiny exponent-notation quantities preserve exact TradingRules quantity and price increments", () => {
  const plan = calculatePlan({
    input: {
      recoveryQuantity: "1e-8",
      configuredLegacyQuantity: "1e-8",
      legacyRemainingQuantity: "0",
      verifiedUnreservedLegacyQuantity: "0",
      recoveryCostBasis: "1e-8",
      legacyInvested: "2e-8",
      originalLegacyQuantity: "1e-8",
      minProfit: "1e-2",
      quoteFeeRate: "0",
      baseFeeRate: "0",
      thirdAssetFeeQuoteValue: "0",
      priceTickSize: "1e-8",
      quantityStepSize: "1e-8",
    },
  })
  assert.deepEqual(selectPlan(plan), {
    recoveryQuantity: "1e-8",
    legacyQuantity: "0",
    quantity: "0.00000001",
    recoverySellQuantity: "0.00000001",
    legacySellQuantity: "0",
    recoveryRequiredNetQuoteProceeds: "0.01000001",
    legacyRequiredNetQuoteProceeds: "0",
    combinedRequiredNetQuoteProceeds: "0.01000001",
    requiredNetQuoteProceeds: "0.01000001",
    price: "1000001",
  }, "Exponent-notation quantity, quantity step and price tick must be parsed as exact decimals without Number conversion or rounding away the minimum sell quantity.")
})


function createScenarioTradingRules({ input, market, baseAsset }) {
  const { quoteAsset } = market
  const constraints = [
    {
      type: "PRICE_INCREMENT",
      status: "SUPPORTED",
      value: new Money({
        amount: input.tradingRules.priceIncrement,
        asset: quoteAsset,
      }),
    },
    {
      type: "QUANTITY_INCREMENT",
      status: "SUPPORTED",
      value: new Quantity({
        amount: input.tradingRules.quantityIncrement,
        asset: baseAsset,
      }),
    },
    {
      type: "MIN_QUANTITY",
      status: "SUPPORTED",
      value: new Quantity({
        amount: input.tradingRules.minQuantity,
        asset: baseAsset,
      }),
    },
    {
      type: "MIN_NOTIONAL",
      status: "SUPPORTED",
      value: new Money({
        amount: input.tradingRules.minNotional ?? "20",
        asset: quoteAsset,
      }),
    },
  ].filter(({ type }) => type !== input.tradingRules.missingFilter)
  return {
    market,
    supportedOrderTypes: ["LIMIT_MAKER", "LIMIT"],
    tradingRules: new TradingRules({
      market,
      constraints,
    }),
  }
}

function summarizeExchangeFilterDecision({ decision }) {
  return {
    outcome: decision.decision.outcome,
    stopStatus: decision.stopState.status,
    orderIntent: decision.orderIntent ?? null,
    filterViolation: decision.decision.explanation.includes("MIN_NOTIONAL")
      ? "MIN_NOTIONAL"
      : null,
  }
}

function createExchangeFilterScenarioDecision({ input }) {
  const baseAsset = new Asset({
    id: "binance:ZRO",
    code: "ZRO",
  })
  const market = createSpotMarket({
    baseAsset,
    symbol: "ZROUSDT",
    quoteCode: "USDT",
  })
  const marketMetadata = createScenarioTradingRules({
    input,
    market,
    baseAsset,
  })
  const decision = evaluateRecoverySellerSellDecision({
    pairConfig: {
      minProfit: 0.01,
      makerPercent: 0,
      takerPercent: 0.075,
    },
    marketMetadata,
    cycleState: createRecoverySellerCycleState({
      cycleId: "rs-filter-cycle",
      positionId: "rs-filter-position",
    }),
    stopState: createRecoverySellerStopState(),
    planInput: {
      recoveryQuantity: input.candidate.recoveryQuantity,
      configuredLegacyQuantity: "0.01",
      legacyRemainingQuantity: "0",
      verifiedUnreservedLegacyQuantity: "0",
      recoveryCostBasis: input.candidate.recoveryCostBasis,
      legacyAverageCost: "0",
      minProfit: input.candidate.minProfit,
      thirdAssetFeeQuoteValue: "0",
    },
  })
  return summarizeExchangeFilterDecision({
    decision,
  })
}

test("RS-003-010-A: a supported MIN_NOTIONAL violation blocks SELL without adjustment", async () => {
  const scenario = recoverySellerMixedSellPlanningScenarios.find((item) => item.id === "RS-003-010")
  assert.ok(scenario,
    "RS-003-010 must be a declarative exchange-filter business scenario.")
  assert.ok(recoverySellerScenarioRegistry.includes(scenario),
    "The shared RS registry must include the exchange-filter scenario.")
  const result = await runRecoverySellerDomainScenario({
    scenario,
    handlers: {
      "evaluate-exchange-filter-block": createExchangeFilterScenarioDecision,
    },
  })
  assert.deepEqual(
    result.results[0],
    scenario.then,
    "The real SELL policy must block below MIN_NOTIONAL, latch STOP and return no adjusted order intent.",
  )
})

test("RS-003-006: account-wide SELL reservations across markets are summed and snapshot commitments are not double-counted", async () => {
  assertAccountWideReservationBoundary()
  await assertRegisteredAccountWideReservationScenario()
})

test("RS-003-011-A: missing required MIN_NOTIONAL metadata blocks SELL", async () => {
  const scenario = recoverySellerMixedSellPlanningScenarios.find((item) => item.id === "RS-003-011")
  assert.ok(scenario,
    "RS-003-011 must be a declarative missing-filter business scenario.")
  assert.ok(recoverySellerScenarioRegistry.includes(scenario),
    "The shared RS registry must include the missing-filter scenario.")
  const result = await runRecoverySellerDomainScenario({
    scenario,
    handlers: {
      "evaluate-missing-required-filter": createExchangeFilterScenarioDecision,
    },
  })
  assert.deepEqual(
    result.results[0],
    scenario.then,
    "Missing required MIN_NOTIONAL metadata must block, latch STOP and return no order intent.",
  )
})

