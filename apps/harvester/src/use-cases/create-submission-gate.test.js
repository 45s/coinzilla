import assert from "node:assert/strict"
import nodeTest from "node:test"

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
