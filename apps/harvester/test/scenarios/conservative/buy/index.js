import { createScenarioDefinition } from "../../shared/factories.js"

export const scenarios = [
  createScenarioDefinition({
    id: "CON-BUY-001",
    title: "A completed BUY advances the cycle only after recovery SELL acknowledgement",
    category: "buy-lifecycle",
    priority: "P0",
    description: "Cover initial BUY creation, partial and complete fills, next BUY reference price, acknowledgement ordering, and the permitted BUY/SELL coexistence.",
    tags: ["buy", "order-lifecycle", "acknowledgement", "partial-fill"],
    preconditions: [
      "The Conservative pair is enabled and account commitments permit the requested BUY.",
      "The initial position is empty or represents the current strategy-owned cycle.",
    ],
    initialState: {
      position: "empty",
      activeOrders: [],
      orderSubmission: "idle",
    },
    inputEvents: [
      { type: "BUY_DECISION", sequence: 1 },
      { type: "BUY_PARTIAL_FILL", sequence: 2 },
      { type: "BUY_COMPLETE_FILL", sequence: 3 },
      { type: "RECOVERY_SELL_SUBMISSION", sequence: 4 },
      { type: "RECOVERY_SELL_ACKNOWLEDGED", sequence: 5 },
    ],
    expectedState: {
      partialBuy: "updates actual quantity and quote basis without advancing the completed cycle",
      completedBuy: "establishes the next BUY reference from completed execution facts",
      submission: "unknown outcomes remain blocked and are not blindly retried",
    },
    expectedOrders: [
      { side: "BUY", purpose: "STANDING_BUY", condition: "entry gates pass" },
      { side: "SELL", purpose: "RECOVERY_SELL", condition: "created from filled inventory" },
      { side: "BUY", purpose: "STANDING_BUY", condition: "submitted only after recovery SELL acknowledgement" },
    ],
    expectedAccounting: {
      source: "actual canonical BUY fills and commission facts",
      estimatedOrRequestedQuantity: "never substituted for executed quantity",
    },
    expectedSideEffects: {
      secondBuyBeforeRecoverySellAcknowledgement: false,
      duplicateSubmissionAfterUnknownOutcome: false,
    },
    invariants: [
      "Partial BUY fills are accounted for exactly once.",
      "The next standing BUY is not submitted before recovery SELL acknowledgement.",
      "An acknowledged recovery SELL may coexist with the next standing BUY.",
    ],
    relatedRequirements: ["CON-SPEC-3.1", "CON-SPEC-3.3", "CON-SPEC-3.4", "CON-SPEC-3.5", "CON-SPEC-3.6"],
    relatedCriticalBehaviors: ["STRATEGY_BUY_SELL_SAFETY_GATES", "ORDER_SUBMISSION_UNKNOWN", "ORDER_IDENTITY_TRANSITIONS"],
    coverageStatus: "TEST-MAPPED",
    coverageReason: "Named decision and order-lifecycle tests exist; full partial-fill and unknown-submission sequence coverage remains under review.",
  }),
]
