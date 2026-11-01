# Market Simulator Engineering Roadmap

**Application:** `apps/market-simulator`  
**Package:** `@coinzilla/market-simulator`  
**Target branch:** `develop`

## Mission

Provide a market-data-only mock broker that strategies can consume through the existing Coinzilla `CoreBroker` contract, using the repository's existing DOGEUSDT historical fixture.

## Architecture

~~~text
Strategy under test
        |
        | CoreBroker contract
        v
HistoricalMarketBroker
        |
        v
apps/bot-free-roll/doge-history.json
(10,080 DOGEUSDT 1m candles)
~~~

## Engineering constraints

- Extend and reuse `CoreBroker` from `@coinzilla/brokers`; do not change the shared contract.
- Do not instantiate `BinanceWebSocketBroker`, inject Binance stream clients, or manufacture raw Binance WebSocket messages.
- Emit historical candle-close data through `subscribeForPrices({ symbol, onPrice })`.
- Preserve source decimal strings and timestamps. The callback's `price` is the candle `close`.
- Read the existing DOGE fixture in place. Do not copy, rewrite, or fabricate historical records.
- No exchange network access, API credentials, or real orders.
- This phase simulates market data only. Order execution, balances, fills, and user-data events remain unsupported.
- No public manual step/pause/resume/reset API. Subscriptions advance automatically at the configured speed and stop at end-of-file.
- Tests remain offline and deterministic with injected timers.

## Phases

### MS-001 — Application scaffold
- [x] Create the workspace package, local instructions, README, and roadmap.
- [x] Register the app in workspace package documentation.

### MS-002 — Historical market-data broker (current PR)
- [x] Extend the existing `CoreBroker` class.
- [x] Load the actual DOGEUSDT history from `apps/bot-free-roll/doge-history.json`.
- [x] Validate metadata, candle count, decimal strings, and chronological timestamps.
- [x] Implement `connect()`, `disconnect()`, `getPrice(s)`, and `subscribeForPrices()`.
- [x] Emit each candle close as the current price, preserving OHLCV and source timestamps.
- [x] Support configurable speed and automatic subscription cleanup.
- [x] Test against the complete 10,080-candle source file.
- [ ] Verify package/workspace CI and review before merge.

### MS-003 — Strategy test integration
- [ ] Add a strategy integration harness using `HistoricalMarketBroker`.
- [ ] Specify simulated order lifecycle before implementing order/fill/account behavior.
- [ ] Test strategy behavior reproducibly without a live exchange.
- [ ] Do not implement order simulation until its semantics are agreed and tested.

## Quality gates

- Use repository Node.js and pnpm versions.
- Keep tests offline, deterministic, and credential-free.
- Inject timers; do not use real sleeps in unit tests.
- Preserve source decimal strings; avoid floating-point conversions in the market-data adapter.
- Report only checks actually executed.
- Mark roadmap work complete only after merge to `develop` and required checks pass.
