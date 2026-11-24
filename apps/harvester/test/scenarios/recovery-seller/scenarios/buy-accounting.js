import { defineRecoverySellerScenario } from "../registry/define-scenario.js"

const testFile = "apps/harvester/test/scenarios/recovery-seller/authorization-custody.scenario.test.js"
const workflowSource = "apps/harvester/src/use-cases/create-recovery-seller-accounting-workflow.js"
const portfolioSource = "apps/harvester/src/domain/portfolio/portfolio.js"

function makeBuyCase({ id, name, input, expected, testTitle, rules = [] }) {
  const title = `${id}: ${name}`
  return defineRecoverySellerScenario({
    id,
    family: "RS-002",
    name,
    priority: "P0",
    authority: [
      "apps/harvester/docs/domain/recovery-seller-domain-specification.md#6-buy-tranche-accumulation-and-eligibility",
      "issue-1780: RS-002 BUY accounting",
    ],
    layer: "APPLICATION",
    configFields: [
      "RS_PAIR.orderQuantity",
      "RS_PAIR.investment",
    ],
    covers: {
      rules,
      decisions: ["RS_BUY_ELIGIBILITY"],
      states: ["ACCUMULATING"],
      transitions: [],
      invariants: [
        "RS_STABLE_OWNERSHIP",
        "RS_EXACT_ONCE",
        "RS_FINANCIAL_CONSERVATION",
      ],
    },
    given: { input },
    when: [{
      type: "apply-recovery-buy-scenario",
      inputKey: "input",
      saveAs: "actual",
    }],
    then: expected,
    mustNot: [
      "create recovery inventory from a submitted or acknowledged BUY without a confirmed canonical Fill",
      "derive invested quote cost from the limit price when actual Fill quote quantity is available",
      "apply one canonical Fill more than once",
      "adopt an external Fill without immutable RS order ownership",
    ],
    subcases: [{
      id: `${id}-A`,
      description: name,
      status: "TEST-MAPPED",
      test: {
        file: testFile,
        title: testTitle ?? title,
      },
      evidence: null,
    }],
    implementation: [workflowSource, portfolioSource],
    test: {
      file: testFile,
      title: testTitle ?? title,
    },
    status: "TEST-MAPPED",
    evidence: null,
  })
}

export const recoverySellerBuyAccountingScenarios = Object.freeze([
  makeBuyCase({
    id: "RS-002-001",
    rules: ["RS_BUY_CONFIRMED_FILL_ONLY"],
    name: "an acknowledged BUY without a confirmed fill creates no recovery inventory",
    input: {
      fills: [],
    },
    expected: {
      appliedFillIds: 0,
      position: null,
      executionQuantity: null,
      executionVwap: null,
    },
  }),
  makeBuyCase({
    id: "RS-002-002",
    rules: ["RS_BUY_CONFIRMED_FILL_ONLY", "RS_BUY_ACTUAL_QUOTE_COST"],
    name: "a confirmed partial BUY fill contributes only its actual base and quote execution",
    input: {
      fills: [{
        tradeId: "rs-buy-partial-1",
        quantity: "2.5",
        quoteQuantity: "5",
      }],
    },
    expected: {
      appliedFillIds: 1,
      position: {
        quantity: "2.5",
        spent: "5",
      },
      executionQuantity: "2.5",
      executionVwap: "2",
    },
  }),
  makeBuyCase({
    id: "RS-002-003",
    rules: ["RS_BUY_CONFIRMED_FILL_ONLY", "RS_BUY_ACTUAL_QUOTE_COST"],
    name: "multiple BUY fills accumulate actual quote cost and cycle execution VWAP",
    input: {
      fills: [
        {
          tradeId: "rs-buy-accumulated-1",
          quantity: "2.5",
          quoteQuantity: "5",
        },
        {
          tradeId: "rs-buy-accumulated-2",
          quantity: "2.51",
          quoteQuantity: "5.02",
        },
      ],
    },
    expected: {
      appliedFillIds: 2,
      position: {
        quantity: "5.01",
        spent: "10.02",
      },
      executionQuantity: "5.01",
      executionVwap: "2",
    },
  }),
  makeBuyCase({
    id: "RS-002-004",
    rules: ["RS_BUY_CONFIRMED_FILL_ONLY", "RS_BUY_ACTUAL_QUOTE_COST"],
    name: "an identical BUY Fill replay is an exact no-op",
    input: {
      fills: [{
        tradeId: "rs-buy-duplicate-1",
        quantity: "2.5",
        quoteQuantity: "5",
      }],
      replayFirstFill: true,
    },
    expected: {
      appliedFillIds: 1,
      position: {
        quantity: "2.5",
        spent: "5",
      },
      executionQuantity: "2.5",
      executionVwap: "2",
      replay: {
        ok: true,
        applied: false,
        duplicate: true,
      },
    },
  }),
  makeBuyCase({
    id: "RS-002-005",
    rules: ["RS_BUY_CONFIRMED_FILL_ONLY"],
    name: "a BUY Fill with a conflicting broker order identity fails without Portfolio mutation",
    input: {
      fills: [{
        tradeId: "rs-buy-mismatch-1",
        quantity: "1",
        quoteQuantity: "2",
        brokerOrderId: "unowned-broker-order",
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
  }),
  makeBuyCase({
    id: "RS-002-006",
    rules: ["RS_BUY_CONFIRMED_FILL_ONLY"],
    name: "an external BUY Fill without registered RS ownership is not adopted",
    input: {
      fills: [{
        tradeId: "rs-buy-external-1",
        quantity: "1",
        quoteQuantity: "2",
      }],
      owned: false,
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
  }),
  makeBuyCase({
    id: "RS-002-007",
    name: "BUY base, quote and valued third-asset commissions affect net inventory and actual cost",
    rules: ["RS_BUY_NET_BASE_AFTER_FEES", "RS_BUY_ACTUAL_QUOTE_COST"],
    input: {
      fills: [{
        tradeId: "rs-buy-fees-1",
        quantity: "2.5",
        quoteQuantity: "5",
        baseCommission: "0.01",
        quoteCommission: "0.005",
        thirdAssetCommission: "0.01",
        thirdAssetQuoteValue: "0.02",
      }],
    },
    expected: {
      appliedFillIds: 1,
      position: {
        quantity: "2.49",
        spent: "5.025",
      },
      executionQuantity: "2.5",
      executionVwap: "2",
    },
  }),
  makeBuyCase({
    id: "RS-002-008",
    name: "an unvalued third-asset BUY commission fails closed before Portfolio mutation",
    rules: ["RS_BUY_NET_BASE_AFTER_FEES", "RS_BUY_ACTUAL_QUOTE_COST"],
    input: {
      fills: [{
        tradeId: "rs-buy-unvalued-fee-1",
        quantity: "2.5",
        quoteQuantity: "5",
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
  }),
])
