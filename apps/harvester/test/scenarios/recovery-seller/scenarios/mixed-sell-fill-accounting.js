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
        { tradeId: "rs-multi-fill-sell-trade-1", quantity: "2.5", quoteQuantity: "5.25", quoteCommission: "0.001" },
        { tradeId: "rs-multi-fill-sell-trade-2", quantity: "2.51", quoteQuantity: "5.25", quoteCommission: "0.002" },
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
      totalNetQuoteProceeds: "10.497",
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
      test: { file: testFile, title: multiFillTestTitle },
      evidence: null,
    }, {
      id: "RS-006-003-B",
      description: "replaying the same two-Fill terminal mixed-SELL boundary is an exact no-op in both projections",
      status: "TEST-MAPPED",
      test: { file: testFile, title: replayTestTitle },
      evidence: null,
    }],
    implementation: [
      "apps/harvester/src/domain/strategies/recovery-seller/mixed-sell-fill-allocation.js",
      "apps/harvester/src/domain/strategies/recovery-seller/mixed-sell-fill-reconciliation.js",
      "apps/harvester/src/domain/strategies/recovery-seller/mixed-sell-fill-accounting.js",
      "apps/harvester/src/use-cases/create-recovery-seller-accounting-workflow.js",
    ],
    test: { file: testFile, title: multiFillTestTitle },
    status: "TEST-MAPPED",
    evidence: null,
  }),
])
