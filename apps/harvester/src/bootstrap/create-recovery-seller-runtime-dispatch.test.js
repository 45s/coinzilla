import assert from "node:assert/strict"
import test from "node:test"
import { StrategyId } from "../../domain/strategies/strategy-ids.js"
import { createRecoverySellerRuntimeDispatch } from "./create-recovery-seller-runtime-dispatch.js"

const symbol = "ZROUSDT"
const marketPrice = Object.freeze({ symbol, price: "12.3" })
const marketMetadata = Object.freeze({ market: Object.freeze({ symbol }) })
const pairConfig = Object.freeze({})
const accountSnapshot = Object.freeze({ balances: Object.freeze([]) })
const stopState = Object.freeze({ status: "RUNNING", decision: null })

function createDispatch({ evaluateBuyDecision, onSubmit = async () => ({ ok: true, data: { submitted: false } }) } = {}) {
  let snapshotInput
  let submissionInput
  const dispatch = createRecoverySellerRuntimeDispatch({
    recoverySellerWorkflow: {
      getTransitionSnapshot: (input) => {
        snapshotInput = input
        return Object.freeze({
          cycleState: Object.freeze({ cycleId: "rs-cycle-1", positionId: "rs-position-1", status: "ACCUMULATING" }),
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
          marketPaused: input.marketPaused,
          reconciliationComplete: input.reconciliationComplete,
        })
      },
    },
    recoverySellerStopWorkflow: { getState: async () => stopState },
    recoverySellerPairs: { [symbol]: pairConfig },
    getRecoverySellerMarketMetadata: async () => marketMetadata,
    getAccountSnapshot: async () => accountSnapshot,
    evaluateBuyDecision,
  })
  return {
    dispatch: (input = {}) => dispatch({
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
        submissionInput = submission
        return onSubmit(submission)
      },
      ...input,
    }),
    getSnapshotInput: () => snapshotInput,
    getSubmissionInput: () => submissionInput,
  }
}

test("composes runtime dependencies and returns the shared result contract", async () => {
  const runtime = createDispatch({
    evaluateBuyDecision: () => ({
      decision: Object.freeze({ outcome: "WAIT", reasonCode: "TEST_WAIT", explanation: "No order is eligible." }),
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
      decision: Object.freeze({ outcome: "SUBMIT", reasonCode: "TEST_SUBMIT", explanation: "Test-only order." }),
      action: Object.freeze({
        side: "BUY",
        purpose: "RECOVERY_BUY",
        cycleId: "rs-cycle-1",
        positionId: "rs-position-1",
        quantity: "1",
        price: "10",
      }),
    }),
    onSubmit: async () => ({ ok: true, data: { submitted: true } }),
  })
  const result = await runtime.dispatch()
  const submission = runtime.getSubmissionInput()

  assert.equal(result.ok, true, "The shared order submitter result must be preserved.")
  assert.equal(result.data.submitted, true, "The RS action must reach the engine-owned submitter.")
  assert.equal(submission.action.strategyId, StrategyId.RECOVERY_SELLER, "The submitted action must retain RS ownership.")
  assert.equal(submission.action.cycleId, "rs-cycle-1", "The submitted action must retain its cycle identity.")
})
