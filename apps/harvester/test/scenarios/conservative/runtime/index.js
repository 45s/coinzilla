import { createScenarioDefinition } from "../../shared/factories.js"

export const scenarios = [
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
      {
        type: "STARTUP_PREFLIGHT",
        sequence: 1,
      },
      {
        type: "USER_DATA_DISCONNECT",
        sequence: 2,
      },
      {
        type: "RECONNECT_AND_DRAIN_EVENTS",
        sequence: 3,
      },
      {
        type: "CLOSING_ACCOUNT_AUDIT",
        sequence: 4,
      },
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
