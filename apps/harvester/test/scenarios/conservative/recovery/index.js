import { createScenarioDefinition } from "../../shared/factories.js"

export const scenarios = [
  createScenarioDefinition({
    id: "CON-RECOVERY-001",
    title: "A pre-existing BUY fill reconciles the open recovery SELL without reopening BUY admission",
    category: "recovery-lifecycle",
    priority: "P0",
    description: "Exercise a BUY acknowledged before the recovery Position became active, late partial/final BUY fills, recovery SELL cancellation, fill reconciliation, replacement economics, and fail-closed shutdown completion.",
    tags: ["recovery", "pre-existing-buy", "late-fill", "replacement", "cancellation-race"],
    preconditions: [
      "The Conservative pair has an active strategy-owned Position and an acknowledged recovery SELL.",
      "A standing BUY was acknowledged before the recovery Position became active and remains part of its existing order lifecycle; it is not a new BUY intent.",
      "Portfolio, RecoveryLedger, OrderRegistry, and broker fill history agree on accepted execution facts.",
    ],
    initialState: {
      position: "active recovery position with authoritative quote basis",
      recoveryLedger: "confirmed net proceeds from any completed SELL fills",
      activeOrders: [
        {
          side: "SELL",
          purpose: "RECOVERY_SELL",
          status: "OPEN",
        },
        {
          side: "BUY",
          purpose: "STANDING_BUY",
          status: "OPEN",
          lifecycle: "pre-existing-before-recovery-cycle",
        },
      ],
    },
    inputEvents: [
      {
        type: "PRE_EXISTING_BUY_FILL",
        sequence: 1,
      },
      {
        type: "CANCEL_RECOVERY_SELL",
        sequence: 2,
      },
      {
        type: "RECONCILE_CANCEL_RACE_FILLS",
        sequence: 3,
      },
      {
        type: "RECALCULATE_RECOVERY_SELL",
        sequence: 4,
      },
      {
        type: "RECOVERY_SELL_COMPLETE",
        sequence: 5,
      },
      {
        type: "RECOVERY_CYCLE_COMPLETION_RECONCILED",
        sequence: 6,
      },
      {
        type: "NEXT_CYCLE_BUY",
        sequence: 7,
      },
    ],
    expectedState: {
      preExistingBuy: "retains its canonical identity and late fills are applied exactly once",
      buyAdmission: "remains closed while recovery inventory, recovery basis, or an active recovery SELL reservation remains",
      cancellation: "old recovery SELL is terminal and all raced fills are reconciled before replacement",
      recoveryBasis: "recalculated from the latest Position.spent and confirmed net SELL proceeds",
      completion: "cycle reset occurs once only after canonical terminal evidence, fill/commission reconciliation, retained-inventory disposition, and all completion gates pass",
      nextCycle: "new recovery basis contains only the new cycle's fills; a new BUY is admitted only after full completion and Position/RecoveryLedger basis reset",
    },
    expectedOrders: [
      {
        side: "BUY",
        purpose: "STANDING_BUY",
        condition: "already acknowledged before the recovery cycle; no new broker submission",
      },
      {
        side: "SELL",
        purpose: "RECOVERY_SELL",
        condition: "replacement is calculated after cancellation and complete fill reconciliation",
      },
      {
        side: "BUY",
        purpose: "STANDING_BUY",
        condition: "new cycle only after full recovery completion and Position/RecoveryLedger basis reset",
      },
    ],
    expectedAccounting: {
      portfolio: "base quantity, quote cost, and actual commissions reconcile with canonical fills",
      recoveryLedger: "confirmed net SELL proceeds are not lost or counted twice",
      retainedInventory: "keepQuantity and constrained dust remain outside sellable quantity",
      duplicateFills: "each canonical BUY/SELL fill is applied exactly once",
    },
    expectedSideEffects: {
      newBuyBeforeCycleCompletion: false,
      replacementBeforeTerminalReconciliation: false,
      duplicateCycleCompletion: false,
      priorCycleBasisLeakage: false,
    },
    invariants: [
      "A pre-existing BUY remains an existing order lifecycle and does not authorize another BUY.",
      "A late BUY fill invalidates stale recovery SELL coverage.",
      "Cancellation and replacement use canonical order identity.",
      "All fills racing with cancellation are reconciled exactly once before replacement.",
      "The recovery SELL is not replaced from stale or incomplete inventory.",
      "Failure to stage Portfolio and RecoveryLedger completion leaves both authoritative projections unchanged.",
      "A completed prior cycle cannot contaminate the next cycle's quote basis.",
      "No new BUY is admitted until recovery completion and Position/RecoveryLedger basis reset.",
    ],
    relatedRequirements: ["CON-SPEC-3.1", "CON-SPEC-3.6", "CON-SPEC-3.8", "CON-SPEC-5.1", "CON-SPEC-5.2", "CON-SPEC-5.3", "CON-SPEC-5.4", "CON-SPEC-6.1", "CON-SPEC-6.2", "CON-SPEC-6.3"],
    relatedCriticalBehaviors: [
      "PORTFOLIO_RECOVERY_LEDGER_ALIGNMENT",
      "BROKER_HISTORY_RECONCILIATION",
      "RECOVERY_SELL_ECONOMICS",
      "CANCELLATION_UNKNOWN_OUTCOMES",
      "STRATEGY_BUY_SELL_SAFETY_GATES",
    ],
    coverageStatus: "TEST-MAPPED",
    coverageReason: "Pre-existing BUY, cancellation-race, recovery accounting, strategy admission, final submission-gate, and replay tests are mapped; exact-head verification is pending.",
  }),
]
