export const CG_CONSERVATIVE_SCENARIO_DETAILS_PART_THREE = [
  {
    "id": "CON-FILTER-001",
    "title": "Recovery SELL planning uses fresh filters and exact exchange precision boundaries",
    "category": "precision-exchange-filters",
    "priority": "P1",
    "description": "Cover tick/step precision, minimum quantity/notional, maximum quantity/notional, filter freshness, and rejection of non-executable residuals.",
    "tags": [
      "precision",
      "filters",
      "min-notional",
      "tick-size",
      "step-size"
    ],
    "preconditions": [
      "The latest exchange filters belong to the exact market being evaluated.",
      "Filter metadata is refreshed within the active freshness window."
    ],
    "initialState": {
      "marketFilters": "fresh and complete",
      "recoveryPosition": "may contain a residual near exchange minimums"
    },
    "inputEvents": [
      {
        "type": "REFRESH_MARKET_FILTERS",
        "sequence": 1
      },
      {
        "type": "CALCULATE_RECOVERY_SELL",
        "sequence": 2
      },
      {
        "type": "FILTER_BOUNDARY_CHECK",
        "sequence": 3
      }
    ],
    "expectedState": {
      "quantity": "rounded down to valid step size",
      "price": "rounded up to valid tick size",
      "residual": "not submitted when minimum quantity or notional is not met",
      "maximumFilters": "MAX_QUANTITY and MAX_NOTIONAL cap each order and leave remaining inventory for later sell-through",
      "refreshPolicy": "refreshes stale/missing filters before recovery evaluation, skips refresh while a recovery SELL is active, and forces a fresh preflight before trailing BUY replacement"
    },
    "expectedOrders": [
      {
        "side": "SELL",
        "purpose": "RECOVERY_SELL",
        "condition": "all current exchange filters pass"
      }
    ],
    "expectedSideEffects": {
      "staleFilterSubmission": false,
      "invalidQuantityOrPriceSubmission": false
    },
    "invariants": [
      "Decimal quantities and prices are not converted through binary floating point.",
      "Recovery SELL filters are checked against current market metadata.",
      "An untradeable residual is retained rather than rounded into an invalid order.",
      "A quantity or notional maximum does not silently discard the remaining sellable inventory."
    ],
    "relatedRequirements": [
      "CON-SPEC-4.5",
      "CON-SPEC-4.8"
    ],
    "relatedCriticalBehaviors": [
      "RECOVERY_SELL_MARKET_METADATA_FRESHNESS",
      "RECOVERY_SELL_ECONOMICS"
    ],
    "coverageStatus": "TEST-MAPPED",
    "coverageReason": "Recovery SELL precision and fresh-filter tests are linked; all exchange filter combinations remain a broader matrix."
  },
  {
    "id": "CON-MARKET-001",
    "title": "Stale or changed market data cannot authorize a stale Conservative order",
    "category": "market-conditions",
    "priority": "P1",
    "description": "Cover stale market snapshots, changing prices, residual sell-through market reference, and fresh metadata requirements before recovery SELL planning.",
    "tags": [
      "market-data",
      "staleness",
      "price-change",
      "filters"
    ],
    "preconditions": [
      "Market timestamps and exchange metadata freshness are available to the evaluator.",
      "The current market price is distinguished from a prior BUY or recovery reference price."
    ],
    "initialState": {
      "marketData": "fresh, stale, or changed since the previous evaluation",
      "recoveryPosition": "may have secured required net proceeds with a residual balance"
    },
    "inputEvents": [
      {
        "type": "MARKET_PRICE_CHANGE",
        "sequence": 1
      },
      {
        "type": "STALE_MARKET_SNAPSHOT",
        "sequence": 2
      },
      {
        "type": "RECOVERY_SELL_REEVALUATION",
        "sequence": 3
      }
    ],
    "expectedState": {
      "staleSnapshot": "does not authorize a new order",
      "residualSellThrough": "uses the current market reference when required recovery proceeds are already secured",
      "filters": "must remain fresh for the exact market"
    },
    "expectedSideEffects": {
      "orderFromStaleSnapshot": false,
      "staleFilterReuse": false
    },
    "invariants": [
      "A stale market snapshot cannot authorize a new order.",
      "A price change is evaluated against the correct strategy reference.",
      "Residual sell-through does not reuse a stale recovery target price."
    ],
    "relatedRequirements": [
      "CON-SPEC-4.6",
      "CON-SPEC-8.1"
    ],
    "relatedCriticalBehaviors": [
      "RECOVERY_SELL_MARKET_METADATA_FRESHNESS",
      "STRATEGY_BUY_SELL_SAFETY_GATES"
    ],
    "coverageStatus": "TEST-MAPPED",
    "coverageReason": "Fresh metadata and strategy gate tests are linked; all stale-market timing and boundary cases remain under review."
  },
  {
    "id": "CON-FILL-001",
    "title": "Partial and repeated fills change inventory only by accepted execution facts",
    "category": "partial-fills",
    "priority": "P0",
    "description": "Cover partial BUY/SELL fills, multiple fills at different prices, duplicate delivery, conflicting execution identity, and out-of-order order updates.",
    "tags": [
      "fills",
      "partial-fill",
      "idempotency",
      "event-order"
    ],
    "preconditions": [
      "Canonical Fill identity, market, side, quantity, price, and commission facts are normalized.",
      "The target Portfolio and order belong to the Conservative strategy and expected market."
    ],
    "initialState": {
      "portfolio": "known accepted fill set",
      "order": "partially filled or terminal",
      "eventStream": "may contain duplicate or reordered delivery"
    },
    "inputEvents": [
      {
        "type": "PARTIAL_FILL",
        "sequence": 1
      },
      {
        "type": "DUPLICATE_FILL",
        "sequence": 2
      },
      {
        "type": "CONFLICTING_FILL_IDENTITY",
        "sequence": 3
      },
      {
        "type": "STALE_ORDER_UPDATE",
        "sequence": 4
      }
    ],
    "expectedState": {
      "acceptedFillSet": "each execution identity is applied at most once",
      "conflictingIdentity": "rejected without mutating accepted accounting",
      "orderLifecycle": "terminal state cannot regress to executable state"
    },
    "expectedAccounting": {
      "quantity": "sum of accepted net base deltas only",
      "quoteBasisOrProceeds": "sum of accepted exact fill notionals and actual commission deltas"
    },
    "expectedSideEffects": {
      "duplicateAccounting": false,
      "staleLifecycleRegression": false,
      "partialProjectionMutationOnConflict": false
    },
    "invariants": [
      "A fill is never accounted for twice.",
      "Same execution identity with different economic payload is rejected.",
      "A completed order cannot become executable again."
    ],
    "relatedRequirements": [
      "CON-SPEC-2.2",
      "CON-SPEC-3.3",
      "CON-SPEC-5.1",
      "CON-SPEC-6.3"
    ],
    "relatedCriticalBehaviors": [
      "FILL_IDENTITY_DEDUPLICATION",
      "PORTFOLIO_RECOVERY_LEDGER_ALIGNMENT",
      "ORDER_IDENTITY_TRANSITIONS"
    ],
    "coverageStatus": "TEST-MAPPED",
    "coverageReason": "Canonical fill identity and order transition tests are linked; broader delayed/missing evidence permutations remain tracked in the parent matrix."
  },
  {
    "id": "CON-PERSIST-001",
    "title": "Offline operational-state persistence preserves durable intent and crash-boundary integrity",
    "category": "persistence-restart-recovery",
    "priority": "P1",
    "description": "Cover durable submission intent/outcome records, idempotent fact handling, offline crash-matrix projections, and persistence failure boundaries.",
    "tags": [
      "persistence",
      "durability",
      "crash-matrix",
      "offline"
    ],
    "preconditions": [
      "Persistence tests use deterministic local stores and no exchange credentials.",
      "The active runtime's state-restoration boundary is kept distinct from offline projection tests."
    ],
    "initialState": {
      "operationalStateStore": "empty or containing durable intent/outcome facts",
      "runtimeRestoration": "disabled by the active Conservative contract"
    },
    "inputEvents": [
      {
        "type": "PERSIST_SUBMISSION_INTENT",
        "sequence": 1
      },
      {
        "type": "PERSIST_SUBMISSION_OUTCOME",
        "sequence": 2
      },
      {
        "type": "REPLAY_OFFLINE_CRASH_MATRIX",
        "sequence": 3
      }
    ],
    "expectedState": {
      "durableFacts": "idempotent and validated",
      "offlineProjection": "candidateOnly remains true, restorationEnabled remains false, and exchange reconciliation is required before any readiness decision",
      "incompleteOrConflictingFacts": "fail closed",
      "runtime": "does not infer that offline replay enables process restart restoration"
    },
    "expectedSideEffects": {
      "exchangeCallDuringPersistenceTest": false,
      "inferredRuntimeRestoration": false
    },
    "invariants": [
      "Durable intent and outcome facts are validated independently of exchange side effects.",
      "Offline crash-matrix evidence is not presented as runtime restoration evidence."
    ],
    "relatedRequirements": [
      "CON-SPEC-6.2"
    ],
    "relatedCriticalBehaviors": [
      "PERSISTENCE_RESTART_SAFETY_BOUNDARY"
    ],
    "coverageStatus": "TEST-MAPPED",
    "coverageReason": "Offline operational-state and crash-boundary tests are linked; they do not verify runtime state restoration."
  },
  {
    "id": "CON-PERSIST-002",
    "title": "Runtime restart and state restoration remain explicitly unsupported",
    "category": "persistence-restart-recovery",
    "priority": "P1",
    "description": "Record the specification boundary for runtime state reconstruction; startup history validation is separately covered by CON-PERSIST-003.",
    "tags": [
      "restart",
      "unsupported",
      "scope-boundary"
    ],
    "preconditions": [
      "The active Conservative Domain Specification §7 is authoritative.",
      "Offline operational-state tests are not treated as runtime restart acceptance."
    ],
    "initialState": {
      "process": "interrupted or restarted",
      "persistedState": "may contain operational facts but is not a supported runtime restoration source"
    },
    "inputEvents": [
      {
        "type": "PROCESS_RESTART_REQUEST",
        "sequence": 1
      }
    ],
    "expectedState": {
      "runtimeRestoration": "UNSUPPORTED: no Portfolio, RecoveryLedger, OrderRegistry, or active-order reconstruction/resumption is performed",
      "startupSafetyGate": "when recovery is disabled, current-session readiness comes only from fresh PREFLIGHT and current-process user-data; prior-session orders/fills remain external"
    },
    "expectedSideEffects": {
      "inferredTradingReadiness": false,
      "currentSessionReadinessFromFreshPreflight": true,
      "automaticOrderResumption": false
    },
    "invariants": [
      "No runtime restoration behavior is inferred from offline persistence tests.",
      "A fresh current process never adopts prior-session Portfolio, RecoveryLedger, OrderRegistry, order, or fill state.",
      "Current-session trading requires its own successful PREFLIGHT and current-process user-data readiness.",
      "No restart acceptance or exchange operation is introduced by this scenario inventory."
    ],
    "relatedRequirements": [
      "CON-SPEC-7.1"
    ],
    "relatedCriticalBehaviors": [],
    "relatedSourceFiles": [
      "src/use-cases/restore-harvester-operational-state.js",
      "src/bootstrap/start-harvester.js",
      "src/application/operator/create-harvester-readiness-report.js"
    ],
    "coverageStatus": "TEST-MAPPED",
    "coverageReason": "Mapped offline crash/restart tests prove the candidate remains reconciliation-required and runtime restoration remains disabled; startup tests separately prove that a fresh process derives readiness from its own PREFLIGHT while prior-session orders/fills remain external.",
    "relatedExistingTests": [
      {
        "path": "test/recovery/operational-state-crash-matrix.test.js",
        "name": "reopens the real append-only ledger across partial/final fills, duplicate delivery, and two unclean process restarts",
        "kind": "integration"
      },
      {
        "path": "test/recovery/operational-state-crash-matrix.test.js",
        "name": "replays a fill that races an uncertain cancellation without losing execution evidence",
        "kind": "integration"
      },
      {
        "path": "test/recovery/startup-history-gate.test.js",
        "name": "starts fresh current-session trading after prior process history when recovery is disabled",
        "kind": "normal"
      }
    ]
  },
  {
    "id": "CON-PERSIST-003",
    "title": "Startup history isolates prior-session state while allowing fresh current-session trading",
    "category": "persistence-restart-recovery",
    "priority": "P0",
    "description": "Cover recovery-disabled fresh-session startup after prior process history, strict recovery-enabled history eligibility, and strategy-scoped RS STOP/account safety blockers.",
    "tags": [
      "restart-gate",
      "startup",
      "current-session-only",
      "safety"
    ],
    "preconditions": [
      "The durable Operational State Store is supplied when required (including RS durable STOP) and its integrity verification succeeds.",
      "Fresh current-session account PREFLIGHT and user-data readiness are required before trading.",
      "Prior process state is never projected into the new process Portfolio, RecoveryLedger, or OrderRegistry."
    ],
    "initialState": {
      "processHistory": "may contain prior PROCESS_STARTED and PROCESS_STOPPED records",
      "stickySafetyBlockers": "may contain account-level safety blockers or a strategy-scoped RS STOP latch"
    },
    "inputEvents": [
      {
        "type": "STARTUP_WITH_CLEAN_PRIOR_SESSION_RECOVERY_DISABLED",
        "sequence": 1
      },
      {
        "type": "STARTUP_WITH_UNCLEAN_PRIOR_SESSION_RECOVERY_DISABLED",
        "sequence": 2
      },
      {
        "type": "STARTUP_WITH_UNCLEAN_PRIOR_SESSION_RECOVERY_ENABLED",
        "sequence": 3
      },
      {
        "type": "STARTUP_WITH_PERSISTED_RS_STOP_LATCH",
        "sequence": 4
      },
      {
        "type": "STARTUP_WITH_UNRESOLVED_ACCOUNT_SAFETY_BLOCKER",
        "sequence": 5
      }
    ],
    "expectedState": {
      "priorProcessHistory": "when recovery is disabled, prior PROCESS_STARTED history does not restore prior state or globally disable a fresh process; trading eligibility is derived from new PREFLIGHT and current-process user-data readiness",
      "recoveryDisabled": "no history sync or full process projection occurs; prior-session orders/fills remain external; a retained store may still be verified for RS STOP and unresolved ACCOUNT safety blockers",
      "recoveryEnabled": "history eligibility remains strict; every prior PROCESS_STARTED must have a matching PROCESS_STOPPED, and accepted restarts remain observation-only while runtime restoration is unsupported",
      "recoverySellerStop": "when process recovery is disabled, a durable RS STOP remains strategy-scoped and blocks RS investment BUY admission without globally disabling unrelated current-session routes; recovery SELL admission remains allowed; when recovery is enabled, the prior-process observation-only gate still applies",
      "accountSafety": "unresolved ACCOUNT safety blockers remain startup blockers",
      "restoration": "candidateOnly remains true and restorationEnabled remains false; Portfolio, RecoveryLedger, and OrderRegistry are not reconstructed"
    },
    "expectedOrders": [],
    "expectedAccounting": {},
    "expectedSideEffects": {
      "brokerConnectBeforeHistoryVerification": false,
      "automaticPositionRestoration": false,
      "automaticOrderResumption": false,
      "priorSessionOrderAdoption": false,
      "priorSessionFillAdoption": false,
      "processHistorySync": false
    },
    "invariants": [
      "Unverified operational-state store integrity prevents broker connection; when recovery is enabled, unprojectable process history also prevents broker connection.",
      "Prior-session orders and fills remain external and are never adopted, cancelled, managed, or replayed by the new process.",
      "When recovery is disabled, a prior PROCESS_STARTED fact alone does not globally disable fresh current-session trading.",
      "Fresh account PREFLIGHT and current-process user-data readiness are mandatory before the new process can trade.",
      "When recovery is enabled, every prior PROCESS_STARTED session must have a matching PROCESS_STOPPED record and pass the projected eligibility gate.",
      "With process recovery disabled, a persisted RS STOP remains strategy-scoped; it does not globally pause unrelated current-session routes.",
      "Unresolved ACCOUNT safety blockers and configured per-market BLOCK policy remain fail-closed.",
      "Startup eligibility never enables runtime Portfolio, RecoveryLedger, or OrderRegistry restoration."
    ],
    "relatedRequirements": [
      "CON-SPEC-7.1",
      "CON-RUNTIME-5"
    ],
    "relatedCriticalBehaviors": [],
    "relatedSourceFiles": [
      "src/bootstrap/start-harvester.js",
      "src/application/operator/create-harvester-readiness-report.js",
      "src/bootstrap/subscriptions/subscribe-to-market-data.js",
      "src/infrastructure/operational-state/project-harvester.js"
    ],
    "coverageStatus": "TEST-MAPPED",
    "coverageReason": "Mapped tests prove that recovery-disabled restarts create a fresh current-process session after PREFLIGHT, prior-session orders/fills remain external, recovery-enabled unclean history remains blocked, clean recovery-enabled restart remains observation-only, the durable account-level RS STOP latch: RS STOP stays strategy-scoped, and unresolved ACCOUNT blockers remain fail-closed. Runtime state restoration remains disabled.",
    "relatedExistingTests": [
      {
        "path": "test/recovery/startup-history-gate.test.js",
        "name": "starts fresh current-session trading after prior process history when recovery is disabled",
        "kind": "normal"
      },
      {
        "path": "test/recovery/startup-history-gate.test.js",
        "name": "rejects recovery-enabled restart before broker connection when prior process session is unclean",
        "kind": "failure"
      },
      {
        "path": "test/recovery/startup-history-gate.test.js",
        "name": "allows a clean observation-only restart without enabling trading",
        "kind": "normal"
      },
      {
        "path": "src/bootstrap/start-harvester.test.js",
        "name": "starts a fresh current-process trading session when process recovery is disabled despite prior process history",
        "kind": "integration"
      },
      {
        "path": "src/bootstrap/start-harvester.test.js",
        "name": "keeps persisted RS STOP strategy-scoped when CG process recovery is disabled",
        "kind": "normal"
      },
      {
        "path": "src/bootstrap/start-harvester.test.js",
        "name": "restores a persisted RS STOP and keeps a restarted runtime observation-only",
        "kind": "normal"
      },
      {
        "path": "test/bootstrap/process-lifecycle-recovery.test.js",
        "name": "starts a fresh current-session runtime after a clean prior process when restart recovery is disabled",
        "kind": "normal"
      },
      {
        "path": "test/bootstrap/process-lifecycle-recovery.test.js",
        "name": "starts a fresh current-session runtime after an unclean prior process when restart recovery is disabled",
        "kind": "normal"
      }
    ]
  }
]

