import { defineRecoverySellerScenario } from "../registry/define-scenario.js"

const testFile = "apps/harvester/test/scenarios/recovery-seller/buy-accounting.scenario.test.js"
const workflowSource = "apps/harvester/src/use-cases/create-recovery-seller-accounting-workflow.js"
const portfolioSource = "apps/harvester/src/domain/portfolio/portfolio.js"
const buyPolicySource = "apps/harvester/src/domain/strategies/recovery-seller/evaluate-buy-decision.js"

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
    configFields: [
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
    mustNot: [
      "create recovery inventory from a submitted or acknowledged BUY without a confirmed canonical Fill",
      "derive invested quote cost from the limit price when actual Fill quote quantity is available",
      "apply one canonical Fill more than once",
      "adopt an external Fill without immutable RS order ownership",
    ],
    subcases: mappings.subcases,
    implementation: [
      workflowSource,
      portfolioSource,
      buyPolicySource,
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
  blockedCase({
    id: "RS-002-017",
    name: "fill-before-acknowledgement and immediate terminal acknowledgement preserve ownership",
    reason: "The current RS accounting workflow requires a broker-order identity already registered in OrderRegistry; the new scenario boundary does not yet compose out-of-order broker events through the real order-event workflow.",
    unblockCondition: "Add application scenarios that deliver fill-before-ack, acknowledgement-before-fill and immediate terminal acknowledgement through the production order-event workflow with controlled event ordering.",
  }),
  makeBuyCase({
    id: "RS-002-018",
    name: "an unknown BUY submission is durably retained and STOP blocks replacement; reconciliation remains blocked",
    stepType: "submit-recovery-buy-with-unknown-outcome",
    input: {},
    expected: {
      brokerCallCount: 1,
      resultOk: false,
      unresolvedCount: 1,
      durableFactCount: 2,
      activeOrderStatus: "UNKNOWN",
      stopStatus: "STOPPED",
      followupOutcome: "BLOCK",
      followupAction: null,
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
          title: "RS-002-018: an unknown BUY submission is durably retained and STOP blocks replacement; reconciliation remains blocked",
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
