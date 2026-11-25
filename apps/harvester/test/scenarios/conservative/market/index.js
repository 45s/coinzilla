import { createScenarioDefinition } from "../../shared/factories.js"

export const scenarios = [
  createScenarioDefinition({
    id: "CON-MARKET-001",
    title: "Stale or changed market data cannot authorize a stale Conservative order",
    category: "market-conditions",
    priority: "P1",
    description: "Cover stale market snapshots, changing prices, residual sell-through market reference, and fresh metadata requirements before recovery SELL planning.",
    tags: ["market-data", "staleness", "price-change", "filters"],
    preconditions: [
      "Market timestamps and exchange metadata freshness are available to the evaluator.",
      "The current market price is distinguished from a prior BUY or recovery reference price.",
    ],
    initialState: {
      marketData: "fresh, stale, or changed since the previous evaluation",
      recoveryPosition: "may have secured required net proceeds with a residual balance",
    },
    inputEvents: [
      {
        type: "MARKET_PRICE_CHANGE",
        sequence: 1,
      },
      {
        type: "STALE_MARKET_SNAPSHOT",
        sequence: 2,
      },
      {
        type: "RECOVERY_SELL_REEVALUATION",
        sequence: 3,
      },
    ],
    expectedState: {
      staleSnapshot: "does not authorize a new order",
      residualSellThrough: "uses the current market reference when required recovery proceeds are already secured",
      filters: "must remain fresh for the exact market",
    },
    expectedSideEffects: {
      orderFromStaleSnapshot: false,
      staleFilterReuse: false,
    },
    invariants: [
      "A stale market snapshot cannot authorize a new order.",
      "A price change is evaluated against the correct strategy reference.",
      "Residual sell-through does not reuse a stale recovery target price.",
    ],
    relatedRequirements: ["CON-SPEC-4.6", "CON-SPEC-8.1"],
    relatedCriticalBehaviors: ["RECOVERY_SELL_MARKET_METADATA_FRESHNESS", "STRATEGY_BUY_SELL_SAFETY_GATES"],
    coverageStatus: "TEST-MAPPED",
    coverageReason: "Fresh metadata and strategy gate tests are linked; all stale-market timing and boundary cases remain under review.",
  }),
]
