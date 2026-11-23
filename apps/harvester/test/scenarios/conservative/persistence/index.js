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
]
