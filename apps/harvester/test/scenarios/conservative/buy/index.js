import { createScenarioDefinition } from "../../shared/factories.js"

export const scenarios = [
  createScenarioDefinition({
    id: "CON-BUY-001",
    title: "A completed BUY keeps BUY admission closed until the recovery cycle is fully reconciled",
    category: "buy-lifecycle",
    priority: "P0",
    description: "Cover initial BUY creation, partial and complete fills, recovery SELL reconciliation, retained-inventory disposition, recovery-basis reset, and next-cycle BUY admission. A SELL acknowledgement alone never opens the BUY gate.",
    tags: ["buy", "order-lifecycle", "recovery-cycle", "reconciliation", "partial-fill"],
    preconditions: [
      "The Conservative pair is enabled and account commitments permit the requested BUY.",
      "The initial position is empty and no prior recovery cycle remains unresolved.",
    ],
    initialState: {
      position: "empty",
      activeOrders: [],
      orderSubmission: "idle",
    },
    inputEvents: [
      {
        type: "BUY_DECISION",
        sequence: 1,
      },
      {
        type: "BUY_PARTIAL_FILL",
        sequence: 2,
      },
      {
        type: "BUY_COMPLETE_FILL",
        sequence: 3,
      },
      {
        type: "RECOVERY_SELL_SUBMISSION",
        sequence: 4,
      },
      {
        type: "RECOVERY_SELL_ACKNOWLEDGED",
        sequence: 5,
      },
      {
        type: "RECOVERY_SELL_PARTIAL_FILL",
        sequence: 6,
      },
      {
        type: "RECOVERY_SELL_COMPLETE_FILL",
        sequence: 7,
      },
      {
        type: "RECOVERY_CYCLE_COMPLETION_RECONCILED",
        sequence: 8,
      },
      {
        type: "NEXT_BUY_DECISION",
        sequence: 9,
      },
    ],
    expectedState: {
      partialBuy: "updates actual quantity and quote basis without advancing or completing the recovery cycle",
      completedBuy: "establishes the active recovery Position and RecoveryLedger basis; it does not authorize another BUY",
      recoverySell: "remains the only new order intent while the recovery cycle is unresolved",
      buyAdmission: "remains closed through SELL acknowledgement, partial fills, terminal status, and proceeds recovery",
      cycleCompletion: "requires complete terminal SELL fill and commission reconciliation, retained-inventory/dust disposition, and Position/RecoveryLedger basis reset",
      nextCycle: "a new standing BUY is admitted only after the prior recovery cycle is fully completed and reset",
      submission: "unknown outcomes remain blocked and are not blindly retried",
    },
    expectedOrders: [
      {
        side: "BUY",
        purpose: "STANDING_BUY",
        condition: "initial entry gates pass and no recovery cycle is unresolved",
      },
      {
        side: "SELL",
        purpose: "RECOVERY_SELL",
        condition: "created and maintained from reconciled filled inventory",
      },
      {
        side: "BUY",
        purpose: "STANDING_BUY",
        condition: "submitted only after full recovery-cycle completion and Position/RecoveryLedger basis reset",
      },
    ],
    expectedAccounting: {
      source: "actual canonical BUY/SELL fills and commission facts",
      estimatedOrRequestedQuantity: "never substituted for executed quantity",
      cycleCompletion: "not inferred from SELL acknowledgement or cost recovery alone",
    },
    expectedSideEffects: {
      newBuyBeforeCycleCompletion: false,
      nextBuyBeforeRecoverySellAcknowledgement: false,
      buyGateRemainsClosedAfterRecoverySellAcknowledgement: true,
      duplicateSubmissionAfterUnknownOutcome: false,
      nextBuyAfterCycleReset: true,
    },
    invariants: [
      "Partial BUY and SELL fills are accounted for exactly once.",
      "A new standing BUY is not submitted while Position recovery inventory, recovery basis, RecoveryLedger cycle totals, or an owned active recovery SELL reservation remains.",
      "PENDING, UNKNOWN, OPEN, and PARTIALLY_FILLED recovery SELL states do not release BUY admission.",
      "An acknowledged or terminal recovery SELL does not by itself complete the cycle.",
      "The next standing BUY is admitted only after complete fill/commission reconciliation, retained-inventory disposition, and Position/RecoveryLedger basis reset.",
    ],
    relatedRequirements: ["CON-SPEC-3.1", "CON-SPEC-3.3", "CON-SPEC-3.4", "CON-SPEC-3.5", "CON-SPEC-3.6", "CON-SPEC-3.8"],
    relatedCriticalBehaviors: ["STRATEGY_BUY_SELL_SAFETY_GATES", "ORDER_SUBMISSION_UNKNOWN", "ORDER_IDENTITY_TRANSITIONS"],
    coverageStatus: "TEST-MAPPED",
    coverageReason: "Strategy, final submission-gate, engine, replay, and recovery-completion tests are mapped; exact-head verification is pending.",
  }),
]
