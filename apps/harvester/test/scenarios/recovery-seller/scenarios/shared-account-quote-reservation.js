import { defineRecoverySellerScenario } from "../registry/define-scenario.js"

const testFile = "apps/harvester/src/use-cases/conservative-trading-engine.multi-market.test.js"
const testTitle = "RS-008-018-A: RS-owned quote reservation blocks CG BUY across markets"

export const recoverySellerSharedQuoteReservationScenario = defineRecoverySellerScenario({
  id: "RS-008-018",
  family: "RS-008",
  name: "an RS-owned BUY commitment reduces shared account quote available to CG on another market",
  priority: "P0",
  authority: [
    "apps/harvester/docs/domain/recovery-seller-scenario-testing.md#rs-008--cg-rs-shared-account-resources-and-concurrency-p0",
    "issue-1780: RS-008 shared quote availability across CG/RS concurrent intents",
  ],
  layer: "APPLICATION",
  configFields: [],
  covers: {
    rules: [],
    decisions: [],
    states: [],
    transitions: [],
    invariants: [],
  },
  given: {
    input: {
      quoteFreeBalance: "150",
      rsMarketSymbol: "DOGEUSDT",
      rsBuyQuoteCommitment: "100",
      cgMarketSymbol: "SOLUSDT",
      cgBuyQuoteRequirement: "100",
    },
  },
  when: [{
    type: "evaluate-cg-buy-with-rs-quote-commitment",
    inputKey: "input",
  }],
  then: {
    waitingForAvailableQuoteBalance: true,
    deferredReason: "INSUFFICIENT_QUOTE_BALANCE",
    submittedCgBuyOrders: 0,
  },
  mustNot: [
    "double-spend quote reserved by the RS-owned BUY",
    "transfer the RS order ownership or Position attribution to CG",
    "submit a CG BUY when the account-wide free quote is insufficient",
    "connect to a broker or exchange",
  ],
  subcases: [
    {
      id: "RS-008-018-C",
      description: "aggregate CG and RS quote commitments defer a further BUY that would exceed shared account free quote",
      status: "TEST-MAPPED",
      test: {
        file: "apps/harvester/src/domain/orders/allocate-order-commitments.test.js",
        title: "RS-008-018-C: aggregates CG and RS quote reservations before authorizing another BUY",
      },
      evidence: null,
    },
    {
      id: "RS-008-018-D",
      description: "aggregate CG and RS SELL commitments prevent overselling shared account base inventory",
      status: "TEST-MAPPED",
      test: {
        file: "apps/harvester/src/domain/orders/allocate-order-commitments.test.js",
        title: "RS-008-018-D: rejects aggregate CG and RS SELL commitments that oversell shared base inventory",
      },
      evidence: null,
    },
    {
      id: "RS-008-018-B",
      description: "concurrent same-market CG and RS BUY fills update independent strategy-owned Positions in the same account Portfolio",
      status: "TEST-MAPPED",
      test: {
        file: "apps/harvester/src/use-cases/create-recovery-seller-accounting-workflow.test.js",
        title: "RS-008-018-B: concurrent same-market CG and RS fills retain independent Positions",
      },
      evidence: null,
    },
    {
      id: "RS-008-018-E",
      description: "concurrent CG BUY evaluations on different markets serialize against an existing RS quote reservation so the account cannot double-spend",
      status: "TEST-MAPPED",
      test: {
        file: "apps/harvester/src/use-cases/conservative-trading-engine.multi-market.test.js",
        title: "RS-008-018-E: concurrent CG BUY intents serialize against a shared RS quote reservation",
      },
      evidence: null,
    },
    {
      id: "RS-008-018-F",
      description: "the real Conservative engine rejects a CG SELL when an existing RS-owned SELL reservation exhausts shared free base",
      status: "TEST-MAPPED",
      test: {
        file: "apps/harvester/src/use-cases/conservative-trading-engine.multi-market.test.js",
        title: "RS-008-018-F: runtime CG SELL is rejected when an RS SELL reserves all shared free base",
      },
      evidence: null,
    },
    {
      id: "RS-008-018-A",
    description: "an existing RS-owned BUY commitment on DOGEUSDT leaves insufficient account quote for a new CG BUY on SOLUSDT",
    status: "TEST-MAPPED",
    test: {
      file: testFile,
      title: testTitle,
    },
    evidence: null,
  }],
  implementation: [
    "apps/harvester/src/use-cases/conservative-trading-engine.js",
    "apps/harvester/src/domain/orders/order-registry.js",
  ],
  test: {
    file: testFile,
    title: testTitle,
  },
  status: "TEST-MAPPED",
  evidence: null,
})
