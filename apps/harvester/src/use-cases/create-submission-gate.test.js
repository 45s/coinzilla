import assert from "node:assert/strict"
import nodeTest from "node:test"

import { StrategyId } from "../domain/strategies/strategy-ids.js"
import { createSubmissionGate } from "./create-submission-gate.js"

const test = (...args) => {
  const [name, ...testArgs] = args
  return nodeTest(`[create-submission-gate.test.js] ${name}`, ...testArgs)
}

function createDependencies({ recoverySubmissionAllowed = false } = {}) {
  return {
    state: {
      shutdownBuyGate: true,
      paused: new Set(),
      operatorPausedMarkets: new Set(),
      volatilityProtection: new Map(),
      prices: new Map([
        ["DOGEUSDT", {
          price: "100",
          timestamp: 1,
        }],
      ]),
      books: new Map(),
    },
    isShutdownRecoverySubmissionAllowed: () => recoverySubmissionAllowed,
    isStopping: () => true,
    hasBlockingOpenOrdersForSymbol: () => false,
    canTrade: () => false,
    getAccountSafetyBlocker: () => null,
    isMarketPriceFresh: () => true,
    getVolatilityData: () => ({ ok: false }),
    isVolatilityProtectionEnabledForSymbol: () => false,
    isMarketBookFresh: () => true,
    isPostOnlyOrderCrossing: () => false,
  }
}

function createOrder({ side, type = "LIMIT" } = {}) {
  return {
    market: { symbol: "DOGEUSDT" },
    side,
    type,
    limitPrice: { amount: "100" },
  }
}

function createVolatilityProtectedDependencies() {
  const dependencies = createDependencies()
  dependencies.state.shutdownBuyGate = false
  dependencies.state.volatilityProtection.set("DOGEUSDT", {
    mode: "PROTECTED",
    reason: "HIGH_VOLATILITY",
  })
  dependencies.canTrade = () => true
  dependencies.isStopping = () => false
  dependencies.isMarketPriceFresh = () => true
  dependencies.getVolatilityData = () => ({
    ok: true,
    data: {
      status: {
        isReady: true,
        isFresh: true,
      },
      metrics: { volatilityRatio: "2" },
    },
  })
  dependencies.isVolatilityProtectionEnabledForSymbol = () => true
  return dependencies
}

test("market-owned volatility protection blocks RS recovery BUY submissions", () => {
  const gate = createSubmissionGate(createVolatilityProtectedDependencies())
  const result = gate({
    order: createOrder({ side: "BUY" }),
    purpose: "RECOVERY_BUY",
  })

  assert.equal(result.allowed, false, "The shared market protection gate must block an RS recovery BUY.")
  assert.equal(result.reason, "VOLATILITY_PROTECTION_ACTIVE")
})

test("market-owned volatility protection permits explicitly purposed RS recovery SELLs", () => {
  const gate = createSubmissionGate(createVolatilityProtectedDependencies())
  const result = gate({
    order: createOrder({ side: "SELL" }),
    purpose: "RECOVERY_SELL",
  })

  assert.deepEqual(result, { allowed: true }, "The shared volatility gate must retain the explicit recovery-SELL exception.")
})

test("market-scoped strategy safety pause blocks only its symbol and preserves the recovery SELL exception", () => {
  const dependencies = createDependencies()
  dependencies.state.shutdownBuyGate = false
  dependencies.state.paused.add("DOGEUSDT")
  dependencies.state.durablePausedMarkets = new Set(["DOGEUSDT"])
  dependencies.state.prices.set("BTCUSDT", {
    price: "100",
    timestamp: 1,
  })
  dependencies.canTrade = () => true
  dependencies.isStopping = () => false
  const gate = createSubmissionGate(dependencies)

  const blockedBuy = gate({
    order: createOrder({ side: "BUY" }),
    purpose: "STANDING_BUY",
  })
  const blockedOrdinarySell = gate({
    order: createOrder({ side: "SELL" }),
    purpose: "STANDING_SELL",
  })
  const recoverySell = gate({
    order: createOrder({ side: "SELL" }),
    purpose: "RECOVERY_SELL",
  })
  const unrelatedMarketBuy = gate({
    order: {
      ...createOrder({ side: "BUY" }),
      market: { symbol: "BTCUSDT" },
    },
    purpose: "STANDING_BUY",
  })

  assert.equal(blockedBuy.reason, "MARKET_PAUSED")
  assert.equal(blockedOrdinarySell.reason, "MARKET_PAUSED")
  assert.deepEqual(recoverySell, { allowed: true })
  assert.deepEqual(unrelatedMarketBuy, { allowed: true })
})

test("blocks every BUY at the final submission gate after shutdown", () => {
  const gate = createSubmissionGate(createDependencies())
  const result = gate({
    order: createOrder({ side: "BUY" }),
    purpose: "STANDING_BUY",
  })

  assert.equal(result.allowed, false, "Expected result.allowed to equal false in \"blocks every BUY at the final submission gate after shutdown\".")
  assert.equal(result.reason, "CONSERVATIVE_SHUTDOWN_BUY_GATE_ACTIVE", "Expected result.reason to equal \"CONSERVATIVE_SHUTDOWN_BUY_GATE_ACTIVE\" in \"blocks every BUY at the final submission gate after shutdown\".")
})

test("allows only the explicitly authorized recovery SELL after shutdown", () => {
  const gate = createSubmissionGate(createDependencies({
    recoverySubmissionAllowed: true,
  }))
  const result = gate({
    order: createOrder({ side: "SELL" }),
    purpose: "RECOVERY_SELL",
  })

  assert.deepEqual(result, { allowed: true }, "Expected result to match the expected structure in \"allows only the explicitly authorized recovery SELL after shutdown\".")
})

test("blocks an ordinary SELL while Conservative shutdown permits recovery SELL only", () => {
  const gate = createSubmissionGate(createDependencies())
  const result = gate({
    order: createOrder({ side: "SELL" }),
    purpose: "NORMAL_SELL",
  })

  assert.equal(result.allowed, false, "Expected result.allowed to equal false in \"blocks an ordinary SELL while Conservative shutdown permits recovery SELL only\".")
  assert.equal(result.reason, "CONSERVATIVE_SHUTDOWN_RECOVERY_SELL_ONLY", "Expected result.reason to equal \"CONSERVATIVE_SHUTDOWN_RECOVERY_SELL_ONLY\" in \"blocks an ordinary SELL while Conservative shutdown permits recovery SELL only\".")
})


const CONSERVATIVE_MARKET_ID = "binance:spot:DOGEUSDT"
const ACTIVE_RECOVERY_SELL_STATUSES = new Set(["PENDING", "OPEN", "PARTIALLY_FILLED", "UNKNOWN"])
const CONSERVATIVE_POSITION_ID = JSON.stringify([
  CONSERVATIVE_MARKET_ID,
  StrategyId.COIN_GRABBER,
])

function createActiveRecoverySellDependencies({
  status = "PENDING",
  clientOrderId = "existing-recovery-sell",
  strategyId = StrategyId.COIN_GRABBER,
  positionId = CONSERVATIVE_POSITION_ID,
} = {}) {
  const dependencies = createDependencies()
  dependencies.state.shutdownBuyGate = false
  const activeOrder = {
    clientOrderId,
    brokerOrderId: "broker-existing-recovery-sell",
    market: {
      id: CONSERVATIVE_MARKET_ID,
      symbol: "DOGEUSDT",
    },
    side: "SELL",
    status,
  }
  dependencies.state.registry = {
    getActiveOrders: ({ marketId } = {}) => marketId === CONSERVATIVE_MARKET_ID &&
      ACTIVE_RECOVERY_SELL_STATUSES.has(status)
      ? [activeOrder]
      : [],
    getOwnership: ({ clientOrderId: requestedClientOrderId } = {}) =>
      requestedClientOrderId === activeOrder.clientOrderId
        ? {
          strategyId,
          positionId,
          purpose: "RECOVERY_SELL",
        }
        : undefined,
  }
  dependencies.canTrade = () => true
  dependencies.isStopping = () => false
  return {
    dependencies,
    activeOrder,
  }
}

function createRecoverySellCandidate({ clientOrderId = "new-recovery-sell" } = {}) {
  return {
    clientOrderId,
    ...createOrder({ side: "SELL" }),
    market: {
      id: CONSERVATIVE_MARKET_ID,
      symbol: "DOGEUSDT",
    },
  }
}

test("blocks a second Conservative recovery SELL while its Position has an active order reservation", () => {
  for (const status of ["PENDING", "OPEN", "PARTIALLY_FILLED", "UNKNOWN"]) {
    const { dependencies, activeOrder } = createActiveRecoverySellDependencies({
      status,
    })
    const gate = createSubmissionGate(dependencies)
    const result = gate({
      order: createRecoverySellCandidate(),
      purpose: "RECOVERY_SELL",
    })

    assert.deepEqual(result, {
      allowed: false,
      reason: "RECOVERY_SELL_ALREADY_ACTIVE",
      details: {
        symbol: "DOGEUSDT",
        existingClientOrderId: activeOrder.clientOrderId,
        existingStatus: status,
      },
    }, `An existing ${status} Conservative recovery SELL must reserve its Position against a second submission.`)
  }
})

test("allows the current PENDING recovery SELL through its post-registration gate recheck", () => {
  const { dependencies } = createActiveRecoverySellDependencies({
    status: "PENDING",
    clientOrderId: "new-recovery-sell",
  })
  const gate = createSubmissionGate(dependencies)
  const result = gate({
    order: createRecoverySellCandidate(),
    purpose: "RECOVERY_SELL",
  })

  assert.deepEqual(result, {
    allowed: true,
  }, "The recovery SELL must not block itself after its PENDING order has been registered.")
})

test("does not treat a Recovery Seller order as a Conservative Position reservation", () => {
  const { dependencies } = createActiveRecoverySellDependencies({
    status: "OPEN",
    strategyId: StrategyId.RECOVERY_SELLER,
  })
  const gate = createSubmissionGate(dependencies)
  const result = gate({
    order: createRecoverySellCandidate(),
    purpose: "RECOVERY_SELL",
  })

  assert.deepEqual(result, {
    allowed: true,
  }, "The Conservative admission guard must not block an order owned by the separate Recovery Seller strategy.")
})


test("releases the Conservative recovery SELL reservation after terminal order transitions", () => {
  for (const status of ["FILLED", "CANCELED", "REJECTED", "EXPIRED"]) {
    const { dependencies } = createActiveRecoverySellDependencies({
      status,
    })
    const gate = createSubmissionGate(dependencies)
    const result = gate({
      order: createRecoverySellCandidate(),
      purpose: "RECOVERY_SELL",
    })

    assert.deepEqual(result, {
      allowed: true,
    }, `A canonical ${status} SELL must release the Position reservation for a later recovery intent.`)
  }
})


test("blocks a Conservative-owned active SELL when its persisted Position identity is stale or absent", () => {
  for (const positionId of ["stale-position-id", null]) {
    const { dependencies, activeOrder } = createActiveRecoverySellDependencies({
      status: "OPEN",
      positionId,
    })
    const gate = createSubmissionGate(dependencies)
    const result = gate({
      order: createRecoverySellCandidate(),
      purpose: "RECOVERY_SELL",
    })

    assert.deepEqual(result, {
      allowed: false,
      reason: "RECOVERY_SELL_ALREADY_ACTIVE",
      details: {
        symbol: "DOGEUSDT",
        existingClientOrderId: activeOrder.clientOrderId,
        existingStatus: "OPEN",
      },
    }, "A stale or absent ownership Position ID must not release an active SELL reservation for the same Conservative market.")
  }
})


test("an account safety blocker overrides every order path, including shutdown recovery SELL", () => {
  const dependencies = createDependencies({ recoverySubmissionAllowed: true })
  dependencies.getAccountSafetyBlocker = () => ({
    scope: "ACCOUNT",
    reason: "RECOVERY_SELLER_UNEXPECTED_CONDITION",
    blockerId: "account-blocker-1",
  })
  const gate = createSubmissionGate(dependencies)
  const cases = [
    {
      side: "BUY",
      purpose: "STANDING_BUY",
    },
    {
      side: "BUY",
      purpose: "RECOVERY_SELL",
    },
    {
      side: "SELL",
      purpose: "STANDING_BUY",
    },
    {
      side: "SELL",
      purpose: "RECOVERY_SELL",
    },
  ]

  for (const { side, purpose } of cases) {
    const result = gate({
      order: createOrder({ side }),
      purpose,
    })

    assert.equal(result.allowed, false, `${side}/${purpose} must remain blocked`)
    assert.equal(result.reason, "ACCOUNT_SAFETY_BLOCKER_ACTIVE")
    assert.deepEqual(result.details, {
      symbol: "DOGEUSDT",
      blockerReason: "RECOVERY_SELLER_UNEXPECTED_CONDITION",
      blockerId: "account-blocker-1",
    })
  }
})

test("blocks a BUY when a durable account-scoped safety blocker is active", () => {
  const dependencies = createDependencies()
  dependencies.state.shutdownBuyGate = false
  dependencies.canTrade = () => true
  dependencies.isStopping = () => false
  dependencies.getAccountSafetyBlocker = () => ({
    scope: "ACCOUNT",
    reason: "RECOVERY_SELLER_UNEXPECTED_CONDITION",
    blockerId: "incident-sequence-13",
  })
  const gate = createSubmissionGate(dependencies)
  const result = gate({
    order: createOrder({ side: "BUY" }),
    purpose: "STANDING_BUY",
  })

  assert.equal(result.allowed, false)
  assert.equal(result.reason, "ACCOUNT_SAFETY_BLOCKER_ACTIVE")
  assert.deepEqual(result.details, {
    symbol: "DOGEUSDT",
    blockerReason: "RECOVERY_SELLER_UNEXPECTED_CONDITION",
    blockerId: "incident-sequence-13",
  })
})
