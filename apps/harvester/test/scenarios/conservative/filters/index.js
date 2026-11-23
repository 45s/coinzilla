import { createScenarioDefinition } from "../../shared/factories.js"

export const scenarios = [
  createScenarioDefinition({
    id: "CON-FILTER-001",
    title: "Recovery SELL planning uses fresh filters and exact exchange precision boundaries",
    category: "precision-exchange-filters",
    priority: "P1",
    description: "Cover tick/step precision, minimum quantity/notional, maximum quantity/notional, filter freshness, and rejection of non-executable residuals.",
    tags: ["precision", "filters", "min-notional", "tick-size", "step-size"],
    preconditions: [
      "The latest exchange filters belong to the exact market being evaluated.",
      "Filter metadata is refreshed within the active freshness window.",
    ],
    initialState: {
      marketFilters: "fresh and complete",
      recoveryPosition: "may contain a residual near exchange minimums",
    },
    inputEvents: [
      { type: "REFRESH_MARKET_FILTERS", sequence: 1 },
      { type: "CALCULATE_RECOVERY_SELL", sequence: 2 },
      { type: "FILTER_BOUNDARY_CHECK", sequence: 3 },
    ],
    expectedState: {
      quantity: "rounded down to valid step size",
      price: "rounded up to valid tick size",
      residual: "not submitted when minimum quantity or notional is not met",
    },
    expectedOrders: [
      { side: "SELL", purpose: "RECOVERY_SELL", condition: "all current exchange filters pass" },
    ],
    expectedSideEffects: {
      staleFilterSubmission: false,
      invalidQuantityOrPriceSubmission: false,
    },
    invariants: [
      "Decimal quantities and prices are not converted through binary floating point.",
      "Recovery SELL filters are checked against current market metadata.",
      "An untradeable residual is retained rather than rounded into an invalid order.",
    ],
    relatedRequirements: ["CON-SPEC-4.5", "CON-SPEC-4.8"],
    relatedCriticalBehaviors: ["RECOVERY_SELL_MARKET_METADATA_FRESHNESS", "RECOVERY_SELL_ECONOMICS"],
    coverageStatus: "TEST-MAPPED",
    coverageReason: "Recovery SELL precision and fresh-filter tests are linked; all exchange filter combinations remain a broader matrix.",
  }),
]
