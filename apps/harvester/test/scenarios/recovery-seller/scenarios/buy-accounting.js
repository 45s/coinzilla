import { defineRecoverySellerScenario } from "../registry/define-scenario.js"

const testFile = "apps/harvester/test/scenarios/recovery-seller/buy-accounting.scenario.test.js"
const workflowSource = "apps/harvester/src/use-cases/create-recovery-seller-accounting-workflow.js"
const portfolioSource = "apps/harvester/src/domain/portfolio/portfolio.js"
const buyPolicySource = "apps/harvester/src/domain/strategies/recovery-seller/evaluate-buy-decision.js"
const orderOwnershipSource = "apps/harvester/src/domain/orders/order-ownership.js"
const orderRegistrySource = "apps/harvester/src/domain/orders/order-registry.js"

function createBuySubcases({ id, name, status, blocker, title }) {
  return [{
    id: `${id}-A`,
    description: name,
    status,
    test: status === "BLOCKED" ? null : {
      file: testFile,
      title,
    },
    ...(status === "BLOCKED" ? { blocker } : {}),
    evidence: null,
  }]
}

function createBuyCaseMappings({ id, name, status, blocker, title, subcases }) {
  return {
    test: status === "BLOCKED" ? null : {
      file: testFile,
      title,
    },
    subcases: subcases ?? createBuySubcases({
      id,
      name,
      status,
      blocker,
      title,
    }),
  }
}

function createBuyCaseCoverage({ rules, invariants }) {
  return {
    rules,
    decisions: ["RS_BUY_ELIGIBILITY"],
    states: ["ACCUMULATING"],
    transitions: [],
    invariants: [
      "RS_STABLE_OWNERSHIP",
      "RS_EXACT_ONCE",
      "RS_FINANCIAL_CONSERVATION",
      ...invariants,
    ],
  }
}

const BUY_ACCOUNTING_MUST_NOT = Object.freeze([
  "create recovery inventory from a submitted or acknowledged BUY without a confirmed canonical Fill",
  "derive invested quote cost from the limit price when actual Fill quote quantity is available",
  "apply one canonical Fill more than once",
  "adopt an external Fill without immutable RS order ownership",
])

function createBuyCaseDefinition({
  id,
  name,
  input,
  expected,
  rules,
  invariants,
  status,
  blocker,
  layer,
  stepType,
  mappings,
  configFields,
  implementation = [],
}) {
  return defineRecoverySellerScenario({
    id,
    family: "RS-002",
    name,
    priority: "P0",
    authority: [
      "apps/harvester/docs/domain/recovery-seller-domain-specification.md#6-buy-tranche-accumulation-and-eligibility",
      "issue-1780: RS-002 BUY accounting",
    ],
    layer,
    configFields: configFields ?? [
      "RS_PAIR.orderQuantity",
      "RS_PAIR.investment",
    ],
    covers: createBuyCaseCoverage({
      rules,
      invariants,
    }),
    given: { input },
    when: [{
      type: stepType,
      inputKey: "input",
      saveAs: "actual",
    }],
    then: expected,
    mustNot: BUY_ACCOUNTING_MUST_NOT,
    subcases: mappings.subcases,
    implementation: [
      workflowSource,
      portfolioSource,
      buyPolicySource,
      orderOwnershipSource,
      orderRegistrySource,
      ...implementation,
    ],
    test: mappings.test,
    status,
    evidence: null,
    ...(status === "BLOCKED" ? { blocker } : {}),
  })
}

function makeBuyCase(options) {
  const normalized = {
    rules: [],
    invariants: [],
    status: "TEST-MAPPED",
    layer: "APPLICATION",
    stepType: "apply-recovery-buy-scenario",
    ...options,
  }
  const title = `${normalized.id}: ${normalized.name}`
  const mappings = createBuyCaseMappings({
    ...normalized,
    title,
  })
  return createBuyCaseDefinition({
    ...normalized,
    title,
    mappings,
  })
}

export const recoverySellerBuyAccountingScenarios = Object.freeze([
  makeBuyCase({
    id: "RS-002-001",
    name: "an empty recovery allocation is BUY-eligible without creating inventory before a confirmed Fill",
    stepType: "evaluate-initial-buy-and-accounting-scenario",
    input: {
      policyOverrides: {},
      limitPrice: "1.999",
      originalQuantity: "5",
      fills: [],
    },
    expected: {
      policy: {
        outcome: "SUBMIT",
        reasonCode: "BUY_TRANCHE_ELIGIBLE",
        action: {
          side: "BUY",
          purpose: "RECOVERY_BUY",
          cycleId: "rs-policy-cycle",
          positionId: "rs-policy-position",
          type: "LIMIT_MAKER",
          price: "1.999",
          quantity: "5",
          notional: "9.995",
          reason: "INITIAL_BUY",
        },
        stopStatus: "CLEAR",
        orderIdentity: null,
      },
      accounting: {
        appliedFillIds: 0,
        position: null,
        executionQuantity: null,
        executionVwap: null,
      },
    },
    rules: ["RS_BUY_CONFIRMED_FILL_ONLY", "RS_BUY_INTENT_CONTRACT"],
  }),
  makeBuyCase({
    id: "RS-002-002",
    name: "BUY policy blocks known readiness failures and latches STOP for missing or orphaned evidence",
    layer: "DOMAIN",
    stepType: "evaluate-recovery-buy-policy-scenario",
    input: {
      cases: [
        {
          id: "operator-stopped",
          overrides: { strategyStopped: true },
        },
        {
          id: "market-paused",
          overrides: { marketPaused: true },
        },
        {
          id: "reconciliation-incomplete",
          overrides: { reconciliationComplete: false },
        },
        {
          id: "missing-readiness",
          overrides: { reconciliationComplete: undefined },
        },
        {
          id: "invalid-market-metadata",
          overrides: { marketMetadata: null },
        },
      ],
    },
    expected: {
      cases: [
        {
          id: "operator-stopped",
          outcome: "BLOCK",
          reasonCode: "STRATEGY_STOPPED",
          action: null,
          stopStatus: "CLEAR",
          orderIdentity: null,
        },
        {
          id: "market-paused",
          outcome: "BLOCK",
          reasonCode: "MARKET_PAUSED",
          action: null,
          stopStatus: "CLEAR",
          orderIdentity: null,
        },
        {
          id: "reconciliation-incomplete",
          outcome: "BLOCK",
          reasonCode: "RECONCILIATION_INCOMPLETE",
          action: null,
          stopStatus: "CLEAR",
          orderIdentity: null,
        },
        {
          id: "missing-readiness",
          outcome: "BLOCK",
          reasonCode: "UNEXPECTED_OR_UNMODELED_CONDITION",
          action: null,
          stopStatus: "STOPPED",
          orderIdentity: null,
        },
        {
          id: "invalid-market-metadata",
          outcome: "BLOCK",
          reasonCode: "UNEXPECTED_OR_UNMODELED_CONDITION",
          action: null,
          stopStatus: "STOPPED",
          orderIdentity: null,
        },
      ],
    },
    rules: ["RS_BUY_READINESS_REQUIRED", "RS_UNKNOWN_OUTCOME_NO_RETRY"],
    status: "PARTIAL",
    subcases: [
      {
        id: "RS-002-002-A",
        description: "readiness, missing-evidence and orphaned-commitment gates",
        status: "TEST-MAPPED",
        test: {
          file: testFile,
          title: "RS-002-002: BUY policy blocks known readiness failures and latches STOP for missing or orphaned evidence",
        },
        evidence: null,
      },
      {
        id: "RS-002-002-B",
        description: "authorization, legacy-basis and authoritative account-snapshot gates",
        status: "BLOCKED",
        test: null,
        blocker: {
          reason: "The BUY policy evaluator does not own the operator legacy-basis or account-snapshot contract; the scenario runner has not yet composed the real authorization and account-snapshot application boundary.",
          unblockCondition: "Add a composed application scenario through the real legacy authorization/custody context and shared action authorizer, proving missing/invalid basis and missing/stale account snapshots produce zero BUY submissions.",
        },
        evidence: null,
      },
    ],
  }),
  makeBuyCase({
    id: "RS-002-003",
    name: "the BUY policy produces the exact canonical initial BUY intent",
    layer: "DOMAIN",
    stepType: "evaluate-recovery-buy-policy-scenario",
    input: {
      cases: [{
        id: "initial-intent",
        overrides: {},
      }],
    },
    expected: {
      cases: [{
        id: "initial-intent",
        outcome: "SUBMIT",
        reasonCode: "BUY_TRANCHE_ELIGIBLE",
        action: {
          side: "BUY",
          purpose: "RECOVERY_BUY",
          cycleId: "rs-policy-cycle",
          positionId: "rs-policy-position",
          type: "LIMIT_MAKER",
          price: "1.999",
          quantity: "5",
          notional: "9.995",
          reason: "INITIAL_BUY",
        },
        stopStatus: "CLEAR",
        orderIdentity: null,
      }],
    },
    rules: ["RS_BUY_INTENT_CONTRACT"],
  }),
  makeBuyCase({
    id: "RS-002-004",
    name: "a canonical BUY Fill is attributed to the RS Position without changing CG accounting",
    input: {
      initialCGPosition: true,
      includePositionOwnerships: true,
      assertStrategyOwnership: true,
      originalQuantity: "1",
      fills: [{
        tradeId: "rs-owned-buy-fill",
        price: "10",
        quantity: "1",
        quoteQuantity: "10",
      }],
    },
    expected: {
      appliedFillIds: 2,
      position: {
        quantity: "1",
        spent: "10",
      },
      executionQuantity: "1",
      executionVwap: "10",
      positionStrategyId: "RS_recoverySeller",
      positions: [
        {
          positionId: "existing-cg-position",
          strategyId: "CG_coinGrabber",
          quantity: "3",
          spent: "6",
        },
        {
          positionId: "rs-buy-scenario-position",
          strategyId: "RS_recoverySeller",
          quantity: "1",
          spent: "10",
        },
      ],
    },
    rules: ["RS_STRATEGY_OWNERSHIP_ISOLATION"],
    invariants: ["RS_NO_CROSS_SUBSIDY"],
  }),
  makeBuyCase({
    id: "RS-002-005",
    name: "a full confirmed BUY Fill updates the RS Position and actual quote cost exactly once",
    input: {
      originalQuantity: "1",
      fills: [{
        tradeId: "rs-full-buy-fill",
        price: "10",
        quantity: "1",
        quoteQuantity: "10",
      }],
      assertStrategyOwnership: true,
    },
    expected: {
      appliedFillIds: 1,
      position: {
        quantity: "1",
        spent: "10",
      },
      executionQuantity: "1",
      executionVwap: "10",
      positionStrategyId: "RS_recoverySeller",
    },
    rules: ["RS_BUY_CONFIRMED_FILL_ONLY"],
    invariants: ["RS_QUANTITY_CONSERVATION"],
  }),
  makeBuyCase({
    id: "RS-002-006",
    name: "a partial BUY Fill accounts only confirmed quantity and cost while the remaining commitment stays reserved",
    input: {
      originalQuantity: "1",
      fills: [{
        tradeId: "rs-partial-buy-fill",
        price: "10",
        quantity: "0.4",
        quoteQuantity: "4",
        baseCommission: "0.0004",
      }],
    },
    expected: {
      appliedFillIds: 1,
      position: {
        quantity: "0.3996",
        spent: "4",
      },
      executionQuantity: "0.4",
      executionVwap: "10",
    },
    status: "PARTIAL",
    subcases: [
      {
        id: "RS-002-006-A",
        description: "the confirmed partial Fill changes only net acquired RS quantity and actual quote cost",
        status: "TEST-MAPPED",
        test: {
          file: testFile,
          title: "RS-002-006: a partial BUY Fill accounts only confirmed quantity and cost while the remaining commitment stays reserved",
        },
        evidence: null,
      },
      {
        id: "RS-002-006-B",
        description: "the unfilled portion of an OPEN or PARTIALLY_FILLED BUY remains reserved in the shared account allocator",
        status: "TEST-MAPPED",
        test: {
          file: "src/use-cases/create-recovery-seller-action-authorizer.test.js",
          title: "RS-002-006-B: keeps the unfilled portion of a partially filled RS BUY reserved in account allocation",
        },
        evidence: null,
      },
    ],
    rules: ["RS_BUY_CONFIRMED_FILL_ONLY", "RS_ACCOUNT_QUOTE_RESERVATION"],
    invariants: ["RS_RESERVATION_CONSERVATION"],
  }),
  makeBuyCase({
    id: "RS-002-007",
    name: "multiple BUY fills at different prices accumulate exact net base, quote cost and gross execution VWAP",
    input: {
      originalQuantity: "1",
      fills: [
        {
          tradeId: "rs-multiple-buy-fill-a",
          price: "10",
          quantity: "0.4",
          quoteQuantity: "4",
          baseCommission: "0.0004",
        },
        {
          tradeId: "rs-multiple-buy-fill-b",
          price: "11",
          quantity: "0.6",
          quoteQuantity: "6.6",
          baseCommission: "0.0006",
        },
      ],
    },
    expected: {
      appliedFillIds: 2,
      position: {
        quantity: "0.999",
        spent: "10.6",
      },
      executionQuantity: "1",
      executionVwap: "10.6",
    },
    rules: ["RS_BUY_NET_BASE_AFTER_FEES", "RS_BUY_ACTUAL_QUOTE_COST"],
    invariants: ["RS_QUANTITY_CONSERVATION", "RS_FINANCIAL_CONSERVATION"],
  }),
  makeBuyCase({
    id: "RS-002-008",
    name: "a BUY base-asset commission reduces net acquired Position quantity",
    input: {
      originalQuantity: "1",
      fills: [{
        tradeId: "rs-base-fee-buy-fill",
        price: "10",
        quantity: "1",
        quoteQuantity: "10",
        baseCommission: "0.001",
      }],
    },
    expected: {
      appliedFillIds: 1,
      position: {
        quantity: "0.999",
        spent: "10",
      },
      executionQuantity: "1",
      executionVwap: "10",
    },
    rules: ["RS_BUY_NET_BASE_AFTER_FEES"],
    invariants: ["RS_QUANTITY_CONSERVATION"],
  }),
  makeBuyCase({
    id: "RS-002-009",
    name: "a BUY quote-asset commission increases actual quote cost without reducing base quantity",
    input: {
      originalQuantity: "1",
      fills: [{
        tradeId: "rs-quote-fee-buy-fill",
        price: "10",
        quantity: "1",
        quoteQuantity: "10",
        quoteCommission: "0.01",
      }],
    },
    expected: {
      appliedFillIds: 1,
      position: {
        quantity: "1",
        spent: "10.01",
      },
      executionQuantity: "1",
      executionVwap: "10",
    },
    rules: ["RS_BUY_ACTUAL_QUOTE_COST"],
    invariants: ["RS_FINANCIAL_CONSERVATION"],
  }),
  makeBuyCase({
    id: "RS-002-010",
    name: "zero commission and multiple supported commission records are accounted exactly",
    stepType: "apply-recovery-buy-fee-record-scenarios",
    input: {
      zeroCommission: {
        originalQuantity: "1",
        fills: [{
          tradeId: "rs-zero-fee-buy-fill",
          price: "10",
          quantity: "1",
          quoteQuantity: "10",
        }],
      },
      multipleFeeRecords: {
        originalQuantity: "1",
        fills: [{
          tradeId: "rs-multiple-fee-buy-fill",
          price: "10",
          quantity: "1",
          quoteQuantity: "10",
          baseCommissions: ["0.001", "0.002"],
          quoteCommissions: ["0.01", "0.02"],
        }],
      },
    },
    expected: {
      zeroCommission: {
        appliedFillIds: 1,
        position: {
          quantity: "1",
          spent: "10",
        },
        executionQuantity: "1",
        executionVwap: "10",
      },
      multipleFeeRecords: {
        appliedFillIds: 1,
        position: {
          quantity: "0.997",
          spent: "10.03",
        },
        executionQuantity: "1",
        executionVwap: "10",
      },
    },
    subcases: [
      {
        id: "RS-002-010-A",
        description: "a canonical BUY Fill with no commission records preserves gross base and quote amounts",
        status: "TEST-MAPPED",
        test: {
          file: testFile,
          title: "RS-002-010: zero commission and multiple supported commission records are accounted exactly",
        },
        evidence: null,
      },
      {
        id: "RS-002-010-B",
        description: "multiple supported base and quote commission records are summed exactly by asset",
        status: "TEST-MAPPED",
        test: {
          file: testFile,
          title: "RS-002-010: zero commission and multiple supported commission records are accounted exactly",
        },
        evidence: null,
      },
    ],
    rules: ["RS_BUY_NET_BASE_AFTER_FEES", "RS_BUY_ACTUAL_QUOTE_COST"],
    invariants: ["RS_QUANTITY_CONSERVATION", "RS_FINANCIAL_CONSERVATION"],
  }),
  makeBuyCase({
    id: "RS-002-011",
    name: "replaying an identical canonical BUY Fill is an exact-once no-op",
    input: {
      originalQuantity: "1",
      fills: [{
        tradeId: "rs-replayed-buy-fill",
        price: "10",
        quantity: "1",
        quoteQuantity: "10",
      }],
      replayFirstFill: true,
    },
    expected: {
      appliedFillIds: 1,
      position: {
        quantity: "1",
        spent: "10",
      },
      executionQuantity: "1",
      executionVwap: "10",
      replay: {
        ok: true,
        applied: false,
        duplicate: true,
      },
    },
    rules: ["RS_CANONICAL_FILL_EXACT_ONCE"],
    invariants: ["RS_EXACT_ONCE"],
  }),
  makeBuyCase({
    id: "RS-002-012",
    name: "a third-asset BUY commission without authoritative quote valuation fails closed",
    input: {
      originalQuantity: "1",
      fills: [{
        tradeId: "rs-third-asset-fee-buy-fill",
        price: "10",
        quantity: "1",
        quoteQuantity: "10",
        thirdAssetCommission: "0.01",
      }],
    },
    expected: {
      appliedFillIds: 0,
      position: null,
      executionQuantity: null,
      executionVwap: null,
      results: [{
        ok: false,
        applied: false,
      }],
    },
    status: "PARTIAL",
    subcases: [
      {
        id: "RS-002-012-A",
        description: "missing authoritative execution-time quote valuation rejects the Fill before Portfolio mutation",
        status: "TEST-MAPPED",
        test: {
          file: testFile,
          title: "RS-002-012: a third-asset BUY commission without authoritative quote valuation fails closed",
        },
        evidence: null,
      },
      {
        id: "RS-002-012-B",
        description: "a third-asset commission with an approved authoritative execution-time quote value and freshness source is accepted",
        status: "BLOCKED",
        test: null,
        blocker: {
          reason: "No authoritative execution-time third-asset quote-value source and freshness contract is approved.",
          unblockCondition: "Approve the execution-time valuation source and identity/freshness contract, then test exact fee conversion and quote-cost attribution without using an operator-configured or fabricated rate.",
        },
        evidence: null,
      },
    ],
    rules: ["RS_BUY_ACTUAL_QUOTE_COST"],
    invariants: ["RS_FINANCIAL_CONSERVATION"],
  }),
  makeBuyCase({
    id: "RS-002-013",
    name: "reusing a canonical BUY Fill identity with changed quantity, price or commission is rejected atomically",
    input: {
      originalQuantity: "2",
      fills: [{
        tradeId: "rs-conflicting-buy-fill",
        price: "10",
        quantity: "1",
        quoteQuantity: "10",
      }],
      conflictFirstFill: true,
    },
    expected: {
      appliedFillIds: 1,
      position: {
        quantity: "1",
        spent: "10",
      },
      executionQuantity: "1",
      executionVwap: "10",
      conflict: {
        cases: [
          {
            id: "changed-quantity",
            ok: false,
            applied: false,
            appliedFillIds: 1,
            position: {
              quantity: "1",
              spent: "10",
            },
          },
          {
            id: "changed-price",
            ok: false,
            applied: false,
            appliedFillIds: 1,
            position: {
              quantity: "1",
              spent: "10",
            },
          },
          {
            id: "changed-commission",
            ok: false,
            applied: false,
            appliedFillIds: 1,
            position: {
              quantity: "1",
              spent: "10",
            },
          },
        ],
      },
    },
    subcases: [
      {
        id: "RS-002-013-A",
        description: "the same Fill ID with changed gross quantity is rejected without a second Portfolio mutation",
        status: "TEST-MAPPED",
        test: {
          file: testFile,
          title: "RS-002-013: reusing a canonical BUY Fill identity with changed quantity, price or commission is rejected atomically",
        },
        evidence: null,
      },
      {
        id: "RS-002-013-B",
        description: "the same Fill ID with changed execution price and quote quantity is rejected without changing the first result",
        status: "TEST-MAPPED",
        test: {
          file: testFile,
          title: "RS-002-013: reusing a canonical BUY Fill identity with changed quantity, price or commission is rejected atomically",
        },
        evidence: null,
      },
      {
        id: "RS-002-013-C",
        description: "the same Fill ID with changed commission facts is rejected without changing the first result",
        status: "TEST-MAPPED",
        test: {
          file: testFile,
          title: "RS-002-013: reusing a canonical BUY Fill identity with changed quantity, price or commission is rejected atomically",
        },
        evidence: null,
      },
    ],
    rules: ["RS_CANONICAL_FILL_EXACT_ONCE"],
    invariants: ["RS_EXACT_ONCE", "RS_CONFLICT_REJECTION"],
  }),
  makeBuyCase({
    id: "RS-002-014",
    name: "BUY fills with unowned, wrong-strategy, wrong-position, wrong-order, wrong-market or wrong-side identity are rejected",
    layer: "APPLICATION",
    stepType: "reject-invalid-buy-fill-ownership",
    input: {
      cases: [
        {
          id: "unowned-order",
          owned: false,
          fillInput: {
            tradeId: "rs-unowned-buy-fill",
            price: "10",
            quantity: "1",
            quoteQuantity: "10",
          },
        },
        {
          id: "wrong-strategy",
          strategyId: "CG_coinGrabber",
          fillInput: {
            tradeId: "rs-wrong-strategy-buy-fill",
            price: "10",
            quantity: "1",
            quoteQuantity: "10",
          },
        },
        {
          id: "wrong-position",
          seedPositionId: "foreign-position",
          seedFillInput: {
            tradeId: "rs-wrong-position-buy-fill",
            price: "10",
            quantity: "1",
            quoteQuantity: "10",
          },
          fillInput: {
            tradeId: "rs-wrong-position-buy-fill",
            price: "10",
            quantity: "1",
            quoteQuantity: "10",
          },
        },
        {
          id: "wrong-broker-order",
          fillInput: {
            tradeId: "rs-wrong-order-buy-fill",
            price: "10",
            brokerOrderId: "foreign-broker-order",
            quantity: "1",
            quoteQuantity: "10",
          },
        },
        {
          id: "wrong-market",
          fillInput: {
            tradeId: "rs-wrong-market-buy-fill",
            price: "10",
            marketSymbol: "ZROFDUSD",
            quantity: "1",
            quoteQuantity: "10",
          },
        },
        {
          id: "wrong-side",
          fillInput: {
            tradeId: "rs-wrong-side-buy-fill",
            price: "10",
            side: "SELL",
            quantity: "1",
            quoteQuantity: "10",
          },
        },
      ],
    },
    expected: {
      cases: [
        {
          id: "unowned-order",
          accepted: false,
          appliedFillIdsBefore: 0,
          appliedFillIdsAfter: 0,
          positionIdsBefore: [],
          positionIdsAfter: [],
        },
        {
          id: "wrong-strategy",
          accepted: false,
          appliedFillIdsBefore: 0,
          appliedFillIdsAfter: 0,
          positionIdsBefore: [],
          positionIdsAfter: [],
        },
        {
          id: "wrong-position",
          accepted: false,
          appliedFillIdsBefore: 1,
          appliedFillIdsAfter: 1,
          positionIdsBefore: ["foreign-position"],
          positionIdsAfter: ["foreign-position"],
        },
        {
          id: "wrong-broker-order",
          accepted: false,
          appliedFillIdsBefore: 0,
          appliedFillIdsAfter: 0,
          positionIdsBefore: [],
          positionIdsAfter: [],
        },
        {
          id: "wrong-market",
          accepted: false,
          appliedFillIdsBefore: 0,
          appliedFillIdsAfter: 0,
          positionIdsBefore: [],
          positionIdsAfter: [],
        },
        {
          id: "wrong-side",
          accepted: false,
          appliedFillIdsBefore: 0,
          appliedFillIdsAfter: 0,
          positionIdsBefore: [],
          positionIdsAfter: [],
        },
      ],
    },
    rules: ["RS_STRATEGY_OWNERSHIP_ISOLATION"],
    invariants: ["RS_STABLE_OWNERSHIP", "RS_NO_CROSS_SUBSIDY", "RS_CONFLICT_REJECTION"],
  }),
  makeBuyCase({
    id: "RS-002-015",
    name: "invalid BUY quantities and commission bounds fail before accounting mutation",
    stepType: "validate-rejected-buy-fill-values",
    input: {},
    expected: {
      zeroQuantityRejected: true,
      negativeQuantityRejected: true,
      negativeCommissionRejected: true,
      excessiveBaseCommissionRejected: true,
      appliedFillIds: 0,
      positionCount: 0,
    },
    status: "PARTIAL",
    subcases: [
      {
        id: "RS-002-015-A",
        description: "zero and negative canonical BUY quantities and negative commission amounts are rejected at value construction",
        status: "TEST-MAPPED",
        test: {
          file: testFile,
          title: "RS-002-015: invalid BUY quantities and commission bounds fail before accounting mutation",
        },
        evidence: null,
      },
      {
        id: "RS-002-015-B",
        description: "base commission greater than the canonical Fill gross base quantity is rejected without Portfolio mutation",
        status: "TEST-MAPPED",
        test: {
          file: testFile,
          title: "RS-002-015: invalid BUY quantities and commission bounds fail before accounting mutation",
        },
        evidence: null,
      },
      {
        id: "RS-002-015-C",
        description: "a canonical BUY Fill whose cumulative quantity exceeds registered order original quantity is rejected",
        status: "BLOCKED",
        test: null,
        blocker: {
          reason: "The current accounting workflow validates order identity and ownership but does not compare applied BUY Fill quantity against the registered order original quantity.",
          unblockCondition: "Add the approved order-event/accounting boundary check for cumulative executed quantity versus original quantity, then prove overfill rejection is atomic and does not mutate Portfolio or execution aggregates.",
        },
        evidence: null,
      },
      {
        id: "RS-002-015-D",
        description: "BUY Fill precision and exchange TradingRules bounds are enforced before accounting",
        status: "BLOCKED",
        test: null,
        blocker: {
          reason: "The direct accounting workflow has no TradingRules input and cannot prove exchange tick, step or notional validity.",
          unblockCondition: "Compose the production order-event/market-readiness boundary with canonical TradingRules and assert invalid precision is rejected before any Fill accounting mutation.",
        },
        evidence: null,
      },
    ],
    rules: ["RS_BUY_NET_BASE_AFTER_FEES", "RS_BUY_ACTUAL_QUOTE_COST"],
    invariants: ["RS_QUANTITY_CONSERVATION", "RS_FINANCIAL_CONSERVATION"],
  }),
  makeBuyCase({
    id: "RS-002-016",
    name: "multiple recovery BUY tranches leave the operator-declared legacy basis unchanged",
    input: {
      originalQuantity: "3",
      includeLegacyBasis: true,
      legacyInvested: "50",
      legacyQuantity: "10",
      fills: [
        {
          tradeId: "rs-tranche-buy-fill-a",
          price: "10",
          quantity: "1",
          quoteQuantity: "10",
          baseCommission: "0.001",
        },
        {
          tradeId: "rs-tranche-buy-fill-b",
          price: "12",
          quantity: "2",
          quoteQuantity: "24",
          quoteCommission: "0.024",
        },
      ],
      assertStrategyOwnership: true,
    },
    expected: {
      appliedFillIds: 2,
      position: {
        quantity: "2.999",
        spent: "34.024",
      },
      executionQuantity: "3",
      executionVwap: "11.333333333333333333",
      positionStrategyId: "RS_recoverySeller",
      legacyPosition: {
        invested: "50",
        originalQuantity: "10",
        averageCost: "5",
        remainingQuantity: "10",
      },
    },
    configFields: [
      "RS_PAIR.orderQuantity",
      "RS_PAIR.investment",
      "RS_PAIR.legacyPosition.invested",
      "RS_PAIR.legacyPosition.quantity",
    ],
    rules: ["RS_BUY_NET_BASE_AFTER_FEES", "RS_BUY_ACTUAL_QUOTE_COST"],
    invariants: ["RS_FINANCIAL_CONSERVATION", "RS_NO_CROSS_SUBSIDY"],
  }),
  makeBuyCase({
    id: "RS-002-017",
    name: "acknowledgement before fill, fill before acknowledgement and immediate terminal acknowledgement preserve BUY ownership",
    stepType: "process-recovery-buy-order-event-orderings",
    input: {
      cases: [
        {
          id: "ack-before-fill",
          quantity: "0.4",
          quoteQuantity: "4",
        },
        {
          id: "fill-before-ack",
          quantity: "0.4",
          quoteQuantity: "4",
        },
        {
          id: "immediate-terminal-ack",
          quantity: "1",
          quoteQuantity: "10",
        },
      ],
    },
    expected: {
      cases: [
        {
          id: "ack-before-fill",
          resultOk: true,
          eventCount: 2,
          orderStatus: "PARTIALLY_FILLED",
          orderBrokerOrderId: "broker-rs-order-event-buy",
          brokerCallCount: 0,
          pauseCount: 0,
          appliedFillIds: 1,
          position: {
            quantity: "0.4",
            spent: "4",
          },
          executionQuantity: "0.4",
          executionVwap: "10",
        },
        {
          id: "fill-before-ack",
          resultOk: true,
          eventCount: 1,
          orderStatus: "PARTIALLY_FILLED",
          orderBrokerOrderId: "broker-rs-order-event-buy",
          brokerCallCount: 0,
          pauseCount: 0,
          appliedFillIds: 1,
          position: {
            quantity: "0.4",
            spent: "4",
          },
          executionQuantity: "0.4",
          executionVwap: "10",
        },
        {
          id: "immediate-terminal-ack",
          resultOk: true,
          eventCount: 1,
          orderStatus: "FILLED",
          orderBrokerOrderId: "broker-rs-order-event-buy",
          brokerCallCount: 1,
          pauseCount: 0,
          appliedFillIds: 1,
          position: {
            quantity: "1",
            spent: "10",
          },
          executionQuantity: "1",
          executionVwap: "10",
        },
      ],
    },
    subcases: [
      {
        id: "RS-002-017-A",
        description: "an acknowledged BUY order accepts its later partial TRADE event and applies the canonical Fill exactly once",
        status: "TEST-MAPPED",
        test: {
          file: testFile,
          title: "RS-002-017: acknowledgement before fill, fill before acknowledgement and immediate terminal acknowledgement preserve BUY ownership",
        },
        evidence: null,
      },
      {
        id: "RS-002-017-B",
        description: "a partial TRADE event arriving before a separate acknowledgement attaches broker identity and applies the owned Fill exactly once",
        status: "TEST-MAPPED",
        test: {
          file: testFile,
          title: "RS-002-017: acknowledgement before fill, fill before acknowledgement and immediate terminal acknowledgement preserve BUY ownership",
        },
        evidence: null,
      },
      {
        id: "RS-002-017-C",
        description: "an immediate FILLED acknowledgement reconciles broker Fill history and applies the BUY accounting exactly once",
        status: "TEST-MAPPED",
        test: {
          file: testFile,
          title: "RS-002-017: acknowledgement before fill, fill before acknowledgement and immediate terminal acknowledgement preserve BUY ownership",
        },
        evidence: null,
      },
    ],
    implementation: [
      "apps/harvester/src/use-cases/order-event-workflow.js",
      "apps/harvester/src/use-cases/create-user-data-event-transition.js",
      "apps/harvester/src/use-cases/reconcile-terminal-order-fills.js",
    ],
    rules: ["RS_BUY_CONFIRMED_FILL_ONLY", "RS_CANONICAL_FILL_EXACT_ONCE"],
    invariants: ["RS_STABLE_OWNERSHIP", "RS_EXACT_ONCE", "RS_RECONCILIATION_CONTINUES"],
  }),
  makeBuyCase({
    id: "RS-002-018",
    name: "an unknown BUY submission is durably retained after one broker call and latches STOP",
    stepType: "submit-recovery-buy-with-unknown-outcome",
    input: {},
    expected: {
      brokerCallCount: 1,
      resultOk: false,
      unresolvedCount: 1,
      durableFactCount: 2,
      activeOrderStatus: "UNKNOWN",
      stopStatus: "STOPPED",
    },
    rules: ["RS_UNKNOWN_OUTCOME_NO_RETRY", "RS_BUY_ACTIVE_ORDER_GATE"],
    invariants: [
      "RS_STOP_INVESTMENT_ONLY",
      "RS_RECONCILIATION_CONTINUES",
    ],
    status: "PARTIAL",
    subcases: [
      {
        id: "RS-002-018-A",
        description: "unknown submission persists intent/outcome, retains the owned UNKNOWN order and latches STOP after exactly one broker call",
        status: "TEST-MAPPED",
        test: {
          file: testFile,
          title: "RS-002-018: an unknown BUY submission is durably retained after one broker call and latches STOP",
        },
        evidence: null,
      },
      {
        id: "RS-002-018-B",
        description: "follow-up order reconciliation continues while STOP is latched",
        status: "BLOCKED",
        test: null,
        blocker: {
          reason: "The current BUY evaluator returns BLOCK before reconciling an already-owned UNKNOWN BUY while STOP is latched. The owner-approved STOP contract requires existing orders to continue WAIT/RECONCILE; STOP is investment-only.",
          unblockCondition: "Implement the separately authorized production STOP/evaluator correction so an existing owned UNKNOWN order remains reconcilable while new BUY submissions remain blocked; then change this scenario oracle to require RECONCILE and prove zero replacement broker calls.",
        },
        evidence: null,
      },
    ],
  }),
  makeBuyCase({
    id: "RS-002-019",
    name: "open and partially filled RS BUY orders suppress every additional BUY intent",
    layer: "DOMAIN",
    stepType: "evaluate-recovery-buy-policy-scenario",
    input: {
      cases: [
        {
          id: "open",
          overrides: {
            activeOrders: [{
              market: { symbol: "ZROUSDT" },
              side: "BUY",
              status: "OPEN",
              clientOrderId: "rs-buy-open",
              brokerOrderId: "broker-rs-open",
              ownership: {
                strategyId: "RS_recoverySeller",
                purpose: "RECOVERY_BUY",
                positionId: "rs-policy-position",
                cycleId: "rs-policy-cycle",
              },
            }],
          },
        },
        {
          id: "partially-filled",
          overrides: {
            activeOrders: [{
              market: { symbol: "ZROUSDT" },
              side: "BUY",
              status: "PARTIALLY_FILLED",
              clientOrderId: "rs-buy-partial",
              brokerOrderId: "broker-rs-partial",
              ownership: {
                strategyId: "RS_recoverySeller",
                purpose: "RECOVERY_BUY",
                positionId: "rs-policy-position",
                cycleId: "rs-policy-cycle",
              },
            }],
          },
        },
      ],
    },
    expected: {
      cases: [
        {
          id: "open",
          outcome: "WAIT",
          reasonCode: "WAIT_FOR_EXISTING_RS_BUY",
          action: null,
          stopStatus: "CLEAR",
          orderIdentity: {
            clientOrderId: "rs-buy-open",
            brokerOrderId: "broker-rs-open",
          },
        },
        {
          id: "partially-filled",
          outcome: "WAIT",
          reasonCode: "WAIT_FOR_EXISTING_RS_BUY",
          action: null,
          stopStatus: "CLEAR",
          orderIdentity: {
            clientOrderId: "rs-buy-partial",
            brokerOrderId: "broker-rs-partial",
          },
        },
      ],
    },
    rules: ["RS_BUY_ACTIVE_ORDER_GATE"],
  }),
  makeBuyCase({
    id: "RS-002-020",
    name: "the per-pair investment limit enforces exact below, equal and above boundaries",
    status: "PARTIAL",
    subcases: [
      {
        id: "RS-002-020-A",
        description: "the cap rejects below-limit exposure and permits exact equality using already-spent recovery quote",
        status: "TEST-MAPPED",
        test: {
          file: testFile,
          title: "RS-002-020: the per-pair investment limit enforces exact below, equal and above boundaries",
        },
        evidence: null,
      },
      {
        id: "RS-002-020-B",
        description: "a positive pending BUY commitment is included exactly once in cap arithmetic",
        status: "TEST-MAPPED",
        test: {
          file: "src/use-cases/create-recovery-seller-action-authorizer.test.js",
          title: "RS-002-020-B: counts an owned pending BUY commitment exactly once at the pair investment cap",
        },
        evidence: null,
      },
    ],
    layer: "DOMAIN",
    stepType: "evaluate-recovery-buy-policy-scenario",
    input: {
      cases: [
        {
          id: "below",
          overrides: {
            pairConfig: {
              orderQuantity: "5",
              priceStepPercent: "0.05",
              investment: "19.994",
            },
            recoveryPosition: {
              positionId: "rs-policy-position",
              quantity: "5",
              spent: "10",
            },
            lastBuyPrice: "2",
          },
        },
        {
          id: "equal",
          overrides: {
            pairConfig: {
              orderQuantity: "5",
              priceStepPercent: "0.05",
              investment: "19.995",
            },
            recoveryPosition: {
              positionId: "rs-policy-position",
              quantity: "5",
              spent: "10",
            },
            lastBuyPrice: "2",
          },
        },
        {
          id: "above",
          overrides: {
            pairConfig: {
              orderQuantity: "5",
              priceStepPercent: "0.05",
              investment: "19.996",
            },
            recoveryPosition: {
              positionId: "rs-policy-position",
              quantity: "5",
              spent: "10",
            },
            lastBuyPrice: "2",
          },
        },
        {
          id: "equal-with-existing-exposure",
          overrides: {
            pairConfig: {
              orderQuantity: "5",
              priceStepPercent: "0.05",
              investment: "20",
            },
            recoveryPosition: {
              positionId: "rs-policy-position",
              quantity: "5",
              spent: "10.005",
            },
            lastBuyPrice: "2",
          },
        },
      ],
    },
    expected: {
      cases: [
        {
          id: "below",
          outcome: "BLOCK",
          reasonCode: "INVESTMENT_LIMIT_REACHED",
          action: null,
          stopStatus: "CLEAR",
          orderIdentity: null,
        },
        {
          id: "equal",
          outcome: "SUBMIT",
          reasonCode: "BUY_TRANCHE_ELIGIBLE",
          action: {
            side: "BUY",
            purpose: "RECOVERY_BUY",
            cycleId: "rs-policy-cycle",
            positionId: "rs-policy-position",
            type: "LIMIT_MAKER",
            price: "1.999",
            quantity: "5",
            notional: "9.995",
            reason: "NEXT_STANDING_BUY",
          },
          stopStatus: "CLEAR",
          orderIdentity: null,
        },
        {
          id: "above",
          outcome: "SUBMIT",
          reasonCode: "BUY_TRANCHE_ELIGIBLE",
          action: {
            side: "BUY",
            purpose: "RECOVERY_BUY",
            cycleId: "rs-policy-cycle",
            positionId: "rs-policy-position",
            type: "LIMIT_MAKER",
            price: "1.999",
            quantity: "5",
            notional: "9.995",
            reason: "NEXT_STANDING_BUY",
          },
          stopStatus: "CLEAR",
          orderIdentity: null,
        },
        {
          id: "equal-with-existing-exposure",
          outcome: "SUBMIT",
          reasonCode: "BUY_TRANCHE_ELIGIBLE",
          action: {
            side: "BUY",
            purpose: "RECOVERY_BUY",
            cycleId: "rs-policy-cycle",
            positionId: "rs-policy-position",
            type: "LIMIT_MAKER",
            price: "1.999",
            quantity: "5",
            notional: "9.995",
            reason: "NEXT_STANDING_BUY",
          },
          stopStatus: "CLEAR",
          orderIdentity: null,
        },
      ],
    },
    rules: ["RS_BUY_BUDGET_LIMIT"],
  }),
  makeBuyCase({
    id: "RS-002-021",
    name: "RS keeps its own pair investment cap and shared account reservations include CG commitments",
    stepType: "evaluate-recovery-buy-budget-isolation",
    input: {
      otherStrategyInvestment: "1000",
    },
    expected: {
      otherStrategyInvestment: "1000",
      rsPairBudgetOutcome: "BLOCK",
      rsPairBudgetReason: "INVESTMENT_LIMIT_REACHED",
      sharedAccountAllocation: {
        ok: true,
        allowed: false,
        skipped: true,
        reason: "INSUFFICIENT_QUOTE_BALANCE",
      },
      stopLatchCount: 0,
    },
    rules: [
      "RS_NO_CROSS_SUBSIDY",
      "RS_BUY_BUDGET_LIMIT",
      "RS_ACCOUNT_QUOTE_RESERVATION",
    ],
  }),
])
