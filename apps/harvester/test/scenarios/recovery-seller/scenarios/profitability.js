import { defineRecoverySellerScenario } from "../registry/define-scenario.js"

export const recoverySellerProfitabilityAllGatesScenario = defineRecoverySellerScenario({
  id: "RS-004-011",
  family: "RS-004",
  name: "recovery, legacy and combined profitability gates all pass independently",
  priority: "P0",
  authority: [
    "apps/harvester/docs/domain/recovery-seller-domain-specification.md#5-profitability--independent-allocations-and-combined-sell-target",
    "issue-1780: scenario matrix D",
  ],
  layer: "DOMAIN",
  configFields: [
    "RS_PAIR.minProfit",
    "RS_PAIR.legacyPosition.invested",
    "RS_PAIR.legacyPosition.quantity",
  ],
  covers: {
    rules: [
      "RS_PROFIT_RECOVERY_MINIMUM",
      "RS_PROFIT_LEGACY_NON_NEGATIVE",
      "RS_PROFIT_COMBINED_MINIMUM",
      "RS_NO_CROSS_SUBSIDY",
    ],
    decisions: ["RS_SELL_ELIGIBILITY"],
    states: [],
    transitions: [],
    invariants: ["RS_NO_CROSS_SUBSIDY", "RS_FINANCIAL_CONSERVATION"],
  },
  given: {
    profitabilityInput: {
      recoveryCostBasis: "10",
      recoveryNetQuoteProceeds: "10.01",
      minProfit: "0.01",
      legacyAverageCost: "2",
      legacyBaseDebit: "0.1",
      legacyNetQuoteProceeds: "0.2",
    },
  },
  when: [
    {
      type: "evaluate-recovery-seller-profitability",
      inputKey: "profitabilityInput",
      saveAs: "profitability",
    },
  ],
  then: {
    recovery: {
      costBasis: "10",
      netQuoteProceeds: "10.01",
      netProfit: "0.01",
      minProfit: "0.01",
      eligible: true,
    },
    legacy: {
      applicable: true,
      averageCost: "2",
      baseDebit: "0.1",
      costBasis: "0.2",
      netQuoteProceeds: "0.2",
      netProfit: "0",
      eligible: true,
    },
    cycle: {
      costBasis: "10.2",
      netQuoteProceeds: "10.21",
      netProfit: "0.01",
      minProfit: "0.01",
      eligible: true,
    },
    eligible: true,
  },
  mustNot: [
    "replace the independent recovery, legacy and combined gates with one combined-only calculation",
    "treat legacy break-even as a loss or require positive legacy profit",
    "derive the expected oracle by calling the production profitability function",
  ],
  subcases: [
    {
      id: "RS-004-011-A",
      description: "all applicable profitability gates pass at exact recovery and combined minProfit equality with legacy break-even",
      status: "TEST-MAPPED",
      test: {
        file: "apps/harvester/test/scenarios/recovery-seller/registry-and-runner.scenario.test.js",
        title: "RS-004-011: recovery, legacy and combined profitability gates all pass independently",
      },
      evidence: null,
    },
  ],
  implementation: [
    "apps/harvester/src/domain/strategies/recovery-seller/calculate-profitability.js",
  ],
  test: {
    file: "apps/harvester/test/scenarios/recovery-seller/registry-and-runner.scenario.test.js",
    title: "RS-004-011: recovery, legacy and combined profitability gates all pass independently",
  },
  status: "TEST-MAPPED",
  evidence: null,
})
