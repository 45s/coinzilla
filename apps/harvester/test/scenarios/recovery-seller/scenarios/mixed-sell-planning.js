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
    authority: ["apps/harvester/docs/domain/recovery-seller-domain-specification.md#4-recovery-and-legacy-inventory", "issue-1780: RS-003 verified Spot custody and shared Portfolio allocation"],
    layer: "DOMAIN",
    configFields: ["RS_PAIR.sellQuantity", "RS_PAIR.legacyPosition.quantity"],
    covers: {
      rules: ["RS_SELL_VERIFIED_UNRESERVED_QUANTITY", "RS_CUSTODY_CONSERVATION"],
      decisions: ["RS_ACCOUNT_ALLOCATION"],
      states: [],
      transitions: [],
      invariants: ["RS_CUSTODY_CONSERVATION", "RS_QUANTITY_CONSERVATION"],
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
    suffix: "A",
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
    suffix: "B",
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
    suffix: "C",
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

const recoverySellerMixedSellPlanningScenariosWithoutReservations = Object.freeze([
  ...recoverySellerSellPlanScenarios,
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
    subcases: spotAllocationCases.map(({ id, suffix }) => ({
      id: `RS-003-004-${suffix}`,
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

function createReservationScenario({ id, name, input, expected, subcases }) {
  const title = `${id}: ${name}`
  return defineRecoverySellerScenario({
    id,
    family: "RS-003",
    name,
    priority: "P0",
    authority: [
      "apps/harvester/docs/domain/recovery-seller-domain-specification.md#4-recovery-and-legacy-inventory",
      "issue-1780: RS-003 account-wide SELL reservations and shared base commitments",
    ],
    layer: "DOMAIN",
    configFields: ["RS_PAIR.sellQuantity", "RS_PAIR.legacyPosition.quantity"],
    covers: {
      rules: ["RS_ACCOUNT_BASE_RESERVATION", "RS_SELL_VERIFIED_UNRESERVED_QUANTITY"],
      decisions: ["RS_ACCOUNT_ALLOCATION"],
      states: [],
      transitions: [],
      invariants: ["RS_RESERVATION_CONSERVATION", "RS_CUSTODY_CONSERVATION"],
    },
    given: { input },
    when: [{
      type: "calculate-same-cross-market-sell-reservation",
      inputKey: "input",
      saveAs: "allocation",
    }],
    then: expected,
    mustNot: [
      "subtract a reservation already reflected in the AccountSnapshot more than once",
      "ignore a SELL reservation because it belongs to another market or strategy",
      "allow a new SELL to consume base quantity already reserved by an existing order",
      "treat account-wide Portfolio quantity as Recovery Seller-owned active inventory",
    ],
    subcases,
    implementation: [
      "apps/harvester/src/use-cases/strategy-order-commitments.js",
      "apps/harvester/src/domain/orders/allocate-order-commitments.js",
      "apps/harvester/src/domain/account/calculate-account-snapshot-baselines.js",
      "apps/harvester/src/domain/account/account-snapshot.js",
    ],
    test: {
      file: testFile,
      title,
    },
    status: "TEST-MAPPED",
    evidence: null,
  })
}

const reservationCases = [
  {
    id: "same-market-rs",
    subcaseId: "A",
    reservationId: "rs-same-market-sell",
    reservationMarketSymbol: "ZROUSDT",
    reservationOwner: "RS",
    snapshotIncludesReservation: true,
    freeBaseBalance: "2",
    lockedBaseBalance: "0.5",
    expectedRemainingBaseBalance: "1.49",
    expectedRemainingActiveBase: "0",
    expectedFailure: "Strategy SELL quantity exceeds Harvester-owned active inventory after commitments",
  },
  {
    id: "same-market-cg",
    subcaseId: "B",
    reservationId: "cg-same-market-sell",
    reservationMarketSymbol: "ZROUSDT",
    reservationOwner: "CG",
    snapshotIncludesReservation: true,
    freeBaseBalance: "0.51",
    lockedBaseBalance: "0.5",
    expectedRemainingBaseBalance: "0",
    expectedRemainingActiveBase: "0.5",
    expectedFailure: "Strategy SELL quantity exceeds available free base balance after commitments",
  },
  {
    id: "cross-market-cg",
    subcaseId: "C",
    reservationId: "cg-cross-market-sell",
    reservationMarketSymbol: "ZROFDUSD",
    reservationOwner: "CG",
    snapshotIncludesReservation: false,
    freeBaseBalance: "1.01",
    lockedBaseBalance: "0",
    expectedRemainingBaseBalance: "0",
    expectedRemainingActiveBase: "0.5",
    expectedFailure: "Strategy SELL quantity exceeds available free base balance after commitments",
  },
]

const reservationTestFile = "apps/harvester/test/scenarios/recovery-seller/mixed-sell-planning.scenario.test.js"
const reservationTestTitles = {
  "same-market-rs": "RS-003-007-A: a same-market RS reservation reduces owned active SELL inventory exactly once",
  "same-market-cg": "RS-003-007-B: a same-market CG reservation reduces shared account base availability",
  "cross-market-cg": "RS-003-007-C: a cross-market CG reservation reduces shared base availability after the account snapshot",
}


const accountWideReservationTitle = "RS-003-006: account-wide SELL reservations across markets are summed and snapshot commitments are not double-counted"
const accountWideReservationExpected = {
  atLimit: {
    ok: true,
    executableActions: [{
      side: "SELL",
      quantity: "0.26",
    }],
    remainingBaseBalance: "0",
    remainingActiveBase: "0.75",
  },
  overLimit: {
    ok: false,
    reason: "Strategy SELL quantity exceeds available free base balance after commitments",
  },
}
const accountWideReservationSubcases = [{
  id: "RS-003-006-A",
  description: "sum remaining SELL quantities from all active orders across two other markets and preserve the snapshot baseline exactly once",
  status: "TEST-MAPPED",
  test: {
    file: testFile,
    title: accountWideReservationTitle,
  },
  evidence: null,
}]
const accountWideReservationMustNot = [
  "subtract a reservation already reflected in the AccountSnapshot more than once",
  "ignore active SELL commitments from another market or strategy sharing the same base asset",
  "allow a new SELL to consume base quantity already reserved by existing orders",
]
const accountWideReservationImplementation = [
  "apps/harvester/src/use-cases/strategy-order-commitments.js",
  "apps/harvester/src/domain/orders/allocate-order-commitments.js",
  "apps/harvester/src/domain/account/calculate-account-snapshot-baselines.js",
  "apps/harvester/src/domain/account/account-snapshot.js",
]

function createAccountWideReservationScenario() {
  return defineRecoverySellerScenario({
    id: "RS-003-006",
    family: "RS-003",
    name: "account-wide active SELL reservations and shared base commitments are respected",
    priority: "P0",
    authority: [
      "apps/harvester/docs/domain/recovery-seller-domain-specification.md#4-recovery-and-legacy-inventory",
      "issue-1780: RS-003 account-wide active SELL commitments",
    ],
    layer: "DOMAIN",
    configFields: ["RS_PAIR.sellQuantity", "RS_PAIR.legacyPosition.quantity"],
    covers: {
      rules: ["RS_ACCOUNT_BASE_RESERVATION", "RS_SELL_VERIFIED_UNRESERVED_QUANTITY"],
      decisions: ["RS_ACCOUNT_ALLOCATION"],
      states: [],
      transitions: [],
      invariants: ["RS_RESERVATION_CONSERVATION", "RS_CUSTODY_CONSERVATION"],
    },
    given: { input: {} },
    when: [{
      type: "calculate-account-wide-sell-reservation",
      inputKey: "input",
      saveAs: "allocation",
    }],
    then: accountWideReservationExpected,
    mustNot: accountWideReservationMustNot,
    subcases: accountWideReservationSubcases,
    implementation: accountWideReservationImplementation,
    test: {
      file: testFile,
      title: accountWideReservationTitle,
    },
    status: "TEST-MAPPED",
    evidence: null,
  })
}

const mixedSellFillTestFile = "apps/harvester/test/scenarios/recovery-seller/mixed-sell-fill-allocation.scenario.test.js"
const mixedSellFillTestTitle = "RS-003-008: one canonical SELL Fill is split exactly between recovery and legacy with quantity conservation"
const mixedSellFillInput = {
  baseAssetId: "doge-asset",
  baseAssetCode: "DOGE",
  quoteAssetId: "usdt-asset",
  quoteAssetCode: "USDT",
  venue: "binance",
  marketSymbol: "DOGEUSDT",
  clientOrderId: "rs-doge-mixed-sell-001",
  brokerOrderId: "binance-order-001",
  positionId: "rs-doge-position-001",
  cycleId: "rs-doge-cycle-001",
  tradeId: "trade-001",
  fillQuantity: "401",
  recoveryQuantity: "400",
  legacyQuantity: "1",
  price: "10",
  quoteProceeds: "4010",
  quoteCommission: "4.01",
}
const mixedSellFillExpected = {
  fillIdentityPreserved: true,
  orderOwnership: {
    strategyId: "RS_recoverySeller",
    positionId: "rs-doge-position-001",
    purpose: "RECOVERY_SELL",
    cycleId: "rs-doge-cycle-001",
  },
  recovery: {
    grossBaseQuantity: "400",
    baseDebit: "400",
    quoteProceeds: "4000",
    commissions: [{
      assetId: "usdt-asset",
      assetCode: "USDT",
      amount: "4",
    }],
  },
  legacy: {
    grossBaseQuantity: "1",
    baseDebit: "1",
    quoteProceeds: "10",
    commissions: [{
      assetId: "usdt-asset",
      assetCode: "USDT",
      amount: "0.01",
    }],
  },
  baseQuantityConserved: true,
  quoteProceedsConserved: true,
  quoteCommissionConserved: true,
}
const mixedSellFillSubcases = [{
  id: "RS-003-008-A",
  description: "split one 401-unit canonical SELL Fill into exact 400-unit recovery and 1-unit legacy allocations and conserve gross base, quote proceeds and quote commission",
  status: "TEST-MAPPED",
  test: {
    file: mixedSellFillTestFile,
    title: mixedSellFillTestTitle,
  },
  evidence: null,
}]
const mixedSellFillImplementation = [
  "apps/harvester/src/domain/strategies/recovery-seller/mixed-sell-fill-allocation.js",
  "apps/harvester/src/domain/fills/validate-fill-commissions.js",
  "apps/harvester/src/domain/orders/order-registry.js",
]

function createMixedSellFillAllocationScenario() {
  return defineRecoverySellerScenario({
    id: "RS-003-008",
    family: "RS-003",
    name: "one canonical SELL Fill is split exactly between recovery and legacy with quantity conservation",
    priority: "P0",
    authority: [
      "apps/harvester/docs/domain/recovery-seller-domain-specification.md",
      "issue-1780: RS-003 exact recovery/legacy allocation split and quantity conservation",
    ],
    layer: "DOMAIN",
    configFields: ["RS_PAIR.sellQuantity", "RS_PAIR.legacyPosition.quantity"],
    covers: {
      rules: ["RS_SELL_VERIFIED_UNRESERVED_QUANTITY", "RS_CUSTODY_CONSERVATION"],
      decisions: ["RS_SELL_PLAN", "RS_ACCOUNT_ALLOCATION"],
      states: [],
      transitions: [],
      invariants: ["RS_QUANTITY_CONSERVATION", "RS_CUSTODY_CONSERVATION"],
    },
    given: {
      input: mixedSellFillInput,
    },
    when: [{
      type: "allocate-mixed-sell-fill",
      inputKey: "input",
      saveAs: "allocation",
    }],
    then: mixedSellFillExpected,
    mustNot: [
      "change the original canonical Fill identity or quantity",
      "attribute recovery quantity to the legacy projection or legacy quantity to the recovery Position",
      "lose quote proceeds or commission during the ownership split",
      "infer recovery/legacy ownership from market symbol or mutable strategy state",
    ],
    subcases: mixedSellFillSubcases,
    implementation: mixedSellFillImplementation,
    test: {
      file: mixedSellFillTestFile,
      title: mixedSellFillTestTitle,
    },
    status: "TEST-MAPPED",
    evidence: null,
  })
}


export const recoverySellerMixedSellPlanningScenarios = Object.freeze([
  ...recoverySellerMixedSellPlanningScenariosWithoutReservations,
  createAccountWideReservationScenario(),
  createReservationScenario({
    id: "RS-003-007",
    name: "cross-market reservations and same-market CG/RS reservations cannot double-sell the same physical base inventory",
    input: {
      cases: reservationCases,
    },
    expected: {
      cases: reservationCases.map(({ id, expectedRemainingBaseBalance, expectedRemainingActiveBase, expectedFailure }) => ({
        id,
        atLimit: {
          ok: true,
          executableActions: [{
            side: "SELL",
            quantity: "0.51",
          }],
          remainingBaseBalance: expectedRemainingBaseBalance,
          remainingActiveBase: expectedRemainingActiveBase,
        },
        overLimit: {
          ok: false,
          reason: expectedFailure,
        },
      })),
    },
    subcases: reservationCases.map(({ id, subcaseId }) => ({
      id: `RS-003-007-${subcaseId}`,
      description: id,
      status: "TEST-MAPPED",
      test: {
        file: reservationTestFile,
        title: reservationTestTitles[id],
      },
      evidence: null,
    })),
  }),
  createMixedSellFillAllocationScenario(),

])

