export const CG_CONSERVATIVE_SCENARIO_DETAILS_PART_FOUR = [
  {
    "id": "CON-RECOVERY-001",
    "title": "A pre-existing BUY fill reconciles the open recovery SELL without reopening BUY admission",
    "category": "recovery-lifecycle",
    "priority": "P0",
    "description": "Exercise a BUY acknowledged before the recovery Position became active, late partial/final BUY fills, recovery SELL cancellation, fill reconciliation, replacement economics, and fail-closed shutdown completion.",
    "tags": [
      "recovery",
      "pre-existing-buy",
      "late-fill",
      "replacement",
      "cancellation-race"
    ],
    "preconditions": [
      "The Conservative pair has an active strategy-owned Position and an acknowledged recovery SELL.",
      "A standing BUY was acknowledged before the recovery Position became active and remains part of its existing order lifecycle; it is not a new BUY intent.",
      "Portfolio, RecoveryLedger, OrderRegistry, and broker fill history agree on accepted execution facts."
    ],
    "initialState": {
      "position": "active recovery position with authoritative quote basis",
      "recoveryLedger": "confirmed net proceeds from any completed SELL fills",
      "activeOrders": [
        {
          "side": "SELL",
          "purpose": "RECOVERY_SELL",
          "status": "OPEN"
        },
        {
          "side": "BUY",
          "purpose": "STANDING_BUY",
          "status": "OPEN",
          "lifecycle": "pre-existing-before-recovery-cycle"
        }
      ]
    },
    "inputEvents": [
      {
        "type": "PRE_EXISTING_BUY_FILL",
        "sequence": 1
      },
      {
        "type": "CANCEL_RECOVERY_SELL",
        "sequence": 2
      },
      {
        "type": "RECONCILE_CANCEL_RACE_FILLS",
        "sequence": 3
      },
      {
        "type": "RECALCULATE_RECOVERY_SELL",
        "sequence": 4
      },
      {
        "type": "RECOVERY_SELL_COMPLETE",
        "sequence": 5
      },
      {
        "type": "RECOVERY_CYCLE_COMPLETION_RECONCILED",
        "sequence": 6
      },
      {
        "type": "NEXT_CYCLE_BUY",
        "sequence": 7
      }
    ],
    "expectedState": {
      "preExistingBuy": "retains its canonical identity and late fills are applied exactly once",
      "buyAdmission": "remains closed while recovery inventory, recovery basis, or an active recovery SELL reservation remains",
      "cancellation": "old recovery SELL is terminal and all raced fills are reconciled before replacement",
      "recoveryBasis": "recalculated from the latest Position.spent and confirmed net SELL proceeds",
      "completion": "cycle reset occurs once only after canonical terminal evidence, fill/commission reconciliation, retained-inventory disposition, and all completion gates pass",
      "nextCycle": "new recovery basis contains only the new cycle's fills; a new BUY is admitted only after full completion and Position/RecoveryLedger basis reset"
    },
    "expectedOrders": [
      {
        "side": "BUY",
        "purpose": "STANDING_BUY",
        "condition": "already acknowledged before the recovery cycle; no new broker submission"
      },
      {
        "side": "SELL",
        "purpose": "RECOVERY_SELL",
        "condition": "replacement is calculated after cancellation and complete fill reconciliation"
      },
      {
        "side": "BUY",
        "purpose": "STANDING_BUY",
        "condition": "new cycle only after full recovery completion and Position/RecoveryLedger basis reset"
      }
    ],
    "expectedAccounting": {
      "portfolio": "base quantity, quote cost, and actual commissions reconcile with canonical fills",
      "recoveryLedger": "confirmed net SELL proceeds are not lost or counted twice",
      "retainedInventory": "keepQuantity and constrained dust remain outside sellable quantity",
      "duplicateFills": "each canonical BUY/SELL fill is applied exactly once"
    },
    "expectedSideEffects": {
      "newBuyBeforeCycleCompletion": false,
      "replacementBeforeTerminalReconciliation": false,
      "duplicateCycleCompletion": false,
      "priorCycleBasisLeakage": false
    },
    "invariants": [
      "A pre-existing BUY remains an existing order lifecycle and does not authorize another BUY.",
      "A late BUY fill invalidates stale recovery SELL coverage.",
      "Cancellation and replacement use canonical order identity.",
      "All fills racing with cancellation are reconciled exactly once before replacement.",
      "The recovery SELL is not replaced from stale or incomplete inventory.",
      "Failure to stage Portfolio and RecoveryLedger completion leaves both authoritative projections unchanged.",
      "A completed prior cycle cannot contaminate the next cycle's quote basis.",
      "No new BUY is admitted until recovery completion and Position/RecoveryLedger basis reset."
    ],
    "relatedRequirements": [
      "CON-SPEC-3.1",
      "CON-SPEC-3.6",
      "CON-SPEC-3.8",
      "CON-SPEC-5.1",
      "CON-SPEC-5.2",
      "CON-SPEC-5.3",
      "CON-SPEC-5.4",
      "CON-SPEC-6.1",
      "CON-SPEC-6.2",
      "CON-SPEC-6.3"
    ],
    "relatedCriticalBehaviors": [
      "PORTFOLIO_RECOVERY_LEDGER_ALIGNMENT",
      "BROKER_HISTORY_RECONCILIATION",
      "RECOVERY_SELL_ECONOMICS",
      "CANCELLATION_UNKNOWN_OUTCOMES",
      "STRATEGY_BUY_SELL_SAFETY_GATES"
    ],
    "coverageStatus": "TEST-MAPPED",
    "coverageReason": "Pre-existing BUY, cancellation-race, recovery accounting, strategy admission, final submission-gate, and replay tests are mapped; exact-head verification is pending."
  },
  {
    "id": "CON-RUNTIME-001",
    "title": "Coordinator startup, account readiness, reconnect, and shutdown preserve Conservative ownership",
    "category": "runtime-coordinator-integration",
    "priority": "P1",
    "description": "Cover startup account reconciliation, user-data disconnect recovery, multi-market account commitments, closing-account open-order audit, and lifecycle coordination.",
    "tags": [
      "runtime",
      "coordinator",
      "startup",
      "reconnect",
      "multi-market"
    ],
    "preconditions": [
      "Broker and persistence ports are deterministic offline test doubles.",
      "The coordinator owns the order and account lifecycle for each configured market."
    ],
    "initialState": {
      "runtime": "starting, ready, reconnecting, or shutting down",
      "account": "may contain balances and open orders across markets",
      "userData": "connected or disconnected"
    },
    "inputEvents": [
      {
        "type": "STARTUP_PREFLIGHT",
        "sequence": 1
      },
      {
        "type": "USER_DATA_DISCONNECT",
        "sequence": 2
      },
      {
        "type": "RECONNECT_AND_DRAIN_EVENTS",
        "sequence": 3
      },
      {
        "type": "CLOSING_ACCOUNT_AUDIT",
        "sequence": 4
      }
    ],
    "expectedState": {
      "readiness": "trading is gated until account and event evidence is authoritative",
      "reconnect": "event draining and reconciliation complete before readiness resumes",
      "multiMarket": "shared account commitments remain consistent"
    },
    "expectedSideEffects": {
      "tradingBeforeReadiness": false,
      "externalOrderAdoption": false,
      "crossMarketOverspend": false
    },
    "invariants": [
      "Startup and reconnect readiness require authoritative account and order evidence.",
      "Cross-market reservations and commitments reconcile at the account level.",
      "The coordinator does not adopt or cancel external orders as Conservative-owned orders."
    ],
    "relatedRequirements": [
      "CON-RUNTIME-1",
      "CON-RUNTIME-2",
      "CON-RUNTIME-3",
      "CON-RUNTIME-4"
    ],
    "relatedCriticalBehaviors": [
      "STARTUP_ACCOUNT_RECONCILIATION",
      "USER_DATA_DISCONNECT_RECOVERY",
      "ACCOUNT_COMMITMENT_ALLOCATION",
      "CLOSING_ACCOUNT_OPEN_ORDER_AUDIT"
    ],
    "coverageStatus": "TEST-MAPPED",
    "coverageReason": "Startup, reconnect, account allocation, and ownership tests are linked; full end-to-end Conservative coordinator coverage remains under review."
  },
  {
    "id": "CON-SAFETY-001",
    "title": "Safety pause and shutdown preserve order ownership and prevent new risk",
    "category": "safety-risk-controls",
    "priority": "P0",
    "description": "Cover account-scoped submission blockers, exposure and safety pause gates, owned BUY cancellation, shutdown ordering, process-lock retention, and safe release.",
    "tags": [
      "safety",
      "risk",
      "shutdown",
      "ownership"
    ],
    "preconditions": [
      "The current process has explicit ownership of its canonical orders.",
      "Account and order state are reconciled before a safety transition is evaluated."
    ],
    "initialState": {
      "strategy": "running or entering a safety pause",
      "accountSafetyBlocker": "absent or active and restored from durable state",
      "ownedOrders": "may include open BUY and recovery SELL orders",
      "processLock": "held by the current process"
    },
    "inputEvents": [
      {
        "type": "ACCOUNT_SAFETY_BLOCKER_ACTIVATED_OR_RESTORED",
        "sequence": 1
      },
      {
        "type": "SAFETY_PAUSE",
        "sequence": 2
      },
      {
        "type": "SHUTDOWN_REQUEST",
        "sequence": 3
      },
      {
        "type": "ORDER_RECONCILIATION",
        "sequence": 4
      }
    ],
    "expectedState": {
      "accountAdmission": "closed for every strategy, market, side, and order purpose while the account blocker is active",
      "newBuy": "blocked while account blocker or safety pause is active",
      "ownedBuyOrders": "canceled through the current process ownership boundary",
      "processLock": "retained until shutdown recovery work is complete"
    },
    "expectedSideEffects": {
      "accountBlockerBypassedByRecoverySell": false,
      "newOrderDuringAccountBlocker": false,
      "externalOrderCancellation": false,
      "unsafeLockRelease": false,
      "newBuyDuringSafetyPause": false
    },
    "invariants": [
      "An account-scoped safety blocker closes every order path, including shutdown Recovery Seller SELL.",
      "A restored account blocker keeps startup observation-only until explicitly resolved.",
      "Safety pause cannot create a new BUY.",
      "Only current-process-owned BUY orders are canceled by the Conservative safety pause.",
      "Shutdown does not release process ownership before required reconciliation completes."
    ],
    "relatedRequirements": [
      "CON-SPEC-8.3",
      "CON-SPEC-10.1"
    ],
    "relatedCriticalBehaviors": [
      "ACCOUNT_SAFETY_BLOCKER_ADMISSION",
      "STRATEGY_SAFETY_PAUSE_BUY_CANCELLATION",
      "SHUTDOWN_PROCESS_OWNERSHIP"
    ],
    "coverageStatus": "TEST-MAPPED",
    "coverageReason": "Four-market recovery-input failure and shared-service retention tests are mapped; historical incident outcomes and other failure-ordering combinations remain under review.",
    "relatedExistingTests": [
      {
        "path": "src/bootstrap/shutdown/create-conservative-shutdown-participant.test.js",
        "name": "retains recovery-input blockers independently for all four configured markets"
      },
      {
        "path": "src/bootstrap/shutdown/create-shutdown-handler.test.js",
        "name": "retains shared services when four-market shutdown proof is blocked"
      }
    ]
  },
  {
    "id": "CON-SELL-001",
    "title": "Recovery SELL quantity and price preserve profit, fees, inventory, and exchange constraints",
    "category": "sell-lifecycle",
    "priority": "P0",
    "description": "Cover recovery SELL creation, retained inventory, fee reserve, minimum profit, tick/step rounding, post-only rules, partial fills, and terminal replacement decisions.",
    "tags": [
      "sell",
      "recovery",
      "fees",
      "filters",
      "rounding"
    ],
    "preconditions": [
      "Position.spent and actual net base quantity are authoritative.",
      "A fresh same-symbol order-book snapshot is available for the post-only crossing check immediately before broker I/O.",
      "Current market metadata and trading filters belong to the same market and are fresh."
    ],
    "initialState": {
      "position": "positive quote basis and strategy-owned base inventory",
      "recoveryLedger": "confirmed net SELL proceeds accumulated from canonical fills",
      "activeRecoverySell": "absent or terminal"
    },
    "inputEvents": [
      {
        "type": "RECOVERY_SELL_PLAN",
        "sequence": 1
      },
      {
        "type": "FRESH_ORDER_BOOK_SNAPSHOT",
        "sequence": 2
      },
      {
        "type": "SELL_PARTIAL_FILL",
        "sequence": 2
      },
      {
        "type": "SELL_TERMINAL_UPDATE",
        "sequence": 3
      }
    ],
    "expectedState": {
      "retainedInventory": "keepQuantity remains reserved",
      "inventoryDisposition": "classifies KEEP_QUANTITY, SELLABLE_RESIDUAL, and EXCHANGE_CONSTRAINED_DUST using exact step and notional rules",
      "sellableQuantity": "actual net base less retained inventory and applicable fee reserve",
      "residual": "positive sellable residual is not suppressed merely because outstandingRecoveryAmount is zero; when recovery proceeds are secured, sell-through uses the current market reference"
    },
    "expectedOrders": [
      {
        "side": "SELL",
        "purpose": "RECOVERY_SELL",
        "type": "POST_ONLY_LIMIT"
      },
      {
        "quantity": "rounded down to step size",
        "price": "rounded up to tick size"
      }
    ],
    "expectedAccounting": {
      "requiredNetProceeds": "covers authoritative recovery basis plus minProfit",
      "commission": "actual fill commission is accounted separately from configured fee reserve"
    },
    "expectedSideEffects": {
      "belowMinimumQuantityOrNotional": "no exchange order is emitted",
      "staleOrMissingFilters": "no recovery SELL is submitted",
      "staleOrMissingBookSnapshot": "no post-only order is submitted"
    },
    "invariants": [
      "A recovery SELL never consumes keepQuantity.",
      "Price rounding never reduces required net proceeds.",
      "A partial SELL without a new BUY does not reprice an otherwise valid open recovery SELL.",
      "Exchange filters are checked before an order intent is emitted.",
      "Post-only crossing is checked against a fresh same-symbol book immediately before broker submission.",
      "Exchange-constrained dust is retained and is never rounded into an invalid order."
    ],
    "relatedRequirements": [
      "CON-SPEC-4.1",
      "CON-SPEC-4.2",
      "CON-SPEC-4.3",
      "CON-SPEC-4.4",
      "CON-SPEC-4.5",
      "CON-SPEC-4.6",
      "CON-SPEC-4.7",
      "CON-SPEC-4.8",
      "CON-SPEC-5.1",
      "CON-SPEC-5.3"
    ],
    "relatedCriticalBehaviors": [
      "RECOVERY_SELL_ECONOMICS",
      "RECOVERY_SELL_MARKET_METADATA_FRESHNESS"
    ],
    "coverageStatus": "TEST-MAPPED",
    "coverageReason": "The recovery SELL planner and fresh-filter tests are mapped; the complete exchange rejection and terminal-order matrix remains a separate application concern."
  }
]

