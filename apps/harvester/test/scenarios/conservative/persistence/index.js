import { createScenarioDefinition } from "../../shared/factories.js"

export const scenarios = [
  createScenarioDefinition({
    id: "CON-PERSIST-001",
    title: "Offline operational-state persistence preserves durable intent and crash-boundary integrity",
    category: "persistence-restart-recovery",
    priority: "P1",
    description: "Cover durable submission intent/outcome records, idempotent fact handling, offline crash-matrix projections, and persistence failure boundaries.",
    tags: ["persistence", "durability", "crash-matrix", "offline"],
    preconditions: [
      "Persistence tests use deterministic local stores and no exchange credentials.",
      "The active runtime's state-restoration boundary is kept distinct from offline projection tests.",
    ],
    initialState: {
      operationalStateStore: "empty or containing durable intent/outcome facts",
      runtimeRestoration: "disabled by the active Conservative contract",
    },
    inputEvents: [
      {
        type: "PERSIST_SUBMISSION_INTENT",
        sequence: 1,
      },
      {
        type: "PERSIST_SUBMISSION_OUTCOME",
        sequence: 2,
      },
      {
        type: "REPLAY_OFFLINE_CRASH_MATRIX",
        sequence: 3,
      },
    ],
    expectedState: {
      durableFacts: "idempotent and validated",
      offlineProjection: "candidateOnly remains true, restorationEnabled remains false, and exchange reconciliation is required before any readiness decision",
      incompleteOrConflictingFacts: "fail closed",
      runtime: "does not infer that offline replay enables process restart restoration",
    },
    expectedSideEffects: {
      exchangeCallDuringPersistenceTest: false,
      inferredRuntimeRestoration: false,
    },
    invariants: [
      "Durable intent and outcome facts are validated independently of exchange side effects.",
      "Offline crash-matrix evidence is not presented as runtime restoration evidence.",
    ],
    relatedRequirements: ["CON-SPEC-6.2"],
    relatedCriticalBehaviors: ["PERSISTENCE_RESTART_SAFETY_BOUNDARY"],
    coverageStatus: "TEST-MAPPED",
    coverageReason: "Offline operational-state and crash-boundary tests are linked; they do not verify runtime state restoration.",
  }),
  createScenarioDefinition({
    id: "CON-PERSIST-002",
    title: "Runtime restart and state restoration remain explicitly unsupported",
    category: "persistence-restart-recovery",
    priority: "P1",
    description: "Record the specification boundary for runtime state reconstruction; startup history validation is separately covered by CON-PERSIST-003.",
    tags: ["restart", "unsupported", "scope-boundary"],
    preconditions: [
      "The active Conservative Domain Specification §7 is authoritative.",
      "Offline operational-state tests are not treated as runtime restart acceptance.",
    ],
    initialState: {
      process: "interrupted or restarted",
      persistedState: "may contain operational facts but is not a supported runtime restoration source",
    },
    inputEvents: [
      {
        type: "PROCESS_RESTART_REQUEST",
        sequence: 1,
      },
    ],
    expectedState: {
      runtimeRestoration: "UNSUPPORTED: no Portfolio, RecoveryLedger, OrderRegistry, or active-order reconstruction/resumption is performed",
      startupSafetyGate: "durable history integrity and prior-session eligibility are checked separately before broker connection",
    },
    expectedSideEffects: {
      inferredTradingReadiness: false,
      automaticOrderResumption: false,
    },
    invariants: [
      "No runtime restoration behavior is inferred from offline persistence tests.",
      "No restart acceptance or exchange operation is introduced by this scenario inventory.",
    ],
    relatedRequirements: ["CON-SPEC-7.1"],
    relatedCriticalBehaviors: [],
    relatedSourceFiles: ["src/use-cases/restore-harvester-operational-state.js"],
    relatedExistingTests: [
      {
        path: "test/recovery/operational-state-crash-matrix.test.js",
        name: "reopens the real append-only ledger across partial/final fills, duplicate delivery, and two unclean process restarts",
        kind: "integration",
      },
      {
        path: "test/recovery/operational-state-crash-matrix.test.js",
        name: "replays a fill that races an uncertain cancellation without losing execution evidence",
        kind: "integration",
      },
      {
        path: "test/recovery/startup-history-gate.test.js",
        name: "keeps default Conservative restart observation-only when prior process history exists",
        kind: "normal",
      },
    ],
    coverageStatus: "TEST-MAPPED",
    coverageReason: "Mapped offline crash/restart tests prove the candidate remains reconciliation-required and runtime restoration remains disabled; they do not reconstruct Portfolio, RecoveryLedger, OrderRegistry, or resume orders.",
  }),
  createScenarioDefinition({
    id: "CON-PERSIST-003",
    title: "Startup history gates prevent Conservative trading resumption after prior process history",
    category: "persistence-restart-recovery",
    priority: "P0",
    description: "Cover default recovery-disabled observation-only restart and the stricter projection/eligibility gate when recovery or Recovery Seller routes are enabled.",
    tags: ["restart-gate", "startup", "safety", "missing-test"],
    preconditions: [
      "The durable Operational State Store is supplied and its integrity verification succeeds.",
      "Prior process history is projected with candidateOnly=true and restorationEnabled=false.",
    ],
    initialState: {
      processHistory: "may contain prior PROCESS_STARTED and PROCESS_STOPPED records",
      stickySafetyBlockers: "may contain account-level recovery STOP state",
    },
    inputEvents: [
      {
        type: "STARTUP_WITH_UNCLEAN_PRIOR_SESSION",
        sequence: 1,
      },
      {
        type: "STARTUP_WITH_TRADING_ENABLED_PRIOR_SESSION",
        sequence: 2,
      },
      {
        type: "STARTUP_WITH_OBSERVATION_ONLY_PRIOR_SESSION",
        sequence: 3,
      },
      {
        type: "STARTUP_WITH_SINGLE_RECOVERY_SELLER_STOP_LATCH",
        sequence: 4,
      },
    ],
    expectedState: {
      priorProcessHistory: "any prior PROCESS_STARTED record forces resolved.tradingEnabled=false",
      recoveryDisabled: "durable history is read and verified; no full projection/clean-stop eligibility check is performed",
      recoveryEnabled: "history is projected; every prior PROCESS_STARTED must have a matching PROCESS_STOPPED, and only observation-only/no-sticky-blocker or the single account-level RECOVERY_SELLER_UNEXPECTED_CONDITION latch is accepted",
      restoration: "candidateOnly remains true and restorationEnabled remains false; Portfolio, RecoveryLedger, and OrderRegistry are not reconstructed",
    },
    expectedSideEffects: {
      brokerConnectBeforeHistoryVerification: false,
      automaticPositionRestoration: false,
      automaticOrderResumption: false,
    },
    invariants: [
      "Unverified or unprojectable operational-state history prevents broker connection.",
      "Any prior process history disables trading on restart, including the default recovery-disabled Conservative configuration.",
      "When recovery is enabled, every prior PROCESS_STARTED session must have a matching PROCESS_STOPPED record and pass the projected eligibility gate.",
      "Startup eligibility does not enable runtime state restoration.",
    ],
    relatedRequirements: ["CON-SPEC-7.1", "CON-RUNTIME-5"],
    relatedCriticalBehaviors: [],
    relatedSourceFiles: [
      "src/bootstrap/start-harvester.js",
      "src/infrastructure/operational-state/project-harvester.js",
    ],
    relatedExistingTests: [
      {
        path: "test/recovery/startup-history-gate.test.js",
        name: "keeps default Conservative restart observation-only when prior process history exists",
        kind: "normal",
      },
      {
        path: "test/recovery/startup-history-gate.test.js",
        name: "rejects recovery-enabled restart before broker connection when prior process session is unclean",
        kind: "failure",
      },
      {
        path: "test/recovery/startup-history-gate.test.js",
        name: "allows a clean observation-only restart without enabling trading",
        kind: "normal",
      },
      {
        path: "src/bootstrap/start-harvester.test.js",
        name: "restores a persisted RS STOP and keeps a restarted runtime observation-only",
        kind: "normal",
      },
    ],
    coverageStatus: "TEST-MAPPED",
    coverageReason: "Mapped tests prove default recovery-disabled observation-only restart, rejection of unclean recovery-enabled history before broker connection, acceptance of a clean observation-only session, and restoration of one durable account-level RS STOP latch. Runtime state restoration remains disabled and the remaining Step 8/9 acceptance gates remain open.",
  }),
]
