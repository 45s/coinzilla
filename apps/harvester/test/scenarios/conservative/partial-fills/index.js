import { createScenarioDefinition } from "../../shared/factories.js"

export const scenarios = [
  createScenarioDefinition({
    id: "CON-FILL-001",
    title: "Partial and repeated fills change inventory only by accepted execution facts",
    category: "partial-fills",
    priority: "P0",
    description: "Cover partial BUY/SELL fills, multiple fills at different prices, duplicate delivery, conflicting execution identity, and out-of-order order updates.",
    tags: ["fills", "partial-fill", "idempotency", "event-order"],
    preconditions: [
      "Canonical Fill identity, market, side, quantity, price, and commission facts are normalized.",
      "The target Portfolio and order belong to the Conservative strategy and expected market.",
    ],
    initialState: {
      portfolio: "known accepted fill set",
      order: "partially filled or terminal",
      eventStream: "may contain duplicate or reordered delivery",
    },
    inputEvents: [
      {
        type: "PARTIAL_FILL",
        sequence: 1,
      },
      {
        type: "DUPLICATE_FILL",
        sequence: 2,
      },
      {
        type: "CONFLICTING_FILL_IDENTITY",
        sequence: 3,
      },
      {
        type: "STALE_ORDER_UPDATE",
        sequence: 4,
      },
    ],
    expectedState: {
      acceptedFillSet: "each execution identity is applied at most once",
      conflictingIdentity: "rejected without mutating accepted accounting",
      orderLifecycle: "terminal state cannot regress to executable state",
    },
    expectedAccounting: {
      quantity: "sum of accepted net base deltas only",
      quoteBasisOrProceeds: "sum of accepted exact fill notionals and actual commission deltas",
    },
    expectedSideEffects: {
      duplicateAccounting: false,
      staleLifecycleRegression: false,
      partialProjectionMutationOnConflict: false,
    },
    invariants: [
      "A fill is never accounted for twice.",
      "Same execution identity with different economic payload is rejected.",
      "A completed order cannot become executable again.",
    ],
    relatedRequirements: ["CON-SPEC-2.2", "CON-SPEC-3.3", "CON-SPEC-5.1", "CON-SPEC-6.3"],
    relatedCriticalBehaviors: ["FILL_IDENTITY_DEDUPLICATION", "PORTFOLIO_RECOVERY_LEDGER_ALIGNMENT", "ORDER_IDENTITY_TRANSITIONS"],
    coverageStatus: "TEST-MAPPED",
    coverageReason: "Canonical fill identity and order transition tests are linked; broader delayed/missing evidence permutations remain tracked in the parent matrix.",
  }),
]
