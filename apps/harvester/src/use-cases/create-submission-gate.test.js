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
    getPortfolio: () => ({
      getPosition: () => undefined,
    }),
    getRecoveryLedger: () => undefined,
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



test("blocks a Conservative BUY while the Position still has active recovery inventory", () => {
  const dependencies = createDependencies()
  dependencies.state.shutdownBuyGate = false
  dependencies.canTrade = () => true
  dependencies.isStopping = () => false
  dependencies.getPortfolio = () => ({
    getPosition: () => ({
      positionId: "doge-conservative-position",
      quantity: { amount: "99" },
      spent: { amount: "10" },
    }),
  })
  dependencies.getRecoveryLedger = () => ({
    buyCost: "10",
    netSellProceeds: "0",
  })

  const result = createSubmissionGate(dependencies)({
    order: createOrder({ side: "BUY" }),
    purpose: "STANDING_BUY",
  })

  assert.deepEqual(result, {
    allowed: false,
    reason: "CONSERVATIVE_RECOVERY_CYCLE_ACTIVE",
    details: {
      symbol: "DOGEUSDT",
      positionId: "doge-conservative-position",
      activeQuantity: "99",
      positionSpent: "10",
      netSellProceeds: "0",
    },
  }, "The final application gate must block stale BUY intents while recovery inventory remains active.")
})

test("blocks a Conservative BUY after SELL proceeds recover cost but before cycle completion resets the Position", () => {
  const dependencies = createDependencies()
  dependencies.state.shutdownBuyGate = false
  dependencies.canTrade = () => true
  dependencies.isStopping = () => false
  dependencies.getPortfolio = () => ({
    getPosition: () => ({
      positionId: "doge-conservative-position",
      quantity: { amount: "0" },
      spent: { amount: "10" },
    }),
  })
  dependencies.getRecoveryLedger = () => ({
    buyCost: "10",
    netSellProceeds: "10.02",
  })

  const result = createSubmissionGate(dependencies)({
    order: createOrder({ side: "BUY" }),
    purpose: "STANDING_BUY",
  })

  assert.equal(result.allowed, false, "Profit realization alone must not release BUY admission before cycle completion.")
  assert.equal(result.reason, "CONSERVATIVE_RECOVERY_CYCLE_ACTIVE")
})

test("allows a Conservative BUY only after recovery basis and cycle totals have been reset", () => {
  const dependencies = createDependencies()
  dependencies.state.shutdownBuyGate = false
  dependencies.canTrade = () => true
  dependencies.isStopping = () => false
  dependencies.getPortfolio = () => ({
    getPosition: () => ({
      positionId: "doge-conservative-position",
      quantity: { amount: "0" },
      spent: { amount: "0" },
    }),
  })
  dependencies.getRecoveryLedger = () => ({
    buyCost: "0",
    netSellProceeds: "0",
  })

  const result = createSubmissionGate(dependencies)({
    order: createOrder({ side: "BUY" }),
    purpose: "STANDING_BUY",
  })

  assert.deepEqual(result, { allowed: true }, "A fully reset Position and RecoveryLedger make the next cycle eligible.")
})


test("blocks a Conservative BUY while an owned recovery SELL remains active after accounting totals reset", () => {
  for (const status of ["PENDING", "OPEN", "PARTIALLY_FILLED", "UNKNOWN"]) {
    const { dependencies, activeOrder } = createActiveRecoverySellDependencies({
      status,
      clientOrderId: `doge-recovery-sell-${status}`,
    })
    const marketId = activeOrder.market.id
    const positionId = JSON.stringify([marketId, StrategyId.COIN_GRABBER])
    dependencies.getPortfolio = () => ({
      getPosition: () => ({
        positionId,
        quantity: { amount: "0" },
        spent: { amount: "0" },
      }),
    })
    dependencies.getRecoveryLedger = () => ({
      buyCost: "0",
      netSellProceeds: "0",
    })

    const result = createSubmissionGate(dependencies)({
      order: {
        ...createOrder({ side: "BUY" }),
        market: {
          id: marketId,
          symbol: "DOGEUSDT",
        },
      },
      purpose: "STANDING_BUY",
    })

    assert.deepEqual(result, {
      allowed: false,
      reason: "CONSERVATIVE_RECOVERY_CYCLE_ACTIVE",
      details: {
        symbol: "DOGEUSDT",
        activeRecoverySellClientOrderId: activeOrder.clientOrderId,
        activeRecoverySellStatus: status,
      },
    }, `An owned ${status} recovery SELL must keep BUY admission closed even when Position and RecoveryLedger projections appear reset.`)
  }
})

test("does not apply the Conservative recovery BUY gate to Recovery Seller orders", () => {
  const dependencies = createDependencies()
  dependencies.state.shutdownBuyGate = false
  dependencies.canTrade = () => true
  dependencies.isStopping = () => false
  dependencies.getPortfolio = () => ({
    getPosition: () => ({
      quantity: { amount: "99" },
      spent: { amount: "10" },
    }),
  })
  dependencies.getRecoveryLedger = () => ({
    buyCost: "10",
    netSellProceeds: "0",
  })

  const result = createSubmissionGate(dependencies)({
    order: createOrder({ side: "BUY" }),
    purpose: "RECOVERY_BUY",
    ownership: { strategyId: StrategyId.RECOVERY_SELLER },
  })

  assert.deepEqual(result, { allowed: true }, "The Conservative Position gate must not block the independent Recovery Seller strategy.")
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
test("blocks a Conservative BUY while RecoveryLedger buyCost remains non-zero after Position reset", () => {
  const dependencies = createDependencies()
  dependencies.state.shutdownBuyGate = false
  dependencies.canTrade = () => true
  dependencies.isStopping = () => false
  dependencies.getPortfolio = () => ({
    getPosition: () => ({
      positionId: "doge-conservative-position",
      quantity: { amount: "0" },
      spent: { amount: "0" },
    }),
  })
  dependencies.getRecoveryLedger = () => ({
    buyCost: "10",
    netSellProceeds: "0",
  })

  const result = createSubmissionGate(dependencies)({
    order: createOrder({ side: "BUY" }),
    purpose: "STANDING_BUY",
  })

  assert.equal(result.allowed, false)
  assert.equal(result.reason, "CONSERVATIVE_RECOVERY_CYCLE_ACTIVE")
  assert.deepEqual(result.details, {
    symbol: "DOGEUSDT",
    positionId: "doge-conservative-position",
    activeQuantity: "0",
    positionSpent: "0",
    netSellProceeds: "0",
  })
})

test("fails closed when Conservative recovery admission dependencies are unavailable", () => {
  const configurations = [
    (dependencies) => {
      dependencies.getPortfolio = undefined
    },
    (dependencies) => {
      dependencies.getRecoveryLedger = undefined
    },
    (dependencies) => {
      dependencies.getPortfolio = () => {
        throw new Error("portfolio unavailable")
      }
    },
    (dependencies) => {
      dependencies.getPortfolio = () => ({})
    },
    (dependencies) => {
      dependencies.getRecoveryLedger = () => {
        throw new Error("recovery ledger unavailable")
      }
    },
  ]

  for (const configure of configurations) {
    const dependencies = createDependencies()
    dependencies.state.shutdownBuyGate = false
    dependencies.canTrade = () => true
    dependencies.isStopping = () => false
    configure(dependencies)

    const result = createSubmissionGate(dependencies)({
      order: createOrder({ side: "BUY" }),
      purpose: "STANDING_BUY",
    })

    assert.equal(result.allowed, false)
    assert.equal(result.reason, "CONSERVATIVE_RECOVERY_STATE_UNAVAILABLE")
  }
})

test("fails closed when Conservative recovery admission accounting contains an invalid decimal", () => {
  const dependencies = createDependencies()
  dependencies.state.shutdownBuyGate = false
  dependencies.canTrade = () => true
  dependencies.isStopping = () => false
  dependencies.getPortfolio = () => ({
    getPosition: () => ({
      quantity: { amount: "not-a-decimal" },
      spent: { amount: "0" },
    }),
  })
  dependencies.getRecoveryLedger = () => ({
    buyCost: "0",
    netSellProceeds: "0",
  })

  const result = createSubmissionGate(dependencies)({
    order: createOrder({ side: "BUY" }),
    purpose: "STANDING_BUY",
  })

  assert.equal(result.allowed, false)
  assert.equal(result.reason, "CONSERVATIVE_RECOVERY_STATE_UNAVAILABLE")
})


test("blocks Recovery Seller BUY spending while its STOP is durably active", () => {
  const dependencies = createVolatilityProtectedDependencies()
  dependencies.isRecoverySellerBuyAdmissionBlocked = () => true
  dependencies.isRecoverySellerSellAdmissionBlocked = () => false
  const result = createSubmissionGate(dependencies)({
    order: createOrder({ side: "BUY" }),
    purpose: "RECOVERY_BUY",
    ownership: {
      strategyId: StrategyId.RECOVERY_SELLER,
      positionId: "rs-position-1",
      cycleId: "rs-cycle-1",
    },
  })

  assert.equal(result.allowed, false,
    "A durable Recovery Seller STOP must block new RS BUY spending.")
  assert.equal(result.reason, "RECOVERY_SELLER_STOP_BUY_GATE_ACTIVE",
    "The final submission gate must identify the RS investment-only STOP.")
})

test("allows the first owned Recovery Seller SELL while durable STOP blocks BUYs", () => {
  const dependencies = createVolatilityProtectedDependencies()
  dependencies.isRecoverySellerBuyAdmissionBlocked = () => true
  dependencies.isRecoverySellerSellAdmissionBlocked = () => false
  const result = createSubmissionGate(dependencies)({
    order: createOrder({ side: "SELL" }),
    purpose: "RECOVERY_SELL",
    ownership: {
      strategyId: StrategyId.RECOVERY_SELLER,
      positionId: "rs-position-1",
      cycleId: "rs-cycle-1",
    },
  })

  assert.deepEqual(result, { allowed: true },
    "A persisted RS STOP must not block an independently eligible first recovery SELL.")
})

test("blocks Recovery Seller SELL while STOP persistence is unverified", () => {
  const dependencies = createVolatilityProtectedDependencies()
  dependencies.isRecoverySellerBuyAdmissionBlocked = () => true
  dependencies.isRecoverySellerSellAdmissionBlocked = () => true
  const result = createSubmissionGate(dependencies)({
    order: createOrder({ side: "SELL" }),
    purpose: "RECOVERY_SELL",
    ownership: {
      strategyId: StrategyId.RECOVERY_SELLER,
      positionId: "rs-position-1",
      cycleId: "rs-cycle-1",
    },
  })

  assert.equal(result.allowed, false,
    "No RS order may pass while STOP persistence is pending or unverified.")
  assert.equal(result.reason, "RECOVERY_SELLER_STOP_PERSISTENCE_UNVERIFIED",
    "The gate must distinguish unverified STOP persistence from a durable investment STOP.")
})

test("generic ACCOUNT blockers still block a Recovery Seller recovery SELL", () => {
  const dependencies = createVolatilityProtectedDependencies()
  dependencies.getAccountSafetyBlocker = () => ({
    scope: "ACCOUNT",
    reason: "USER_DATA_RECONCILIATION_REQUIRED",
    blockerId: "account-blocker-1",
  })
  dependencies.isRecoverySellerBuyAdmissionBlocked = () => true
  dependencies.isRecoverySellerSellAdmissionBlocked = () => false
  const result = createSubmissionGate(dependencies)({
    order: createOrder({ side: "SELL" }),
    purpose: "RECOVERY_SELL",
    ownership: {
      strategyId: StrategyId.RECOVERY_SELLER,
      positionId: "rs-position-1",
      cycleId: "rs-cycle-1",
    },
  })

  assert.equal(result.allowed, false,
    "The RS-specific SELL exception must never bypass an independent generic ACCOUNT blocker.")
  assert.equal(result.reason, "ACCOUNT_SAFETY_BLOCKER_ACTIVE")
})

test("Recovery Seller STOP does not block Conservative orders", () => {
  const dependencies = createVolatilityProtectedDependencies()
  dependencies.isRecoverySellerBuyAdmissionBlocked = () => true
  dependencies.isRecoverySellerSellAdmissionBlocked = () => false
  const result = createSubmissionGate(dependencies)({
    order: createOrder({ side: "BUY" }),
    purpose: "STANDING_BUY",
    ownership: {
      strategyId: StrategyId.COIN_GRABBER,
      positionId: "cg-position-1",
    },
  })

  assert.deepEqual(result, { allowed: true },
    "An RS investment STOP must remain strategy-scoped and must not stop Conservative orders.")
})
