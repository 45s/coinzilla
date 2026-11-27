import { createHash } from "node:crypto"

function createRecoverySellerMixedSellReconciledCallback({ store,
  recordRecoverySellerMixedSellReconciled } = {}) {
  return store
    ? ({ terminalOrder, ownership, canonicalFills, accountingApplied, eligible }) =>
      recordRecoverySellerMixedSellReconciled({
        operationalStateStore: store,
        terminalOrder,
        ownership,
        canonicalFills,
        accountingApplied,
        eligible,
      })
    : undefined
}

function createExecutionFillCallback({ store,
  recordExecutionFill } = {}) {
  return store ? ({ fill }) => recordExecutionFill({ operationalStateStore: store,
    fill }) : undefined
}

function createRecoveryCycleCompletedCallback({ store,
  recordRecoveryCycleCompleted } = {}) {
  return store
    ? ({ recoveryLedger,
  position,
  sellOrder,
  completion,
  minProfit,
  inventoryDisposition }) =>
      recordRecoveryCycleCompleted({
        operationalStateStore: store,
        recoveryLedger,
        position,
        sellOrder,
        completion,
        minProfit,
        inventoryDisposition,
      })
    : undefined
}

function createRecoveryCycleNotCompletedCallback({ store,
  recordRecoveryCycleNotCompleted } = {}) {
  return store
    ? ({ recoveryLedger,
  position,
  sellOrder,
  completion,
  minProfit }) =>
      recordRecoveryCycleNotCompleted({
        operationalStateStore: store,
        recoveryLedger,
        position,
        sellOrder,
        completion,
        minProfit,
      })
    : undefined
}

function createSubmissionIntentCallback({ store,
  recordOrderSubmissionIntent } = {}) {
  return store ? ({ order,
  purpose,
  ownership }) => recordOrderSubmissionIntent({ operationalStateStore: store,
    order,
    purpose,
    ownership }) : undefined
}

function createSubmissionOutcomeCallback({ store,
  recordOrderSubmissionOutcome } = {}) {
  return store
    ? ({ order,
  outcome,
  purpose,
  ownership }) => recordOrderSubmissionOutcome({ operationalStateStore: store,
      order,
      outcome,
      purpose,
      ownership })
    : undefined
}

function createCancellationIntentCallback({ store,
  recordOrderCancellationIntent } = {}) {
  return store ? ({ order,
  reason }) => recordOrderCancellationIntent({ operationalStateStore: store,
    order,
    reason }) : undefined
}

function createStrategyMarketPausedCallback({ store,
  recordStrategyMarketControl,
  sequence } = {}) {
  return store
    ? ({ symbol,
  reason,
  error }) => recordStrategyMarketControl({
      operationalStateStore: store,
      action: "PAUSE",
      transitionId: `${store.runtimeSessionId}:${++sequence.value}`,
      symbol,
      reason,
      ...(error === undefined ? {} : { error }),
    })
    : undefined
}

function createSafetyBlockerCallback({ store,
  recordSafetyBlockerRaised,
  createHash: hashFactory } = {}) {
  return store
    ? ({ scope,
  symbol,
  reason,
  evidence }) => {
      const canonicalEvidence = Object.fromEntries(
        Object.keys(evidence).sort().map((key) => [key, evidence[key]]),
      )
      const evidenceDigest = hashFactory("sha256").update(JSON.stringify(canonicalEvidence)).digest("hex")
      return recordSafetyBlockerRaised({
        operationalStateStore: store,
        scope,
        symbol,
        reason,
        evidenceDigest,
      })
    }
    : undefined
}

function createCancellationOutcomeCallback({ store,
  recordOrderCancellationOutcome } = {}) {
  return store
    ? ({ order,
  canceledOrder,
  reason,
  outcome }) =>
      recordOrderCancellationOutcome({ operationalStateStore: store,
        order,
        canceledOrder,
        reason,
        outcome })
    : undefined
}

export function createOperationalStateCallbacks(dependencies = {}) {
  const { operationalStateStore: store } = dependencies
  const sequence = { value: 0 }
  return {
    onOperationalStateExecutionFill: createExecutionFillCallback({ store,
      recordExecutionFill: dependencies.recordExecutionFill }),
    onOperationalStateRecoverySellerMixedSellReconciled: createRecoverySellerMixedSellReconciledCallback({
      store,
      recordRecoverySellerMixedSellReconciled: dependencies.recordRecoverySellerMixedSellReconciled,
    }),
    onOperationalStateRecoveryCycleCompleted: createRecoveryCycleCompletedCallback({ store,
      recordRecoveryCycleCompleted: dependencies.recordRecoveryCycleCompleted }),
    onOperationalStateRecoveryCycleNotCompleted: createRecoveryCycleNotCompletedCallback({ store,
      recordRecoveryCycleNotCompleted: dependencies.recordRecoveryCycleNotCompleted }),
    onOperationalStateSubmissionIntent: createSubmissionIntentCallback({ store,
      recordOrderSubmissionIntent: dependencies.recordOrderSubmissionIntent }),
    onOperationalStateSubmissionOutcome: createSubmissionOutcomeCallback({ store,
      recordOrderSubmissionOutcome: dependencies.recordOrderSubmissionOutcome }),
    onOperationalStateCancellationIntent: createCancellationIntentCallback({ store,
      recordOrderCancellationIntent: dependencies.recordOrderCancellationIntent }),
    onOperationalStateStrategyMarketPaused: createStrategyMarketPausedCallback({ store,
      recordStrategyMarketControl: dependencies.recordStrategyMarketControl,
      sequence }),
    onSafetyBlockerRaised: createSafetyBlockerCallback({ store,
      recordSafetyBlockerRaised: dependencies.recordSafetyBlockerRaised,
      createHash: dependencies.createHash ?? createHash }),
    onOperationalStateCancellationOutcome: createCancellationOutcomeCallback({ store,
      recordOrderCancellationOutcome: dependencies.recordOrderCancellationOutcome }),
  }
}
