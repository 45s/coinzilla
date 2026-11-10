# Market Simulator agent instructions

- **Owned path:** `packages/market-simulator/**`
- **Roadmap:** `ROADMAP.md`

Read root `AGENTS.md`, `ENGINEERING_STANDARDS.md`, and `AI_AGENT_WORKFLOW.md` before changes.

## Architecture rules

- Follow Clean Architecture: dependencies point inward.
- Domain modules are pure and cannot import application, infrastructure, Node APIs, or broker packages.
- Application use cases depend on domain behavior and explicit port contracts, never concrete infrastructure.
- Infrastructure implements repository/scheduler ports.
- Broker integration belongs in adapters and must reuse `CoreBroker` from `@coinzilla/brokers`.
- Do not create a second strategy-facing broker contract or change shared broker interfaces.
- Require callers to supply an explicit history file or in-memory history; do not rely on application-owned fixtures or fabricate market data.
- Never instantiate Binance broker clients or send exchange requests.
- Preserve source decimal strings and timestamps.
- Use exact string/BigInt decimal arithmetic for simulated accounting.
- Document simulation assumptions and limitations; never present simulation as a live profitability estimate.

## Simulation rules

- No manual step/pause/resume/reset price controls.
- Market orders fill at the latest candle close.
- Limit orders fill fully at the limit when candle high/low crosses it.
- Fees are quote-asset debits.
- Partial fills, queue position, slippage, spread, market impact and intrabar order are unsupported until explicitly designed and tested.
- Unit tests must be offline and use injected timers.

## Workflow

Follow the [mandatory AI-agent workflow](../../AI_AGENT_WORKFLOW.md) for branch creation, PR targets, synchronization, merge gates, branch cleanup, and releases.

- Run `pnpm --filter @coinzilla/market-simulator test` and `pnpm --filter @coinzilla/market-simulator test:coverage` before applicable workspace CI. The coverage command reports coverage but currently defines no package threshold; do not claim an enforced percentage.
- Keep README and roadmap aligned with implemented behavior.
- Do not claim checks passed unless they were executed.
