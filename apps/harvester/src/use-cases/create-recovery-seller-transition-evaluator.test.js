import assert from "node:assert/strict"
import test from "node:test"
import { createRecoverySellerTransitionEvaluator } from "./create-recovery-seller-transition-evaluator.js"

const marketPrice = Object.freeze({
  symbol: "ZROUSDT",
  price: "12.3",
})

const marketMetadata = Object.freeze({
  market: Object.freeze({
    symbol: "ZROUSDT",
  }),
  tradingRules: Object.freeze({
    constraints: Object.freeze([
      Object.freeze({
        type: "PRICE_INCREMENT",
        status: "SUPPORTED",
        value: Object.freeze({
          amount: "0.1",
        }),
      }),
    ]),
  }),
})

const cycleState = Object.freeze({
  cycleId: "rs-cycle-1",
  positionId: "rs-position-1",
  status: "ACCUMULATING",
})

const recoveryPosition = Object.freeze({
  positionId: "rs-position-1",
  quantity: "1",
  spent: "10",
})

const stopState = Object.freeze({
  status: "RUNNING",
  decision: null,
})

const snapshot = Object.freeze({
  stopState,
  cycleState,
  recoveryPosition,
  planInput: Object.freeze({
    recoveryQuantity: "1",
    configuredLegacyQuantity: "0",
    legacyRemainingQuantity: "0",
    verifiedUnreservedLegacyQuantity: "0",
    recoveryCostBasis: "10",
    legacyAverageCost: "0",
    thirdAssetFeeQuoteValue: "0",
  }),
  cumulativeNetSellProceeds: "0",
  pendingBuyCommitment: "0",
  activeOrders: Object.freeze([]),
  strategyStopped: false,
  sellAdmissionBlocked: false,
  marketPaused: false,
  reconciliationComplete: true,
  lastBuyPrice: "10",
})

function createSellDecision({ price = "12", outcome = "SUBMIT" } = {}) {
  return Object.freeze({
    stopState,
    decision: Object.freeze({
      outcome,
      reasonCode: "SELL_POLICY_RESULT",
      explanation: "SELL policy test decision",
    }),
    orderIntent: outcome === "SUBMIT"
      ? Object.freeze({
        side: "SELL",
        type: "LIMIT_MAKER",
        quantity: "1",
        plan: Object.freeze({
          price,
        }),
      })
      : undefined,
  })
}

function createBuyDecision({ outcome = "SUBMIT" } = {}) {
  return Object.freeze({
    stopState,
    decision: Object.freeze({
      outcome,
      reasonCode: "BUY_POLICY_RESULT",
      explanation: "BUY policy test decision",
    }),
    action: outcome === "SUBMIT"
      ? Object.freeze({
        side: "BUY",
        purpose: "RECOVERY_BUY",
        cycleId: cycleState.cycleId,
        positionId: cycleState.positionId,
        type: "LIMIT_MAKER",
        price: "9.9",
        quantity: "1",
      })
      : undefined,
  })
}

function createEvaluator({
  state = snapshot,
  sellDecision = createSellDecision(),
  buyDecision = createBuyDecision(),
  onSubmit = () => undefined,
} = {}) {
  return createRecoverySellerTransitionEvaluator({
    getSnapshot: async () => state,
    evaluateSellDecision: () => sellDecision,
    evaluateBuyDecision: () => buyDecision,
    submitOrder: async (input) => {
      onSubmit(input)
      return Object.freeze({
        ok: true,
        data: Object.freeze({
          submitted: true,
        }),
      })
    },
  })
}

test("submits one owned SELL only after the current market reaches the profitable plan price", async () => {
  let submitted
  const evaluate = createEvaluator({
    sellDecision: createSellDecision({
      price: "12",
    }),
    onSubmit: (input) => {
      submitted = input
    },
  })

  const result = await evaluate({
    symbol: marketPrice.symbol,
    marketPrice,
    marketMetadata,
    pairConfig: {},
  })

  assert.equal(result.ok, true)
  assert.equal(submitted.action.side, "SELL")
  assert.equal(submitted.action.purpose, "RECOVERY_SELL")
  assert.equal(submitted.action.strategyId, "RS_recoverySeller")
  assert.equal(submitted.action.positionId, cycleState.positionId)
  assert.equal(submitted.action.cycleId, cycleState.cycleId)
  assert.equal(submitted.action.price, "12.3")
  assert.equal(submitted.action.plan.price, "12")
  assert.equal(submitted.action.quantity, "1")
})

test("keeps accumulating with the next BUY while the market remains below the profitable SELL price", async () => {
  let submitted
  const evaluate = createEvaluator({
    sellDecision: createSellDecision({
      price: "12.4",
    }),
    onSubmit: (input) => {
      submitted = input
    },
  })

  const result = await evaluate({
    symbol: marketPrice.symbol,
    marketPrice,
    marketMetadata,
    pairConfig: {},
  })

  assert.equal(result.ok, true)
  assert.equal(submitted.action.side, "BUY")
  assert.equal(submitted.action.purpose, "RECOVERY_BUY")
  assert.equal(submitted.action.positionId, cycleState.positionId)
  assert.equal(submitted.action.cycleId, cycleState.cycleId)
})

test("does not evaluate SELL before the first recovery Position exists", async () => {
  let sellEvaluations = 0
  let submitted
  const evaluate = createRecoverySellerTransitionEvaluator({
    getSnapshot: async () => ({
      ...snapshot,
      recoveryPosition: null,
    }),
    evaluateSellDecision: () => {
      sellEvaluations += 1
      return createSellDecision()
    },
    evaluateBuyDecision: () => createBuyDecision(),
    submitOrder: async (input) => {
      submitted = input
      return {
        ok: true,
        data: {
          submitted: true,
        },
      }
    },
  })

  const result = await evaluate({
    symbol: marketPrice.symbol,
    marketPrice,
    marketMetadata,
    pairConfig: {},
  })

  assert.equal(result.ok, true)
  assert.equal(sellEvaluations, 0)
  assert.equal(submitted.action.side, "BUY")
})

test("allows an eligible first SELL while the RS STOP blocks new BUY spending", async () => {
  let submitted
  const stoppedSnapshot = Object.freeze({
    ...snapshot,
    stopState: Object.freeze({
      status: "STOPPED",
      decision: Object.freeze({
        outcome: "BLOCK",
        reasonCode: "RS_STOPPED",
        explanation: "STOP blocks additional BUY spending only.",
      }),
    }),
    buyAdmissionBlocked: true,
    strategyStopped: false,
  })
  const evaluate = createRecoverySellerTransitionEvaluator({
    getSnapshot: async () => stoppedSnapshot,
    evaluateSellDecision: () => createSellDecision(),
    evaluateBuyDecision: () => createBuyDecision({
      outcome: "WAIT",
    }),
    submitOrder: async (input) => {
      submitted = input
      return {
        ok: true,
        data: {
          submitted: true,
        },
      }
    },
  })

  const result = await evaluate({
    symbol: marketPrice.symbol,
    marketPrice,
    marketMetadata,
    pairConfig: {},
  })

  assert.equal(result.ok, true,
    "The transition must return a successful result when the eligible SELL is submitted under account STOP.")
  assert.equal(submitted.action.side, "SELL",
    "A latched STOP must not prevent an otherwise eligible first recovery SELL.")
})

test("does not submit a BUY after the SELL policy latches STOP", async () => {
  let submitted = false
  const stoppedSellDecision = Object.freeze({
    stopState: Object.freeze({
      status: "STOPPED",
      decision: Object.freeze({
        outcome: "BLOCK",
        reasonCode: "RS_STOPPED",
        explanation: "Manual STOP",
      }),
    }),
    decision: Object.freeze({
      outcome: "BLOCK",
      reasonCode: "RS_STOPPED",
      explanation: "Manual STOP",
    }),
  })
  const evaluate = createEvaluator({
    sellDecision: stoppedSellDecision,
    onSubmit: () => {
      submitted = true
    },
  })

  const result = await evaluate({
    symbol: marketPrice.symbol,
    marketPrice,
    marketMetadata,
    pairConfig: {},
  })

  assert.equal(result.decision.reasonCode, "RS_STOPPED")
  assert.equal(submitted, false)
})

test("does not submit when an owned active order is awaiting reconciliation", async () => {
  let sellEvaluations = 0
  let submitted = false
  const evaluate = createRecoverySellerTransitionEvaluator({
    getSnapshot: async () => ({
      ...snapshot,
      activeOrders: [{
        side: "BUY",
        status: "OPEN",
        clientOrderId: "rs-buy-1",
        ownership: {
          strategyId: "RS_recoverySeller",
          positionId: cycleState.positionId,
          cycleId: cycleState.cycleId,
          purpose: "RECOVERY_BUY",
        },
      }],
    }),
    evaluateSellDecision: () => {
      sellEvaluations += 1
      return createSellDecision()
    },
    evaluateBuyDecision: () => createBuyDecision({
      outcome: "WAIT",
    }),
    submitOrder: async () => {
      submitted = true
      return {
        ok: true,
        data: {
          submitted: true,
        },
      }
    },
  })

  const result = await evaluate({
    symbol: marketPrice.symbol,
    marketPrice,
    marketMetadata,
    pairConfig: {},
  })

  assert.equal(result.decision.outcome, "WAIT")
  assert.equal(sellEvaluations, 0)
  assert.equal(submitted, false)
})


test("does not evaluate a first recovery SELL while STOP persistence is unverified", async () => {
  let sellEvaluations = 0
  let submitted = false
  const pendingStopSnapshot = Object.freeze({
    ...snapshot,
    stopState: Object.freeze({
      status: "CLEAR",
      decision: null,
    }),
    buyAdmissionBlocked: true,
    sellAdmissionBlocked: true,
    strategyStopped: false,
  })
  const evaluate = createRecoverySellerTransitionEvaluator({
    getSnapshot: async () => pendingStopSnapshot,
    evaluateSellDecision: () => {
      sellEvaluations += 1
      return createSellDecision()
    },
    evaluateBuyDecision: () => createBuyDecision({
      outcome: "WAIT",
    }),
    submitOrder: async () => {
      submitted = true
      return {
        ok: true,
        data: {
          submitted: true,
        },
      }
    },
  })

  const result = await evaluate({
    symbol: marketPrice.symbol,
    marketPrice,
    marketMetadata,
    pairConfig: {},
  })

  assert.equal(result.decision.outcome, "WAIT",
    "The transition must wait while the STOP durability boundary is unresolved.")
  assert.equal(sellEvaluations, 0,
    "The SELL policy must not run before the STOP fact is durably acknowledged.")
  assert.equal(submitted, false,
    "No order may be submitted while STOP persistence is unverified.")
})
