export const CG_CONSERVATIVE_SCENARIO_DETAILS_PART_ONE = [
  {
    "id": "CON-ACCOUNTING-001",
    "title": "Portfolio and RecoveryLedger reconcile exact cost, proceeds, fees, and realized PnL",
    "category": "accounting-pnl",
    "priority": "P0",
    "description": "Cover multiple fills at different prices, partial-fill accounting, exact quote cost/proceeds, realized profit, remaining inventory, and ledger-to-position alignment.",
    "tags": [
      "accounting",
      "pnl",
      "decimal",
      "portfolio"
    ],
    "preconditions": [
      "Only canonical fills and actual commission facts are used as accounting inputs.",
      "Position.spent is the authoritative quote-cost basis; RecoveryLedger.buyCost is a compatibility mirror."
    ],
    "initialState": {
      "position": "empty or holding previously accepted inventory",
      "recoveryLedger": "zero or previously confirmed cycle proceeds"
    },
    "inputEvents": [
      {
        "type": "BUY_FILL",
        "sequence": 1
      },
      {
        "type": "BUY_FILL_AT_DIFFERENT_PRICE",
        "sequence": 2
      },
      {
        "type": "PARTIAL_SELL_FILL",
        "sequence": 3
      }
    ],
    "expectedState": {
      "portfolio": "base quantity and quote basis reflect accepted fills",
      "recoveryLedger": "confirmed net proceeds and cycle state align with Portfolio"
    },
    "expectedAccounting": {
      "buyCost": "exact sum of gross quote notional and quote-equivalent commission",
      "netSellProceeds": "exact gross quote notional less actual quote-equivalent commission",
      "realizedPnl": "confirmed net proceeds less the corresponding authoritative cost basis",
      "remainingInventory": "only unsold net base remains"
    },
    "expectedSideEffects": {
      "floatingPointFinancialOracle": false,
      "requestedQuantitySubstitutedForFills": false
    },
    "invariants": [
      "All financial values use exact decimal arithmetic.",
      "Portfolio and RecoveryLedger projections remain aligned after every accepted fill.",
      "Realized PnL uses actual net execution proceeds, not requested price or estimated fee."
    ],
    "relatedRequirements": [
      "CON-SPEC-2.1",
      "CON-SPEC-2.2"
    ],
    "relatedCriticalBehaviors": [
      "EXACT_FINANCIAL_ACCOUNTING",
      "PORTFOLIO_RECOVERY_LEDGER_ALIGNMENT"
    ],
    "coverageStatus": "TEST-MAPPED",
    "coverageReason": "Exact accounting and projection-alignment tests are linked; every fee asset and cycle boundary still requires separate evidence review."
  },
  {
    "id": "CON-BALANCE-001",
    "title": "Account-wide reservations and strategy-owned inventory prevent overspending or external-order adoption",
    "category": "balance-inventory",
    "priority": "P0",
    "description": "Cover free versus reserved balances, cross-market quote commitments, base inventory allocation, startup open-order reconciliation, and closing-account ownership.",
    "tags": [
      "balance",
      "reservation",
      "inventory",
      "ownership",
      "multi-market"
    ],
    "preconditions": [
      "Account balances and open orders are sourced from the authoritative account snapshot.",
      "Order ownership is established by the current process and its canonical order registry."
    ],
    "initialState": {
      "account": "multiple markets may hold quote/base commitments",
      "openOrders": "include current-process-owned and external orders",
      "portfolio": "contains strategy-owned inventory only"
    },
    "inputEvents": [
      {
        "type": "ACCOUNT_SNAPSHOT",
        "sequence": 1
      },
      {
        "type": "ALLOCATE_ORDER_COMMITMENTS",
        "sequence": 2
      },
      {
        "type": "STARTUP_OPEN_ORDER_RECONCILIATION",
        "sequence": 3
      }
    ],
    "expectedState": {
      "availableBalances": "subtract all applicable reservations and commitments",
      "strategyInventory": "does not adopt unrelated external inventory",
      "startup": "blocks trading when account evidence is incomplete or conflicting"
    },
    "expectedSideEffects": {
      "overspendAcrossMarkets": false,
      "externalOrderCancellationOrAdoption": false
    },
    "invariants": [
      "Account-wide quote and base commitments reconcile across markets.",
      "Free balance is not treated as available when already reserved.",
      "Only orders owned by the current process are eligible for strategy cancellation."
    ],
    "relatedRequirements": [
      "CON-SPEC-3.7",
      "CON-RUNTIME-3",
      "CON-RUNTIME-4"
    ],
    "relatedCriticalBehaviors": [
      "ACCOUNT_COMMITMENT_ALLOCATION",
      "STARTUP_ACCOUNT_RECONCILIATION",
      "CLOSING_ACCOUNT_OPEN_ORDER_AUDIT"
    ],
    "coverageStatus": "TEST-MAPPED",
    "coverageReason": "Account commitment and startup ownership tests are linked; account-level integration combinations remain subject to review."
  },
  {
    "id": "CON-BUY-001",
    "title": "A completed BUY keeps BUY admission closed until the recovery cycle is fully reconciled",
    "category": "buy-lifecycle",
    "priority": "P0",
    "description": "Cover initial BUY creation, partial and complete fills, recovery SELL reconciliation, retained-inventory disposition, recovery-basis reset, and next-cycle BUY admission. A SELL acknowledgement alone never opens the BUY gate.",
    "tags": [
      "buy",
      "order-lifecycle",
      "recovery-cycle",
      "reconciliation",
      "partial-fill"
    ],
    "preconditions": [
      "The Conservative pair is enabled and account commitments permit the requested BUY.",
      "The initial position is empty and no prior recovery cycle remains unresolved."
    ],
    "initialState": {
      "position": "empty",
      "activeOrders": [],
      "orderSubmission": "idle"
    },
    "inputEvents": [
      {
        "type": "BUY_DECISION",
        "sequence": 1
      },
      {
        "type": "BUY_PARTIAL_FILL",
        "sequence": 2
      },
      {
        "type": "BUY_COMPLETE_FILL",
        "sequence": 3
      },
      {
        "type": "RECOVERY_SELL_SUBMISSION",
        "sequence": 4
      },
      {
        "type": "RECOVERY_SELL_ACKNOWLEDGED",
        "sequence": 5
      },
      {
        "type": "RECOVERY_SELL_PARTIAL_FILL",
        "sequence": 6
      },
      {
        "type": "RECOVERY_SELL_COMPLETE_FILL",
        "sequence": 7
      },
      {
        "type": "RECOVERY_CYCLE_COMPLETION_RECONCILED",
        "sequence": 8
      },
      {
        "type": "NEXT_BUY_DECISION",
        "sequence": 9
      }
    ],
    "expectedState": {
      "partialBuy": "updates actual quantity and quote basis without advancing or completing the recovery cycle",
      "completedBuy": "establishes the active recovery Position and RecoveryLedger basis; it does not authorize another BUY",
      "recoverySell": "remains the only new order intent while the recovery cycle is unresolved",
      "buyAdmission": "remains closed through SELL acknowledgement, partial fills, terminal status, and proceeds recovery",
      "cycleCompletion": "requires complete terminal SELL fill and commission reconciliation, retained-inventory/dust disposition, and Position/RecoveryLedger basis reset",
      "nextCycle": "a new standing BUY is admitted only after the prior recovery cycle is fully completed and reset",
      "submission": "unknown outcomes remain blocked and are not blindly retried"
    },
    "expectedOrders": [
      {
        "side": "BUY",
        "purpose": "STANDING_BUY",
        "condition": "initial entry gates pass and no recovery cycle is unresolved"
      },
      {
        "side": "SELL",
        "purpose": "RECOVERY_SELL",
        "condition": "created and maintained from reconciled filled inventory"
      },
      {
        "side": "BUY",
        "purpose": "STANDING_BUY",
        "condition": "submitted only after full recovery-cycle completion and Position/RecoveryLedger basis reset"
      }
    ],
    "expectedAccounting": {
      "source": "actual canonical BUY/SELL fills and commission facts",
      "estimatedOrRequestedQuantity": "never substituted for executed quantity",
      "cycleCompletion": "not inferred from SELL acknowledgement or cost recovery alone"
    },
    "expectedSideEffects": {
      "newBuyBeforeCycleCompletion": false,
      "nextBuyBeforeRecoverySellAcknowledgement": false,
      "buyGateRemainsClosedAfterRecoverySellAcknowledgement": true,
      "duplicateSubmissionAfterUnknownOutcome": false,
      "nextBuyAfterCycleReset": true
    },
    "invariants": [
      "Partial BUY and SELL fills are accounted for exactly once.",
      "A new standing BUY is not submitted while Position recovery inventory, recovery basis, RecoveryLedger cycle totals, or an owned active recovery SELL reservation remains.",
      "PENDING, UNKNOWN, OPEN, and PARTIALLY_FILLED recovery SELL states do not release BUY admission.",
      "An acknowledged or terminal recovery SELL does not by itself complete the cycle.",
      "The next standing BUY is admitted only after complete fill/commission reconciliation, retained-inventory disposition, and Position/RecoveryLedger basis reset."
    ],
    "relatedRequirements": [
      "CON-SPEC-3.1",
      "CON-SPEC-3.3",
      "CON-SPEC-3.4",
      "CON-SPEC-3.5",
      "CON-SPEC-3.6",
      "CON-SPEC-3.8"
    ],
    "relatedCriticalBehaviors": [
      "STRATEGY_BUY_SELL_SAFETY_GATES",
      "ORDER_SUBMISSION_UNKNOWN",
      "ORDER_IDENTITY_TRANSITIONS",
      "PORTFOLIO_RECOVERY_LEDGER_ALIGNMENT",
      "RECOVERY_SELL_ECONOMICS"
    ],
    "coverageStatus": "TEST-MAPPED",
    "coverageReason": "Strategy, final submission-gate, engine, replay, and recovery-completion tests are mapped; exact-head verification is pending."
  },
  {
    "id": "CON-CONFIG-001",
    "title": "Invalid Conservative pair configuration fails before trading side effects",
    "category": "configuration",
    "priority": "P1",
    "description": "Cover missing or invalid pair configuration, strategy mode, minProfit threshold, order quantity, and inconsistent market configuration.",
    "tags": [
      "configuration",
      "validation",
      "fail-closed"
    ],
    "preconditions": [
      "Configuration is loaded before any order submission or account mutation.",
      "The active pair uses the Conservative strategy-specific contract."
    ],
    "initialState": {
      "configuration": "may contain invalid or incomplete Conservative values",
      "broker": "offline and not called during validation"
    },
    "inputEvents": [
      {
        "type": "LOAD_PAIR_CONFIGURATION",
        "sequence": 1
      },
      {
        "type": "VALIDATE_CONSERVATIVE_CONFIGURATION",
        "sequence": 2
      }
    ],
    "expectedState": {
      "invalidConfiguration": "rejected with an actionable validation error",
      "validConfiguration": "normalized and available to the strategy"
    },
    "expectedSideEffects": {
      "brokerCallsOnInvalidConfiguration": false,
      "partialRuntimeInitialization": false
    },
    "invariants": [
      "Configuration validation occurs before exchange or trading side effects.",
      "Conservative-specific settings are not silently replaced by generic strategy defaults."
    ],
    "relatedRequirements": [
      "CON-CONFIG-1"
    ],
    "relatedCriticalBehaviors": [],
    "relatedSourceFiles": [
      "config/strategies/cg-coin-grabber.js",
      "src/bootstrap/config/resolve-harvester-options.js"
    ],
    "coverageStatus": "PARTIAL",
    "coverageReason": "Existing tests cover strategy enablement, execution-route selection, and TRADING_MODE validation. Conservative pair-specific financial constraints such as minProfit, keepQuantity, and quantity configuration are not comprehensively validated at configuration load."
  }
]
