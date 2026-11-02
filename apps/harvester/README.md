# Harvester

Harvester is an independent Node.js process for cryptocurrency trading, built inside the Coinzilla pnpm monorepo.

It is intended to support multiple trading strategies through a shared trading engine. The first documented strategy modes are:

- **Conservative (Free-Roll):** the capital-recovery and free-coin accumulation strategy derived from `apps/bot-free-roll`.
- **Conservative (Free-Roll):** the first executable policy. It produces initial/standing BUY and recovery SELL intents from actual Portfolio and RecoveryLedger state. Aggressive is deferred.

These are strategy modes, not separate trading engines. Shared capabilities (market data, broker access, order lifecycle, fills, balances, accounting, and safety controls) should be implemented once where their contracts genuinely match. Strategy-specific decisions must remain isolated behind clear boundaries.

## Package

- Package: `@coinzilla/harvester`
- Runtime: Node.js `>=22.23.4`
- Modules: native ECMAScript modules
- Dependencies: keep minimal; add only for an agreed requirement

Run from the repository root:

```sh
cp apps/harvester/.env.example apps/harvester/.env.development
pnpm --filter @coinzilla/harvester dev
```

Edit `.env.development` with your local credentials if needed. Keep this file local; do not commit it. The development script loads it using Node's native `--env-file` option, matching the Free-Roll app.

Tests:

```sh
pnpm --filter @coinzilla/harvester test
pnpm --filter @coinzilla/harvester test:coverage
```

## Architecture direction

Use a ports-and-adapters architecture:

1. **Bootstrap** loads and validates configuration, composes dependencies, and manages process lifecycle.
2. **Application / trading engine** coordinates market updates, strategy execution, order workflows, and reconciliation.
3. **Domain** owns trading concepts, invariants, calculations, and strategy rules. Keep it deterministic and independent of I/O.
4. **Ports** define required capabilities such as market data, broker operations, persistence, clock, and journal.
5. **Infrastructure** implements those ports using concrete exchange/broker and storage adapters.

The engine must not contain Conservative- or Aggressive-specific policy. Strategies must not depend on exchange SDKs. Broker responses and market data must be validated at infrastructure boundaries.

See [Architecture](./docs/architecture.md) for the responsibilities of domain entities, strategy policies, the Trading Engine, use cases, and broker adapters. The selected broker integration is a Harvester-owned application port implemented by an infrastructure adapter around `@coinzilla/brokers`; see [Broker Port and Adapter](./docs/infrastructure/broker-port-and-adapter.md) for the examples and reliability rules. AI coding agents must also follow the [Harvester implementation guidance](./AGENTS.md#required-implementation-style-use-case-factories-and-explicit-composition) and the concrete [use-case implementation pattern](./docs/architecture.md#implementation-pattern-for-use-cases).

### Portfolio domain

A Portfolio is an immutable in-memory collection of market-scoped Positions. Positions track net base quantity and signed quote cash flow and are updated from canonical actual fills through `src/use-cases/update-portfolio.js`; market-price updates and order submissions do not change holdings. Base/quote commissions are applied exactly; incomplete/unknown and third-asset commissions fail closed. Duplicate canonical fill IDs are ignored for the current process.

See [Portfolio Domain](./docs/domain/portfolio.md) for the domain boundary, fill accounting flow, responsibilities, reliability requirements, and unresolved design decisions.

## Strategy documentation

See [Trading strategies](./docs/trading-strategies.md) for the agreed scope and unresolved design decisions.

## Configuration

Harvester uses one flat configuration shared by its strategy policies. The root contains:

- `settings`: process-wide trading settings, currently `minProfit`.
- `pairs`: market-specific settings keyed by symbol (for example, `ZROUSDT` or `ZROFDUSD`).

There is no strategy-name wrapper in the config. Each pair has its own `enabled` flag, `investment` limit, order sizing, reserve quantity, price/quantity precision, and fee percentages.

`investment` is the maximum quote-currency capital allocated to that pair. It is denominated in the quote asset named by the symbol: `ZROUSDT` uses USDT, while `ZROFDUSD` uses FDUSD. It is a per-pair allocation limit, not an order size. `orderQuantity` remains a separate configured order quantity; `keepQuantity` remains the retained base-asset quantity. These values are not interchangeable.

Example:

```json
{
  "settings": {
    "minProfit": 0.01
  },
  "pairs": {
    "ZROUSDT": {
      "enabled": true,
      "investment": 100,
      "orderQuantity": 5,
      "keepQuantity": 0.01,
      "priceStepPercent": 0.05,
      "pricePrecision": 3,
      "quantityPrecision": 1,
      "makerPercent": 0.075,
      "takerPercent": 0.075
    }
  }
}
```

The configuration loader and structural validation live in:

- `src/infrastructure/config/load-trading-config.js`
- `src/domain/trading-config.js`

The configuration contract does not imply that either strategy mode or order execution is implemented. Strategy behavior must be agreed and documented before strategy-specific parameters or runtime behavior are added.

## Logging

The process entry point and bootstrap use `defaultLogger` from `@coinzilla/utils`. Keep logging at application boundaries, inject a logger where tests or alternate composition need control, and do not call global `console` directly from Harvester modules. The shared logger accepts one data argument per method; pass structured objects when a log needs metadata.

## Implementation style

Harvester has a mandatory class-versus-function rule:

- **Plain pure functions are required** for deterministic calculations, trading decisions, validation, predicates, parsing, normalization, and transformations. They receive explicit inputs, return results, and have no side effects.
- Meaningful pure functions must live in focused, cohesive, independently testable modules—even if they have only one caller.
- **Classes are for domain concepts that own state and protect state-related invariants**, such as `Fill`, `Position`, and `Portfolio`. Use private fields and deliberate getters/methods where appropriate.
- Do not put independent calculations or trading decisions into class methods just because the class has the relevant data.
- **Use cases are dependency-injected functions** that coordinate domain logic and explicit ports. Keep I/O at application/infrastructure boundaries.

See [Architecture — implementation style](./docs/architecture.md#implementation-style-classes-versus-plain-pure-functions) and [Harvester agent standards](./AGENTS.md#required-domain-implementation-style-classes-and-pure-functions).

## Engineering rules

- Follow [AGENTS.md](./AGENTS.md) and repository-level engineering guidance.
- Use exact decimal arithmetic for prices, quantities, fees, and accounting.
- Base accounting on actual fills and commissions, not estimates.
- Make order state transitions explicit and handle partial fills, cancellations, rejections, and duplicate events safely.
- Never silently ignore broker errors or unexpected commission assets.
- Keep live exchange integration tests explicitly opt-in; the default test suite must not require credentials or place orders.
- Do not claim restart recovery, exactly-once processing, or other guarantees until implemented and tested.

## Startup and broker connection

Run `pnpm --filter @coinzilla/harvester start` from the repository root. Startup always loads and validates `trading-config.json`.

Broker connectivity is opt-in. Order execution is separately opt-in with `HARVESTER_ENABLE_TRADING=true`, requires `HARVESTER_TRADING_MODE=testnet`, and is rejected when `NODE_ENV=production`. The first trading run requires exactly one enabled pair, no open orders, and zero pre-existing base inventory for that pair.

```sh
HARVESTER_BROKER=binance
HARVESTER_TRADING_MODE=testnet
HARVESTER_ENABLE_TRADING=true
BINANCE_API_KEY=...
BINANCE_API_SECRET_KEY=...
```

Without `HARVESTER_BROKER=binance`, startup validates configuration but does not connect to an exchange. With it, bootstrap creates the Harvester broker port through the Binance infrastructure adapter, connects, and subscribes to price streams for every pair whose `enabled` flag is true. A failed connection or price subscription causes startup to fail; already-created subscriptions are removed and disconnect is attempted. Shutdown closes the trading gate first, drains queued user-data processing, and unsubscribes market data before disconnecting; queued fills cannot schedule new orders after shutdown begins.

Each normalized broker price event is validated by the `process-market-price` application use case, then passed to the injected strategy with its pair configuration and process-wide settings. When `HARVESTER_ENABLE_TRADING=true`, bootstrap composes the Conservative policy with the in-process trading engine. With trading disabled, the process remains read-only. Price events produce validated BUY/SELL intents, orders are registered before submission, and canonical user-data events update only Harvester-owned orders. The engine waits for full fills before advancing the strategy. The first trading run is deliberately limited to one enabled pair and requires a clean TESTNET account with no open orders or pre-existing base inventory. Strategy BUY intents respect the configured pair investment cap; the engine checks each BUY against free quote balance and each SELL against free base balance. If quote funds are insufficient for the next BUY, a valid recovery SELL is still allowed to proceed. Aggressive remains deferred.

Price events are trade-price updates from the broker's aggregate-trade stream; Harvester does not currently seed the strategy with a REST ticker snapshot. The broker user-data stream is normalized into canonical order and Fill events. Harvester correlates order updates against its in-process registry and applies actual fills to Portfolio and RecoveryLedger. Reconnect recovery, durable restart state, reservation accounting, and complete TESTNET BUY → SELL → next-cycle proof remain unfinished.

## Current status

Implemented: application-owned broker port, Binance adapter, validated config, Conservative pure policy, initial/standing BUY and recovery SELL planning, exchange-rule-validated order submission, in-process order ownership, canonical order/fill event coordination, fill-driven Portfolio/RecoveryLedger updates, clean TESTNET startup checks, and graceful shutdown. Not yet demonstrated: a complete TESTNET BUY → SELL → next-cycle run. Durable recovery, reservations, comprehensive reconciliation, and Aggressive remain deferred. See [ROADMAP.md](./ROADMAP.md).
