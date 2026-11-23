import { createScenarioDefinition } from "../../shared/factories.js"

export const scenarios = [
  createScenarioDefinition({
    id: "CON-CONFIG-001",
    title: "Invalid Conservative pair configuration fails before trading side effects",
    category: "configuration",
    priority: "P1",
    description: "Cover missing or invalid pair configuration, strategy mode, minProfit threshold, order quantity, and inconsistent market configuration.",
    tags: ["configuration", "validation", "fail-closed"],
    preconditions: [
      "Configuration is loaded before any order submission or account mutation.",
      "The active pair uses the Conservative strategy-specific contract.",
    ],
    initialState: {
      configuration: "may contain invalid or incomplete Conservative values",
      broker: "offline and not called during validation",
    },
    inputEvents: [
      { type: "LOAD_PAIR_CONFIGURATION", sequence: 1 },
      { type: "VALIDATE_CONSERVATIVE_CONFIGURATION", sequence: 2 },
    ],
    expectedState: {
      invalidConfiguration: "rejected with an actionable validation error",
      validConfiguration: "normalized and available to the strategy",
    },
    expectedSideEffects: {
      brokerCallsOnInvalidConfiguration: false,
      partialRuntimeInitialization: false,
    },
    invariants: [
      "Configuration validation occurs before exchange or trading side effects.",
      "Conservative-specific settings are not silently replaced by generic strategy defaults.",
    ],
    relatedRequirements: ["CON-CONFIG-1"],
    relatedCriticalBehaviors: [],
    relatedSourceFiles: [
      "config/strategies/cg-coin-grabber.js",
      "src/bootstrap/config/resolve-harvester-options.js",
    ],
    coverageStatus: "PARTIAL",
    coverageReason: "Existing tests cover strategy enablement, execution-route selection, and TRADING_MODE validation. Conservative pair-specific financial constraints such as minProfit, keepQuantity, and quantity configuration are not comprehensively validated at configuration load.",
  }),
]
