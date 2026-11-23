import { createScenarioDefinition } from "../../shared/factories.js"

export const scenarios = [
  createScenarioDefinition({
    id: "CON-FEE-001",
    title: "Base, quote, and third-asset commissions preserve exact net inventory and quote economics",
    category: "fees-commission-assets",
    priority: "P0",
    description: "Cover BUY and SELL commissions charged in base, quote, and a third asset, including quote valuation of third-asset fees and fail-closed missing valuation.",
    tags: ["fees", "commission", "base-asset", "quote-asset", "third-asset"],
    preconditions: [
      "Each canonical Fill carries its actual commission amount and commission asset.",
      "A third-asset commission is accepted only when its quote valuation is available.",
    ],
    initialState: {
      feePolicy: "configured fee reserve is separate from actual commission facts",
      assets: "base, quote, and optional third commission asset are explicit",
    },
    inputEvents: [
      { type: "BUY_FILL_WITH_BASE_COMMISSION", sequence: 1 },
      { type: "BUY_FILL_WITH_QUOTE_COMMISSION", sequence: 2 },
      { type: "SELL_FILL_WITH_THIRD_ASSET_COMMISSION", sequence: 3 },
      { type: "THIRD_ASSET_VALUATION_MISSING", sequence: 4 },
    ],
    expectedState: {
      baseCommission: "reduces net acquired base or increases net base disposed as appropriate",
      quoteCommission: "changes quote cash flow and quote recovery basis",
      thirdAssetCommission: "is valued in quote or rejected when valuation evidence is absent",
    },
    expectedAccounting: {
      actualCommission: "uses exchange-reported amount and asset",
      feeReserve: "used only for order planning, never substituted for actual accounting",
    },
    expectedSideEffects: {
      unvaluedThirdAssetAccepted: false,
      feeCountedTwice: false,
    },
    invariants: [
      "Commission asset identity is never inferred from the market pair.",
      "Actual commission facts are applied exactly once.",
      "Missing third-asset valuation fails closed before recovery economics are accepted.",
    ],
    relatedRequirements: ["CON-SPEC-2.3", "CON-SPEC-4.7"],
    relatedCriticalBehaviors: ["EXACT_FINANCIAL_ACCOUNTING"],
    coverageStatus: "TEST-MAPPED",
    coverageReason: "Actual commission and valuation tests are linked; the complete base/quote/third-asset cross-product remains subject to review.",
  }),
]
