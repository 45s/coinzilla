import { defineRecoverySellerScenario } from "../registry/define-scenario.js"

const testFile = "apps/harvester/test/scenarios/recovery-seller/buy-accounting.scenario.test.js"
const workflowSource = "apps/harvester/src/use-cases/create-recovery-seller-accounting-workflow.js"
const portfolioSource = "apps/harvester/src/domain/portfolio/portfolio.js"

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

function makeBuyCase({
  id,
  name,
  input,
  expected,
  rules = [],
  invariants = [],
  status = "TEST-MAPPED",
  blocker,
  subcases,
}) {
  const title = `${id}: ${name}`
  const test = status === "BLOCKED" ? null : {
    file: testFile,
    title,
  }
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
        ...invariants,
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
    subcases: subcases ?? createBuySubcases({
      id,
      name,
      status,
      blocker,
      title,
    }),
    implementation: [workflowSource, portfolioSource],
    test,
    status,
    evidence: null,
    ...(status === "BLOCKED" ? { blocker } : {}),
  })
}

function blockedCase({ id, name, reason, unblockCondition }) {
  return makeBuyCase({
    id,
    name,
    input: {},
    expected: { blocked: true },
    status: "BLOCKED",
    blocker: {
      reason,
      unblockCondition,
    },
  })
}

export const recoverySellerBuyAccountingScenarios = Object.freeze([
  makeBuyCase({
    id: "RS-002-001",
    name: "a valid initial BUY order creates no recovery inventory before a confirmed Fill",
    input: { fills: [] },
    expected: {
      appliedFillIds: 0,
      position: null,
      executionQuantity: null,
      executionVwap: null,
    },
    rules: ["RS_BUY_CONFIRMED_FILL_ONLY"],
  }),
  blockedCase({
    id: "RS-002-002",
    name: "BUY eligibility fails closed when authorization, readiness, snapshot, budget or safety evidence is invalid",
    reason: "The current scenario runner has no composed BUY evaluator/action-authorizer boundary that accepts the complete authorization, market-readiness, account-snapshot and strategy-budget inputs as one real application decision.",
    unblockCondition: "Add an offline application scenario around the production BUY evaluator and shared action authorizer; assert each missing/invalid evidence gate and zero broker submissions without changing production policy.",
  }),
  blockedCase({
    id: "RS-002-003",
    name: "the submitted BUY intent preserves exact identity, market, side, type, price, quantity, commitment and reason",
    reason: "The production BUY submission path is not yet exposed as one scenario-runner operation with an observable intent and broker-call boundary.",
    unblockCondition: "Add a deterministic offline application fixture around the real BUY evaluator, intent builder, shared authorizer and submitter; assert the complete canonical intent and exact broker-call count.",
  }),
  makeBuyCase({
    id: "RS-002-005",
    name: "a confirmed BUY Fill is attributed to the registered RS Position and never to CG",
    input: {
      fills: [{
        tradeId: "rs-buy-owner-1",
        quantity: "5.01",
        quoteQuantity: "10.02",
      }],
      assertStrategyOwnership: true,
    },
    expected: {
      appliedFillIds: 1,
      position: {
        quantity: "5.01",
        spent: "10.02",
      },
      positionStrategyId: "RS_recoverySeller",
      executionQuantity: "5.01",
      executionVwap: "2",
    },
    rules: ["RS_BUY_CONFIRMED_FILL_ONLY", "RS_STRATEGY_OWNERSHIP_ISOLATION"],
  }),
  makeBuyCase({
    id: "RS-002-006",
    name: "a full BUY Fill updates the shared Portfolio and RS Position exactly once",
    input: {
      fills: [{
        tradeId: "rs-buy-full-1",
        quantity: "5.01",
        quoteQuantity: "10.02",
      }],
    },
    expected: {
      appliedFillIds: 1,
      position: {
        quantity: "5.01",
        spent: "10.02",
      },
      executionQuantity: "5.01",
      executionVwap: "2",
    },
    rules: ["RS_BUY_CONFIRMED_FILL_ONLY", "RS_BUY_ACTUAL_QUOTE_COST"],
  }),
  makeBuyCase({
    id: "RS-002-007",
    name: "a partial BUY Fill records only executed quantity and leaves the remainder unfilled",
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
    rules: ["RS_BUY_CONFIRMED_FILL_ONLY", "RS_BUY_ACTUAL_QUOTE_COST"],
  }),
  makeBuyCase({
    id: "RS-002-008",
    name: "multiple BUY fills at different prices accumulate exact cost, net base and execution VWAP",
    input: {
      fills: [
        {
          tradeId: "rs-buy-multiple-1",
          quantity: "2.5",
          quoteQuantity: "5",
          price: "2",
        },
        {
          tradeId: "rs-buy-multiple-2",
          quantity: "2.5",
          quoteQuantity: "10",
          price: "4",
        },
      ],
    },
    expected: {
      appliedFillIds: 2,
      position: {
        quantity: "5",
        spent: "15",
      },
      executionQuantity: "5",
      executionVwap: "3",
    },
    rules: ["RS_BUY_CONFIRMED_FILL_ONLY", "RS_BUY_ACTUAL_QUOTE_COST"],
  }),
  makeBuyCase({
    id: "RS-002-009",
    name: "a BUY base-asset commission reduces acquired net base",
    input: {
      fills: [{
        tradeId: "rs-buy-base-fee-1",
        quantity: "2.5",
        quoteQuantity: "5",
        baseCommission: "0.01",
      }],
    },
    expected: {
      appliedFillIds: 1,
      position: {
        quantity: "2.49",
        spent: "5",
      },
      executionQuantity: "2.5",
      executionVwap: "2",
    },
    rules: ["RS_BUY_NET_BASE_AFTER_FEES"],
  }),
  makeBuyCase({
    id: "RS-002-010",
    name: "a BUY quote-asset commission increases actual quote cost",
    input: {
      fills: [{
        tradeId: "rs-buy-quote-fee-1",
        quantity: "2.5",
        quoteQuantity: "5",
        quoteCommission: "0.005",
      }],
    },
    expected: {
      appliedFillIds: 1,
      position: {
        quantity: "2.5",
        spent: "5.005",
      },
      executionQuantity: "2.5",
      executionVwap: "2",
    },
    rules: ["RS_BUY_ACTUAL_QUOTE_COST"],
  }),
  makeBuyCase({
    id: "RS-002-011",
    name: "zero commission and multiple supported base and quote fee records are accounted exactly",
    input: {
      fills: [
        {
          tradeId: "rs-buy-zero-fee-1",
          quantity: "1",
          quoteQuantity: "2",
        },
        {
          tradeId: "rs-buy-multiple-fees-1",
          quantity: "2.5",
          quoteQuantity: "5",
          baseCommissions: ["0.01", "0.005"],
          quoteCommissions: ["0.005", "0.002"],
        },
      ],
    },
    expected: {
      appliedFillIds: 2,
      position: {
        quantity: "3.485",
        spent: "7.007",
      },
      executionQuantity: "3.5",
      executionVwap: "2",
    },
    rules: [
      "RS_BUY_NET_BASE_AFTER_FEES",
      "RS_BUY_ACTUAL_QUOTE_COST",
    ],
  }),
  makeBuyCase({
    id: "RS-002-012",
    name: "an unvalued third-asset BUY commission fails closed and is never treated as zero",
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
    rules: ["RS_BUY_ACTUAL_QUOTE_COST"],
    status: "PARTIAL",
    subcases: [
      {
        id: "RS-002-012-A",
        description: "missing third-asset quote valuation fails closed",
        status: "TEST-MAPPED",
        test: {
          file: testFile,
          title: "RS-002-012: an unvalued third-asset BUY commission fails closed and is never treated as zero",
        },
        evidence: null,
      },
      {
        id: "RS-002-012-B",
        description: "successful third-asset valuation is blocked until an authoritative execution-time source is approved",
        status: "BLOCKED",
        test: null,
        blocker: {
          reason: "No authoritative execution-time quote-value source is approved for third-asset commissions.",
          unblockCondition: "Approve a source with asset identity, quote asset, rate/value and freshness semantics, then add a successful valuation scenario.",
        },
        evidence: null,
      },
    ],
  }),
  makeBuyCase({
    id: "RS-002-013",
    name: "an identical canonical BUY Fill replay is an exact no-op",
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
    rules: ["RS_CANONICAL_FILL_EXACT_ONCE"],
  }),
  makeBuyCase({
    id: "RS-002-014",
    name: "the same canonical Fill identity with changed execution facts is rejected atomically",
    input: {
      fills: [{
        tradeId: "rs-buy-conflict-1",
        quantity: "2.5",
        quoteQuantity: "5",
      }],
      conflictFirstFill: true,
    },
    expected: {
      appliedFillIds: 1,
      position: {
        quantity: "2.5",
        spent: "5",
      },
      executionQuantity: "2.5",
      executionVwap: "2",
      conflict: {
        ok: false,
        applied: false,
      },
    },
    rules: ["RS_CANONICAL_FILL_EXACT_ONCE"],
    invariants: ["RS_CONFLICT_REJECTION"],
  }),
  makeBuyCase({
    id: "RS-002-015",
    name: "wrong broker identity and external unowned BUY fills cannot mutate the RS Position",
    input: {
      owned: false,
      fills: [
        {
          tradeId: "rs-buy-wrong-broker-1",
          quantity: "1",
          quoteQuantity: "2",
          brokerOrderId: "unowned-broker-order",
        },
        {
          tradeId: "rs-buy-unowned-1",
          quantity: "1",
          quoteQuantity: "2",
        },
      ],
    },
    expected: {
      appliedFillIds: 0,
      position: null,
      executionQuantity: null,
      executionVwap: null,
      results: [
        {
          ok: false,
          applied: false,
        },
        {
          ok: false,
          applied: false,
        },
      ],
    },
    rules: ["RS_STRATEGY_OWNERSHIP_ISOLATION"],
  }),
  makeBuyCase({
    id: "RS-002-016",
    name: "a base commission exceeding executed quantity fails without negative recovery inventory",
    input: {
      fills: [{
        tradeId: "rs-buy-invalid-base-fee-1",
        quantity: "2.5",
        quoteQuantity: "5",
        baseCommission: "3",
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
    rules: ["RS_BUY_NET_BASE_AFTER_FEES"],
  }),
  blockedCase({
    id: "RS-002-017",
    name: "fill-before-acknowledgement and immediate terminal acknowledgement preserve ownership",
    reason: "The current RS accounting workflow requires a broker-order identity already registered in OrderRegistry; the new scenario boundary does not yet compose out-of-order broker events through the real order-event workflow.",
    unblockCondition: "Add application scenarios that deliver fill-before-ack, acknowledgement-before-fill and immediate terminal acknowledgement through the production order-event workflow with controlled event ordering.",
  }),
  blockedCase({
    id: "RS-002-018",
    name: "an unknown BUY submission retains identity and commitment and blocks replacement",
    reason: "The current new scenario runner exercises accounting after canonical order registration, not the durable BUY submitter's unknown-outcome and reservation boundary.",
    unblockCondition: "Add an offline application scenario around the real submitter and durable intent/outcome callbacks; assert exact broker-call count, retained client identity and quote reservation until authoritative reconciliation.",
  }),
  blockedCase({
    id: "RS-002-019",
    name: "open, partial and unknown BUY lifecycle states block another BUY",
    reason: "The scenario runner does not yet drive the real BUY decision and action-authorizer boundary across pending/open/partial/unknown lifecycle states.",
    unblockCondition: "Add the production transition evaluator and shared action authorizer to the application scenario harness; assert no second BUY intent or broker call while the prior BUY remains active or unresolved.",
  }),
  blockedCase({
    id: "RS-002-020",
    name: "investment cap below, at and above the exact boundary includes committed quote once",
    reason: "The scenario runner currently does not compose the production BUY investment-limit evaluator with snapshot-relative account commitments.",
    unblockCondition: "Add boundary scenarios through the real BUY evaluator and shared allocator for below/equal/above investment limit, including open and partially filled quote commitments.",
  }),
  blockedCase({
    id: "RS-002-021",
    name: "RS per-pair investment budget cannot borrow unused CG or other-strategy budget",
    reason: "The scenario runner does not yet compose strategy-specific investment budgets with the account-wide shared quote allocator for competing CG/RS intents.",
    unblockCondition: "Add a same-market offline CG/RS application scenario with separate pair budgets and shared quote availability; assert budget rejection/deferment and exact broker-call count for each strategy.",
  }),
])
