# Harvester

> **Current status — 2026-11-05:** PR #545 (automatic account PREFLIGHT audit), PR #546 (Binance WebSocket/REST canonical fill timestamp alignment), PR #552 (audit status documentation), PR #553 (Journal durability policy reconciliation), PR #554 (aggregate BUY/SELL commitment limits), and PR #559 (same-process lost-ack client-order-ID reconciliation) are merged into `develop`. The source-level startup audit, canonical fill timestamp correction, and order-budget allocator are covered by offline regressions; this does not constitute exchange acceptance. The controlled Binance Spot TESTNET gate remains CLOSED until the operator and assistant complete and review the joint one-pair recovery-cycle evidence. See [TESTNET validation runbook](./docs/TESTNET_VALIDATION_RUNBOOK.md) and [Harvester Roadmap](./ROADMAP.md).


Harvester is an independent Node.js process for cryptocurrency trading, built inside the Coinzilla pnpm monorepo.

It is intended to support multiple trading strategies through a shared trading engine. The first documented strategy modes are:

- **Conservative:** the first executable policy. It produces initial/standing BUY and recovery SELL intents from actual Portfolio and RecoveryLedger state. Aggressive is deferred.

These are strategy modes, not separate trading engines. Shared capabilities (market data, broker access, order lifecycle, fills, balances, accounting, and safety controls) should be implemented once where their contracts genuinely match. Strategy-specific decisions must remain isolated behind clear boundaries.

## Package

- Package: `@coinzilla/harvester`
- Runtime: Node.js `>=24`
- Modules: native ECMAScript modules
- Dependencies: keep minimal; add only for an agreed requirement

Run from the repository root:

```sh
cp apps/harvester/.env.example apps/harvester/.env.development
pnpm --filter @coinzilla/harvester dev
```

Edit `.env.development` with your local credentials if needed. Keep this file local; do not commit it. The development script loads it using Node's native `--env-file` option.

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

### One-shot TESTNET account audit

To capture the current account baseline without restarting Harvester or enabling trading, run `pnpm run testnet:audit` from `apps/harvester`. This read-only command connects to the Binance TESTNET WebSocket API, retrieves all account balances and account-wide open orders, writes `account.snapshot_captured` and `account.open_orders_captured` with phase `PREFLIGHT`, durably flushes both events, and disconnects. It does not subscribe to market/user-data streams, create the trading engine, submit orders, or cancel orders. It requires `HARVESTER_BROKER=binance`, `HARVESTER_TRADING_MODE=testnet`, non-production `NODE_ENV`, TESTNET credentials, and an enabled Journal. Exit code 0 means no open orders were found; exit code 2 means the audit was saved but existing orders make trading readiness BLOCKED; exit code 1 means the audit itself failed.

### Operational event journal

Harvester publishes allowlisted operational, strategy/order, execution, and recovery events through one in-process EventBus. It does not publish every market-price update. The Journal is enabled by default. Applied-fill records include stable trade identity, exact execution quantities, actual commission amounts, and commission asset identity. PR #604 adds a strict Journal projection and rehydrates Portfolio, RecoveryLedger, free inventory, order identities, and recovery intents from those facts before trading readiness. Set `HARVESTER_JOURNAL_ENABLED=false` only for configuration-only/no-broker operation; every broker-connected startup requires Journal persistence for the durable PREFLIGHT account audit. Set `HARVESTER_JOURNAL_DIRECTORY` to select a relative-to-app or absolute directory. The default is `apps/harvester/logs/`.

Journal persistence is optional only when Harvester runs without a broker (configuration-only mode). Every broker-connected startup, including read-only mode, requires an enabled, ready Journal with durable flush support because the account PREFLIGHT audit is mandatory. Startup fails closed if the Journal is disabled, cannot start, either account query fails, either event cannot be published, or either flush is not durable. Before market subscriptions or trading-engine activation, Harvester captures the full broker account balance snapshot (all returned assets, exact free/locked/total quantities), fetches the account-wide open-order set (not just enabled symbols), and durably flushes both `account.snapshot_captured` and `account.open_orders_captured` with `phase: "PREFLIGHT"`. Every open order is recorded with symbol, broker/client order IDs, side, type, price, original/executed quantities, and status. Trading-enabled startup restores Harvester-owned orders from the validated Journal and reconciles each against canonical exchange order history and complete paginated fills. Pre-existing unowned, duplicate, missing, or contradictory orders still block startup; Harvester never adopts or cancels unowned orders automatically. Read-only startup records existing orders without changing them. This removes the need to run the balances/orders scripts manually before each start. During graceful shutdown of a trading-enabled run, Harvester stops new intake, drains accepted user-data work, reconciles Harvester-owned orders, captures a CLOSING balance snapshot, and durably flushes it before disconnecting the broker. The closing snapshot is marked INCOMPLETE if order reconciliation failed, owned orders remain non-terminal, or user-data/accounting state is unsafe.

The Journal event is an account-level balance record, not a Portfolio import. PREFLIGHT is the startup baseline; CLOSING is the graceful-shutdown balance audit for trading-enabled runs. Neither event seeds strategy-owned inventory. It includes every asset returned by the broker, with exact free, locked, and total decimal quantities, and does not silently assign pre-existing balances or external orders to Harvester.

Recovery completion allocates exactly the configured keepQuantity to free inventory. Any additional active residual (for example, quantity-step or conservative fee-reserve dust) remains active inventory. Once the RecoveryLedger is reset, that residual alone is not a recovery obligation and must not generate another recovery SELL. A deterministic 12-fill regression exercises the real Conservative policy and verifies that every next BUY price is derived from the preceding reconciled fill.

The recovery.cycle_completed event's realizedNetProfit is per-cycle, not cumulative session profit. The read-only journal:balance-audit command sums those cycle results per JSONL session and reports the cumulative recovery profit alongside exact per-asset opening/closing balance deltas. Files are one JSONL session per process; automatic rotation and retention are not provided.

Normal shutdown stops intake, drains accepted user-data work, reconciles owned orders, records and flushes the CLOSING account snapshot while broker REST access is still available, disconnects the broker, publishes the final stopped event, closes Journal (drain and sync), then closes EventBus. See [Journal Operations](./docs/JOURNAL_OPERATIONS.md) for the exact event inventory, file format, failure behavior, and diagnosis steps. Follow the [staged Journal integration roadmap](./docs/JOURNAL_INTEGRATION_ROADMAP.md) and its [AI implementation task](./docs/tasks/AI_TASK_JOURNAL_INTEGRATION.md).

### Durable restart recovery

PR #604 adds a fail-closed recovery path for trading-enabled startup:

- Validate all previous Journal sessions and reject malformed or contradictory order, cancellation, fill, recovery-cycle, account-audit, and shutdown sequences.
- Rebuild exact canonical Fill values, Portfolio positions, RecoveryLedger state, free inventory, OrderRegistry ownership, completed-cycle identities, and paused/cancel-replace state.
- Load canonical market metadata for enabled and historically owned symbols.
- Resolve every restored order by canonical client-order lookup when necessary, then require exactly one canonical order-history record and complete paginated REST fill history.
- Compare REST fills against every durable Journal execution fact, including trade identity, price, quantities, transaction time, liquidity role, commission status, and commission denomination/amount. Missing Journal execution IDs or changed facts fail closed.
- Reconcile account-wide open orders and current free/locked balances against the original PREFLIGHT baseline, replayed accounting, and exact active-order reservations.
- Keep stream-driven order transitions read-only until canonical order/fill reconciliation, account audit, and user-data stream checks all pass. Recovery cannot submit, cancel, or replace orders.
- Preserve ambiguous submissions, cancellations, partial-fill cancellations, and durable strategy pauses. Recoverable cancel/replace pauses clear only after every associated order has been canonically resolved.
- Fetch paginated symbol-scoped account trade history from the durable PREFLIGHT source timestamp, with strict cursor advancement, duplicate detection, exact fill parity, and request pacing.
- Compare exchange trade facts against durable Journal fills; any unowned, missing, duplicate, or contradictory execution blocks recovery.

**Known limits and current gate:** Binance `myTrades` requires a symbol. PR #598 adds the unfiltered current `exchangeInfo` market catalog, and PR #604 adds the paginated history scanner and exact Journal parity audit. The current catalog cannot enumerate symbols delisted after the durable baseline, so it cannot prove a complete historical account-wide symbol universe. The startup gate therefore remains fail-closed until that universe can be proven complete; do not bypass it or manually set a completeness flag. The full crash-boundary matrix is also still in progress. TESTNET acceptance is NOT ACCEPTED until the separate joint validation session.

### Portfolio domain

A Portfolio is an immutable in-memory collection of market-scoped Positions. Positions track net base quantity and signed quote cash flow and are updated from canonical actual fills through `src/use-cases/update-portfolio.js`; market-price updates and order submissions do not change holdings. Base/quote commissions are applied exactly; incomplete/unknown and third-asset commissions fail closed. Duplicate canonical fill IDs are checked against the restored Journal execution history across process restarts.

See [Portfolio Domain](./docs/domain/portfolio.md) for the domain boundary, fill accounting flow, responsibilities, reliability requirements, and unresolved design decisions.

## Strategy documentation

See [Trading strategies](./docs/trading-strategies.md) for the agreed scope and unresolved design decisions.

## Configuration

Harvester uses one `trading-config.json` with strategy-scoped configuration. The root contains a `strategies` object; each strategy owns its enabled flag, settings, and market pairs. The active strategy key is `CG_coinGrabber` (the former Free-Roll strategy name).

- `strategies.CG_coinGrabber.enabled`: enables the strategy.
- `strategies.CG_coinGrabber.settings.minProfit`: minimum required net profit per completed recovery sale, in the pair's quote currency.
- `strategies.CG_coinGrabber.settings.conservative.enabled`: must remain `true`; Conservative is the first executable mode.
- `strategies.CG_coinGrabber.settings.aggressive.enabled`: must remain `false`; Aggressive is deferred until Conservative is proven on TESTNET.
- `strategies.CG_coinGrabber.pairs`: market-specific settings keyed by symbol; each pair owns its enabled flag, investment limit, sizing, reserve, precision, and fee settings.

All settings and pairs belong to their strategy. Future strategies can be sibling entries under `strategies`; they do not share this strategy's pairs. Strategy availability is not configured through environment variables.

`investment` is the maximum quote-currency capital allocated to that pair. It is denominated in the quote asset named by the symbol: `ZROUSDT` uses USDT, while `ZROFDUSD` uses FDUSD. It is a per-pair allocation limit, not an order size. `orderQuantity` remains a separate configured order quantity; `keepQuantity` remains the retained base-asset quantity. On startup, enabled pairs are checked against exchange metadata and actual tick/step/notional filters. `pricePrecision` and `quantityPrecision` do not override exchange increments.

Example:

```json
{
  "strategies": {
    "CG_coinGrabber": {
      "enabled": true,
      "settings": {
        "minProfit": 0.01,
        "conservative": { "enabled": true },
        "aggressive": { "enabled": false }
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
          "makerPercent": 0.1,
          "takerPercent": 0.1
        }
      }
    }
  }
}
```

`makerPercent` and `takerPercent` are percentage values in the range 0 inclusive to 100 exclusive (for example, `0.1` means 0.1%). Startup validation rejects negative, non-finite, and 100-or-higher values. The current USDT pair configuration reflects the reported 0.1% maker/taker setting; FDUSD pairs retain `makerPercent: 0` and use `takerPercent: 0.1`. Conservative SELL planning reserves the higher configured maker/taker rate because maker execution is not guaranteed.

The configuration loader and validation live in `src/infrastructure/config/load-trading-config.js` and `src/domain/trading-config.js`. Conservative is the first executable mode; the default process remains read-only unless TESTNET trading is explicitly enabled.

## Logging

The process entry point and bootstrap use `defaultLogger` from `@coinzilla/utils`. Keep logging at application boundaries, inject a logger where tests or alternate composition need control, and do not call global `console` directly from Harvester modules. The shared logger accepts one data argument per method; pass structured objects when a log needs metadata.

- `logger.debug({ message, ...context })` traces startup stages, broker operations, market metadata/rule validation, user-data subscription and status, initial account snapshot loading, order ownership/commitment checks, market-price processing, strategy evaluation inputs/results, and per-fill accounting. Strategy traces include every market-price event with a monotonic event ID, previous price, `lastBuyPrice`, reference overrides, active orders, Portfolio and RecoveryLedger snapshots, readiness/pause state, plus trailing-BUY repricing trigger inputs/results and the correlated evaluation ID, decision and generated intents. Accounting traces include execution/trade/order identity, side, price, base/quote quantities, actual commission amount/asset/status, before/after Position and RecoveryLedger values, exact per-fill deltas for active/free base and quote cash flow, BUY cost, SELL proceeds, outstanding recovery and realized profit, plus duplicate/applied outcome. Rejected accounting traces include errors and unchanged state. A failed startup leaves the last completed/in-progress stage visible; debug output is suppressed when `NODE_ENV=production` by the shared logger.
- `logger.info({ message, ...context })` marks key lifecycle actions such as configuration validation, broker connection, user-data subscription, OPENING/CLOSING account snapshot phase and audit completeness, trading readiness, engine activation, active market subscriptions, and shutdown.
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

Broker connectivity is opt-in. Conservative is the only executable strategy; strategy availability is read from `trading-config.json`, not environment variables. Order execution is separately opt-in with `HARVESTER_ENABLE_TRADING=true`; this explicit opt-in also requires `HARVESTER_BROKER=binance`, otherwise startup fails instead of silently falling back to read-only mode. Execution requires `HARVESTER_TRADING_MODE=testnet` and is rejected when `NODE_ENV=production`. The default `trading-config.json` enables only `ZROUSDT` for the first trading run. Trading startup currently supports exactly one enabled pair; enable additional pairs only after shared-asset allocation is implemented. Startup captures and durably journals one canonical full-account snapshot before activating the trading engine. This records the initial wallet state without adopting external open orders or treating pre-existing inventory as Harvester-owned. A closing snapshot is recorded during graceful shutdown; if open owned orders or unresolved execution state remain, it is marked INCOMPLETE.

```sh
HARVESTER_BROKER=binance
HARVESTER_TRADING_MODE=testnet
HARVESTER_ENABLE_TRADING=true
BINANCE_API_KEY=...
BINANCE_API_SECRET_KEY=...
```

### Trading-first implementation direction

Harvester implements the Conservative lifecycle: subscribe to prices, submit the initial limit BUY, account canonical TRADE fills, and manage the recovery SELL from actual in-process accounting. The initial account snapshot supplies the starting free balances; subsequent order checks subtract net quote spent, add realized quote proceeds, and reserve outstanding in-process BUY/SELL commitments. These are order-backed commitments rather than a separate reservation store: canonical PENDING orders are registered before broker I/O, and PENDING/OPEN/PARTIALLY_FILLED/UNKNOWN orders continue consuming their remaining quote or base commitment until authoritative lifecycle updates and fill accounting reconcile them. A strategy decision containing multiple orders is allocated sequentially against the remaining quote balance, pair investment limit, and Harvester-owned active base quantity before any order in that decision is submitted. Outstanding BUY reservations and quote cash-flow adjustments are aggregated by quote-asset ID across markets; SELL reservations and active inventory are likewise reconciled at account-asset and pair scopes separately. Immediately before each broker placement or cancellation call, its allowlisted intent event is durably flushed; a failed Journal barrier prevents the exchange write and pauses the pair. On process restart, prior Journal sessions are read and validated before a new writer session starts; trading is refused when any prior account-audit, order, or fill history exists until full Portfolio, RecoveryLedger, and owned-order recovery is implemented. Read-only startup remains available. If a submission acknowledgement is lost, the engine marks the pending order UNKNOWN, retains its commitment, and pauses the pair. Same-process recovery can look up the original client order ID through the broker's read-only canonical order query, attach the verified broker order ID, and reconcile canonical order history and actual fills. A missing or mismatched result remains UNKNOWN and paused; successful reconciliation does not automatically resume or retry trading. An unconfirmed cancellation also transitions the acknowledged order to UNKNOWN while preserving its broker ID and cumulative executed quantity; the order commitment remains active and the pair stays paused. SELL quantities are additionally capped by the active base inventory in Harvester's Portfolio, so external base inventory and its free/locked balances are never adopted as strategy-owned inventory. This coordination is process-local and does not provide durable restart recovery or multi-pair shared-asset allocation. A process restart still cannot reconstruct an unresolved client-order-ID registry from durable Journal state. External open orders are not registered as Harvester orders; an execution report for an unowned order after engine activation remains an ownership violation and pauses the affected pair, while an order report received before the ownership registry is ready aborts trading startup. Read-only mode does not adopt external fills into Portfolio. Ordinary TRADE fills for registered Harvester orders update Portfolio and RecoveryLedger exactly once and do not trigger full account snapshots.

## Controlled TESTNET runbook

The detailed joint-session procedure, explicit limits, reconciliation requirements, abort conditions, and evidence checklist are maintained in [TESTNET validation runbook](./docs/TESTNET_VALIDATION_RUNBOOK.md). That document is preparation only: execution requires an explicit joint session authorization. Harvester must remain stopped until then.

1. Use Binance Spot TESTNET credentials only. Never place production keys in
   the Harvester environment file.
2. Copy `.env.example` to `.env.development`. Set
   `HARVESTER_BROKER=binance`, `HARVESTER_TRADING_MODE=testnet`, and
   `HARVESTER_ENABLE_TRADING=true`. Keep `NODE_ENV=development`.
3. Keep exactly one pair enabled. The committed default is `ZROUSDT`;
   `ZROFDUSD`, DOGEUSDT, and SOLFDUSD are disabled.
4. For a controlled first-cycle test, inspect the TESTNET account and preferably
   cancel existing orders for the enabled pair. External orders and pre-existing
   base inventory are not adopted by Harvester and are not sold by its strategy;
   they may still affect the exchange free balance. Leave sufficient free quote
   balance for the configured investment. These clean-account steps are a
   runbook precaution, not a startup prerequisite.
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
orders. Before restarting, inspect the TESTNET account and reconcile any
outstanding Harvester orders or uncertain outcomes. External orders and
pre-existing inventory are not adopted by Harvester; they may affect available
balances but are not automatically sold. A clean account is recommended for a
controlled first-cycle test, but it is not a startup requirement. If Harvester
pauses because an order outcome or fill history is uncertain, do not restart
and blindly resubmit; inspect the account and reconcile it first.

This runbook is for TESTNET only. It does not enable live trading or claim
durable restart recovery.

Without `HARVESTER_BROKER=binance`, startup validates configuration but does not connect to an exchange. With it, bootstrap creates the Harvester broker port through the Binance infrastructure adapter, connects, and subscribes to price streams for every pair whose `enabled` flag is true. A failed connection or price subscription causes startup to fail; already-created subscriptions are removed and disconnect is attempted. Shutdown closes the trading gate first, drains queued user-data processing, and unsubscribes market data before disconnecting; queued fills cannot schedule new orders after shutdown begins.

Each normalized broker price event is validated by the `process-market-price` application use case, then passed to the injected strategy with its pair configuration and process-wide settings. When `HARVESTER_ENABLE_TRADING=true`, bootstrap composes the Conservative policy with the in-process trading engine. With trading disabled, the process remains read-only. Price events produce validated BUY/SELL intents, orders are registered before submission, and canonical user-data events update only Harvester-owned orders. The engine waits for full fills before advancing the strategy. The first trading run is deliberately limited to one enabled pair. Strategy BUY intents respect the configured pair investment cap; the engine checks each BUY against free quote balance after accounting for net quote cash flow and outstanding in-process BUY commitments. Each SELL is capped by active Harvester-owned base inventory and free base balance after outstanding SELL commitments. External inventory and orders remain unowned. If quote funds are insufficient for the next BUY, a valid recovery SELL is still allowed to proceed. Aggressive remains deferred.

Bootstrap seeds each enabled market from a REST ticker snapshot, then processes ongoing aggregate-trade price updates. When TESTNET trading is enabled, Harvester also subscribes to Binance `bookTicker`: every `LIMIT_MAKER` order waits for a fresh best bid/ask and is deferred if a BUY would reach/cross the best ask or a SELL would reach/cross the best bid. Binance's POST-ONLY rejection remains the final race-condition safeguard; a confirmed Spot POST-ONLY rejection invalidates the cached book and waits for a new book update before reevaluation.

## Binance client order identifiers

Every Harvester trading-engine executor creates an 88-bit random client-order
ID namespace at startup and increments a local sequence within that namespace.
The resulting IDs are compatible with Binance Spot's 36-character client-order
ID limit and are not reused merely because the process restarts.

This prevents a fresh process from restarting at a predictable identifier
such as `h-DOGEUSDT-1`, which Binance may already have seen on the account.
It does not make an order submission safe to retry: if the submission outcome
is unknown, Harvester must continue to pause and reconcile rather than submit
another order blindly. Durable retry idempotency remains unfinished.

## Runtime boundary and startup reporting

The runtime returned by `startHarvester` exposes read-only state and lifecycle
operations (configuration, subscriptions, Portfolio/account snapshots,
readiness status, and `stop`). It deliberately does **not** expose the broker
port or a standalone `placeOrder` function. All order submission must flow
through the Conservative trading engine so strategy decisions, market rules,
balance checks, order ownership, and fill lifecycle cannot be bypassed by
runtime callers. Ordinary execution reports do not close the global trading readiness gate; actual accounting failures and disconnect/recovery conditions still do. Strategy evaluations deferred by a genuine readiness gate are retained and resumed when the gate becomes ready, without requiring another market-price tick.

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

Implemented: application-owned broker port, Binance adapter, validated config, Conservative pure policy, initial/standing BUY and recovery SELL planning, exchange-rule-validated order submission, in-process order ownership, canonical order/fill event coordination, fill-driven Portfolio/RecoveryLedger updates, in-process balance/commitment checks, deferred evaluation resumption, graceful shutdown, durable OPENING/CLOSING all-asset account snapshots, and a read-only per-session balance audit command. The 2026-11-04 Journal shows 21 BUY fills (8,400 DOGE / 635.85200 USDT) and 8 SELL fills (8,390 DOGE / 636.42265 USDT), net +0.57065 USDT quote cash flow. The five per-cycle recovery profits (+0.07808, +0.03285, +0.06053, +0.03584, +0.36335) sum exactly to +0.57065; the +0.20730 difference was the previous four cycles, while +0.36335 was only the final cycle. The same Journal confirms the twelve BUY race: all 12 distinct 400-DOGE BUYs at 0.07598 USDT were acknowledged FILLED before the first execution fill was applied. Merged PR #513 waits for complete fill-history reconciliation before releasing the serialized transition, and deterministic delayed-ack plus 12-fill real-policy tests cover the race. The post-cycle residual inventory path now requires positive outstanding recovery before another recovery SELL can be planned; invalid order validation pauses the pair. Engine-level regressions cover the reset/keep/free state and repeated MIN_NOTIONAL decisions. Follow-up PR #515 now adds streamed partial-fill, stale REST, pending acknowledgement/cancellation, shutdown reconciliation, fee-boundary, multi-fill accounting, and account-audit failure regressions; its latest offline CI results and remaining gates are tracked in ROADMAP.md. The latest read-only account snapshot reports 12,321 free DOGE, 9,792.44855 free USDT, 9,990.865 FDUSD, and 517 non-zero assets; this is account-wide pre-existing TESTNET inventory, not Harvester-owned Portfolio state. The historical Journal predates opening/closing snapshots, so it cannot establish the account opening baseline. Keep TESTNET trading stopped; live trading remains disabled. See [ROADMAP.md](./ROADMAP.md) for the incident evidence, remaining gates, and next acceptance steps.


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

**Account-state warning (2026-11-04):** the latest supplied snapshot contains 517 non-zero assets, including 12,321 free DOGE and 9,792.44855 free USDT; all reported locked balances are zero. This is not a clean test account and is not a Harvester Portfolio snapshot. Do not treat wallet DOGE as strategy-owned inventory, infer the strategy's retained/free quantity from it, or calculate PnL from this snapshot. Establish a known opening balance and reconcile all relevant DOGEUSDT trades with their actual commission amount and asset before attributing balances or profit.


## Standalone Binance TESTNET ZRO market sell

A separate operator script can sell the account's free ZRO balance using a
market order on the fixed Binance Spot TESTNET `ZROUSDT` symbol:

```sh
pnpm --filter @coinzilla/harvester testnet:sell-zro
```

The default run is a preview. The script requires typing
`SELL ALL FREE ZRO ON TESTNET` before placing an order, checks that no
`ZROUSDT` orders are open, rounds down to the exchange market quantity step,
and rechecks the free balance immediately before submission. Locked ZRO is
not sold. A market order has no guaranteed execution price. This tool is
destructive and must only be used after reviewing the displayed quantity.
It is TESTNET-only and is not part of the Harvester runtime.

See [Binance TESTNET order scripts](./docs/testnet-order-tools.md) for the
full behavior and safety constraints.


## Standalone Binance TESTNET order history

Inspect the latest exchange-recorded orders for one symbol without changing
the account:

```sh
# Latest 20 ZROUSDT orders (default)
pnpm --filter @coinzilla/harvester testnet:history

# Latest 50 ZROUSDT orders
pnpm --filter @coinzilla/harvester testnet:history ZROUSDT 50

# Latest 20 BTCUSDT orders
pnpm --filter @coinzilla/harvester testnet:history -- BTCUSDT 20
```

Binance requires a symbol for order history; the command cannot return a
mixed-symbol account-wide list. The output includes order IDs, timestamps,
side/type, original and executed quantities, cumulative quote quantity,
status, and client order ID. It is read-only and defaults to the latest 20
orders for `ZROUSDT`. See
[Binance TESTNET order scripts](./docs/testnet-order-tools.md) for details
and diagnostic limitations.


### 2026-11-04 TESTNET incident remediation

**BUY-burst clarification:** the twelve DOGEUSDT BUYs were twelve distinct exchange orders with distinct client IDs and broker order IDs; they were not duplicate IDs. All twelve nevertheless used the exact same 0.07598 USDT price and 400 DOGE quantity, executed as TAKER within roughly three seconds. A 12-order burst may be expected during a sharp price dump; twelve independently submitted orders at the identical price are the anomaly. The Conservative strategy interprets priceStepPercent: 0.05 as 0.05% and computes the next BUY from the last reconciled BUY execution price. The repeated identical price is consistent with submissions occurring before the previous BUY fill had updated strategy state. PR #513 adds the immediate-FILLED acknowledgement reconciliation barrier; review and test the non-terminal acknowledgement followed by streamed FILLED/TRADE event path as well. Do not describe this as a client-ID collision or treat the burst count alone as proof of a defect.

PR #513 is merged and contains the source-level fixes for the two incident defects: FILLED broker acknowledgements are held behind complete execution-history retrieval/application before the serialized strategy transition can finish, and residual active inventory no longer creates a recovery SELL after the recovery ledger has been reset. Invalid strategy order validation pauses the affected pair rather than retrying the same invalid decision on every market event. Deterministic regression tests cover delayed multi-fill acknowledgement reconciliation, incomplete-history fail-closed behavior, and residual inventory after cycle completion. Follow-up PR #515 owns the remaining streamed lifecycle/interleaving matrix, end-to-end accounting and fee boundaries, and OPENING/CLOSING audit verification. Its branch must remain synchronized with `develop`, and all remaining acceptance checks must pass on the exact final head before merge. Keep Harvester stopped; CI success and merge do not authorize TESTNET restart.


## Standalone Binance TESTNET trade history (read-only)

Retrieve actual executions, including exchange trade IDs, order IDs, side,
price, base/quote quantities, commission amount/asset, maker/taker role, and
execution timestamp. This is the evidence needed to reconcile exchange fills
with Harvester's journal and accounting.

From the repository root, run this **single command** for the DOGEUSDT incident:

```sh
pnpm --filter @coinzilla/harvester testnet:trades DOGEUSDT 1000
```

It loads `apps/harvester/.env.development` and calls Binance Spot TESTNET
`GET /api/v3/myTrades`. The command is read-only; it does not create or
cancel orders. It prints every returned trade. Binance limits a response to
1,000 trades; this command retrieves one page only. If the incident spans more
than 1,000 executions, request the next page with the optional third argument
`FROM_ID` (the next trade ID to retrieve), for example:
`pnpm --filter @coinzilla/harvester testnet:trades DOGEUSDT 1000 212336`. The local system clock must be synchronized
because the signed endpoint validates request timestamps.


### Follow-up execution-history validation

PR #513 now rejects conflicting duplicate canonical fill records during immediate-FILLED acknowledgement reconciliation. Previously, the path deduplicated by fill ID without comparing payloads; it now pauses the pair if the same ID appears with different Fill.value data. A regression test verifies that no fill is applied before this conflict is rejected.


### TESTNET commission configuration note — 2026-11-04

The Binance Spot TESTNET account initially showed **Commissions: None**. The operator changed the account setting to **0.1% maker & taker** (shown in the later screenshot). Historical incident trades report zero commission; do not retroactively apply 0.1% to them. For future trades, verify the setting is active and reconcile actual per-trade commission amount and asset from Binance. The setting is account-wide across the API keys on that TESTNET account. Harvester must account for actual fees in net-profit and recovery calculations; a configured rate is not a substitute for execution-level commission facts.

### Incident review status — 2026-11-04 (follow-up PR #515)

The previous CI run checked an earlier PR merge ref and failed one Harvester regression because it still expected a successful result for an invalid MIN_NOTIONAL intent. The current branch test now asserts the intended contract: `processMarketPrice()` returns `ok: false` with the MIN_NOTIONAL validation error, pauses the pair once, and does not reevaluate on later ticks. A fresh CI run must verify the exact current PR head before merge.

The earlier maker-only fee-reserve finding is resolved in source: Conservative recovery SELL sizing reserves the greater of configured makerPercent and takerPercent. Tests cover zero, maker-higher, taker-higher, equal, and invalid fee rates. Actual exchange commissions remain authoritative for realized accounting.

The remaining lifecycle overlap matrix and a future closed-session account-baseline audit are follow-up work, not blockers to merging the completed source remediation. Keep Harvester stopped; merge does not authorize TESTNET restart or order submission.


### Incident audit logging requirement — 2026-11-04

The Harvester TESTNET Journal initially appeared to show a +0.20730 USDT discrepancy because the final recovery.cycle_completed event reported +0.36335 while the exchange's session-wide quote cash flow was +0.57065. Reconciliation of all five cycle events resolves this exactly: the previous four cycles sum to +0.20730 and all five sum to +0.57065. Historical exchange executions reported zero commission; the later 0.1% maker/taker setting is not retroactive.

The merged PR #513 source emits structured DEBUG traces for strategy evaluation and every accounting fill. These logs are diagnostic evidence; the durable Journal must not be assumed to contain them. For any incident reconciliation, correlate by exchange trade ID and verify gross quote, actual commission asset/amount, Portfolio cash-flow changes, RecoveryLedger cost/proceeds, cycle completion/reset, and Journal aggregation. Recovery-completion trace and end-to-end journal arithmetic reconciliation remain part of the PR #515 offline verification scope; a future controlled TESTNET run remains separately gated.


### Account-level balance audit

Every explicitly enabled Conservative TESTNET session records an OPENING snapshot before the trading engine can submit its first order and a CLOSING snapshot during graceful shutdown, before broker disconnect. The snapshot includes all broker-returned assets (including unrelated and third-asset balances) with exact free, locked, and total quantities. A closing snapshot is marked INCOMPLETE when owned-order reconciliation fails, an owned order remains non-terminal, intake fails, or user-data/accounting state is unresolved.

The pure reconcileAccountSnapshotDeltas helper computes exact per-asset free/locked/total changes from OPENING and CLOSING events, including assets that appear or disappear, and propagates INCOMPLETE audit reasons. Balance deltas are an independent account-level cross-check, not a standalone proof of strategy profit. Reconcile every asset delta against executions and commissions, deposits/withdrawals/transfers, other account activity, and the valuation of remaining inventory in a common quote currency. Trade-level fill accounting remains authoritative for realized strategy PnL. Unknown external activity or open orders makes the account-level result incomplete.

### Compare persisted opening and closing balances

After a graceful shutdown, run the read-only Journal audit command from the Harvester app directory:

```bash
pnpm run journal:balance-audit
```

Pass a Journal directory as the first argument when using a non-default location:

```bash
pnpm run journal:balance-audit -- ./logs
```

The command groups records by JSONL session and reports exact per-asset free, locked, and total balance deltas. It exits non-zero if a session is missing either snapshot, has duplicate endpoints, or carries an INCOMPLETE closing audit. The command is read-only and never modifies Journal sessions. It deliberately does not convert these deltas into a profit figure; executions, commissions, external transfers, and remaining inventory valuation still require reconciliation.

## Startup account preflight audit

Every connected `pnpm run dev` startup captures exchange account state before market subscriptions, whether order execution is enabled or not. Harvester uses its existing broker connection and durably journals `account.snapshot_captured` (exact free, locked, and total balances) and `account.open_orders_captured` (account-wide open orders and their identifiers, symbol, side, type, price, original/executed quantities, and status), both with phase `PREFLIGHT`. Each event is flushed before startup proceeds. Query, publication, or flush failure blocks startup. Existing orders are recorded as unowned and are never adopted or changed. Read-only mode may continue with a blocked order audit; trading-enabled startup remains blocked when any pre-existing order exists.


The automatic `PREFLIGHT` account audit is implemented and merged in PR #545. Its required CI checks passed. The feature is observational only; existing exchange orders remain external/unowned, and this merge does not authorize resuming TESTNET trading.


Trading-enabled startup also acquires an exclusive `.harvester-trading.lock` in the configured Journal directory before reading prior sessions. A second local process using the same Journal directory is refused. The lock is released only after runtime shutdown and Journal writer closure are confirmed. A stale lock is never reclaimed automatically: after a crash, verify the recorded PID/host is no longer active before manually removing the lock file. Instances sharing one exchange account must use the same Journal directory; separate directories do not coordinate this local lock.
