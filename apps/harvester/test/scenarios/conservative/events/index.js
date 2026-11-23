import { createScenarioDefinition } from "../../shared/factories.js"

export const scenarios = [
  createScenarioDefinition({
    id: "CON-EVENT-001",
    title: "Duplicate, delayed, conflicting, and reordered exchange events cannot corrupt order state",
    category: "event-reliability",
    priority: "P0",
    description: "Cover duplicate order updates, duplicate fills, conflicting execution evidence, out-of-order transitions, REST/stream overlap, and missing history.",
    tags: ["events", "deduplication", "ordering", "reconciliation"],
    preconditions: [
      "Exchange event identities and canonical order/fill projections are available.",
      "The same market/order may be observed through stream and REST reconciliation paths.",
    ],
    initialState: {
      orderRegistry: "contains known canonical orders and accepted fills",
      eventDelivery: "may be duplicated, delayed, reordered, or conflicting",
    },
    inputEvents: [
      { type: "DUPLICATE_FILL_EVENT", sequence: 1 },
      { type: "STALE_ORDER_UPDATE", sequence: 2 },
      { type: "CONFLICTING_EXECUTION_EVIDENCE", sequence: 3 },
      { type: "REST_STREAM_OVERLAP", sequence: 4 },
    ],
    expectedState: {
      acceptedFills: "each canonical execution is applied once",
      orderLifecycle: "does not regress on stale or reordered updates",
      conflict: "rejected without partial accounting mutation",
    },
    expectedSideEffects: {
      duplicateAccounting: false,
      duplicateCycleCompletion: false,
      staleOrderReactivation: false,
    },
    invariants: [
      "A fill identity cannot be applied twice.",
      "Conflicting evidence for the same identity is rejected.",
      "Out-of-order events cannot move a terminal order back to an executable state.",
    ],
    relatedRequirements: ["CON-SPEC-2.2", "CON-SPEC-6.3"],
    relatedCriticalBehaviors: ["FILL_IDENTITY_DEDUPLICATION", "ORDER_IDENTITY_TRANSITIONS", "BROKER_HISTORY_RECONCILIATION"],
    coverageStatus: "TEST-MAPPED",
    coverageReason: "Duplicate, identity, and reconciliation tests are linked; delayed and missing-evidence permutations remain under review.",
  }),
]
