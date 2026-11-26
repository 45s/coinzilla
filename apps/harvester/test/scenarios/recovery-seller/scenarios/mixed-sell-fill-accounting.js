import { defineRecoverySellerScenario } from "../registry/define-scenario.js"

const testFile = "apps/harvester/test/scenarios/recovery-seller/mixed-sell-fill-allocation.scenario.test.js"
const multiFillTestTitle = "RS-006-003-A: multiple partial SELL fills are accumulated and reconciled exactly"
const replayTestTitle = "RS-006-003-B: duplicate terminal mixed-SELL replay is an exact no-op"

export const recoverySellerMixedSellFillAccountingScenarios = Object.freeze([
  defineRecoverySellerScenario({
    id: "RS-006-003",
    family: "RS-006",
    name: "multiple canonical partial SELL fills are accumulated into one exact atomic recovery/legacy accounting commit",
    priority: "P0",
    authority: [
      "apps/harvester/docs/domain/recovery-seller-scenario-testing.md#rs-006--exact-once-mixed-sell-accounting-and-atomicity-p0",
      "issue-1780: RS-006 required cases 3 and 13",
    ],
    layer: "APPLICATION",
    configFields: [],
    covers: {
      rules: ["RS_CANONICAL_FILL_EXACT_ONCE", "RS_MIXED_ALLOCATION_CONSERVATION", "RS_DUAL_PROJECTION_ATOMICITY"],
      decisions: [],
      states: [],
      transitions: [],
      invariants: ["RS_EXACT_ONCE", "RS_DUAL_PROJECTION_ATOMICITY", "RS_QUANTITY_CONSERVATION"],
    },
    given: {
      order: {
        side: "SELL",
        originalQuantity: "5.01",
        strategyId: "RS",
        purpose: "RECOVERY_SELL",
      },
      partialFills: [
        {
          tradeId: "rs-multi-fill-sell-trade-1",
          quantity: "2.5",
          quoteQuantity: "5.25",
          quoteCommission: "0.001",
        },
        {
          tradeId: "rs-multi-fill-sell-trade-2",
          quantity: "2.51",
          quoteQuantity: "5.271",
          quoteCommission: "0.002",
        },
      ],
      allocations: {
        recoveryQuantity: "5",
        legacyQuantity: "0.01",
      },
    },
    when: [{
      type: "reconcile-terminal-mixed-sell-with-complete-canonical-partial-fill-history",
      inputKey: "partialFills",
    }],
    then: {
      applied: true,
      canonicalFillCount: 2,
      recoveryBaseDebit: "5",
      legacyBaseDebit: "0.01",
      totalNetQuoteProceeds: "10.518",
      profitabilityEligible: true,
      sellReservationReleasedAfterCommit: true,
    },
    mustNot: [
      "commit only the first partial Fill",
      "apply either accounting projection before the complete Fill set is reconciled",
      "release the sole SELL reservation before both projections commit",
      "count either canonical Fill or quote commission more than once",
      "attribute the legacy allocation to the recovery Position",
    ],
    subcases: [{
      id: "RS-006-003-A",
      description: "two distinct partial SELL Fills are accumulated and committed from one complete terminal history",
      status: "TEST-MAPPED",
      test: {
        file: testFile,
        title: multiFillTestTitle,
      },
      evidence: null,
    }, {
      id: "RS-006-003-B",
      description: "replaying the same two-Fill terminal mixed-SELL boundary is an exact no-op in both projections",
      status: "TEST-MAPPED",
      test: {
        file: testFile,
        title: replayTestTitle,
      },
      evidence: null,
    }],
    implementation: [
      "apps/harvester/src/domain/strategies/recovery-seller/mixed-sell-fill-allocation.js",
      "apps/harvester/src/domain/strategies/recovery-seller/mixed-sell-fill-reconciliation.js",
      "apps/harvester/src/domain/strategies/recovery-seller/mixed-sell-fill-accounting.js",
      "apps/harvester/src/use-cases/create-recovery-seller-accounting-workflow.js",
    ],
    test: {
      file: testFile,
      title: multiFillTestTitle,
    },
    status: "TEST-MAPPED",
    evidence: null,
  }),

  defineRecoverySellerScenario({
    id: "RS-006-012",
    family: "RS-006",
    name: "durable mixed SELL reconciliation failure does not publish either accounting projection or release the sole SELL reservation",
    priority: "P0",
    authority: [
      "apps/harvester/docs/domain/recovery-seller-scenario-testing.md#rs-006--exact-once-mixed-sell-accounting-and-atomicity-p0",
      "issue-1780: RS-006 durable transaction barrier",
    ],
    layer: "APPLICATION",
    configFields: [],
    covers: {
      rules: ["RS_DUAL_PROJECTION_ATOMICITY", "RS_CANONICAL_FILL_EXACT_ONCE"],
      decisions: [],
      states: [],
      transitions: [],
      invariants: ["RS_DUAL_PROJECTION_ATOMICITY", "RS_RESERVATION_CONSERVATION"],
    },
    given: {
      completeTerminalFillHistory: true,
      durableReconciliationAppend: "FAILED",
      reservedSellOrder: "rs-multi-fill-sell-client",
    },
    when: [{
      type: "reconcile-terminal-mixed-sell-with-durable-append-failure",
    }],
    then: {
      applied: false,
      recoveryProjectionPublished: false,
      legacyProjectionPublished: false,
      orderRegistryPublished: false,
      sellReservationRetained: true,
    },
    mustNot: [
      "publish Portfolio or legacy accounting before durable terminal fact append succeeds",
      "release the active SELL reservation after a failed durable append",
      "implicitly retry an ambiguous durable append",
    ],
    subcases: [{
      id: "RS-006-012-A",
      description: "a failed durable terminal reconciliation append leaves Portfolio, legacy projections and the SELL reservation unchanged",
      status: "TEST-MAPPED",
      test: {
        file: testFile,
        title: "RS-006-012-A: failed durable terminal fact append leaves both accounting projections and SELL reservation unchanged",
      },
      evidence: null,
    }],
    implementation: [
      "apps/harvester/src/domain/strategies/recovery-seller/mixed-sell-fill-accounting.js",
      "apps/harvester/src/use-cases/create-recovery-seller-accounting-workflow.js",
    ],
    test: {
      file: testFile,
      title: "RS-006-012-A: failed durable terminal fact append leaves both accounting projections and SELL reservation unchanged",
    },
    status: "TEST-MAPPED",
    evidence: null,
  }),
  defineRecoverySellerScenario({
    id: "RS-006-016",
    family: "RS-006",
    name: "terminal SELL accounting fails closed until canonical Fill history covers the full executed quantity",
    priority: "P0",
    authority: [
      "apps/harvester/docs/domain/recovery-seller-scenario-testing.md#rs-006--exact-once-mixed-sell-accounting-and-atomicity-p0",
      "issue-1780: RS-006 complete canonical terminal Fill history",
    ],
    layer: "APPLICATION",
    configFields: [],
    covers: {
      rules: ["RS_CANONICAL_FILL_EXACT_ONCE", "RS_MIXED_ALLOCATION_CONSERVATION"],
      decisions: [],
      states: [],
      transitions: [],
      invariants: ["RS_EXACT_ONCE", "RS_RESERVATION_CONSERVATION"],
    },
    given: {
      terminalOrderExecutedQuantity: "5.01",
      canonicalFillHistoryQuantity: "2.5",
      terminalOrderStatus: "FILLED",
    },
    when: [{
      type: "reconcile-terminal-mixed-sell-with-incomplete-canonical-fill-history",
    }],
    then: {
      applied: false,
      recoveryProjectionPublished: false,
      legacyProjectionPublished: false,
      sellReservationRetained: true,
      durableReconciliationAppendCalled: false,
    },
    mustNot: [
      "treat a partial REST or stream Fill page as complete terminal execution history",
      "publish either accounting projection from an incomplete Fill set",
      "release the sole SELL reservation before all executed quantity is reconciled",
    ],
    subcases: [{
      id: "RS-006-016-A",
      description: "a terminal order with only partial canonical Fill history leaves accounting and reservation unchanged",
      status: "TEST-MAPPED",
      test: {
        file: testFile,
        title: "RS-006-016-A: incomplete canonical SELL fill history keeps both projections and reservation unchanged",
      },
      evidence: null,
    }],
    implementation: [
      "apps/harvester/src/domain/strategies/recovery-seller/mixed-sell-fill-reconciliation.js",
      "apps/harvester/src/use-cases/create-recovery-seller-accounting-workflow.js",
    ],
    test: {
      file: testFile,
      title: "RS-006-016-A: incomplete canonical SELL fill history keeps both projections and reservation unchanged",
    },
    status: "TEST-MAPPED",
    evidence: null,
  }),
  defineRecoverySellerScenario({
    id: "RS-006-018",
    family: "RS-006",
    name: "confirmed terminal SELL executions are accounted even when realized profitability misses minProfit",
    priority: "P0",
    authority: [
      "apps/harvester/docs/domain/recovery-seller-scenario-testing.md#rs-006--exact-once-mixed-sell-accounting-and-atomicity-p0",
      "issue-1780: RS-006 actual execution accounting is independent from profitability eligibility",
    ],
    layer: "APPLICATION",
    configFields: [],
    covers: {
      rules: ["RS_CANONICAL_FILL_EXACT_ONCE", "RS_PROFIT_COMBINED_MINIMUM"],
      decisions: [],
      states: [],
      transitions: [],
      invariants: ["RS_EXACT_ONCE", "RS_DUAL_PROJECTION_ATOMICITY"],
    },
    given: {
      completeTerminalFillHistory: true,
      minProfit: "100",
      realizedNetProfitBelowMinProfit: true,
    },
    when: [{
      type: "reconcile-terminal-mixed-sell-after-profitability-miss",
    }],
    then: {
      applied: true,
      profitabilityEligible: false,
      recoveryFillAccounted: true,
      legacyFillAccounted: true,
      sellReservationReleasedAfterCommit: true,
    },
    mustNot: [
      "discard confirmed exchange Fill facts because the profitability gate failed",
      "leave recovery and legacy projections inconsistent after a confirmed terminal execution",
      "retain a completed SELL reservation after the full terminal Fill set is durably committed",
    ],
    subcases: [{
      id: "RS-006-018-A",
      description: "both confirmed allocation slices commit while the mixed SELL remains ineligible below minProfit",
      status: "TEST-MAPPED",
      test: {
        file: testFile,
        title: "RS-006-018-A: confirmed mixed SELL fills are committed even when realized profitability misses minProfit",
      },
      evidence: null,
    }],
    implementation: [
      "apps/harvester/src/domain/strategies/recovery-seller/mixed-sell-fill-accounting.js",
      "apps/harvester/src/use-cases/create-recovery-seller-accounting-workflow.js",
    ],
    test: {
      file: testFile,
      title: "RS-006-018-A: confirmed mixed SELL fills are committed even when realized profitability misses minProfit",
    },
    status: "TEST-MAPPED",
    evidence: null,
  }),
])
