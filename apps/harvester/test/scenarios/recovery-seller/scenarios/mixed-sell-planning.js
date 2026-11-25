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

const recoverySellerSellPlanScenarios = Object.freeze([
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

function createSpotAllocationScenario({
  id,
  name,
  input,
  expected,
  subcases,
}) {
  const title = `${id}: ${name}`
  return defineRecoverySellerScenario({
    id,
    family: "RS-003",
    name,
    priority: "P0",
    authority: [
      "apps/harvester/docs/domain/recovery-seller-domain-specification.md#4-recovery-and-legacy-inventory",
      "issue-1780: RS-003 verified Spot custody and shared Portfolio allocation",
    ],
    layer: "DOMAIN",
    configFields: [
      "RS_PAIR.sellQuantity",
      "RS_PAIR.legacyPosition.quantity",
    ],
    covers: {
      rules: [
        "RS_SELL_VERIFIED_UNRESERVED_QUANTITY",
        "RS_CUSTODY_CONSERVATION",
      ],
      decisions: ["RS_ACCOUNT_ALLOCATION"],
      states: [],
      transitions: [],
      invariants: [
        "RS_CUSTODY_CONSERVATION",
        "RS_QUANTITY_CONSERVATION",
      ],
    },
    given: { input },
    when: [{
      type: "calculate-verified-legacy-spot-allocation",
      inputKey: "input",
      saveAs: "allocations",
    }],
    then: expected,
    mustNot: [
      "treat the wallet balance as RS-owned legacy inventory without operator authorization",
      "count a Portfolio Position as additional legacy Spot inventory",
      "ignore a Position because it belongs to another strategy or market sharing the same base asset",
      "allocate more than the remaining operator-authorized legacy quantity",
      "use floating-point arithmetic for base-asset quantity aggregation",
    ],
    subcases,
    implementation: [
      "apps/harvester/src/domain/strategies/recovery-seller/legacy-spot-allocation.js",
    ],
    test: {
      file: testFile,
      title,
    },
    status: "TEST-MAPPED",
    evidence: null,
  })
}

const spotAllocationBaseInput = Object.freeze({
  acquisitions: [{
    symbol: "ZROUSDT",
    quoteCode: "USDT",
    tradeId: "rs-spot-boundary-recovery-buy",
    positionId: "rs-spot-boundary-recovery-position",
    strategy: "RS",
    quantity: "1",
    quoteQuantity: "10",
  }],
  legacyPositions: [{
    symbol: "ZROUSDT",
    quoteCode: "USDT",
    originalQuantity: "0.01",
    remainingQuantity: "0.01",
  }],
})

const spotAllocationCases = [
  {
    id: "below",
    input: {
      ...spotAllocationBaseInput,
      spotFreeQuantity: "1.005",
    },
    expected: [{
      assetId: "binance:ZRO",
      amount: "0.005",
    }],
  },
  {
    id: "equal",
    input: {
      ...spotAllocationBaseInput,
      spotFreeQuantity: "1.01",
    },
    expected: [{
      assetId: "binance:ZRO",
      amount: "0.01",
    }],
  },
  {
    id: "above",
    input: {
      ...spotAllocationBaseInput,
      spotFreeQuantity: "1.02",
    },
    expected: [{
      assetId: "binance:ZRO",
      amount: "0.01",
    }],
  },
]

const spotBoundaryTitle = "RS-003-004: verified Spot availability below, equal to, and above the required legacy slice is capped exactly"

export const recoverySellerMixedSellPlanningScenarios = Object.freeze([
  ...recoverySellerMixedSellPlanningScenarios,
  createSpotAllocationScenario({
    id: "RS-003-004",
    name: "verified Spot availability below, equal to, and above the required legacy slice is capped exactly",
    input: {
      cases: spotAllocationCases.map(({ id, input }) => ({
        id,
        ...input,
      })),
    },
    expected: {
      cases: spotAllocationCases.map(({ id, expected }) => ({
        id,
        allocations: expected,
      })),
    },
    subcases: spotAllocationCases.map(({ id }) => ({
      id: `RS-003-004-${id === "below" ? "A" : id === "equal" ? "B" : "C"}`,
      description: `verified Spot custody is ${id} the required legacy slice`,
      status: "TEST-MAPPED",
      test: {
        file: testFile,
        title: spotBoundaryTitle,
      },
      evidence: null,
    })),
  }),
  createSpotAllocationScenario({
    id: "RS-003-005",
    name: "verified Spot availability subtracts every shared Portfolio position across markets and strategies",
    input: {
      spotFreeQuantity: "5",
      spotLockedQuantity: "0.5",
      acquisitions: [
        {
          symbol: "ZROUSDT",
          quoteCode: "USDT",
          tradeId: "cg-zro-usdt",
          positionId: "cg-zro-usdt-position",
          strategy: "CG",
          quantity: "2",
          quoteQuantity: "20",
        },
        {
          symbol: "ZROFDUSD",
          quoteCode: "FDUSD",
          tradeId: "rs-zro-fdusd",
          positionId: "rs-zro-fdusd-position",
          strategy: "RS",
          quantity: "3",
          quoteQuantity: "30",
        },
      ],
      legacyPositions: [
        {
          symbol: "ZROUSDT",
          quoteCode: "USDT",
          originalQuantity: "40",
          remainingQuantity: "40",
        },
        {
          symbol: "ZROFDUSD",
          quoteCode: "FDUSD",
          originalQuantity: "10",
          remainingQuantity: "10",
        },
      ],
    },
    expected: {
      allocations: [{
        assetId: "binance:ZRO",
        amount: "0.5",
      }],
    },
    subcases: [{
      id: "RS-003-005-A",
      description: "aggregate all CG and RS Portfolio base quantities across markets before legacy Spot allocation",
      status: "TEST-MAPPED",
      test: {
        file: testFile,
        title: "RS-003-005: verified Spot allocation subtracts every shared Portfolio position across markets and strategies",
      },
      evidence: null,
    }],
  }),
])
