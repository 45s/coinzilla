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
]
