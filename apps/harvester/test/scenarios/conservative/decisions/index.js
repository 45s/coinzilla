import { createScenarioDefinition } from "../../shared/factories.js"

export const scenarios = [
  createScenarioDefinition({
    id: "CON-DECISION-001",
    title: "Conservative decisions emit only permitted BUY and recovery SELL intents",
    category: "strategy-decisions",
    priority: "P0",
    description: "Evaluate entry, trailing, active-position, investment-cap, and safety gates using the real Conservative policy.",
    tags: ["decision", "buy", "sell", "safety"],
    preconditions: [
      "A normalized market, Conservative pair configuration, current market data, and exchange filters are available.",
      "Portfolio, active orders, and account commitments are authoritative for the evaluated market.",
    ],
    initialState: {
      portfolio: "empty or holding a partially recovered position",
      activeOrders: "none or acknowledged strategy-owned orders",
      marketData: "fresh",
    },
    inputEvents: [
      {
        type: "MARKET_SNAPSHOT",
        sequence: 1,
      },
      {
        type: "STRATEGY_EVALUATION",
        sequence: 2,
      },
    ],
    expectedState: {
      strategy: "returns a domain decision without mutating authoritative accounting state",
      portfolio: "unchanged by evaluation alone",
    },
    expectedOrders: [
      {
        side: "BUY",
        purpose: "STANDING_BUY",
        condition: "all entry and account gates pass",
      },
      {
        side: "SELL",
        purpose: "RECOVERY_SELL",
        condition: "a recovery position has executable sellable inventory",
      },
    ],
    expectedSideEffects: {
      duplicateOrForbiddenIntent: false,
      brokerSubmissionDuringPureEvaluation: false,
    },
    invariants: [
      "An active BUY or safety gate prevents an unsafe additional BUY.",
      "A recovery SELL decision is derived from the authoritative position basis and current filters.",
      "Evaluation does not mutate Portfolio, Position, or RecoveryLedger.",
    ],
    relatedRequirements: ["CON-SPEC-3.1", "CON-SPEC-3.2", "CON-SPEC-3.7", "CON-SPEC-8.1"],
    relatedCriticalBehaviors: ["STRATEGY_BUY_SELL_SAFETY_GATES"],
    coverageStatus: "TEST-MAPPED",
    coverageReason: "Existing policy tests are linked; the full decision equivalence classes still need assertion-by-assertion review.",
  }),
]
