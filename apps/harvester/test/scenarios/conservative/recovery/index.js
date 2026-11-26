import { createScenarioDefinition } from "../../shared/factories.js"

export const scenarios = [
  createScenarioDefinition({
    id: "CON-RECOVERY-001",
    title: "A second BUY reconciles the open recovery SELL before recalculating the next cycle",
    category: "recovery-lifecycle",
    priority: "P0",
    description: "Exercise the multi-BUY recovery sequence, cancellation/fill race, replacement economics, terminal completion, retained inventory, and next-cycle basis reset.",
    tags: ["recovery", "replacement", "cycle", "cancellation-race"],
    preconditions: [
      "The first BUY has completed and its recovery SELL is acknowledged.",
      "Portfolio, RecoveryLedger, OrderRegistry, and broker fill history agree on accepted execution facts.",
    ],
    initialState: {
      position: "active recovery position with authoritative quote basis",
      recoveryLedger: "confirmed net proceeds from any completed SELL fills",
      recoverySell: "acknowledged and open",
    },
    inputEvents: [
      {
        type: "SECOND_BUY_FILL",
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
        type: "NEXT_CYCLE_BUY",
        sequence: 6,
      },
    ],
    expectedState: {
      cancellation: "old recovery SELL is terminal and all raced fills are reconciled before replacement",
      recoveryBasis: "recalculated from Position.spent and confirmed net SELL proceeds",
      completion: "cycle reset occurs once after canonical terminal evidence and all completion gates pass",
      nextCycle: "new recovery basis contains only the new cycle's fills",
    },
    expectedOrders: [
      {
        side: "SELL",
        purpose: "RECOVERY_SELL",
        condition: "replacement is calculated after reconciliation",
      },
      {
        side: "BUY",
        purpose: "STANDING_BUY",
        condition: "only after recovery SELL acknowledgement",
      },
    ],
    expectedAccounting: {
      portfolio: "base quantity, quote cost, and actual commissions reconcile with canonical fills",
      recoveryLedger: "confirmed net SELL proceeds are not lost or counted twice",
      retainedInventory: "keepQuantity and constrained dust remain outside sellable quantity",
    },
    expectedSideEffects: {
      replacementBeforeTerminalReconciliation: false,
      duplicateCycleCompletion: false,
      priorCycleBasisLeakage: false,
    },
    invariants: [
      "A cancellation race cannot omit a fill or apply it twice.",
      "Replacement recovery economics use all confirmed fills through the cancellation boundary.",
      "Failure to stage Portfolio and RecoveryLedger completion leaves both authoritative projections unchanged.",
      "A completed prior cycle cannot contaminate the next cycle's quote basis.",
    ],
    relatedRequirements: ["CON-SPEC-2.1", "CON-SPEC-2.2", "CON-SPEC-5.2", "CON-SPEC-5.3", "CON-SPEC-6.1", "CON-SPEC-6.2", "CON-SPEC-6.3"],
    relatedCriticalBehaviors: [
      "PORTFOLIO_RECOVERY_LEDGER_ALIGNMENT",
      "BROKER_HISTORY_RECONCILIATION",
      "RECOVERY_SELL_ECONOMICS",
      "CANCELLATION_UNKNOWN_OUTCOMES",
    ],
    coverageStatus: "TEST-MAPPED",
    coverageReason: "Existing cancellation-race, recovery accounting, and next-cycle tests are linked; not every sequence permutation has been independently verified.",
  }),
]
