# Harvester

Harvester is an independent Node.js process for cryptocurrency trading, built inside the Coinzilla pnpm monorepo.

It is intended to support multiple trading strategies through a shared trading engine. The first documented strategy modes are:

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

The configuration loader and validation are implemented. Conservative is the first executable strategy and is composed with the in-process trading engine when TESTNET trading is explicitly enabled. The default remains read-only; see the TESTNET startup requirements above and the trading-strategy documentation for the implemented policy.

## Logging

The process entry point and bootstrap use `defaultLogger` from `@coinzilla/utils`. Keep logging at application boundaries, inject a logger where tests or alternate composition need control, and do not call global `console` directly from Harvester modules. The shared logger accepts one data argument per method; pass structured objects when a log needs metadata.

- `logger.debug({ message, ...context })` traces startup stages, broker operations, market metadata/rule validation, user-data subscription and status, account snapshot loading, open-order/base-inventory checks, market-price processing, and cleanup. A failed startup leaves the last completed/in-progress stage visible; debug output is suppressed when `NODE_ENV=production` by the shared logger.
- `logger.info({ message, ...context })` marks key lifecycle actions such as configuration validation, broker connection, user-data subscription, accepted account snapshot, clean TESTNET readiness, engine activation, active market subscriptions, and shutdown.
- `logger.error({ message, errorName, errorMessage, errorStack })` records actionable failures. The process entry point also emits normalized nested error details so `Error` and `AggregateError` messages/stacks remain visible in structured logs. Startup tests verify both the original error and its normalized diagnostic details.
- Never log API keys, API secrets, signed requests, or raw exchange payloads. Market-price diagnostics include only the symbol, price, and event timestamp; user-data diagnostics include event type and relevant symbol/side metadata.

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

Broker connectivity is opt-in. Order execution is separately opt-in with `HARVESTER_ENABLE_TRADING=true`, requires `HARVESTER_TRADING_MODE=testnet`, and is rejected when `NODE_ENV=production`. The default `trading-config.json` enables only `ZROUSDT` for the first trading run. Trading startup enforces exactly one enabled pair, no open orders, and zero pre-existing base inventory for that pair. Enable additional pairs only after shared-asset allocation is implemented.

```sh
HARVESTER_BROKER=binance
HARVESTER_TRADING_MODE=testnet
HARVESTER_ENABLE_TRADING=true
BINANCE_API_KEY=...
BINANCE_API_SECRET_KEY=...
```

## Controlled TESTNET runbook

1. Use Binance Spot TESTNET credentials only. Never place production keys in
   the Harvester environment file.
2. Copy `.env.example` to `.env.development`. Set
   `HARVESTER_BROKER=binance`, `HARVESTER_TRADING_MODE=testnet`, and
   `HARVESTER_ENABLE_TRADING=true`. Keep `NODE_ENV=development`.
3. Keep exactly one pair enabled. The committed default is `ZROUSDT`;
   `ZROFDUSD`, DOGEUSDT, and SOLFDUSD are disabled.
4. In the TESTNET account, cancel every existing order for the enabled pair
   and clear its base-asset balance. Leave sufficient free quote balance for
   the configured investment. Startup deliberately refuses an ambiguous
   account.
5. Start the app with
   `pnpm --filter @coinzilla/harvester dev`.
6. Confirm the broker connects, user-data readiness becomes READY, and the
   enabled pair receives prices. The first Conservative BUY is submitted below
   the current last trade by `priceStepPercent`, rounded down to the exchange
   tick.
7. When the BUY fills, Harvester accounts the actual fill and places the next
   standing BUY plus the recovery SELL. If another BUY fills while that SELL
   is open, Harvester cancels it, reconciles its fill history, and places a
   recalculated SELL only after the cancellation is confirmed.
8. After the recovery SELL fills, Harvester verifies actual net proceeds and
   moves exactly `keepQuantity` into free inventory. Confirm the next BUY
   remains active and the free amount is excluded from invested-position
   calculations.

**Shutdown/restart warning:** stopping Harvester does not cancel exchange
orders. Before restarting, inspect the TESTNET account, cancel any remaining
orders, and clear any unexplained base inventory. The first-cycle startup gate
will reject an account that is not clean. If Harvester pauses because an order
outcome or fill history is uncertain, do not restart and blindly resubmit;
inspect the account and reconcile it first.

This runbook is for TESTNET only. It does not enable live trading or claim
durable restart recovery.

Without `HARVESTER_BROKER=binance`, startup validates configuration but does not connect to an exchange. With it, bootstrap creates the Harvester broker port through the Binance infrastructure adapter, connects, and subscribes to price streams for every pair whose `enabled` flag is true. A failed connection or price subscription causes startup to fail; already-created subscriptions are removed and disconnect is attempted. Shutdown closes the trading gate first, drains queued user-data processing, and unsubscribes market data before disconnecting; queued fills cannot schedule new orders after shutdown begins.

Each normalized broker price event is validated by the `process-market-price` application use case, then passed to the injected strategy with its pair configuration and process-wide settings. When `HARVESTER_ENABLE_TRADING=true`, bootstrap composes the Conservative policy with the in-process trading engine. With trading disabled, the process remains read-only. Price events produce validated BUY/SELL intents, orders are registered before submission, and canonical user-data events update only Harvester-owned orders. The engine waits for full fills before advancing the strategy. The first trading run is deliberately limited to one enabled pair and requires a clean TESTNET account with no open orders or pre-existing base inventory. Strategy BUY intents respect the configured pair investment cap; the engine checks each BUY against free quote balance and each SELL against free base balance. If quote funds are insufficient for the next BUY, a valid recovery SELL is still allowed to proceed. Aggressive remains deferred.

Price events are trade-price updates from the broker's aggregate-trade stream; Harvester does not currently seed the strategy with a REST ticker snapshot. The broker user-data stream is normalized into canonical order and Fill events. Harvester correlates order updates against its in-process registry and applies actual fills to Portfolio and RecoveryLedger. Reconnect recovery, durable restart state, reservation accounting, and complete TESTNET BUY → SELL → next-cycle proof remain unfinished.

## Runtime boundary and startup reporting

The runtime returned by `startHarvester` exposes read-only state and lifecycle
operations (configuration, subscriptions, Portfolio/account snapshots,
readiness status, and `stop`). It deliberately does **not** expose the broker
port or a standalone `placeOrder` function. All order submission must flow
through the Conservative trading engine so strategy decisions, market rules,
balance checks, order ownership, and fill lifecycle cannot be bypassed by
runtime callers.

Startup logging reports the actual mode:
- **Conservative TESTNET trading enabled:** the engine is composed and waits
  for validated market prices and user-data readiness before acting.
- **Broker read-only:** market data may be connected, but order execution is
  disabled.
- **No broker:** configuration is validated without exchange connectivity.

Every Harvester implementation commit must include its corresponding
documentation update in that same commit. Tests and code must not be committed
with documentation deferred to a later follow-up commit.

## Current status

Implemented: application-owned broker port, Binance adapter, validated config, Conservative pure policy, initial/standing BUY and recovery SELL planning, exchange-rule-validated order submission, in-process order ownership, canonical order/fill event coordination, fill-driven Portfolio/RecoveryLedger updates, clean TESTNET startup checks, and graceful shutdown. Not yet demonstrated: a complete TESTNET BUY → SELL → next-cycle run. Durable recovery, reservations, comprehensive reconciliation, and Aggressive remain deferred. See [ROADMAP.md](./ROADMAP.md).


## Standalone Binance TESTNET order tools

Harvester includes two operator-run scripts under `scripts/`. They are
separate from `src/` and are not imported by or wired into the trading
runtime. They use Node.js built-ins only and are fixed to the Binance Spot
TESTNET API host.

Prepare local TESTNET credentials in
`apps/harvester/.env.development` (never commit this file), then run from
the repository root:

```sh
# Read-only: list open orders across all symbols
pnpm --filter @coinzilla/harvester testnet:orders

# Destructive: cancel all open orders across all symbols after exact confirmation
pnpm --filter @coinzilla/harvester testnet:cancel-orders
```

**Before cancellation:** stop Harvester and every other process that may
submit/manage orders. The cancellation command displays the initial order
list, requires typing `CANCEL ALL TESTNET ORDERS`, cancels per symbol, and
queries the account again to verify the result. It targets orders from all
applications and must not be used if any open order should be preserved.
It does not clear existing asset balances or bypass Harvester's clean-account
checks.

See [Binance TESTNET order scripts](./docs/testnet-order-tools.md) for
permissions, exact behavior, safety warnings, and troubleshooting.


## Standalone Binance TESTNET balance inspection

List every asset with a non-zero free or locked balance using the read-only
account endpoint:

```sh
pnpm --filter @coinzilla/harvester testnet:balances
```

The command uses the local TESTNET credentials, displays exact exchange
decimal strings, and does not place/cancel orders or change balances. See
[Binance TESTNET operator scripts](./docs/testnet-order-tools.md).
