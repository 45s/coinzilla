import test from "node:test"
import assert from "node:assert/strict"
import { evaluateRecoverySellerBuyDecision } from "./evaluate-buy-decision.js"
import {
  createRecoverySellerCycleState,
  reconcileRecoverySellerCycleSell,
  recordRecoverySellerCycleSellSubmission,
  startNextRecoverySellerCycle,
} from "./cycle-state.js"
import {
  createRecoverySellerStopDecision,
  createRecoverySellerStopState,
  latchRecoverySellerStop,
} from "./stop-decision.js"

const marketPrice = {
  symbol: "ZROUSDT",
  price: "2",
}

const pairConfig = {
  orderQuantity: "5",
  priceStepPercent: "0.05",
  investment: "100",
}

const marketMetadata = {
  market: {
    id: "binance:ZROUSDT",
    symbol: "ZROUSDT",
  },
  orderType: "LIMIT_MAKER",
  tradingRules: {
    constraints: [
      {
        type: "PRICE_INCREMENT",
        status: "SUPPORTED",
        value: {
          amount: "0.001",
        },
      },
      {
        type: "QUANTITY_INCREMENT",
        status: "SUPPORTED",
        value: {
          amount: "0.01",
        },
      },
      {
        type: "MIN_QUANTITY",
        status: "SUPPORTED",
        value: {
          amount: "0.01",
        },
      },
      {
        type: "MIN_NOTIONAL",
        status: "SUPPORTED",
        value: {
          amount: "5",
        },
      },
      {
        type: "MAX_QUANTITY",
        status: "SUPPORTED",
        value: {
          amount: "100",
        },
      },
      {
        type: "MAX_NOTIONAL",
        status: "SUPPORTED",
        value: {
          amount: "1000",
        },
      },
      {
        type: "MIN_PRICE",
        status: "SUPPORTED",
        value: {
          amount: "0.001",
        },
      },
      {
        type: "MAX_PRICE",
        status: "SUPPORTED",
        value: {
          amount: "100",
        },
      },
    ],
  },
}

function ownedOrder({ side, status, clientOrderId, brokerOrderId, cycleId = "rs-cycle-1", positionId = "rs-position-1" }) {
  return {
    market: {
      symbol: "ZROUSDT",
    },
    side,
    status,
    clientOrderId,
    ...(brokerOrderId ? { brokerOrderId } : {}),
    ownership: {
      strategyId: "RECOVERY_SELLER",
      purpose: side === "BUY" ? "RECOVERY_BUY" : "RECOVERY_SELL",
      positionId,
      cycleId,
    },
  }
}

function evaluate(overrides = {}) {
  return evaluateRecoverySellerBuyDecision({
    stopState: createRecoverySellerStopState(),
    marketPrice,
    pairConfig,
    marketMetadata,
    activeOrders: [],
    cycleState: createRecoverySellerCycleState({ cycleId: "rs-cycle-1" }),
    positionId: "rs-position-1",
    strategyStopped: false,
    marketPaused: false,
    reconciliationComplete: true,
    cumulativeNetSellProceeds: "0",
    pendingBuyCommitment: "0",
    ...overrides,
  })
}

test("plans the initial BUY using Conservative cadence, tranche size and downward tick rounding", () => {
  const result = evaluate()

  assert.equal(result.decision.outcome, "SUBMIT",
    "An eligible initial RS tranche must produce a pure SUBMIT decision.")
  assert.deepEqual(result.action, {
    side: "BUY",
    purpose: "RECOVERY_BUY",
    cycleId: "rs-cycle-1",
    positionId: "rs-position-1",
    type: "LIMIT_MAKER",
    price: "1.999",
    quantity: "5",
    notional: "9.995",
    reason: "INITIAL_BUY",
  }, "The initial tranche must reuse the established percentage-below-market BUY price and configured orderQuantity.")
  assert.equal(result.stopState.status, "CLEAR",
    "A valid BUY plan must not create a global STOP.")
})

test("prices the next tranche from the reconciled completed-BUY VWAP, not the current market price", () => {
  const result = evaluate({
    marketPrice: {
      ...marketPrice,
      price: "2.5",
    },
    recoveryPosition: {
      positionId: "rs-position-1",
      quantity: "10",
      spent: "20",
    },
    lastBuyPrice: "2.1",
  })

  assert.equal(result.action.price, "2.098",
    "The next standing BUY must use the last completed BUY VWAP and Conservative downward tick rounding.")
  assert.equal(result.action.reason, "NEXT_STANDING_BUY",
    "An existing recovery Position must be distinguished from the initial tranche.")
})

test("blocks the next BUY when the RS per-pair investment limit would be exceeded", () => {
  const result = evaluate({
    pairConfig: {
      ...pairConfig,
      investment: "15",
    },
    recoveryPosition: {
      positionId: "rs-position-1",
      quantity: "5",
      spent: "10",
    },
    lastBuyPrice: "2",
  })

  assert.equal(result.decision.outcome, "BLOCK",
    "The RS investment limit must block only a new BUY intent.")
  assert.equal(result.decision.reasonCode, "INVESTMENT_LIMIT_REACHED",
    "Investment-limit blocks must have a stable policy reason.")
  assert.equal(result.action, undefined,
    "No BUY action may be returned after the strategy's own investment budget is exhausted.")
  assert.equal(result.stopState.status, "CLEAR",
    "A normal configured investment limit is not an unexpected global STOP.")
})

test("latches STOP when a BUY commitment exists without an identifiable active order", () => {
  const result = evaluate({
    pendingBuyCommitment: "5",
  })

  assert.equal(result.decision.outcome, "BLOCK",
    "An orphaned BUY commitment must not be ignored or treated as free investment capacity.")
  assert.equal(result.stopState.status, "STOPPED",
    "A committed quote amount without its canonical order identity is an unmodeled lifecycle condition.")
  assert.equal(result.action, undefined,
    "No additional BUY may be planned while an unowned commitment remains unresolved.")
})

test("waits for an existing acknowledged RS order instead of creating a duplicate BUY", () => {
  const result = evaluate({
    activeOrders: [ownedOrder({
      side: "BUY",
      status: "PARTIALLY_FILLED",
      clientOrderId: "rs-buy-1",
      brokerOrderId: "exchange-1",
    })],
  })

  assert.equal(result.decision.outcome, "WAIT",
    "An acknowledged active RS order must suppress another BUY until its authoritative update.")
  assert.deepEqual(result.decision.orderIdentity, {
    clientOrderId: "rs-buy-1",
    brokerOrderId: "exchange-1",
  }, "The wait decision must retain both canonical order identities.")
  assert.equal(result.action, undefined,
    "An active order must never produce a duplicate action.")
})

test("latches STOP and reconciles the original identity for an unknown or unacknowledged RS order", () => {
  const result = evaluate({
    activeOrders: [ownedOrder({
      side: "BUY",
      status: "UNKNOWN",
      clientOrderId: "rs-buy-unknown",
    })],
  })

  assert.equal(result.stopState.status, "STOPPED",
    "An unknown submission outcome must latch global STOP before any later BUY.")
  assert.equal(result.stopDecision.outcome, "BLOCK",
    "The global STOP must block every new trading action.")
  assert.equal(result.decision.outcome, "RECONCILE",
    "The original unresolved order must remain eligible for non-trading reconciliation.")
  assert.deepEqual(result.decision.orderIdentity, {
    clientOrderId: "rs-buy-unknown",
  }, "Reconciliation must retain the original client identity without inventing a broker identity.")
  assert.equal(result.action, undefined,
    "Unknown submission must never produce a replacement BUY.")
})

test("keeps a previously latched STOP sticky and returns no new BUY action", () => {
  const originalStop = createRecoverySellerStopDecision({
    explanation: "The prior SELL execution has an unmodeled terminal result",
  })
  const stopState = latchRecoverySellerStop({
    state: createRecoverySellerStopState(),
    decision: originalStop,
  })
  const result = evaluate({
    stopState,
  })

  assert.equal(result.stopState.decision, originalStop,
    "A later normal BUY evaluation must not replace the first STOP evidence.")
  assert.equal(result.decision, originalStop,
    "A latched STOP must remain the lifecycle decision while no existing order requires reconciliation.")
  assert.equal(result.action, undefined,
    "A later market event must not resume trading after STOP.")
})

test("returns an ordinary BLOCK for an exchange-filter-constrained BUY", () => {
  const result = evaluate({
    marketMetadata: {
      ...marketMetadata,
      tradingRules: {
        constraints: marketMetadata.tradingRules.constraints.map((rule) =>
          rule.type === "MIN_NOTIONAL"
            ? {
              ...rule,
              value: {
                amount: "20",
              },
            }
            : rule),
      },
    },
  })

  assert.equal(result.decision.outcome, "BLOCK",
    "A known exchange minimum-notional constraint must block the candidate without inventing a global STOP.")
  assert.equal(result.decision.reasonCode, "BUY_EXCHANGE_FILTER_REJECTED",
    "Exchange-filter blocks must expose a stable reason.")
  assert.equal(result.buyDisposition.reason, "MIN_NOTIONAL",
    "The exact exchange filter that blocked the order must remain visible.")
  assert.equal(result.stopState.status, "CLEAR",
    "A normal filter deferral must not latch global STOP.")
})

test("fails closed with global STOP when an active recovery Position lacks its reconciled BUY VWAP", () => {
  const result = evaluate({
    recoveryPosition: {
      positionId: "rs-position-1",
      spent: "20",
    },
  })

  assert.equal(result.decision.outcome, "BLOCK",
    "Missing completed-BUY VWAP must not fall back to a potentially misleading market price.")
  assert.equal(result.stopState.status, "STOPPED",
    "An active Position with missing required pricing evidence must latch global STOP.")
  assert.equal(result.action, undefined,
    "No BUY may be submitted without the authoritative completed-BUY VWAP.")
})


test("latches STOP for malformed or unmodeled active-order snapshots", () => {
  const malformed = evaluate({
    activeOrders: null,
  })
  const unsupported = evaluate({
    activeOrders: [ownedOrder({
      side: "BUY",
      status: "PENDING_REPLACE",
      clientOrderId: "rs-buy-unknown-status",
    })],
  })

  assert.equal(malformed.stopState.status, "STOPPED",
    "A malformed active-order snapshot must not be interpreted as an empty order book.")
  assert.equal(malformed.action, undefined,
    "A malformed active-order snapshot must not permit a new BUY.")
  assert.equal(unsupported.stopState.status, "STOPPED",
    "An unmodeled order status must latch global STOP rather than being ignored.")
  assert.equal(unsupported.action, undefined,
    "An unmodeled order status must never allow a replacement BUY.")
})


test("blocks new BUYs when RS is operator-stopped, the market is paused, or reconciliation is incomplete", () => {
  const operatorStopped = evaluate({
    strategyStopped: true,
  })
  const marketPaused = evaluate({
    marketPaused: true,
  })
  const reconciliationIncomplete = evaluate({
    reconciliationComplete: false,
  })

  assert.equal(operatorStopped.decision.reasonCode, "STRATEGY_STOPPED",
    "An operator stop must prevent a new BUY without canceling or replacing existing orders.")
  assert.equal(marketPaused.decision.reasonCode, "MARKET_PAUSED",
    "A paused market must prevent new BUY submission.")
  assert.equal(reconciliationIncomplete.decision.reasonCode, "RECONCILIATION_INCOMPLETE",
    "Unresolved order/fill/inventory/reservation facts must prevent a new BUY.")
  assert.equal(operatorStopped.stopState.status, "CLEAR",
    "A known operator stop is a normal policy BLOCK, not an unexpected global STOP.")
  assert.equal(marketPaused.stopState.status, "CLEAR",
    "A known market pause is a normal policy BLOCK, not an unexpected global STOP.")
  assert.equal(reconciliationIncomplete.stopState.status, "CLEAR",
    "A known incomplete reconciliation state blocks new actions while preserving the normal reconciliation path.")
})

test("fails closed when an explicit readiness flag is missing", () => {
  const result = evaluate({
    reconciliationComplete: undefined,
  })

  assert.equal(result.stopState.status, "STOPPED",
    "Missing readiness evidence is an unmodeled condition and must latch global STOP.")
  assert.equal(result.action, undefined,
    "Missing readiness evidence must never produce a BUY intent.")
})


test("blocks another BUY after a terminal partial or canceled SELL leaves the cycle unresolved", () => {
  const submitted = recordRecoverySellerCycleSellSubmission({
    state: createRecoverySellerCycleState({ cycleId: "rs-cycle-1" }),
    orderIdentity: { clientOrderId: "rs-sell-1" },
  })
  const unresolved = reconcileRecoverySellerCycleSell({
    state: submitted,
    orderIdentity: { clientOrderId: "rs-sell-1" },
    terminalOrderStatus: "CANCELED",
    reconciliationComplete: true,
    profitabilityEligible: false,
  })
  const result = evaluate({
    cycleState: unresolved,
  })

  assert.equal(result.decision.outcome, "BLOCK",
    "A terminal partial/canceled SELL must not authorize another BUY tranche or a new cycle.")
  assert.equal(result.decision.reasonCode, "CYCLE_UNRESOLVED",
    "The unresolved one-SELL cycle must retain an explicit lifecycle block.")
  assert.equal(result.stopState.status, "CLEAR",
    "A known unresolved terminal cycle is a policy BLOCK; it must not invent a global STOP reason.")
  assert.equal(result.action, undefined,
    "No new BUY may be emitted from an unresolved cycle.")
})

test("latches STOP and reconciles the recorded sole SELL when its active-order evidence is missing", () => {
  const cycleState = recordRecoverySellerCycleSellSubmission({
    state: createRecoverySellerCycleState({ cycleId: "rs-cycle-1" }),
    orderIdentity: {
      clientOrderId: "rs-sell-1",
      brokerOrderId: "exchange-sell-1",
    },
  })
  const result = evaluate({
    cycleState,
    activeOrders: [],
  })

  assert.equal(result.stopState.status, "STOPPED",
    "A recorded submitted SELL without an authoritative active/terminal order snapshot is an unmodeled lifecycle gap.")
  assert.equal(result.decision.outcome, "RECONCILE",
    "The recorded SELL must remain eligible for non-trading reconciliation.")
  assert.deepEqual(result.decision.orderIdentity, {
    clientOrderId: "rs-sell-1",
    brokerOrderId: "exchange-sell-1",
  }, "Reconciliation must preserve the exact original SELL identity.")
  assert.equal(result.action, undefined,
    "No BUY may be submitted while the sole cycle SELL is unresolved.")
})

test("waits on the cycle's existing SELL without canceling or replacing it", () => {
  const cycleState = recordRecoverySellerCycleSellSubmission({
    state: createRecoverySellerCycleState({ cycleId: "rs-cycle-1" }),
    orderIdentity: {
      clientOrderId: "rs-sell-1",
    },
  })
  const result = evaluate({
    cycleState,
    activeOrders: [ownedOrder({
      side: "SELL",
      status: "PARTIALLY_FILLED",
      clientOrderId: "rs-sell-1",
      brokerOrderId: "exchange-sell-1",
    })],
    strategyStopped: true,
    marketPaused: true,
    reconciliationComplete: false,
  })

  assert.equal(result.decision.outcome, "WAIT",
    "An existing acknowledged SELL must remain live and be reconciled even when new BUYs are stopped or readiness is incomplete.")
  assert.equal(result.decision.orderIdentity.clientOrderId, "rs-sell-1",
    "The WAIT decision must retain the original SELL identity.")
  assert.equal(result.action, undefined,
    "The active SELL must not be replaced by a new BUY.")
  assert.equal(result.stopState.status, "CLEAR",
    "A known active SELL is not itself an unexpected STOP condition.")
})

test("allows the next BUY only after the previous cycle is closed and a new cycle state is created", () => {
  const submitted = recordRecoverySellerCycleSellSubmission({
    state: createRecoverySellerCycleState({ cycleId: "rs-cycle-1" }),
    orderIdentity: { clientOrderId: "rs-sell-1" },
  })
  const closed = reconcileRecoverySellerCycleSell({
    state: submitted,
    orderIdentity: { clientOrderId: "rs-sell-1" },
    terminalOrderStatus: "FILLED",
    reconciliationComplete: true,
    profitabilityEligible: true,
  })
  const closedResult = evaluate({
    cycleState: closed,
  })
  const nextCycle = startNextRecoverySellerCycle({
    previousState: closed,
    nextCycleId: "rs-cycle-2",
  })
  const nextCycleResult = evaluate({
    cycleState: nextCycle,
  })

  assert.equal(closedResult.decision.reasonCode, "CYCLE_CLOSED",
    "A closed cycle cannot be reused for another BUY.")
  assert.equal(closedResult.action, undefined,
    "The next BUY requires an explicitly created next-cycle state.")
  assert.equal(nextCycleResult.decision.outcome, "SUBMIT",
    "A new BUY cycle may begin only after the prior SELL is filled, reconciled and profitable.")
})


test("preserves reconciliation of an existing order when the cycle snapshot is malformed", () => {
  const result = evaluate({
    cycleState: undefined,
    activeOrders: [ownedOrder({
      side: "BUY",
      status: "UNKNOWN",
      clientOrderId: "rs-buy-unknown",
    })],
  })

  assert.equal(result.stopState.status, "STOPPED",
    "A malformed cycle snapshot must latch global STOP.")
  assert.equal(result.decision.outcome, "RECONCILE",
    "Failing the policy gate must not discard the original order's reconciliation path.")
  assert.equal(result.decision.orderIdentity.clientOrderId, "rs-buy-unknown",
    "The original active order identity must survive a malformed cycle snapshot.")
  assert.equal(result.action, undefined,
    "No new BUY may be emitted while the cycle state is invalid.")
})


test("reports QUANTITY_INCREMENT when the configured BUY tranche rounds down to zero", () => {
  const result = evaluate({
    pairConfig: {
      ...pairConfig,
      orderQuantity: "0.005",
    },
  })

  assert.equal(result.decision.outcome, "BLOCK",
    "A zero quantity after exchange-step rounding must not become a BUY.")
  assert.equal(result.buyDisposition.reason, "QUANTITY_INCREMENT",
    "The exchange quantity step must be distinguished from a minimum-quantity violation.")
  assert.equal(result.buyDisposition.configuredQuantity, "0.005")
  assert.equal(result.buyDisposition.quantityStepSize, "0.01")
  assert.equal(result.action, undefined)
})


test("uses current market price for an initial BUY even if a stale prior-cycle VWAP is supplied", () => {
  const result = evaluate({
    lastBuyPrice: "2.5",
  })

  assert.equal(result.action.price, "1.999",
    "A new cycle's initial BUY must reference the current market price, not a stale prior-cycle BUY VWAP.")
})

test("fails closed when recovery Position quantity and spent basis are inconsistent or missing", () => {
  const missingQuantity = evaluate({
    recoveryPosition: {
      spent: "20",
    },
    lastBuyPrice: "2.1",
  })
  const missingSpent = evaluate({
    recoveryPosition: {
      positionId: "rs-position-1",
      quantity: "10",
      spent: "0",
    },
    lastBuyPrice: "2.1",
  })

  assert.equal(missingQuantity.stopState.status, "STOPPED",
    "A recovery Position without authoritative quantity must latch STOP.")
  assert.equal(missingSpent.stopState.status, "STOPPED",
    "An active recovery quantity without positive spent basis must latch STOP.")
  assert.equal(missingQuantity.action, undefined)
  assert.equal(missingSpent.action, undefined)
})

test("fails closed when an accumulating cycle already has SELL proceeds", () => {
  const result = evaluate({
    recoveryPosition: {
      quantity: "10",
      spent: "20",
    },
    cumulativeNetSellProceeds: "1",
    lastBuyPrice: "2.1",
  })

  assert.equal(result.stopState.status, "STOPPED",
    "SELL proceeds inside an accumulating one-SELL cycle contradict its cycle state.")
  assert.equal(result.action, undefined,
    "A contradictory cycle accounting snapshot must not create another BUY.")
})


test("fails closed and reconciles an RS order owned by a different recovery cycle", () => {
  const result = evaluate({
    activeOrders: [ownedOrder({
      side: "BUY",
      status: "UNKNOWN",
      clientOrderId: "rs-buy-other-cycle",
      cycleId: "rs-cycle-previous",
    })],
  })

  assert.equal(result.stopState.status, "STOPPED",
    "An order owned by another cycle must not be adopted by the current cycle.")
  assert.equal(result.decision.outcome, "RECONCILE",
    "The previous cycle's original order must remain available for reconciliation.")
  assert.equal(result.decision.orderIdentity.clientOrderId, "rs-buy-other-cycle")
  assert.equal(result.action, undefined)
})


test("requires the stable Recovery Position identity for every BUY intent", () => {
  const missingPositionId = evaluate({
    positionId: undefined,
  })
  const mismatchedPosition = evaluate({
    recoveryPosition: {
      positionId: "rs-position-previous",
      quantity: "10",
      spent: "20",
    },
    lastBuyPrice: "2.1",
  })

  assert.equal(missingPositionId.stopState.status, "STOPPED",
    "A BUY intent without a stable Position identity must fail closed.")
  assert.equal(mismatchedPosition.stopState.status, "STOPPED",
    "A recovery Position from another identity must not be adopted by the current cycle.")
  assert.equal(missingPositionId.action, undefined)
  assert.equal(mismatchedPosition.action, undefined)
})

test("reconciles an active RS order whose Position ownership does not match the current policy context", () => {
  const result = evaluate({
    activeOrders: [ownedOrder({
      side: "BUY",
      status: "UNKNOWN",
      clientOrderId: "rs-buy-other-position",
      positionId: "rs-position-previous",
    })],
  })

  assert.equal(result.stopState.status, "STOPPED",
    "A same-cycle order owned by a different Position must not be adopted.")
  assert.equal(result.decision.outcome, "RECONCILE",
    "The mismatched RS order must remain available for reconciliation by its original identity.")
  assert.equal(result.decision.orderIdentity.clientOrderId, "rs-buy-other-position")
  assert.equal(result.action, undefined)
})
