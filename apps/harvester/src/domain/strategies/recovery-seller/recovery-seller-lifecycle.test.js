import test from "node:test"
import assert from "node:assert/strict"
import { evaluateRecoverySellerBuyDecision } from "./evaluate-buy-decision.js"
import {
  createRecoverySellerCycleState,
  recordRecoverySellerCycleSellSubmission,
} from "./cycle-state.js"
import {
  reconcileRecoverySellerCycleSellWithStop,
  recordRecoverySellerCycleSellUnknown,
  startNextRecoverySellerCycleWithStop,
} from "./lifecycle-state.js"
import { createRecoverySellerStopState } from "./stop-decision.js"

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
    symbol: "ZROUSDT",
  },
  orderType: "LIMIT_MAKER",
  tradingRules: {
    constraints: [
      { type: "PRICE_INCREMENT", status: "SUPPORTED", value: { amount: "0.001" } },
      { type: "QUANTITY_INCREMENT", status: "SUPPORTED", value: { amount: "0.01" } },
      { type: "MIN_QUANTITY", status: "SUPPORTED", value: { amount: "0.01" } },
      { type: "MIN_NOTIONAL", status: "SUPPORTED", value: { amount: "5" } },
      { type: "MAX_QUANTITY", status: "SUPPORTED", value: { amount: "100" } },
      { type: "MAX_NOTIONAL", status: "SUPPORTED", value: { amount: "1000" } },
      { type: "MIN_PRICE", status: "SUPPORTED", value: { amount: "0.001" } },
      { type: "MAX_PRICE", status: "SUPPORTED", value: { amount: "100" } },
    ],
  },
}

function makeOwnedOrder({ side, status, clientOrderId, brokerOrderId, cycleId, positionId }) {
  return {
    market: {
      symbol: "ZROUSDT",
    },
    side,
    status,
    clientOrderId,
    brokerOrderId,
    ownership: {
      strategyId: "RECOVERY_SELLER",
      purpose: side === "BUY" ? "RECOVERY_BUY" : "RECOVERY_SELL",
      positionId,
      cycleId,
    },
  }
}

function evaluateBuy({
  stopState,
  cycleState,
  recoveryPosition,
  activeOrders = [],
  lastBuyPrice,
  investment = "100",
}) {
  return evaluateRecoverySellerBuyDecision({
    stopState,
    cycleState,
    marketPrice,
    pairConfig: {
      ...pairConfig,
      investment,
    },
    marketMetadata,
    recoveryPosition,
    cumulativeNetSellProceeds: "0",
    pendingBuyCommitment: "0",
    activeOrders,
    strategyStopped: false,
    marketPaused: false,
    reconciliationComplete: true,
    lastBuyPrice,
  })
}

function createSubmittedCycle() {
  const initial = createRecoverySellerCycleState({
    cycleId: "rs-cycle-1",
    positionId: "rs-position-1",
  })
  return recordRecoverySellerCycleSellSubmission({
    state: initial,
    orderIdentity: {
      clientOrderId: "rs-sell-1",
    },
  })
}

test("proves offline BUY, WAIT, one-SELL, STOP, RECONCILE and no-auto-resume lifecycle", () => {
  const stopState = createRecoverySellerStopState()
  const cycleState = createRecoverySellerCycleState({
    cycleId: "rs-cycle-1",
    positionId: "rs-position-1",
  })

  const initialBuy = evaluateBuy({
    stopState,
    cycleState,
  })
  assert.equal(initialBuy.decision.outcome, "SUBMIT")
  assert.equal(initialBuy.action.reason, "INITIAL_BUY")
  assert.equal(initialBuy.action.positionId, "rs-position-1")
  assert.equal(initialBuy.action.cycleId, "rs-cycle-1")

  const existingBuy = evaluateBuy({
    stopState,
    cycleState,
    activeOrders: [makeOwnedOrder({
      side: "BUY",
      status: "OPEN",
      clientOrderId: "rs-buy-1",
      brokerOrderId: "exchange-buy-1",
      cycleId: "rs-cycle-1",
      positionId: "rs-position-1",
    })],
  })
  assert.equal(existingBuy.decision.outcome, "WAIT",
    "An acknowledged BUY remains the same order lifecycle; no duplicate BUY is submitted.")

  const nextBuy = evaluateBuy({
    stopState,
    cycleState,
    recoveryPosition: {
      positionId: "rs-position-1",
      quantity: "5",
      spent: "10",
    },
    lastBuyPrice: "2",
  })
  assert.equal(nextBuy.decision.outcome, "SUBMIT")
  assert.equal(nextBuy.action.reason, "NEXT_STANDING_BUY")
  assert.equal(nextBuy.action.price, "1.999",
    "A subsequent tranche is priced from the reconciled completed-BUY VWAP.")

  const atLimit = evaluateBuy({
    stopState,
    cycleState,
    recoveryPosition: {
      positionId: "rs-position-1",
      quantity: "5",
      spent: "10",
    },
    lastBuyPrice: "2",
    investment: "15",
  })
  assert.equal(atLimit.decision.outcome, "BLOCK",
    "The RS per-pair investment limit blocks a new BUY without changing the existing cycle.")

  const sellSubmitted = recordRecoverySellerCycleSellSubmission({
    state: cycleState,
    orderIdentity: {
      clientOrderId: "rs-sell-1",
    },
  })
  const existingSell = evaluateBuy({
    stopState,
    cycleState: sellSubmitted,
    recoveryPosition: {
      positionId: "rs-position-1",
      quantity: "5",
      spent: "10",
    },
    activeOrders: [makeOwnedOrder({
      side: "SELL",
      status: "PARTIALLY_FILLED",
      clientOrderId: "rs-sell-1",
      brokerOrderId: "exchange-sell-1",
      cycleId: "rs-cycle-1",
      positionId: "rs-position-1",
    })],
  })
  assert.equal(existingSell.decision.outcome, "WAIT",
    "The single acknowledged SELL remains live and is never duplicated or replaced.")
  assert.equal(existingSell.action, undefined)

  const unknownSell = recordRecoverySellerCycleSellUnknown({
    stopState,
    cycleState: sellSubmitted,
    explanation: "The SELL submission acknowledgement is unknown",
  })
  assert.equal(unknownSell.stopState.status, "STOPPED")
  assert.equal(unknownSell.decision.outcome, "RECONCILE")
  assert.equal(unknownSell.decision.orderIdentity.clientOrderId, "rs-sell-1")

  const reconciled = reconcileRecoverySellerCycleSellWithStop({
    stopState: unknownSell.stopState,
    cycleState: unknownSell.cycleState,
    orderIdentity: {
      clientOrderId: "rs-sell-1",
    },
    terminalOrderStatus: "FILLED",
    reconciliationComplete: true,
    profitabilityEligible: true,
  })
  assert.equal(reconciled.cycleState.status, "CLOSED",
    "A terminal fill closes the cycle only after authoritative reconciliation and combined profitability pass.")
  assert.equal(reconciled.stopState, unknownSell.stopState,
    "Confirmed fill and accounting reconciliation continue, but never clear global STOP.")

  const nextCycle = startNextRecoverySellerCycleWithStop({
    stopState: reconciled.stopState,
    previousState: reconciled.cycleState,
    nextCycleId: "rs-cycle-2",
    nextPositionId: "rs-position-2",
  })
  const blockedAfterStop = evaluateBuy({
    stopState: nextCycle.stopState,
    cycleState: nextCycle.cycleState,
  })
  assert.equal(blockedAfterStop.stopState, unknownSell.stopState)
  assert.equal(blockedAfterStop.decision.outcome, "BLOCK")
  assert.equal(blockedAfterStop.action, undefined,
    "A successful prior cycle and a new cycle identity do not automatically resume trading.")
})

test("proves terminal underfill/cancel remains unresolved and cannot start another cycle", () => {
  const unknownSell = recordRecoverySellerCycleSellUnknown({
    stopState: createRecoverySellerStopState(),
    cycleState: createSubmittedCycle(),
    explanation: "The SELL submission acknowledgement is unknown",
  })
  const canceled = reconcileRecoverySellerCycleSellWithStop({
    stopState: unknownSell.stopState,
    cycleState: unknownSell.cycleState,
    orderIdentity: {
      clientOrderId: "rs-sell-1",
    },
    terminalOrderStatus: "CANCELED",
    reconciliationComplete: true,
    profitabilityEligible: true,
  })

  assert.equal(canceled.cycleState.status, "UNRESOLVED",
    "A terminal canceled or underfilled SELL does not become a closed cycle even if the realized combined result is profitable.")
  assert.equal(canceled.stopState, unknownSell.stopState)
  assert.throws(
    () => startNextRecoverySellerCycleWithStop({
      stopState: canceled.stopState,
      previousState: canceled.cycleState,
      nextCycleId: "rs-cycle-2",
    }),
    /only from a closed profitable and reconciled cycle/,
    "No new BUY cycle is authorized after a terminal underfill or cancellation.",
  )
})
