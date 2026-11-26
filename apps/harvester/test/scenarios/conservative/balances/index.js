import { createScenarioDefinition } from "../../shared/factories.js"

export const scenarios = [
  createScenarioDefinition({
    id: "CON-BALANCE-001",
    title: "Account-wide reservations and strategy-owned inventory prevent overspending or external-order adoption",
    category: "balance-inventory",
    priority: "P0",
    description: "Cover free versus reserved balances, cross-market quote commitments, base inventory allocation, startup open-order reconciliation, and closing-account ownership.",
    tags: ["balance", "reservation", "inventory", "ownership", "multi-market"],
    preconditions: [
      "Account balances and open orders are sourced from the authoritative account snapshot.",
      "Order ownership is established by the current process and its canonical order registry.",
    ],
    initialState: {
      account: "multiple markets may hold quote/base commitments",
      openOrders: "include current-process-owned and external orders",
      portfolio: "contains strategy-owned inventory only",
    },
    inputEvents: [
      {
        type: "ACCOUNT_SNAPSHOT",
        sequence: 1,
      },
      {
        type: "ALLOCATE_ORDER_COMMITMENTS",
        sequence: 2,
      },
      {
        type: "STARTUP_OPEN_ORDER_RECONCILIATION",
        sequence: 3,
      },
    ],
    expectedState: {
      availableBalances: "subtract all applicable reservations and commitments",
      strategyInventory: "does not adopt unrelated external inventory",
      startup: "blocks trading when account evidence is incomplete or conflicting",
    },
    expectedSideEffects: {
      overspendAcrossMarkets: false,
      externalOrderCancellationOrAdoption: false,
    },
    invariants: [
      "Account-wide quote and base commitments reconcile across markets.",
      "Free balance is not treated as available when already reserved.",
      "Only orders owned by the current process are eligible for strategy cancellation.",
    ],
    relatedRequirements: ["CON-SPEC-3.7", "CON-RUNTIME-3", "CON-RUNTIME-4"],
    relatedCriticalBehaviors: [
      "ACCOUNT_COMMITMENT_ALLOCATION",
      "STARTUP_ACCOUNT_RECONCILIATION",
      "CLOSING_ACCOUNT_OPEN_ORDER_AUDIT",
    ],
    coverageStatus: "TEST-MAPPED",
    coverageReason: "Account commitment and startup ownership tests are linked; account-level integration combinations remain subject to review.",
  }),
]
