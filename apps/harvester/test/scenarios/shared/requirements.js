export const CONSERVATIVE_REQUIREMENTS = Object.freeze([
  {
    id: "CON-SPEC-2.1",
    section: "2",
    title: "Position.spent is the authoritative quote-cost basis.",
  },
  {
    id: "CON-SPEC-2.2",
    section: "2",
    title: "Canonical fills and commissions are accounted for exactly once.",
  },
  {
    id: "CON-SPEC-2.3",
    section: "2",
    title: "Base, quote, and third-asset commission facts are handled distinctly.",
  },
  {
    id: "CON-SPEC-3.1",
    section: "3",
    title: "Initial BUY decisions use the configured Conservative order rules.",
  },
  {
    id: "CON-SPEC-3.2",
    section: "3",
    title: "Trailing BUY decisions use the configured price and market conditions.",
  },
  {
    id: "CON-SPEC-3.3",
    section: "3",
    title: "Partial BUY fills update accounting without advancing the completed-BUY cycle.",
  },
  {
    id: "CON-SPEC-3.4",
    section: "3",
    title: "Completed BUY fills establish the next BUY reference price.",
  },
  {
    id: "CON-SPEC-3.5",
    section: "3",
    title: "No new BUY is submitted while recovery remains unresolved; admission opens only after full cycle completion and Position/RecoveryLedger basis reset.",
  },
  {
    id: "CON-SPEC-3.6",
    section: "3",
    title: "A pre-existing acknowledged BUY may continue its canonical lifecycle during recovery; late fills are reconciled without creating another BUY.",
  },
  {
    id: "CON-SPEC-3.7",
    section: "3",
    title: "BUY placement respects investment and account commitment limits.",
  },
  {
    id: "CON-SPEC-3.8",
    section: "3",
    title: "The final application submission gate blocks BUY while an owned recovery SELL remains PENDING, OPEN, PARTIALLY_FILLED, or UNKNOWN, even if accounting projections appear reset.",
  },
  {
    id: "CON-SPEC-4.1",
    section: "4",
    title: "Recovery SELL economics include the configured minimum profit.",
  },
  {
    id: "CON-SPEC-4.2",
    section: "4",
    title: "Configured keepQuantity is retained across recovery cycles.",
  },
  {
    id: "CON-SPEC-4.3",
    section: "4",
    title: "Sellable quantity accounts for actual base quantity and fee reserve.",
  },
  {
    id: "CON-SPEC-4.4",
    section: "4",
    title: "Required net proceeds are derived from authoritative recovery basis.",
  },
  {
    id: "CON-SPEC-4.5",
    section: "4",
    title: "Recovery SELL price rounding respects the exchange tick size.",
  },
  {
    id: "CON-SPEC-4.6",
    section: "4",
    title: "Residual sell-through uses the current market reference when recovery proceeds are secured.",
  },
  {
    id: "CON-SPEC-4.7",
    section: "4",
    title: "Fee reserves and post-only order constraints are applied conservatively.",
  },
  {
    id: "CON-SPEC-4.8",
    section: "4",
    title: "Recovery SELL orders satisfy current exchange quantity, price, and notional filters.",
  },
  {
    id: "CON-SPEC-5.1",
    section: "5",
    title: "Partial SELL fills update net proceeds and remaining inventory.",
  },
  {
    id: "CON-SPEC-5.2",
    section: "5",
    title: "A late fill from a pre-existing BUY during an open recovery SELL requires cancellation and complete fill reconciliation before recovery SELL replacement; it does not authorize a new BUY.",
  },
  {
    id: "CON-SPEC-5.3",
    section: "5",
    title: "Recovery SELL terminal outcomes trigger only evidence-backed replacement or completion.",
  },
  {
    id: "CON-SPEC-6.1",
    section: "6",
    title: "Recovery completion requires the specified profit, inventory, and terminal-order conditions.",
  },
  {
    id: "CON-SPEC-6.2",
    section: "6",
    title: "Recovery completion is recorded durably and idempotently.",
  },
  {
    id: "CON-SPEC-6.3",
    section: "6",
    title: "Application completion uses canonical terminal SELL evidence and serialized transitions.",
  },
  {
    id: "CON-SPEC-7.1",
    section: "7",
    title: "Runtime restart restoration is explicitly outside the active Conservative contract.",
  },
  {
    id: "CON-SPEC-8.1",
    section: "8",
    title: "Trailing BUY replacement uses a fresh preflight and authoritative market state.",
  },
  {
    id: "CON-SPEC-8.2",
    section: "8",
    title: "Unknown cancellation outcomes and raced fills fail closed pending reconciliation.",
  },
  {
    id: "CON-SPEC-8.3",
    section: "8",
    title: "Safety pause blocks new BUYs and cancels only current-process-owned BUY orders.",
  },
  {
    id: "CON-SPEC-10.1",
    section: "10",
    title: "Graceful shutdown preserves order ownership and recovery safety.",
  },
  {
    id: "CON-RUNTIME-1",
    section: "runtime",
    title: "Startup reconciliation gates trading on authoritative account evidence.",
  },
  {
    id: "CON-RUNTIME-2",
    section: "runtime",
    title: "User-data disconnect and reconnect recovery restore readiness safely.",
  },
  {
    id: "CON-RUNTIME-3",
    section: "runtime",
    title: "Cross-market account-level quote and base commitments remain reconciled.",
  },
  {
    id: "CON-RUNTIME-4",
    section: "runtime",
    title: "Order ownership and closing-account audit prevent external inventory adoption.",
  },
  {
    id: "CON-CONFIG-1",
    section: "configuration",
    title: "Conservative pair configuration is validated before trading side effects.",
  },
  {
    id: "CON-RUNTIME-5",
    section: "runtime",
    title: "Prior process history disables trading; recovery-enabled startup also requires verified, eligible prior-session projection and never restores Conservative trading state.",
  },
])
