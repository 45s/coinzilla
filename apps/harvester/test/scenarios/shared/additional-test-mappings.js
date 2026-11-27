export const ADDITIONAL_TEST_MAPPINGS = Object.freeze({
  "CON-DECISION-001": [
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "creates the initial BUY below last traded price and rounds down to tick",
    },
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "does not duplicate an already active BUY on repeated price events",
    },
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "respects investment-cap equality and both sides of the BUY eligibility boundary",
    },
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "defers a BUY below MIN_NOTIONAL without blocking a valid recovery SELL",
    },
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "defers a BUY below MIN_QUANTITY without emitting an invalid order",
    },
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "defers a BUY that rounds to zero at the exchange quantity step",
    },
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "defers a configured BUY above MAX_QUANTITY without blocking a valid SELL",
    },
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "rejects missing exchange increments and invalid strategy context",
    },
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "fails closed when active inventory has no positive recovery cost basis",
    },
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "fails closed rather than inventing a next BUY reference while active inventory lacks completed-BUY VWAP",
    },
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "rejects a RecoveryLedger belonging to a different market",
    },
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "fails closed when RecoveryLedger has cycle accounting but Portfolio has no Position",
    },
  ],
  "CON-SELL-001": [
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "uses the market-specific minimum profit when planning its recovery SELL",
    },
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "reserves the higher takerPercent for recovery SELL planning when taker is more expensive",
    },
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "includes the actual BUY quote commission in the recovery SELL limit price",
    },
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "continues selling residual inventory after cumulative recovery profit is already secured",
    },
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "classifies residual quantity below the exchange quantity step instead of submitting an invalid SELL",
    },
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "classifies residual quantity below MIN_NOTIONAL instead of submitting an invalid SELL",
    },
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "caps residual SELL quantity at MAX_QUANTITY and leaves the rest for sell-through",
    },
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "caps residual SELL quantity at MAX_NOTIONAL and leaves the rest for sell-through",
    },
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "blocks the next BUY when the required recovery SELL exceeds MAX_PRICE",
    },
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "does not create a duplicate residual SELL while one is active",
    },
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "reconciles actual DOGE fills and keeps the 1.8 DOGE excess as MIN_NOTIONAL dust",
    },
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "reconciles actual ZRO fills and keeps the 0.04 excess as MIN_NOTIONAL dust",
    },
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "classifies the ADA 0.1 residual as MIN_NOTIONAL when one fee-reserved step cannot be sold",
    },
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "fails closed when active inventory has no positive recovery cost basis",
    },
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "rejects missing exchange increments and invalid strategy context",
    },
  ],
  "CON-FEE-001": [
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "includes the actual BUY quote commission in the recovery SELL limit price",
    },
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "reserves the higher takerPercent for recovery SELL planning when taker is more expensive",
    },
  ],
  "CON-FILTER-001": [
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "rejects missing exchange increments and invalid strategy context",
    },
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "classifies residual quantity below the exchange quantity step instead of submitting an invalid SELL",
    },
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "classifies residual quantity below MIN_NOTIONAL instead of submitting an invalid SELL",
    },
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "caps residual SELL quantity at MAX_QUANTITY and leaves the rest for sell-through",
    },
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "caps residual SELL quantity at MAX_NOTIONAL and leaves the rest for sell-through",
    },
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "blocks the next BUY when the required recovery SELL exceeds MAX_PRICE",
    },
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "defers a BUY below MIN_NOTIONAL without blocking a valid recovery SELL",
    },
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "defers a BUY below MIN_QUANTITY without emitting an invalid order",
    },
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "defers a BUY that rounds to zero at the exchange quantity step",
    },
  ],
  "CON-MARKET-001": [
    {
      path: "src/domain/strategies/conservative/strategy.test.js",
      name: "uses the market-specific minimum profit when planning its recovery SELL",
    },
  ],
  "CON-CONFIG-001": [
    {
      path: "src/bootstrap/config/resolve-harvester-options.test.js",
      name: "selects CG and RS markets independently while preserving strategy-owned pair maps",
    },
    {
      path: "src/bootstrap/config/resolve-harvester-options.test.js",
      name: "rejects conflicting volatility settings for a market routed to CG and RS",
    },
    {
      path: "src/bootstrap/config/resolve-harvester-options.test.js",
      name: "rejects an RS route unless the RS strategy is explicitly enabled",
    },
    {
      path: "src/bootstrap/config/resolve-harvester-options.test.js",
      name: "rejects duplicate Conservative strategy routes before selecting runtime pairs",
    },
    {
      path: "src/bootstrap/config/resolve-harvester-options.test.js",
      name: "requires an explicit TRADING_MODE before publishing validated configuration",
    },
    {
      path: "src/bootstrap/config/resolve-harvester-options.test.js",
      name: "rejects an invalid TRADING_MODE",
    },
    {
      path: "src/bootstrap/config/resolve-harvester-options.test.js",
      name: "rejects a pair without an explicit tradingEnvironment before startup",
    },
    {
      path: "src/bootstrap/config/resolve-harvester-options.test.js",
      name: "rejects configurations without an enabled pair",
    },
    {
      path: "src/bootstrap/config/resolve-harvester-options.test.js",
      name: "rejects invalid strategy flags",
    },
    {
      path: "src/bootstrap/config/resolve-harvester-options.test.js",
      name: "resolves RS-only provider routes when Conservative has no configured markets",
    },
  ],
})
