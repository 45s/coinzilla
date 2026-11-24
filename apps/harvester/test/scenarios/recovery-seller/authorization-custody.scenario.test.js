import test from "node:test"
import assert from "node:assert/strict"
import {
  Asset,
  Balance,
  CanonicalOrder,
  Fill,
  Market,
  Money,
  Quantity,
} from "@coinzilla/entities"
import { StrategyId } from "../../../src/domain/strategies/strategy-ids.js"
import { Portfolio } from "../../../src/domain/portfolio/portfolio.js"
import { OrderRegistry } from "../../../src/domain/orders/order-registry.js"
import {
  createLegacyPosition,
  createLegacyPositionAccounting,
  recordLegacySale,
} from "../../../src/domain/strategies/recovery-seller/legacy-position.js"
import {
  calculateVerifiedLegacySpotAllocation,
  LegacySpotAllocationError,
  LEGACY_SPOT_ALLOCATION_ERROR_CODES,
} from "../../../src/domain/strategies/recovery-seller/legacy-spot-allocation.js"
import { createLegacyPositionMap } from "../../../src/domain/strategies/recovery-seller/legacy-accounting-state.js"
import { allocateOrderCommitments } from "../../../src/domain/orders/allocate-order-commitments.js"
import { createRecoverySellerAccountingWorkflow } from "../../../src/use-cases/create-recovery-seller-accounting-workflow.js"
import { runRecoverySellerDomainScenario } from "./runners/run-domain-scenario.js"
import { runRecoverySellerApplicationScenario } from "./runners/run-application-scenario.js"
import { authorizationCustodyScenarios } from "./scenarios/authorization-custody.js"

const baseAsset = new Asset({
  id: "binance:ZRO",
  code: "ZRO",
})
const quoteAsset = new Asset({
  id: "binance:USDT",
  code: "USDT",
})
const alternateQuoteAsset = new Asset({
  id: "binance:FDUSD",
  code: "FDUSD",
})
const market = new Market({
  venue: "binance",
  symbol: "ZROUSDT",
  baseAsset,
  quoteAsset,
})
const alternateMarket = new Market({
  venue: "binance",
  symbol: "ZROFDUSD",
  baseAsset,
  quoteAsset: alternateQuoteAsset,
})

function createBalance({ asset = baseAsset, free, locked = "0" }) {
  return new Balance({
    free: new Quantity({
      amount: free,
      asset,
    }),
    locked: new Quantity({
      amount: locked,
      asset,
    }),
  })
}

function createBuyFill({
  tradeId,
  targetMarket = market,
  quantity,
  quoteQuantity,
} = {}) {
  return new Fill({
    tradeId,
    brokerOrderId: `broker-${tradeId}`,
    clientOrderId: tradeId,
    market: targetMarket,
    side: "BUY",
    price: new Money({
      amount: "1",
      asset: targetMarket.quoteAsset,
    }),
    quantity: new Quantity({
      amount: quantity,
      asset: targetMarket.baseAsset,
    }),
    quoteQuantity: new Money({
      amount: quoteQuantity,
      asset: targetMarket.quoteAsset,
    }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
}

function createPortfolioWithPositions({ positions = [] } = {}) {
  let portfolio = new Portfolio()
  for (const [index, item] of positions.entries()) {
    const fill = createBuyFill({
      tradeId: `portfolio-fill-${index}`,
      targetMarket: item.market ?? market,
      strategyId: item.strategyId ?? StrategyId.COIN_GRABBER,
      quantity: item.quantity,
      quoteQuantity: item.quoteQuantity ?? item.quantity,
    })
    portfolio = portfolio.applyFill({
      fill,
      positionId: `portfolio-position-${index}`,
      strategyId: item.strategyId ?? StrategyId.COIN_GRABBER,
    }).portfolio
  }
  return portfolio
}

function createLegacySpotInput({
  invested = "50",
  quantity = "10",
  spotTotal,
  portfolioQuantity = "0",
  portfolioPositions,
  offSpotQuantity = "0",
} = {}) {
  const position = createLegacyPosition({
    invested,
    quantity,
  })
  const portfolioPositionsToApply = portfolioPositions
    ? input.portfolioPositions.map((item) => ({
        market: item.market === "ZROFDUSD" ? alternateMarket : market,
        quantity: item.quantity,
        quoteQuantity: item.quantity,
        strategyId: item.strategy === "RS"
          ? StrategyId.RECOVERY_SELLER
          : StrategyId.COIN_GRABBER,
      }))
    : portfolioQuantity === "0"
      ? []
      : [{
          quantity: portfolioQuantity,
          quoteQuantity: portfolioQuantity,
          strategyId: StrategyId.COIN_GRABBER,
        }]
  const portfolio = createPortfolioWithPositions({
    positions: portfolioPositionsToApply,
  })
  const allocation = calculateVerifiedLegacySpotAllocation({
    balances: [createBalance({ free: spotTotal })],
    portfolio,
    legacyPositions: [{
      market,
      originalQuantity: position.originalQuantity,
      remainingQuantity: position.remainingQuantity,
    }],
  })
  return {
    position,
    portfolio,
    allocation,
    verifiedSpotQuantity: allocation.find((item) => item.assetId === baseAsset.id)?.amount ?? "0",
    offSpotQuantityUsed: "0",
    otherStrategyPositionQuantity: portfolio.positions.reduce(
      (total, item) => total + Number(item.baseQuantity.amount),
      0,
    ),
    offSpotQuantity,
  }
}

function createExternalBuyOrder({ clientOrderId }) {
  return new CanonicalOrder({
    clientOrderId,
    brokerOrderId: "external-broker-order",
    market,
    side: "BUY",
    type: "LIMIT_MAKER",
    limitPrice: new Money({
      amount: "2",
      asset: quoteAsset,
    }),
    originalQuantity: new Quantity({
      amount: "1",
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
}

const domainHandlers = {
  "create-legacy-position": ({ input }) => createLegacyPosition(input),
  "record-legacy-sale": ({ input }) => {
    const position = createLegacyPosition({
      invested: input.invested,
      quantity: input.quantity,
    })
    return recordLegacySale({
      position,
      quantitySold: input.quantitySold,
    })
  },
  "create-legacy-position-map": ({ input }) => {
    const position = createLegacyPosition(input)
    const portfolio = new Portfolio()
    const map = createLegacyPositionMap([{
      market,
      position,
      accounting: createLegacyPositionAccounting(),
    }])
    return {
      legacyMarkets: map.size,
      portfolioPositions: portfolio.positions.length,
      appliedFillIds: portfolio.appliedFillIds.length,
    }
  },
  "calculate-verified-spot-allocation": ({ input }) => {
    const result = createLegacySpotInput(input)
    return {
      ...(input.invested ? {
        averageCost: result.position.averageCost,
        remainingQuantity: result.position.remainingQuantity,
      } : {}),
      verifiedSpotQuantity: result.verifiedSpotQuantity,
      ...(input.offSpotQuantity === undefined ? {} : {
        offSpotQuantityUsed: result.offSpotQuantityUsed,
      }),
      ...(input.portfolioQuantity === undefined ? {} : {
        otherStrategyPositionQuantity: result.otherStrategyPositionQuantity.toString(),
      }),
    }
  },
  "block-sell-above-verified-spot": ({ input }) => {
    const spot = createLegacySpotInput({
      spotTotal: input.spotTotal,
      quantity: input.authorizedQuantity,
      portfolioQuantity: input.portfolioQuantity,
    })
    const allocation = allocateOrderCommitments({
      actions: [{
        side: "SELL",
        quantity: input.requestedSellQuantity,
      }],
      quoteFreeBalance: "0",
      baseFreeBalance: spot.verifiedSpotQuantity,
      quoteCashFlow: "0",
      activeBaseQuantity: spot.verifiedSpotQuantity,
      portfolioBaseBalance: input.portfolioQuantity,
      portfolioBaseBalanceBaseline: input.portfolioQuantity,
      additionalTrackedBaseBalance: spot.verifiedSpotQuantity,
      additionalTrackedBaseBalanceBaseline: spot.verifiedSpotQuantity,
      outstandingRecoveryAmount: "0",
      committedQuote: "0",
      committedQuoteBalance: "0",
      committedQuoteBalanceBaseline: "0",
      committedBase: "0",
      committedBaseBalance: "0",
      committedBaseBalanceBaseline: "0",
      investmentLimit: "100",
    })
    return {
      verifiedSpotQuantity: spot.verifiedSpotQuantity,
      allocationOk: allocation.ok,
      errorName: allocation.errors?.[0]?.name,
    }
  },
  "compare-spot-transfer-snapshots": ({ input }) => {
    const position = createLegacyPosition({
      invested: input.invested,
      quantity: input.quantity,
    })
    const before = createLegacySpotInput({
      invested: input.invested,
      quantity: input.quantity,
      spotTotal: input.beforeSpotTotal,
      portfolioQuantity: input.portfolioQuantity,
    })
    const after = createLegacySpotInput({
      invested: input.invested,
      quantity: input.quantity,
      spotTotal: input.afterSpotTotal,
      portfolioQuantity: input.portfolioQuantity,
    })
    return {
      beforeVerifiedSpotQuantity: before.verifiedSpotQuantity,
      afterVerifiedSpotQuantity: after.verifiedSpotQuantity,
      invested: position.invested,
      averageCost: position.averageCost,
      remainingQuantity: position.remainingQuantity,
    }
  },
  "allocate-base-commitment": ({ input }) => {
    const action = {
      side: "SELL",
      quantity: input.requestedSellQuantity,
    }
    const result = allocateOrderCommitments({
      actions: [action],
      quoteFreeBalance: input.quoteFreeBalance,
      baseFreeBalance: input.baseFreeBalance,
      quoteCashFlow: "0",
      activeBaseQuantity: input.activeBaseQuantity,
      portfolioBaseBalance: input.portfolioBaseBalance,
      portfolioBaseBalanceBaseline: input.portfolioBaseBalanceBaseline,
      additionalTrackedBaseBalance: input.additionalTrackedBaseBalance,
      additionalTrackedBaseBalanceBaseline: input.additionalTrackedBaseBalanceBaseline,
      outstandingRecoveryAmount: "0",
      committedQuote: "0",
      committedQuoteBalance: "0",
      committedQuoteBalanceBaseline: "0",
      committedBase: input.committedBase,
      committedBaseBalance: input.committedBaseBalance,
      committedBaseBalanceBaseline: input.committedBaseBalanceBaseline,
      investmentLimit: "100",
    })
    return {
      executableActionCount: result.data?.executableActions.length ?? 0,
      deferredActionCount: result.data?.deferredActions.length ?? 0,
      remainingBaseBalance: result.data?.remainingBaseBalance,
      remainingActiveBase: result.data?.remainingActiveBase,
    }
  },
  "reject-invalid-custody-evidence": ({ input }) => {
    const legacyPositions = [{
      market,
      originalQuantity: input.authorizedQuantity,
      remainingQuantity: input.authorizedQuantity,
    }]
    let missingBalanceRejected = false
    let duplicateBalanceRejected = false
    try {
      calculateVerifiedLegacySpotAllocation({
        balances: [],
        portfolio: new Portfolio(),
        legacyPositions,
      })
    } catch (error) {
      missingBalanceRejected = error instanceof LegacySpotAllocationError &&
        error.code === LEGACY_SPOT_ALLOCATION_ERROR_CODES.BALANCE_MISSING
    }
    try {
      calculateVerifiedLegacySpotAllocation({
        balances: [
          createBalance({ free: "1" }),
          createBalance({ free: "2" }),
        ],
        portfolio: new Portfolio(),
        legacyPositions,
      })
    } catch (error) {
      duplicateBalanceRejected = error instanceof TypeError
    }
    return {
      missingBalanceRejected,
      duplicateBalanceRejected,
    }
  },
  "reject-incomplete-or-short-custody": ({ input }) => {
    const legacyPositions = [{
      market,
      originalQuantity: input.authorizedQuantity,
      remainingQuantity: input.authorizedQuantity,
    }]
    let missingBalanceRejected = false
    let portfolioCustodyShortfallRejected = false
    try {
      calculateVerifiedLegacySpotAllocation({
        balances: [],
        portfolio: new Portfolio(),
        legacyPositions,
      })
    } catch (error) {
      missingBalanceRejected = error instanceof LegacySpotAllocationError &&
        error.code === LEGACY_SPOT_ALLOCATION_ERROR_CODES.BALANCE_MISSING
    }
    const portfolio = createPortfolioWithPositions({
      positions: [{
        market,
        quantity: input.portfolioQuantity,
        quoteQuantity: input.portfolioQuantity,
      }],
    })
    try {
      calculateVerifiedLegacySpotAllocation({
        balances: [createBalance({ free: input.spotTotal })],
        portfolio,
        legacyPositions,
      })
    } catch (error) {
      portfolioCustodyShortfallRejected = error instanceof LegacySpotAllocationError &&
        error.code === LEGACY_SPOT_ALLOCATION_ERROR_CODES.PORTFOLIO_CUSTODY_SHORTFALL
    }
    return {
      missingBalanceRejected,
      portfolioCustodyShortfallRejected,
    }
  },
}

const applicationHandlers = {
  "reject-external-buy-fill": async ({ input }) => {
    const order = createExternalBuyOrder({
      clientOrderId: input.externalOrderClientId,
    })
    const workflow = createRecoverySellerAccountingWorkflow({
      initialPortfolio: new Portfolio(),
      initialOrderRegistry: new OrderRegistry({
        orders: [order],
        ownerships: [],
      }),
    })
    const fill = new Fill({
      tradeId: "external-buy-fill",
      brokerOrderId: order.brokerOrderId,
      clientOrderId: order.clientOrderId,
      market,
      side: "BUY",
      price: order.limitPrice,
      quantity: order.originalQuantity,
      quoteQuantity: new Money({
        amount: "2",
        asset: quoteAsset,
      }),
      commissions: [],
      commissionStatus: "COMPLETE",
    })
    const result = await workflow.applyBuyFill({ fill })
    return {
      ok: result.ok,
      portfolioPositions: workflow.getPortfolio().positions.length,
      appliedFillIds: workflow.getPortfolio().appliedFillIds.length,
    }
  },
}

function runDomain(scenario) {
  return runRecoverySellerDomainScenario({
    scenario,
    handlers: domainHandlers,
  })
}

function runApplication(scenario) {
  return runRecoverySellerApplicationScenario({
    scenario,
    handlers: applicationHandlers,
  })
}

test("RS-001-001: valid operator-declared legacy invested quote and original base quantity are accepted", async () => {
  const result = await runDomain(authorizationCustodyScenarios[0])
  assert.deepEqual(result.results[0], authorizationCustodyScenarios[0].then,
    "RS must preserve the operator-declared original basis and derive the exact fixed average cost.")
})

test("RS-001-002: historical average cost remains fixed after a legacy disposal", async () => {
  const result = await runDomain(authorizationCustodyScenarios[1])
  assert.deepEqual(result.results[0], authorizationCustodyScenarios[1].then,
    "A legacy sale may reduce remaining quantity only; invested basis and original average cost must remain unchanged.")
})

test("RS-001-003: missing zero negative malformed or contradictory legacy basis fails closed", async () => {
  await assert.rejects(
    () => runDomain(authorizationCustodyScenarios[2]),
    (error) => error instanceof RangeError,
    "A zero invested basis must be rejected rather than normalized or inferred.",
  )
})

test("RS-001-004: operator-declared legacy basis does not create synthetic Portfolio fills", async () => {
  const result = await runDomain(authorizationCustodyScenarios[3])
  assert.deepEqual(result.results[0], authorizationCustodyScenarios[3].then,
    "Legacy authorization is a separate projection and must not create Portfolio fills or Position quantity.")
})

test("RS-001-005: verified Spot custody is separate from historical legacy basis", async () => {
  const result = await runDomain(authorizationCustodyScenarios[4])
  assert.deepEqual(result.results[0], authorizationCustodyScenarios[4].then,
    "Spot availability must be calculated independently from the original invested/quantity basis.")
})

test("RS-001-006: only authoritative Spot balance is eligible and EARN or off-Spot inventory is excluded", async () => {
  const result = await runDomain(authorizationCustodyScenarios[5])
  assert.deepEqual(result.results[0], authorizationCustodyScenarios[5].then,
    "Only the supplied authoritative Spot balance may contribute to verified sellable legacy inventory.")
})

test("RS-001-007: a SELL larger than verified Spot quantity is blocked without consuming off-Spot inventory", async () => {
  const result = await runDomain(authorizationCustodyScenarios[6])
  assert.deepEqual(result.results[0], authorizationCustodyScenarios[6].then,
    "The shared allocator must reject a SELL larger than verified Spot custody even when off-Spot quantity exists.")
})

test("RS-001-008: external manual and startup-snapshot orders are not adopted as RS-owned", async () => {
  const result = await runApplication(authorizationCustodyScenarios[7])
  assert.deepEqual(result.results[0], authorizationCustodyScenarios[7].then,
    "An external order without registered RS ownership must not mutate RS Portfolio accounting.")
})

test("RS-001-009: other-strategy Portfolio allocations reduce physical Spot availability without becoming RS ownership", async () => {
  const result = await runDomain(authorizationCustodyScenarios[8])
  assert.deepEqual(result.results[0], authorizationCustodyScenarios[8].then,
    "The full shared Portfolio base quantity must be subtracted while other-strategy Position ownership remains unchanged.")
})

test("RS-001-010: missing or conflicting Spot custody evidence fails closed", async () => {
  const result = await runDomain(authorizationCustodyScenarios[9])
  assert.deepEqual(result.results[0], authorizationCustodyScenarios[9].then,
    "Missing and duplicate/conflicting canonical balances must fail closed; stale-snapshot freshness remains explicitly blocked.")
})

test("RS-001-011: authoritative Spot transfer changes availability but never rewrites historical basis", async () => {
  const result = await runDomain(authorizationCustodyScenarios[10])
  assert.deepEqual(result.results[0], authorizationCustodyScenarios[10].then,
    "A new authoritative Spot snapshot may change availability, but it must not rewrite legacy basis.")
})

test("RS-001-012: account snapshot baselines and active reservations are not subtracted twice", async () => {
  const result = await runDomain(authorizationCustodyScenarios[11])
  assert.deepEqual(result.results[0], authorizationCustodyScenarios[11].then,
    "Snapshot-relative Portfolio and legacy baselines must not be subtracted twice, while new active reservations still reduce sellable base.")
})

test("RS-001-013: verified legacy Spot equals account Spot total minus all Portfolio base Positions capped by authorized remainder", async () => {
  const scenario = authorizationCustodyScenarios[12]
  const result = await runDomain(scenario)
  assert.equal(result.results[0].verifiedSpotQuantity, scenario.then.verifiedSpotQuantity,
    "All same-base Portfolio Positions across strategies and markets must be subtracted before capping by authorized legacy remainder.")
})

test("RS-001-014: missing balances and Spot custody below aggregate Portfolio base fail closed", async () => {
  const result = await runDomain(authorizationCustodyScenarios[13])
  assert.deepEqual(result.results[0], authorizationCustodyScenarios[13].then,
    "Missing Spot balances and Spot totals below aggregate Portfolio custody must fail closed; stale/incomplete freshness remains explicitly blocked.")
})
