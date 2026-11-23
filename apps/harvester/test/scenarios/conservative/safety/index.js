import { createScenarioDefinition } from "../../shared/factories.js"

export const scenarios = [
  createScenarioDefinition({
    id: "CON-ERROR-001",
    title: "Unknown submission, cancellation, and incomplete broker history remain fail-closed",
    category: "exchange-failures",
    priority: "P0",
    description: "Cover exchange rejection, timeout with unknown outcome, cancellation races, incomplete fill history, and evidence-backed recovery.",
    tags: ["exchange-error", "unknown-outcome", "reconciliation", "fail-closed"],
    preconditions: [
      "Broker operations are represented by deterministic offline test doubles.",
      "Order identity and durable submission intent are available to the application workflow.",
    ],
    initialState: {
      order: "pending, open, or cancellation requested",
      brokerOutcome: "may be rejected, delayed, unknown, or partially observed",
    },
    inputEvents: [
      { type: "SUBMISSION_TIMEOUT", sequence: 1 },
      { type: "CANCELLATION_TIMEOUT", sequence: 2 },
      { type: "BROKER_HISTORY_INCOMPLETE", sequence: 3 },
    ],
    expectedState: {
      unknownOutcome: "retained as unknown and blocked pending authoritative reconciliation",
      rejection: "treated as a known terminal outcome",
      missingFillEvidence: "prevents replacement or completion",
    },
    expectedOrders: [],
    expectedSideEffects: {
      blindRetry: false,
      replacementBeforeReconciliation: false,
      duplicateOrderSubmission: false,
    },
    invariants: [
      "An unknown exchange outcome is not treated as a rejection or success.",
      "No blind retry occurs while the exchange outcome is unknown.",
      "A cancellation race is resolved using all authoritative fills before replacement.",
    ],
    relatedRequirements: ["CON-SPEC-5.2", "CON-SPEC-5.3", "CON-SPEC-8.2"],
    relatedCriticalBehaviors: ["ORDER_SUBMISSION_UNKNOWN", "CANCELLATION_UNKNOWN_OUTCOMES", "BROKER_HISTORY_RECONCILIATION"],
    coverageStatus: "TEST-MAPPED",
    coverageReason: "Submission, cancellation, and broker-history tests are linked; the full exchange failure matrix remains under review.",
  }),
  createScenarioDefinition({
    id: "CON-SAFETY-001",
    title: "Safety pause and shutdown preserve order ownership and prevent new risk",
    category: "safety-risk-controls",
    priority: "P0",
    description: "Cover exposure and safety pause gates, owned BUY cancellation, shutdown ordering, process-lock retention, and safe release.",
    tags: ["safety", "risk", "shutdown", "ownership"],
    preconditions: [
      "The current process has explicit ownership of its canonical orders.",
      "Account and order state are reconciled before a safety transition is evaluated.",
    ],
    initialState: {
      strategy: "running or entering a safety pause",
      ownedOrders: "may include open BUY and recovery SELL orders",
      processLock: "held by the current process",
    },
    inputEvents: [
      { type: "SAFETY_PAUSE", sequence: 1 },
      { type: "SHUTDOWN_REQUEST", sequence: 2 },
      { type: "ORDER_RECONCILIATION", sequence: 3 },
    ],
    expectedState: {
      newBuy: "blocked while safety pause is active",
      ownedBuyOrders: "canceled through the current process ownership boundary",
      processLock: "retained until shutdown recovery work is complete",
    },
    expectedSideEffects: {
      externalOrderCancellation: false,
      unsafeLockRelease: false,
      newBuyDuringSafetyPause: false,
    },
    invariants: [
      "Safety pause cannot create a new BUY.",
      "Only current-process-owned BUY orders are canceled by the Conservative safety pause.",
      "Shutdown does not release process ownership before required reconciliation completes.",
    ],
    relatedRequirements: ["CON-SPEC-8.3", "CON-SPEC-10.1"],
    relatedCriticalBehaviors: ["STRATEGY_SAFETY_PAUSE_BUY_CANCELLATION", "SHUTDOWN_PROCESS_OWNERSHIP"],
    coverageStatus: "TEST-MAPPED",
    coverageReason: "Safety pause and shutdown ownership tests are linked; all risk-limit and failure-ordering combinations remain under review.",
  }),
]
