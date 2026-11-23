import { createScenarioDefinition } from "../../shared/factories.js"

export const scenarios = [
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
