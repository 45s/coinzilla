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
      { type: "PERSIST_SUBMISSION_INTENT", sequence: 1 },
      { type: "PERSIST_SUBMISSION_OUTCOME", sequence: 2 },
      { type: "REPLAY_OFFLINE_CRASH_MATRIX", sequence: 3 },
    ],
    expectedState: {
      durableFacts: "idempotent and validated",
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
    description: "Record the current specification boundary for process interruption and runtime reconstruction without inventing restart semantics.",
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
      { type: "PROCESS_RESTART_REQUEST", sequence: 1 },
    ],
    expectedState: {
      runtimeRestoration: "UNSUPPORTED until the separate restart acceptance gates are approved",
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
    coverageStatus: "UNSUPPORTED",
    coverageReason: "The active Conservative specification explicitly excludes runtime state reconstruction; separate acceptance gates remain tracked by #654.",
  }),
  createScenarioDefinition({
    id: "CON-RUNTIME-001",
    title: "Coordinator startup, account readiness, reconnect, and shutdown preserve Conservative ownership",
    category: "runtime-coordinator-integration",
    priority: "P1",
    description: "Cover startup account reconciliation, user-data disconnect recovery, multi-market account commitments, closing-account open-order audit, and lifecycle coordination.",
    tags: ["runtime", "coordinator", "startup", "reconnect", "multi-market"],
    preconditions: [
      "Broker and persistence ports are deterministic offline test doubles.",
      "The coordinator owns the order and account lifecycle for each configured market.",
    ],
    initialState: {
      runtime: "starting, ready, reconnecting, or shutting down",
      account: "may contain balances and open orders across markets",
      userData: "connected or disconnected",
    },
    inputEvents: [
      { type: "STARTUP_PREFLIGHT", sequence: 1 },
      { type: "USER_DATA_DISCONNECT", sequence: 2 },
      { type: "RECONNECT_AND_DRAIN_EVENTS", sequence: 3 },
      { type: "CLOSING_ACCOUNT_AUDIT", sequence: 4 },
    ],
    expectedState: {
      readiness: "trading is gated until account and event evidence is authoritative",
      reconnect: "event draining and reconciliation complete before readiness resumes",
      multiMarket: "shared account commitments remain consistent",
    },
    expectedSideEffects: {
      tradingBeforeReadiness: false,
      externalOrderAdoption: false,
      crossMarketOverspend: false,
    },
    invariants: [
      "Startup and reconnect readiness require authoritative account and order evidence.",
      "Cross-market reservations and commitments reconcile at the account level.",
      "The coordinator does not adopt or cancel external orders as Conservative-owned orders.",
    ],
    relatedRequirements: ["CON-RUNTIME-1", "CON-RUNTIME-2", "CON-RUNTIME-3", "CON-RUNTIME-4"],
    relatedCriticalBehaviors: [
      "STARTUP_ACCOUNT_RECONCILIATION",
      "USER_DATA_DISCONNECT_RECOVERY",
      "ACCOUNT_COMMITMENT_ALLOCATION",
      "CLOSING_ACCOUNT_OPEN_ORDER_AUDIT",
    ],
    coverageStatus: "TEST-MAPPED",
    coverageReason: "Startup, reconnect, account allocation, and ownership tests are linked; full end-to-end Conservative coordinator coverage remains under review.",
  }),
]
