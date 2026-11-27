import assert from "node:assert/strict"
import test from "node:test"
import { StrategyId } from "../domain/strategies/strategy-ids.js"
import { createRecoverySellerRuntimeDispatch } from "./create-recovery-seller-runtime-dispatch.js"

const symbol = "ZROUSDT"
const marketPrice = Object.freeze({
  symbol,
  price: "12.3",
})
const marketMetadata = Object.freeze({
  market: Object.freeze({
    symbol,
  }),
})
const pairConfig = Object.freeze({})
const accountSnapshot = Object.freeze({
  balances: Object.freeze([]),
})
const stopState = Object.freeze({
  status: "RUNNING",
  decision: null,
})

function createRecoverySellerWorkflow({ onSnapshot } = {}) {
  return {
    getTransitionSnapshot: (input) => {
      onSnapshot(input)
      return Object.freeze({
        cycleState: Object.freeze({
          cycleId: "rs-cycle-1",
          positionId: "rs-position-1",
          status: "ACCUMULATING",
        }),
        recoveryPosition: undefined,
        planInput: Object.freeze({
          recoveryQuantity: "0",
          configuredLegacyQuantity: "0",
          legacyRemainingQuantity: "0",
          verifiedUnreservedLegacyQuantity: "0",
          recoveryCostBasis: "0",
          legacyAverageCost: "0",
          thirdAssetFeeQuoteValue: "0",
        }),
        cumulativeNetSellProceeds: "0",
        pendingBuyCommitment: "0",
        activeOrders: Object.freeze([]),
        lastBuyPrice: undefined,
        stopState: input.stopState,
        strategyStopped: input.strategyStopped,
        buyAdmissionBlocked: input.buyAdmissionBlocked,
        sellAdmissionBlocked: input.sellAdmissionBlocked,
        marketPaused: input.marketPaused,
        reconciliationComplete: input.reconciliationComplete,
      })
    },
  }
}

function createRecoverySellerStopWorkflow({ onLatch } = {}) {
  return {
    getState: async () => stopState,
    isBuyAdmissionBlocked: () => false,
    isSellAdmissionBlocked: () => false,
    latch: async () => {
      onLatch()
      return {
        ok: true,
        data: { durable: true },
      }
    },
  }
}

function createDispatchFixture({ evaluateBuyDecision, onSubmit } = {}) {
  let snapshotInput
  let submissionInput
  let latchCount = 0
  const dispatch = createRecoverySellerRuntimeDispatch({
    recoverySellerWorkflow: createRecoverySellerWorkflow({
      onSnapshot: (input) => {
        snapshotInput = input
      },
    }),
    recoverySellerStopWorkflow: createRecoverySellerStopWorkflow({
      onLatch: () => {
        latchCount += 1
      },
    }),
    recoverySellerPairs: {
      [symbol]: pairConfig,
    },
    getRecoverySellerMarketMetadata: async () => marketMetadata,
    getAccountSnapshot: async () => accountSnapshot,
    evaluateBuyDecision,
  })
  return {
    dispatch,
    getSnapshotInput: () => snapshotInput,
    getSubmissionInput: () => submissionInput,
    getLatchCount: () => latchCount,
    setSubmissionInput: (value) => {
      submissionInput = value
    },
    onSubmit,
  }
}

function createDispatch(options = {}) {
  const fixture = createDispatchFixture(options)
  return {
    dispatch: (input = {}) => fixture.dispatch({
      symbol,
      state: {
        prices: new Map([[symbol, marketPrice]]),
        paused: new Set(),
        durablePausedMarkets: new Set(),
        operatorPausedMarkets: new Set(),
      },
      isMarketPriceFresh: () => true,
      isStopping: () => false,
      hasBlockingOpenOrdersForSymbol: () => false,
      submitRecoverySellerOrder: async (submission) => {
        fixture.setSubmissionInput(submission)
        return fixture.onSubmit
          ? fixture.onSubmit(submission)
          : {
            ok: true,
            data: { submitted: false },
          }
      },
      ...input,
    }),
    getSnapshotInput: fixture.getSnapshotInput,
    getSubmissionInput: fixture.getSubmissionInput,
    getLatchCount: fixture.getLatchCount,
  }
}

test("composes runtime dependencies and returns the shared result contract", async () => {
  const runtime = createDispatch({
    evaluateBuyDecision: () => ({
      decision: Object.freeze({
        outcome: "WAIT",
        reasonCode: "TEST_WAIT",
        explanation: "No order is eligible.",
      }),
    }),
  })
  const result = await runtime.dispatch()
  const snapshotInput = runtime.getSnapshotInput()

  assert.equal(result.ok, true, "The production dispatch must return the shared result envelope.")
  assert.equal(result.data.decision.outcome, "WAIT", "The dispatch must preserve the pure policy decision.")
  assert.equal(snapshotInput.marketMetadata, marketMetadata, "The evaluator must use canonical market metadata.")
  assert.equal(snapshotInput.accountSnapshot, accountSnapshot, "The evaluator must use the shared account snapshot.")
  assert.equal(snapshotInput.stopState, stopState, "The evaluator must use the durable STOP snapshot.")
  assert.equal(snapshotInput.reconciliationComplete, true, "The evaluator must require reconciled runtime state.")
})

test("routes eligible RS actions through the engine-owned submitter with immutable ownership", async () => {
  const runtime = createDispatch({
    evaluateBuyDecision: () => ({
      decision: Object.freeze({
        outcome: "SUBMIT",
        reasonCode: "TEST_SUBMIT",
        explanation: "Test-only order.",
      }),
      action: Object.freeze({
        side: "BUY",
        purpose: "RECOVERY_BUY",
        cycleId: "rs-cycle-1",
        positionId: "rs-position-1",
        quantity: "1",
        price: "10",
      }),
    }),
    onSubmit: async () => ({
      ok: true,
      data: { submitted: true },
    }),
  })
  let authorizationInput
  let authorizationSnapshot
  let authorizedAction
  const result = await runtime.dispatch({
    authorizeRecoverySellerAction: async ({ action, snapshot, input }) => {
      authorizedAction = action
      authorizationSnapshot = snapshot
      authorizationInput = input
      return {
        ok: true,
        data: { allowed: true },
      }
    },
  })
  const submission = runtime.getSubmissionInput()

  assert.equal(result.ok, true, "The shared order submitter result must be preserved.")
  assert.equal(result.data.submitted, true, "The RS action must reach the engine-owned submitter.")
  assert.equal(authorizationInput.symbol, symbol, "Authorization must retain the symbol from the current transition.")
  assert.equal(authorizationInput.marketPrice, marketPrice, "Authorization must receive the enriched current market price.")
  assert.equal(authorizationInput.marketMetadata, marketMetadata, "Authorization must receive canonical market metadata.")
  assert.equal(authorizationInput.pairConfig, pairConfig, "Authorization must receive the configured RS pair.")
  assert.equal(authorizationSnapshot.planInput.recoveryQuantity, "0", "Authorization must receive the snapshot that produced the action.")
  assert.equal(authorizedAction.strategyId, StrategyId.RECOVERY_SELLER, "Authorization must receive the RS-owned action.")
  assert.equal(runtime.getLatchCount(), 0, "A successful authorization must not latch durable STOP.")
  assert.equal(submission.action.strategyId, StrategyId.RECOVERY_SELLER, "The submitted action must retain RS ownership.")
  assert.equal(submission.action.cycleId, "rs-cycle-1", "The submitted action must retain its cycle identity.")
})

test("latches STOP and withholds an RS order when the shared reservation allocator is missing", async () => {
  const runtime = createDispatch({
    evaluateBuyDecision: () => ({
      decision: Object.freeze({
        outcome: "SUBMIT",
        reasonCode: "TEST_SUBMIT",
        explanation: "Test-only order.",
      }),
      action: Object.freeze({
        side: "BUY",
        purpose: "RECOVERY_BUY",
        cycleId: "rs-cycle-1",
        positionId: "rs-position-1",
        quantity: "1",
        price: "10",
      }),
    }),
  })
  const result = await runtime.dispatch()

  assert.equal(result.ok, false, "An RS order must fail closed without account-wide reservation authorization.")
  assert.equal(runtime.getLatchCount(), 1, "Missing reservation authorization must durably latch STOP.")
  assert.equal(runtime.getSubmissionInput(), undefined, "The broker submitter must not be called without authorization.")
})
