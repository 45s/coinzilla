# Market Simulator agent instructions

Owned path: `apps/market-simulator/**`  
Roadmap: `ROADMAP.md`

Read root `AGENTS.md`, `ENGINEERING_STANDARDS.md`, and `AI_AGENT_WORKFLOW.md` before changes.

## Architecture rules

- Extend the existing `CoreBroker` from `@coinzilla/brokers`.
- Do not instantiate `BinanceWebSocketBroker` or inject Binance WebSocket stream clients.
- Do not create another broker contract or change shared broker interfaces.
- Read the real DOGEUSDT fixture at `apps/bot-free-roll/doge-history.json`; do not copy or fabricate its data.
- Emit candle close prices through the existing `subscribeForPrices({ symbol, onPrice })` callback.
- Preserve source decimal strings and timestamps.
- This phase is market-data-only. Never send exchange requests or real orders.
- Do not add manual step/pause/resume/reset controls unless explicitly requested.
- Tests must inject timers and remain offline.

## Workflow

- Target PRs to `develop`.
- Run package tests/coverage and applicable workspace CI.
- Keep README and roadmap aligned with actual functionality.
- Never claim unsupported account/order behavior is simulated.
