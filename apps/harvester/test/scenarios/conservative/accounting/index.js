import { createScenarioDefinition } from "../../shared/factories.js"

export const scenarios = [
  createScenarioDefinition({
    id: "CON-ACCOUNTING-001",
    title: "Portfolio and RecoveryLedger reconcile exact cost, proceeds, fees, and realized PnL",
    category: "accounting-pnl",
    priority: "P0",
    description: "Cover multiple fills at different prices, partial-fill accounting, exact quote cost/proceeds, realized profit, remaining inventory, and ledger-to-position alignment.",
    tags: ["accounting", "pnl", "decimal", "portfolio"],
    preconditions: [
      "Only canonical fills and actual commission facts are used as accounting inputs.",
      "Position.spent is the authoritative quote-cost basis; RecoveryLedger.buyCost is a compatibility mirror.",
    ],
    initialState: {
      position: "empty or holding previously accepted inventory",
      recoveryLedger: "zero or previously confirmed cycle proceeds",
    },
    inputEvents: [
      {
        type: "BUY_FILL",
        sequence: 1,
      },
      {
        type: "BUY_FILL_AT_DIFFERENT_PRICE",
        sequence: 2,
      },
      {
        type: "PARTIAL_SELL_FILL",
        sequence: 3,
      },
    ],
    expectedState: {
      portfolio: "base quantity and quote basis reflect accepted fills",
      recoveryLedger: "confirmed net proceeds and cycle state align with Portfolio",
    },
    expectedAccounting: {
      buyCost: "exact sum of gross quote notional and quote-equivalent commission",
      netSellProceeds: "exact gross quote notional less actual quote-equivalent commission",
      realizedPnl: "confirmed net proceeds less the corresponding authoritative cost basis",
      remainingInventory: "only unsold net base remains",
    },
    expectedSideEffects: {
      floatingPointFinancialOracle: false,
      requestedQuantitySubstitutedForFills: false,
    },
    invariants: [
      "All financial values use exact decimal arithmetic.",
      "Portfolio and RecoveryLedger projections remain aligned after every accepted fill.",
      "Realized PnL uses actual net execution proceeds, not requested price or estimated fee.",
    ],
    relatedRequirements: ["CON-SPEC-2.1", "CON-SPEC-2.2"],
    relatedCriticalBehaviors: ["EXACT_FINANCIAL_ACCOUNTING", "PORTFOLIO_RECOVERY_LEDGER_ALIGNMENT"],
    coverageStatus: "TEST-MAPPED",
    coverageReason: "Exact accounting and projection-alignment tests are linked; every fee asset and cycle boundary still requires separate evidence review.",
  }),
]
