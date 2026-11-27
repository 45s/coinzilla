import { createScenarioDefinition } from "../../shared/factories.js"

export const scenarios = [
  createScenarioDefinition({
    id: "CON-SAFETY-001",
    title: "Safety pause and shutdown preserve order ownership and prevent new risk",
    category: "safety-risk-controls",
    priority: "P0",
    description: "Cover account-scoped submission blockers, exposure and safety pause gates, owned BUY cancellation, shutdown ordering, process-lock retention, and safe release.",
    tags: ["safety", "risk", "shutdown", "ownership"],
    preconditions: [
      "The current process has explicit ownership of its canonical orders.",
      "Account and order state are reconciled before a safety transition is evaluated.",
    ],
    initialState: {
      strategy: "running or entering a safety pause",
      accountSafetyBlocker: "absent or active and restored from durable state",
      ownedOrders: "may include open BUY and recovery SELL orders",
      processLock: "held by the current process",
    },
    inputEvents: [
      {
        type: "ACCOUNT_SAFETY_BLOCKER_ACTIVATED_OR_RESTORED",
        sequence: 1,
      },
      {
        type: "SAFETY_PAUSE",
        sequence: 2,
      },
      {
        type: "SHUTDOWN_REQUEST",
        sequence: 3,
      },
      {
        type: "ORDER_RECONCILIATION",
        sequence: 4,
      },
    ],
    expectedState: {
      accountAdmission: "closed for every strategy, market, side, and order purpose while the account blocker is active",
      newBuy: "blocked while account blocker or safety pause is active",
      ownedBuyOrders: "canceled through the current process ownership boundary",
      processLock: "retained until shutdown recovery work is complete",
    },
    expectedSideEffects: {
      accountBlockerBypassedByRecoverySell: false,
      newOrderDuringAccountBlocker: false,
      externalOrderCancellation: false,
      unsafeLockRelease: false,
      newBuyDuringSafetyPause: false,
    },
    invariants: [
      "An account-scoped safety blocker closes every order path, including shutdown Recovery Seller SELL.",
      "A restored account blocker keeps startup observation-only until explicitly resolved.",
      "Safety pause cannot create a new BUY.",
      "Only current-process-owned BUY orders are canceled by the Conservative safety pause.",
      "Shutdown does not release process ownership before required reconciliation completes.",
    ],
    relatedRequirements: ["CON-SPEC-8.3", "CON-SPEC-10.1"],
    relatedExistingTests: [
      {
        path: "src/bootstrap/shutdown/create-conservative-shutdown-participant.test.js",
        name: "retains recovery-input blockers independently for all four configured markets",
      },
      {
        path: "src/bootstrap/shutdown/create-shutdown-handler.test.js",
        name: "retains shared services when four-market shutdown proof is blocked",
      },
    ],
    relatedCriticalBehaviors: [
      "ACCOUNT_SAFETY_BLOCKER_ADMISSION",
      "STRATEGY_SAFETY_PAUSE_BUY_CANCELLATION",
      "SHUTDOWN_PROCESS_OWNERSHIP",
    ],
    coverageStatus: "TEST-MAPPED",
    coverageReason: "Four-market recovery-input failure and shared-service retention tests are mapped; historical incident outcomes and other failure-ordering combinations remain under review.",
  }),
]
