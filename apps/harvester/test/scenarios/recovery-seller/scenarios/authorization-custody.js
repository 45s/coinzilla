import { defineRecoverySellerScenario } from "../registry/define-scenario.js"

const testFile = "apps/harvester/test/scenarios/recovery-seller/authorization-custody.scenario.test.js"
const basisSource = "apps/harvester/src/domain/strategies/recovery-seller/legacy-position.js"
const custodySource = "apps/harvester/src/domain/strategies/recovery-seller/legacy-spot-allocation.js"
const workflowSource = "apps/harvester/src/use-cases/create-recovery-seller-accounting-workflow.js"
const allocatorSource = "apps/harvester/src/domain/orders/allocate-order-commitments.js"

function createScenarioCoverage() {
  return {
    rules: [
      "RS_LEGACY_BASIS_REQUIRED",
      "RS_SPOT_CUSTODY_REQUIRED",
      "RS_EXTERNAL_INVENTORY_NOT_OWNED",
      "RS_NO_SYNTHETIC_INVENTORY",
      "RS_CUSTODY_CONSERVATION",
      "RS_ACCOUNT_BASE_RESERVATION",
      "RS_STRATEGY_OWNERSHIP_ISOLATION",
    ],
    decisions: ["RS_SELL_ELIGIBILITY", "RS_ACCOUNT_ALLOCATION"],
    states: [],
    transitions: [],
    invariants: [
      "RS_STABLE_OWNERSHIP",
      "RS_NO_SYNTHETIC_INVENTORY",
      "RS_CUSTODY_CONSERVATION",
      "RS_RESERVATION_CONSERVATION",
    ],
  }
}

function createMappedSubcases({ id, name, status, subcases, title }) {
  return subcases ?? [{
    id: `${id}-A`,
    description: name,
    status,
    test: {
      file: testFile,
      title,
    },
    evidence: null,
  }]
}

function makeCase({
  id,
  name,
  layer = "DOMAIN",
  input,
  step,
  expected,
  mustNot,
  implementation,
  status = "TEST-MAPPED",
  subcases,
}) {
  const title = `${id}: ${name}`
  const mappedSubcases = createMappedSubcases({
    id,
    name,
    status,
    subcases,
    title,
  })

  return defineRecoverySellerScenario({
    id,
    family: "RS-001",
    name,
    priority: "P0",
    authority: [
      "apps/harvester/docs/domain/recovery-seller-domain-specification.md",
      "issue-1780: RS-001 authorization and custody",
    ],
    layer,
    configFields: [
      "RS_PAIR.legacyPosition.invested",
      "RS_PAIR.legacyPosition.quantity",
      "RS_PAIR.sellQuantity",
    ],
    covers: createScenarioCoverage(),
    given: {
      input,
    },
    when: [{
      type: step,
      inputKey: "input",
      saveAs: "actual",
    }],
    then: expected,
    mustNot,
    subcases: mappedSubcases,
    implementation,
    test: {
      file: testFile,
      title,
    },
    status,
    evidence: null,
  })
}

export const authorizationCustodyScenarios = Object.freeze([
  makeCase({
    id: "RS-001-001",
    name: "valid operator-declared legacy invested quote and original base quantity are accepted",
    input: {
      invested: "50",
      quantity: "10",
    },
    step: "create-legacy-position",
    expected: {
      invested: "50",
      originalQuantity: "10",
      averageCost: "5",
      remainingQuantity: "10",
    },
    mustNot: [
      "infer original legacy basis from the current wallet balance",
      "change the operator-declared invested amount or original quantity",
    ],
    implementation: [basisSource],
  }),
  makeCase({
    id: "RS-001-002",
    name: "historical average cost remains fixed after a legacy disposal",
    input: {
      invested: "1",
      quantity: "3",
      quantitySold: "1",
    },
    step: "record-legacy-sale",
    expected: {
      invested: "1",
      originalQuantity: "3",
      averageCost: "0.333333333333333333333333333333333334",
      remainingQuantity: "2",
    },
    mustNot: [
      "recalculate average cost from the remaining quantity",
      "reduce original invested basis after a disposal",
    ],
    implementation: [basisSource],
  }),
  makeCase({
    id: "RS-001-003",
    name: "missing, zero, negative or malformed legacy basis fails closed and average cost is derived",
    input: {
      cases: [
        {
          id: "missing-invested",
          input: {
            quantity: "10",
          },
        },
        {
          id: "zero-invested",
          input: {
            invested: "0",
            quantity: "10",
          },
        },
        {
          id: "negative-invested",
          input: {
            invested: "-1",
            quantity: "10",
          },
        },
        {
          id: "malformed-invested",
          input: {
            invested: "invalid",
            quantity: "10",
          },
        },
        {
          id: "missing-quantity",
          input: {
            invested: "50",
          },
        },
        {
          id: "zero-quantity",
          input: {
            invested: "50",
            quantity: "0",
          },
        },
        {
          id: "negative-quantity",
          input: {
            invested: "50",
            quantity: "-10",
          },
        },
        {
          id: "malformed-quantity",
          input: {
            invested: "50",
            quantity: "invalid",
          },
        },
        {
          id: "contradictory-average-cost",
          input: {
            invested: "50",
            quantity: "10",
            averageCost: "999",
          },
        },
      ],
    },
    step: "create-legacy-position",
    expected: {
      cases: [
        {
          id: "missing-invested",
          errorName: "TypeError",
          averageCost: null,
        },
        {
          id: "zero-invested",
          errorName: "RangeError",
          averageCost: null,
        },
        {
          id: "negative-invested",
          errorName: "RangeError",
          averageCost: null,
        },
        {
          id: "malformed-invested",
          errorName: "TypeError",
          averageCost: null,
        },
        {
          id: "missing-quantity",
          errorName: "TypeError",
          averageCost: null,
        },
        {
          id: "zero-quantity",
          errorName: "RangeError",
          averageCost: null,
        },
        {
          id: "negative-quantity",
          errorName: "RangeError",
          averageCost: null,
        },
        {
          id: "malformed-quantity",
          errorName: "TypeError",
          averageCost: null,
        },
        {
          id: "contradictory-average-cost",
          errorName: null,
          averageCost: "5",
        },
      ],
    },
    mustNot: [
      "create a zero-cost or negative-cost legacy Position",
      "normalize missing or malformed invested/quantity values",
      "replace invalid basis with current market value or wallet balance",
      "trust a caller-supplied averageCost instead of deriving it from original invested/quantity",
    ],
    subcases: [
      ["A", "missing invested amount is rejected"],
      ["B", "zero invested amount is rejected"],
      ["C", "negative invested amount is rejected"],
      ["D", "malformed invested amount is rejected"],
      ["E", "missing original quantity is rejected"],
      ["F", "zero original quantity is rejected"],
      ["G", "negative original quantity is rejected"],
      ["H", "malformed original quantity is rejected"],
      ["I", "a contradictory supplied averageCost cannot override the derived basis"],
    ].map(([suffix, description]) => ({
      id: `RS-001-003-${suffix}`,
      description,
      status: "TEST-MAPPED",
      test: {
        file: testFile,
        title: "RS-001-003: missing, zero, negative or malformed legacy basis fails closed and average cost is derived",
      },
      evidence: null,
    })),
  }),
  makeCase({
    id: "RS-001-004",
    name: "operator-declared legacy basis does not create synthetic Portfolio fills",
    input: {
      invested: "50",
      quantity: "10",
    },
    step: "create-legacy-position-map",
    expected: {
      legacyMarkets: 1,
      portfolioPositions: 0,
      appliedFillIds: 0,
    },
    mustNot: [
      "create a canonical BUY Fill for historical legacy inventory",
      "increase shared Portfolio quantity or quote cost",
    ],
    implementation: [
      basisSource,
      "apps/harvester/src/domain/strategies/recovery-seller/legacy-accounting-state.js",
    ],
  }),
  makeCase({
    id: "RS-001-005",
    name: "verified Spot custody is separate from historical legacy basis",
    input: {
      invested: "50",
      quantity: "10",
      spotTotal: "1.5",
      portfolioQuantity: "1",
    },
    step: "calculate-verified-spot-allocation",
    expected: {
      averageCost: "5",
      remainingQuantity: "10",
      verifiedSpotQuantity: "0.5",
      otherStrategyPositionQuantity: "1",
    },
    mustNot: [
      "derive legacy basis from the Spot balance",
      "add verified legacy Spot quantity to Portfolio-owned inventory",
    ],
    implementation: [basisSource, custodySource],
  }),
  makeCase({
    id: "RS-001-006",
    name: "only authoritative Spot balance is eligible and EARN or off-Spot inventory is excluded",
    input: {
      invested: "50",
      quantity: "10",
      spotTotal: "0.4",
      offSpotQuantity: "5",
      portfolioQuantity: "0",
    },
    step: "calculate-verified-spot-allocation",
    expected: {
      averageCost: "5",
      remainingQuantity: "10",
      verifiedSpotQuantity: "0.4",
      offSpotQuantityUsed: "0",
      otherStrategyPositionQuantity: "0",
    },
    mustNot: [
      "add EARN or other off-Spot balance to sellable legacy quantity",
      "treat wallet-wide total as Spot custody",
    ],
    implementation: [custodySource],
  }),
  makeCase({
    id: "RS-001-007",
    name: "a SELL larger than verified Spot quantity is blocked without consuming off-Spot inventory",
    input: {
      spotTotal: "0.005",
      portfolioQuantity: "0",
      authorizedQuantity: "1",
      requestedSellQuantity: "0.01",
    },
    step: "block-sell-above-verified-spot",
    expected: {
      verifiedSpotQuantity: "0.005",
      allocationOk: false,
      errorName: "RangeError",
    },
    mustNot: [
      "increase the SELL quantity with EARN or off-Spot inventory",
      "silently treat the unverified remainder as available base",
    ],
    implementation: [custodySource, allocatorSource],
  }),
  makeCase({
    id: "RS-001-008",
    name: "external manual and startup-snapshot orders are not adopted as RS-owned",
    layer: "APPLICATION",
    input: { externalOrderClientId: "manual-order-1" },
    step: "reject-external-buy-fill",
    expected: {
      ok: false,
      portfolioPositions: 0,
      appliedFillIds: 0,
    },
    mustNot: [
      "infer RS ownership from a matching market or symbol",
      "apply an external/manual Fill to an RS Position",
    ],
    implementation: [workflowSource],
  }),
  makeCase({
    id: "RS-001-009",
    name: "other-strategy Portfolio allocations reduce physical Spot availability without becoming RS ownership",
    input: {
      spotTotal: "5",
      portfolioQuantity: "4",
      authorizedQuantity: "10",
    },
    step: "calculate-verified-spot-allocation",
    expected: {
      verifiedSpotQuantity: "1",
      otherStrategyPositionQuantity: "4",
    },
    mustNot: [
      "attribute the other strategy Position to RS",
      "allocate the same physical base quantity to both strategies",
    ],
    implementation: [custodySource, "apps/harvester/src/domain/portfolio/portfolio.js"],
  }),
  makeCase({
    id: "RS-001-010",
    name: "missing or conflicting Spot custody evidence fails closed",
    input: {
      authorizedQuantity: "1",
    },
    step: "reject-invalid-custody-evidence",
    expected: {
      missingBalanceRejected: true,
      duplicateBalanceRejected: true,
    },
    mustNot: [
      "interpret a missing base balance as zero available inventory",
      "choose one of two conflicting balances arbitrarily",
    ],
    implementation: [custodySource],
    status: "PARTIAL",
    subcases: [
      {
        id: "RS-001-010-A",
        description: "missing authorized base balance fails closed",
        status: "TEST-MAPPED",
        test: {
          file: testFile,
          title: "RS-001-010: missing or conflicting Spot custody evidence fails closed",
        },
        evidence: null,
      },
      {
        id: "RS-001-010-B",
        description: "duplicate conflicting balances for one asset fail closed",
        status: "TEST-MAPPED",
        test: {
          file: testFile,
          title: "RS-001-010: missing or conflicting Spot custody evidence fails closed",
        },
        evidence: null,
      },
      {
        id: "RS-001-010-C",
        description: "stale account snapshot age is rejected before custody is used",
        status: "BLOCKED",
        test: null,
        blocker: {
          reason: "The canonical Balance/account-snapshot contract used by this domain boundary does not expose an authoritative freshness timestamp or stale marker.",
          unblockCondition: "Define and implement an authoritative account-snapshot freshness contract in a separately approved production change, then add an application-boundary scenario.",
        },
        evidence: null,
      },
    ],
  }),
  makeCase({
    id: "RS-001-011",
    name: "authoritative Spot transfer changes availability but never rewrites historical basis",
    input: {
      invested: "50",
      quantity: "10",
      portfolioQuantity: "2",
      beforeSpotTotal: "3",
      afterSpotTotal: "4",
    },
    step: "compare-spot-transfer-snapshots",
    expected: {
      beforeVerifiedSpotQuantity: "1",
      afterVerifiedSpotQuantity: "2",
      invested: "50",
      averageCost: "5",
      remainingQuantity: "10",
    },
    mustNot: [
      "treat an unobserved transfer as a confirmed custody change",
      "rewrite the original invested amount or average cost",
    ],
    implementation: [basisSource, custodySource],
  }),
  makeCase({
    id: "RS-001-012",
    name: "account snapshot baselines and active reservations are not subtracted twice",
    input: {
      quoteFreeBalance: "100",
      baseFreeBalance: "5",
      activeBaseQuantity: "7",
      portfolioBaseBalance: "5",
      portfolioBaseBalanceBaseline: "5",
      additionalTrackedBaseBalance: "2",
      additionalTrackedBaseBalanceBaseline: "2",
      committedBase: "1",
      committedBaseBalance: "1",
      committedBaseBalanceBaseline: "0",
      requestedSellQuantity: "4",
    },
    step: "allocate-base-commitment",
    expected: {
      executableActionCount: 1,
      deferredActionCount: 0,
      remainingBaseBalance: "0",
      remainingActiveBase: "2",
    },
    mustNot: [
      "subtract snapshot-relative Portfolio or legacy baselines twice",
      "release or ignore a current active base reservation",
    ],
    implementation: [allocatorSource, "apps/harvester/src/use-cases/strategy-account-balance-context.js"],
  }),
  makeCase({
    id: "RS-001-013",
    name: "verified legacy Spot equals account Spot total minus all Portfolio base Positions capped by authorized remainder",
    input: {
      spotTotal: "5.5",
      portfolioQuantity: "5",
      portfolioPositions: [
        {
          market: "ZROUSDT",
          quantity: "2",
          strategy: "CG",
        },
        {
          market: "ZROFDUSD",
          quantity: "3",
          strategy: "RS",
        },
      ],
      authorizedQuantity: "50",
    },
    step: "calculate-verified-spot-allocation",
    expected: {
      verifiedSpotQuantity: "0.5",
    },
    mustNot: [
      "subtract only the current market Position instead of all same-base Positions",
      "allocate more than the operator-authorized remaining legacy quantity",
    ],
    implementation: [custodySource, "apps/harvester/src/domain/portfolio/portfolio.js"],
  }),
  makeCase({
    id: "RS-001-014",
    name: "missing balances and Spot custody below aggregate Portfolio base fail closed",
    input: {
      authorizedQuantity: "1",
      portfolioQuantity: "2",
      spotTotal: "1.99",
    },
    step: "reject-incomplete-or-short-custody",
    expected: {
      missingBalanceRejected: true,
      portfolioCustodyShortfallRejected: true,
    },
    mustNot: [
      "infer Spot quantity from EARN or off-Spot inventory",
      "sell base already attributed to the shared Portfolio",
    ],
    implementation: [custodySource],
    status: "PARTIAL",
    subcases: [
      {
        id: "RS-001-014-A",
        description: "missing authorized Spot balance fails closed",
        status: "TEST-MAPPED",
        test: {
          file: testFile,
          title: "RS-001-014: missing balances and Spot custody below aggregate Portfolio base fail closed",
        },
        evidence: null,
      },
      {
        id: "RS-001-014-B",
        description: "Spot total below aggregate Portfolio base fails closed",
        status: "TEST-MAPPED",
        test: {
          file: testFile,
          title: "RS-001-014: missing balances and Spot custody below aggregate Portfolio base fail closed",
        },
        evidence: null,
      },
      {
        id: "RS-001-014-C",
        description: "stale or incomplete snapshot freshness metadata fails closed",
        status: "BLOCKED",
        test: null,
        blocker: {
          reason: "The current account snapshot interface has no authoritative freshness/completeness contract.",
          unblockCondition: "Add an approved freshness/completeness contract at the account snapshot boundary and test its rejection behavior.",
        },
        evidence: null,
      },
    ],
  }),
])
