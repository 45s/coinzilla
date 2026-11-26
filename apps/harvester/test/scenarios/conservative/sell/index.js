import { createScenarioDefinition } from "../../shared/factories.js"

export const scenarios = [
  createScenarioDefinition({
    id: "CON-SELL-001",
    title: "Recovery SELL quantity and price preserve profit, fees, inventory, and exchange constraints",
    category: "sell-lifecycle",
    priority: "P0",
    description: "Cover recovery SELL creation, retained inventory, fee reserve, minimum profit, tick/step rounding, post-only rules, partial fills, and terminal replacement decisions.",
    tags: ["sell", "recovery", "fees", "filters", "rounding"],
    preconditions: [
      "Position.spent and actual net base quantity are authoritative.",
      "A fresh same-symbol order-book snapshot is available for the post-only crossing check immediately before broker I/O.",
      "Current market metadata and trading filters belong to the same market and are fresh.",
    ],
    initialState: {
      position: "positive quote basis and strategy-owned base inventory",
      recoveryLedger: "confirmed net SELL proceeds accumulated from canonical fills",
      activeRecoverySell: "absent or terminal",
    },
    inputEvents: [
      {
        type: "RECOVERY_SELL_PLAN",
        sequence: 1,
      },
      {
        type: "FRESH_ORDER_BOOK_SNAPSHOT",
        sequence: 2,
      },
      {
        type: "SELL_PARTIAL_FILL",
        sequence: 2,
      },
      {
        type: "SELL_TERMINAL_UPDATE",
        sequence: 3,
      },
    ],
    expectedState: {
      retainedInventory: "keepQuantity remains reserved",
      inventoryDisposition: "classifies KEEP_QUANTITY, SELLABLE_RESIDUAL, and EXCHANGE_CONSTRAINED_DUST using exact step and notional rules",
      sellableQuantity: "actual net base less retained inventory and applicable fee reserve",
      residual: "positive sellable residual is not suppressed merely because outstandingRecoveryAmount is zero; when recovery proceeds are secured, sell-through uses the current market reference",
    },
    expectedOrders: [
      {
        side: "SELL",
        purpose: "RECOVERY_SELL",
        type: "POST_ONLY_LIMIT",
      },
      {
        quantity: "rounded down to step size",
        price: "rounded up to tick size",
      },
    ],
    expectedAccounting: {
      requiredNetProceeds: "covers authoritative recovery basis plus minProfit",
      commission: "actual fill commission is accounted separately from configured fee reserve",
    },
    expectedSideEffects: {
      belowMinimumQuantityOrNotional: "no exchange order is emitted",
      staleOrMissingFilters: "no recovery SELL is submitted",
      staleOrMissingBookSnapshot: "no post-only order is submitted",
    },
    invariants: [
      "A recovery SELL never consumes keepQuantity.",
      "Price rounding never reduces required net proceeds.",
      "A partial SELL without a new BUY does not reprice an otherwise valid open recovery SELL.",
      "Exchange filters are checked before an order intent is emitted.",
      "Post-only crossing is checked against a fresh same-symbol book immediately before broker submission.",
      "Exchange-constrained dust is retained and is never rounded into an invalid order.",
    ],
    relatedRequirements: [
      "CON-SPEC-4.1",
      "CON-SPEC-4.2",
      "CON-SPEC-4.3",
      "CON-SPEC-4.4",
      "CON-SPEC-4.5",
      "CON-SPEC-4.6",
      "CON-SPEC-4.7",
      "CON-SPEC-4.8",
      "CON-SPEC-5.1",
      "CON-SPEC-5.3",
    ],
    relatedCriticalBehaviors: ["RECOVERY_SELL_ECONOMICS", "RECOVERY_SELL_MARKET_METADATA_FRESHNESS"],
    coverageStatus: "TEST-MAPPED",
    coverageReason: "The recovery SELL planner and fresh-filter tests are mapped; the complete exchange rejection and terminal-order matrix remains a separate application concern.",
  }),
]
