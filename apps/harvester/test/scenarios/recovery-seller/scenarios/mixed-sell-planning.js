import { defineRecoverySellerScenario } from "../registry/define-scenario.js"

const testFile = "apps/harvester/test/scenarios/recovery-seller/mixed-sell-planning.scenario.test.js"
const implementation = [
  "apps/harvester/src/domain/strategies/recovery-seller/calculate-sell-plan.js",
]

function createSellPlanScenario({ id, name, input, expected, rules }) {
  const title = `${id}: ${name}`
  return defineRecoverySellerScenario({
    id,
    family: "RS-003",
    name,
    priority: "P0",
    authority: [
      "apps/harvester/docs/domain/recovery-seller-domain-specification.md#4-recovery-and-legacy-inventory",
      "issue-1780: RS-003 additive mixed SELL planning and allocation",
    ],
    layer: "DOMAIN",
    configFields: [
      "RS_PAIR.sellQuantity",
      "RS_PAIR.legacyPosition.invested",
      "RS_PAIR.legacyPosition.quantity",
    ],
    covers: {
      rules,
      decisions: ["RS_SELL_PLAN"],
      states: ["ACCUMULATING"],
      transitions: [],
      invariants: [
        "RS_QUANTITY_CONSERVATION",
        "RS_CUSTODY_CONSERVATION",
        "RS_FINANCIAL_CONSERVATION",
      ],
    },
    given: { input },
    when: [{
      type: "calculate-mixed-sell-plan",
      inputKey: "input",
      saveAs: "plan",
    }],
    then: expected,
    mustNot: [
      "add legacy quantity beyond the configured slice, authorized remainder and verified unreserved Spot quantity",
      "derive historical legacy average cost from a separate averageCost configuration input",
      "fabricate or reuse legacy inventory after its authorized remainder is exhausted",
      "replace exact decimal allocation with JavaScript Number arithmetic",
    ],
    subcases: [{
      id: `${id}-A`,
      description: name,
      status: "TEST-MAPPED",
      test: {
        file: testFile,
        title,
      },
      evidence: null,
    }],
    implementation,
    test: {
      file: testFile,
      title,
    },
    status: "TEST-MAPPED",
    evidence: null,
  })
}

const commonInput = Object.freeze({
  recoveryQuantity: "1",
  configuredLegacyQuantity: "0.01",
  recoveryCostBasis: "10",
  legacyInvested: "0.20",
  originalLegacyQuantity: "0.01",
  minProfit: "0.01",
  quoteFeeRate: "0",
  baseFeeRate: "0",
  thirdAssetFeeQuoteValue: "0",
  priceTickSize: "0.01",
})

export const recoverySellerMixedSellPlanningScenarios = Object.freeze([
  createSellPlanScenario({
    id: "RS-003-001",
    name: "the mixed SELL adds the authorized legacy slice to canonical recovery inventory",
    input: {
      ...commonInput,
      legacyRemainingQuantity: "0.01",
      verifiedUnreservedLegacyQuantity: "0.01",
      quantityStepSize: "0.01",
    },
    expected: {
      recoveryQuantity: "1",
      legacyQuantity: "0.01",
      quantity: "1.01",
      recoverySellQuantity: "1",
      legacySellQuantity: "0.01",
      recoveryRequiredNetQuoteProceeds: "10.1101",
      legacyRequiredNetQuoteProceeds: "20.2",
      combinedRequiredNetQuoteProceeds: "10.21",
      requiredNetQuoteProceeds: "20.2",
      price: "20",
    },
    rules: ["RS_SELL_ADDITIVE_LEGACY_SLICE", "RS_SELL_VERIFIED_UNRESERVED_QUANTITY"],
  }),
  createSellPlanScenario({
    id: "RS-003-002",
    name: "the mixed SELL uses only the smaller authorized legacy remainder",
    input: {
      ...commonInput,
      legacyRemainingQuantity: "0.005",
      verifiedUnreservedLegacyQuantity: "0.005",
      quantityStepSize: "0.001",
    },
    expected: {
      recoveryQuantity: "1",
      legacyQuantity: "0.005",
      quantity: "1.005",
      recoverySellQuantity: "1",
      legacySellQuantity: "0.005",
      recoveryRequiredNetQuoteProceeds: "10.06005",
      legacyRequiredNetQuoteProceeds: "20.1",
      combinedRequiredNetQuoteProceeds: "10.11",
      requiredNetQuoteProceeds: "20.1",
      price: "20",
    },
    rules: ["RS_SELL_ADDITIVE_LEGACY_SLICE", "RS_SELL_VERIFIED_UNRESERVED_QUANTITY"],
  }),
  createSellPlanScenario({
    id: "RS-003-003",
    name: "exhausted legacy inventory produces a recovery-only SELL plan",
    input: {
      ...commonInput,
      legacyRemainingQuantity: "0",
      verifiedUnreservedLegacyQuantity: "0",
      quantityStepSize: "0.01",
    },
    expected: {
      recoveryQuantity: "1",
      legacyQuantity: "0",
      quantity: "1",
      recoverySellQuantity: "1",
      legacySellQuantity: "0",
      recoveryRequiredNetQuoteProceeds: "10.01",
      legacyRequiredNetQuoteProceeds: "0",
      combinedRequiredNetQuoteProceeds: "10.01",
      requiredNetQuoteProceeds: "10.01",
      price: "10.01",
    },
    rules: ["RS_LEGACY_EXHAUSTION", "RS_SELL_ADDITIVE_LEGACY_SLICE"],
  }),
])
