# Harvester

## Pre-launch component configuration

Harvester's startup-only component settings and the audited safety/dependency matrix are documented in the [pre-launch component configuration matrix](./docs/architecture/COMPONENT_CONFIGURATION_MATRIX.md). Configure components in the named `appConfig` in `config/index.js`; changes apply on the next launch. The shipped `components.recovery.enabled: false` master switch disables Operational State Store reads/writes, startup account-history backfill, user-data reconnect reconciliation, Recovery Seller execution, and Telegram Command Center. It leaves current-session Conservative accounting, initial account/open-order PREFLIGHT, Journal durability, process locks, and new order/fill persistence active. After a user-data disconnect, readiness stays blocked until a new process performs a fresh PREFLIGHT. Existing recovery-facts files are left untouched and ignored. This is not a runtime feature-toggle or kill-switch API.

> **Documentation:** Start with the [Harvester documentation index](./docs/README.md). Repository-wide documentation lifecycle and AI-agent maintenance requirements are defined in [Documentation Governance](../../docs/DOCUMENTATION_GOVERNANCE.md). The [documentation migration plan](./docs/plans/DOCUMENTATION_MIGRATION.md) tracks the staged reorganization; historical evidence must be preserved.

> **Current status — 2026-11-16:** ADR-0001 Steps 1–7 are merged: one-market orchestration/READY-gated coverage confirmation in [PR #1047](https://github.com/45s/coinzilla/pull/1047), plus the offline JSON context adapter, audit-only/explicit-confirmation CLI and production-audit end-to-end matrix in [PR #1053](https://github.com/45s/coinzilla/pull/1053). [PR #1055](https://github.com/45s/coinzilla/pull/1055) is merged: Step 8 Operational State Store record producers/barriers, offline candidate Portfolio/RecoveryLedger/OrderRegistry projection, one-market read-only reconciliation and an observation-only trading gate after a prior process session. Process-restart restoration remains disabled by `strategies.CG_coinGrabber.settings.recovery.enabled: false`. Startup verifies the already-initialized Operational State Store but does not project or restore prior Portfolio/RecoveryLedger/OrderRegistry state. If any prior `PROCESS_STARTED` fact exists, Harvester keeps trading disabled while read-only runtime services remain available. The Telegram Command Center is documented separately as an inbound application interface. Same-process user-data reconciliation and Conservative strategy behavior remain unchanged. Startup never creates or repairs the ledger. Conservative same-process BUY/SELL recovery-cycle accounting remains enabled and unchanged. ADR-0001 runtime restoration and Step 9 crash/restart proof require separate future acceptance; no TESTNET acceptance is claimed. The Telegram Command Center is complete: commands and read-only queries (PRs #1079, #1081, #1086), inline navigation/confirmation (PR #1088), persistent keyboard (PR #1194), emergency BUY commands (PR #1267), and correlated interaction diagnostics (PR #1215). It is enabled by default; set `operatorControl.telegram.enabled=false` only when intentionally disabling it. Operator pauses are process-lifetime only. Outbound proactive notifications are separate from the Command Center. Separately, [PR #906](https://github.com/45s/coinzilla/pull/906) adds same-process Journal flush-failure classification and retains the process-ownership lock when runtime shutdown or Journal close is not confirmed. That hardening does not resolve #654. See the [Step 7 recovery operator guide](./docs/recovery/README.md), [Harvester Roadmap](./ROADMAP.md), [Journal Operations](./docs/JOURNAL_OPERATIONS.md), and [Conservative Strategy audit](./docs/audits/reports/AUDIT.md).

> **Latest TESTNET session audit — 2026-11-08:** Source review traced the DOGE follow-up gap to an unowned ZRO execution closing global accounting readiness while an already-resting Harvester BUY remained live. The BUY-cancellation safety fix is in [PR #669](https://github.com/45s/coinzilla/pull/669). The configured-asset snapshot allowlist correction is implemented in [PR #670](https://github.com/45s/coinzilla/pull/670) and tracked in [#667](https://github.com/45s/coinzilla/issues/667). The audit readiness label BLOCKED describes unowned-order reconciliation, not startup readiness. See the [session audit in AUDIT.md](./docs/audits/reports/AUDIT.md#2026-11-0708-binance-spot-testnet-session-audit--issue-667). This is retrospective evidence, not TESTNET acceptance or authorization to trade.

> **AI WORK PRIORITY — HARD RULE:** The Conservative trading workflow and its safety gates remain the product priority; secondary work must not delay or change them. Explicitly selected, narrowly scoped engineering and evidence tasks may proceed independently when they remain non-blocking. This process-provenance work is explicitly selected and must not add a trading-readiness or Journal durability gate. Read [TRADING_FIRST.md](./docs/TRADING_FIRST.md) before doing any work.

Harvester is an independent Node.js process for cryptocurrency trading, built inside the Coinzilla pnpm monorepo.

It is intended to support multiple trading strategies through a shared trading engine. The first documented strategy modes are:

- **Conservative:** the first executable policy. It produces initial/standing BUY and recovery SELL intents from actual Portfolio and RecoveryLedger state. Aggressive is deferred.

These are strategy modes, not separate trading engines. Shared capabilities (market data, broker access, order lifecycle, fills, balances, accounting, and safety controls) should be implemented once where their contracts genuinely match. Strategy-specific decisions must remain isolated behind clear boundaries.

## Package

- Package: `@coinzilla/harvester`
- Runtime: Node.js `>=24`
- Modules: native ECMAScript modules
- Dependencies: keep minimal; add only for an agreed requirement

Run development from the repository root:

```sh
cp apps/harvester/.env.example apps/harvester/.env.development
pnpm --filter @coinzilla/harvester dev
```

The `dev` script loads `.env.development` before starting the logging runner; the child Harvester process inherits those values. Set `TRADING_MODE=testnet` in `.env.development` to select Binance Spot TESTNET. Trading is enabled in this mode; there is no separate trading-enable switch. Put TESTNET API credentials in `.env.development`.

For production, use the same template and select LIVE explicitly:

```sh
cp apps/harvester/.env.example apps/harvester/.env
# Set TRADING_MODE=live and provide Binance Spot LIVE credentials in .env
pnpm --filter @coinzilla/harvester start
```

The `start` script loads `.env` before application and broker modules load. `TRADING_MODE=live` selects Binance Spot LIVE endpoints and enables real order execution. Use a dedicated API key with Spot trading permission and withdrawals disabled. Never copy TESTNET credentials into production. Externally injected credentials remain supported. `NODE_ENV` may still describe the Node.js runtime, but it does not select the Binance environment.

Tests:

```sh
pnpm --filter @coinzilla/harvester test
pnpm --filter @coinzilla/harvester test:coverage
```

The offline DOGE/ZRO Conservative runtime replay and its simulated Binance harness live in [`test/replays/`](./test/replays/). They exercise the real Harvester composition without connecting to Binance or placing exchange orders.

The ADR-0001 Step 7 offline market audit is available through `pnpm --filter @coinzilla/harvester recovery:market -- --context ./recovery-evidence/linkusdt.json`. Audit-only is the default; `--confirm` explicitly appends an operational record to the Operational State Store and requires an already initialized store. The command does not connect to Binance, place/cancel orders, or enable startup restoration. See the [recovery operator guide](./docs/recovery/README.md) for the evidence schema and safety contract.

## Trading-history API v1 (#1635)

The [Trading-history API v1](./docs/api/trading-history-api.md) serves persisted orders, individual fills, and commission facts to independent clients from the existing Harvester process. It uses a transport-independent application query facade and Harvester's already-open relational database connection. It does not add tables, change trading behavior, or connect to a broker/exchange.

The API is an optional process component, enabled by default to preserve existing behavior. Set `components.tradingHistoryApi.enabled: false` in the named `appConfig` in `config/index.js` to omit its HTTP/WebSocket listener at the next launch. This does not disable relational persistence, order/fill accounting, or any trading safety service. When enabled, it binds to `127.0.0.1:4201`; no token or extra environment configuration is required. Start Harvester normally with the intended `TRADING_MODE`:

```sh
pnpm --filter @coinzilla/harvester dev
```

The API starts when Harvester has an active runtime and relational history persistence. It shares Harvester's existing database connection and closes before persistence during process shutdown; it has no separate process, script, or launch command. The unauthenticated listener is fixed to loopback for local single-user development and must not be exposed to a LAN or remote host. See the API contract for routes, filters, pagination, local-only boundary, and exact financial-value semantics.

## Read-only exchange account monitor

The Dashboard Exchanges page uses the local `/api/v1/exchanges/accounts` routes. Harvester
builds the API's account list from successfully started provider runtimes and calls only their
existing read-only account-snapshot and open-order methods. Live invalidation notifications fan
out from the already-running normalized user-data handler through an isolated in-process observer;
no second exchange connection or user-data subscription is created. Monitor listener failures are
contained and do not participate in trading readiness, order processing, accounting, or recovery.

Only provider instances actually started by Harvester and exposing both reads appear. The
current production adapter factory map supports Binance Spot; Binance Futures and Bitunix account
providers are not registered, so they are intentionally absent. The separate public Bitunix Futures
market-data client is not an account provider and is not used as a substitute. The local API remains
loopback-only and read-only.

The account-monitor WebSocket uses RFC 6455 7-bit, 16-bit and 64-bit payload-length encodings, measured from UTF-8 bytes. Complete JSON messages are limited to 1 MiB and each client's buffered-write queue to 2 MiB. A message above 1 MiB is rejected with close code 1009; a slow client's queue overflow uses 1013; serialization, encoding or synchronous write failures use 1011. These outcomes close and clean up only the affected socket. Snapshots are never silently truncated, and a WebSocket client failure must not terminate Harvester or interrupt trading.

## Operational State Store (ADR-0001)

The Operational State Store is a separate Harvester-owned append-only recovery-facts ledger. It is not the SQLite history database and is not interchangeable with Journal.

**Current default (2026-11-22):** Conservative restart recovery remains disabled (`CG_coinGrabber.settings.recovery.enabled: false`), but Recovery Seller is enabled with an enabled LINEAUSDT TESTNET market. Therefore `prepareProcessOperationalStateStore` now constructs and verifies the process-owned ADR-0001 store when either CG restart recovery is enabled **or** RS is enabled with at least one enabled market. Telegram-only operator control still does not create or require the store.

The store is required by RS for durable STOP state and process-boundary facts; this does **not** enable automatic Portfolio/RecoveryLedger/OrderRegistry restoration. Startup verifies the existing ledger before broker-capable runtime startup. It never creates a missing genesis ledger, repairs a corrupt chain, or treats missing history as empty. Fact recorders write only after a verified store is injected. Prior process history remains subject to the existing fail-closed/observation-only startup rules; unattended restart is not enabled.

The default directory is `apps/harvester/recovery-facts/`, resolved relative to the Harvester package. `OPERATIONAL_STATE_DIRECTORY` selects an alternate absolute local-filesystem directory.

**Normal startup requires no manual genesis command.** When the directory is missing or exists but is empty, the process-owned store creates the private directory (0700), `facts.jsonl`, `manifest.jsonl` (0600), and the genesis record, then verifies the result. When both expected files already exist, startup verifies their complete contents and integrity chains. A directory containing only one stream, unexpected files, malformed/corrupt records, or mismatched checkpoints fails closed; startup never repairs, resets, or overwrites existing data.

The explicit `operational-state:init` CLI remains available for deliberate manual initialization and refuses to overwrite a non-empty directory. It is not required for ordinary first startup. Restart restoration remains separately gated by [#654](https://github.com/45s/coinzilla/issues/654).

## Ordinary trading-session history (#1327)

**Implementation status:** The trading-session slice is merged into `develop` in [PR #1369](https://github.com/45s/coinzilla/pull/1369) as `c2116fd647d942c11947e556e71a0e8e578cc192`. Its exact PR head passed 32 GitHub Actions checks; the optional read-only Binance TESTNET integration was skipped. This records code integration into `develop`, not a production deployment or authorization for exchange operations.

Harvester has integrated a provider-neutral, non-authoritative history store through `@coinzilla/db`. The merged first slice stores process trading-session history only; it does not migrate orders, fills, account snapshots, or recovery state.

The initial provider is SQLite, with independent files selected only by validated `TRADING_MODE`:

- `TRADING_MODE=live` → `apps/harvester/data/production/harvester.db`
- `TRADING_MODE=testnet` → `apps/harvester/data/testnet/harvester.db`

`NODE_ENV` never selects the trading environment or database file. An optional `HARVESTER_DATABASE_DIRECTORY` must be an absolute base directory; Harvester creates separate `production/` and `testnet/` children. Runtime database files are Git-ignored.

The database is an ordinary lifecycle-event projection, not the Operational State Store. ADR-0001 remains a separate recovery contract when a store is explicitly constructed/injected; the current `recovery.enabled: false` default means the normal `main()` path does not construct it. Restart restoration remains disabled. The session observer does not change Journal ordering, acknowledgement, flush, durability, or failure behavior. Database/history failures are logged and isolated; they do not add a trading-readiness gate or fallback to another persistence system.

See the [SQLite integration blueprint](./docs/persistence/sqlite-integration-blueprint.md) for the source-verified inventory, target architecture, repository contracts, TESTNET/LIVE isolation, operational constraints, migration phases, and unresolved decisions; see the [trading-session repository contract](./docs/persistence/README.md) for the existing implementation.

## Configuration

Harvester exposes one application-wide named `appConfig` export from `config/index.js`. Follow the repository [Configuration Standard](../../docs/engineering/CONFIGURATION_STANDARD.md) for the shared ownership, loading, validation, environment, secret and compatibility rules; this section records Harvester-specific configuration contracts. Each strategy's switches live in its focused `config/strategies/` module. Conservative (CG) pair definitions live in `apps/harvester/cg-coin-grabber.js` (`tradingPairs`); Recovery Seller (RS) pair definitions live in `apps/harvester/rs-recovery-seller.js` (`recoverySellerPairs`). Each strategy owns one market map; do not duplicate a strategy's pair definitions in application source or maintain separate TESTNET/LIVE maps.

Each pair must explicitly use `TRADING_ENVIRONMENTS.TESTNET`, `.LIVE`, or `.BOTH` from `src/domain/trading-environment.js`. `TRADING_MODE=testnet` includes TESTNET and BOTH; `TRADING_MODE=live` includes LIVE and BOTH. The serialized values remain `"testnet"`, `"live"`, and `"both"`. Non-matching pairs are excluded, and `tradingEnvironment` is removed from the effective runtime pair config. There is no default or fallback. If no pair matches (or no matching pair is enabled), startup fails before broker connection. The pair's `enabled` flag remains independent of its environment.

Conservative pair fields remain under `CG_COIN_GRABBER_CONFIG.pairs.<SYMBOL>` (the source module currently exports this map as `tradingPairs`); Recovery Seller fields remain under `recoverySellerPairs.<SYMBOL>`. Conservative fields include `enabled`, `enableVolatilityProtection`, `externalOrdersPolicy`, `investment`, `orderQuantity`, `keepQuantity`, `minProfit`, and fee settings. Precision is not operator-owned pair configuration: it is resolved from `token-specification.json` by exact market symbol when `loadAppConfig` builds the effective runtime config. The external pair module uses `externalOrdersPolicy: EXTERNAL_ORDERS_POLICIES.IGNORE` (or `.BLOCK`) from `src/domain/external-orders-policy.js`; the serialized values remain `"ignore"` and `"block"`. Validation still allows the policy to be omitted and defaults it to ignore. Every unmatched startup order follows this policy regardless of client-order ID prefix: IGNORE leaves the order external without blocking strategy evaluation, while BLOCK restricts only that symbol. Unmatched execution reports with reserved `h-` IDs remain fail-closed and are never attributed to the current process.

**Runtime environment contract:** `TRADING_MODE` accepts exactly `testnet` or `live` and remains the compatibility selector for the legacy single-Binance configuration. `NODE_ENV` never selects an exchange environment. When `brokers.instances` is configured, each account entry selects its own explicit `environment`; the runtime passes that value into the provider adapter and account-scoped process lock.

### Recovery Seller configuration

**RS activation status — 2026-11-22:** `RS_RECOVERY_SELLER_CONFIG.enabled` is `true`. LINEAUSDT is enabled for Binance Spot TESTNET through its own `tradingEnvironment: TESTNET` setting. The existing per-market environment selector controls eligibility exactly as it does for Conservative: `TRADING_MODE=testnet` selects LINEAUSDT; `TRADING_MODE=live` excludes it. PR #1696 implements legacy single-provider route inference for enabled strategies, RS-only provider startup without a Conservative execution route, and a deduplicated CG/RS market-data union. Multi-provider deployments continue to require explicit execution and market-data route tables. The routing/startup implementation and offline RS-only bootstrap acceptance are complete in merged [PR #1696](https://github.com/45s/coinzilla/pull/1696); all required exact-head CI checks passed. Enabling RS in configuration does not start Harvester or authorize an exchange session. The controlled TESTNET runbook remains CLOSED / PAUSED pending a separate bounded LINEAUSDT session agreement, account/open-order baseline, fee verification and explicit joint start.

An enabled RS market requires the following fields:

```js
export const recoverySellerPairs = {
  LINEAUSDT: {
    enabled: true,
    tradingEnvironment: TRADING_ENVIRONMENTS.TESTNET,
    enableVolatilityProtection: false,
    legacyPosition: {
      invested: 400,
      quantity: 25000,
    },
    sellQuantity: 10,
    investment: 100,
    orderQuantity: 7000,
    minProfit: 0.01,
    priceStepPercent: 0.5,
    makerPercent: 0.1,
    takerPercent: 0.1,
  },
}
```

`legacyPosition.invested` is the operator-declared original quote investment; `legacyPosition.quantity` is the corresponding original base quantity. RS derives the fixed historical average cost from those values. `sellQuantity` is the additive legacy base quantity for a cycle SELL and cannot exceed the declared original quantity. The optional `investment` is the independent RS recovery BUY budget; it is not the legacy historical investment. The existing per-pair `minProfit` floor is 0.01 quote units. Price/quantity precision comes only from `token-specification.json`.

Configuration is authorization and historical-basis input only. It does not seed legacy inventory into Portfolio, prove Spot custody, or make EARN-held assets sellable. Before each SELL, runtime must verify Spot availability and account-wide reservations independently. Missing or invalid basis fails startup validation; RS is enabled in the default configuration and must retain at least one explicitly enabled market; each market's `tradingEnvironment` independently determines whether it is eligible for the selected `TRADING_MODE`.

`loadAppConfig` resolves exchange precision for both CG and RS market maps from the same token specification registry. No TESTNET/LIVE exchange operation is part of configuration validation.

### Multiple provider accounts

The optional `brokers.instances` array is part of the named `appConfig` export. If it is absent, Harvester preserves the legacy `BINANCE_API_KEY`, `BINANCE_API_SECRET_KEY`, `BINANCE_PROVIDER_INSTANCE_ID` and `BINANCE_ACCOUNT_ID` configuration. If present, every entry must declare a unique `providerInstanceId`, `providerType`, `accountId`, `environment` and credential environment-variable references.

```js
brokers: {
  instances: [
    {
      providerInstanceId: "binanceTestnetPrimary",
      providerType: "binance",
      accountId: "binance-primary",
      environment: "testnet",
      credentials: {
        apiKeyEnv: "BINANCE_API_KEY",
        apiSecretEnv: "BINANCE_API_SECRET_KEY",
      },
    },
    {
      providerInstanceId: "binanceTestnetSecondary",
      providerType: "binance",
      accountId: "binance-secondary",
      environment: "testnet",
      credentials: {
        apiKeyEnv: "BINANCE_SECONDARY_API_KEY",
        apiSecretEnv: "BINANCE_SECONDARY_API_SECRET",
      },
    },
  ],
}
```

Credential values are never stored in application configuration or provider identity. Before an account starts, its runtime environment retains only that account's referenced API key/secret variables; credential variables referenced by other configured accounts are removed. Each account starts a separate Harvester runtime with its own BrokerPort connection, Portfolio, OrderRegistry, account snapshot, market metadata, user-data readiness, strategy engine, market subscriptions and shutdown lifecycle. The current Conservative strategy configuration is applied independently to each account. Phase 5 independent market-data routing and Phase 6 strategy/market execution routing are implemented in [PR #1455](https://github.com/45s/coinzilla/pull/1455), pending exact-head CI and merge.

The first configured account owns the process-wide Telegram Command Center; secondary accounts do not create duplicate command handlers. If one account fails during startup, healthy accounts continue. Its process lock is released only when cleanup is confirmed.

The default production provider-adapter factory map currently supports Binance. Unsupported provider types fail clearly until their complete production adapter is registered. Bitunix is not a configured Harvester provider while [#1185](https://github.com/45s/coinzilla/issues/1185) remains open. Do not add a temporary observer or partial provider facade; future Bitunix integration must use the complete provider-instance, BrokerPort, capability, account-lifecycle, execution-routing and market-data contracts. See [ADR-0003](../../docs/architecture/decisions/ADR-0003-multi-provider-routing.md), [ADR-0004](../../docs/architecture/decisions/ADR-0004-complete-bitunix-provider-integration.md), and [issue #1339](https://github.com/45s/coinzilla/issues/1339).

### Generate or refresh market metadata

Use the interactive generator to retrieve Binance precision metadata instead of guessing it:

```sh
pnpm --filter @coinzilla/harvester config:symbol
```

The generator asks only for a Binance market symbol and confirmation. It uses `TRADING_MODE` to select the public metadata endpoint (defaulting to TESTNET when unset), fetches the market's exchange metadata, and atomically updates `apps/harvester/token-specification.json`. The file is grouped by base asset (`LINK`, `POL`, `APE`, etc.); each token contains a `markets` map keyed by exact market symbol. This lets quote markets share one token entry without incorrectly assuming that their price or quantity increments are identical.

Example shape:

```json
{
  "LINK": {
    "baseAsset": "LINK",
    "markets": {
      "LINKUSDT": {
        "quoteAsset": "USDT",
        "pricePrecision": 3,
        "quantityPrecision": 2
      },
      "LINKFDUSD": {
        "quoteAsset": "FDUSD",
        "pricePrecision": 2,
        "quantityPrecision": 3
      }
    }
  }
}
```

`quantityPrecision` is the number of decimal places needed to express the market's `LOT_SIZE.stepSize` (for example, a step of `0.01` means precision `2`). It is not the step size itself and does not replace runtime exchange-filter validation.
The `app-config.test.js` validation fixture mirrors these registry precision values for every operator-configured pair so direct validator tests remain deterministic.

For each market, `pricePrecision` is derived from `PRICE_FILTER.tickSize` and `quantityPrecision` from `LOT_SIZE.stepSize`. These values are precision counts, not exchange filters and not substitutes for the actual tick/step/notional constraints that Harvester validates at startup and before order submission. The registry is the only source for these precision fields; do not add them to `cg-coin-grabber.js`.

**The generator does not add or modify strategy pairs.** After generating metadata, add the market's strategy settings to the single `tradingPairs` map in `apps/harvester/cg-coin-grabber.js` when you want Harvester to consider that market. Do not include `pricePrecision` or `quantityPrecision` in that pair entry. At runtime, `loadAppConfig` resolves the exact market specification and enriches the effective pair config. A missing, malformed, or multiply assigned market specification fails configuration loading before broker startup.

The generator also prints any public exchange constraints that it does not evaluate as diagnostics; these are not written into the precision registry. It writes only the shared JSON registry, uses an exclusive lock and atomic rename, and requires no Binance credentials. If it reports an existing lock, inspect its PID/timestamp and confirm no generator is running before removing a stale lock. It never places, cancels, or modifies orders.

`investment` is the maximum quote-currency capital allocated to that pair. It is denominated in the quote asset named by the symbol: `ZROUSDT` uses USDT, while `ZROFDUSD` uses FDUSD. It is a per-pair allocation limit, not an order size. `orderQuantity` is the base-asset size of each individual order; multiple orders can be placed over time while staying within the pair's total investment allocation. `keepQuantity` remains the retained base-asset quantity; `minProfit` is the minimum net profit in that pair's quote asset.

**Important — `keepQuantity` is retained per completed recovery cycle, not a total-balance cap.** Harvester sells all legally sellable strategy inventory above this amount, then retains the configured quantity when that recovery cycle completes. Each later completed cycle retains another `keepQuantity`, so the free/retained balance accumulates. Example: with `keepQuantity = 0.01 LINK`, four completed cycles retain 0.04 LINK in total; 100 cycles retain 1.00 LINK, assuming no dust bonus. Validated exchange-constrained dust is retained in addition to that cycle's `keepQuantity`. See the [canonical Conservative specification](./docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md) for the full rule and completion conditions. On startup, enabled pairs are checked against exchange metadata and actual tick/step/notional filters. `pricePrecision` and `quantityPrecision` are derived precision counts only; actual exchange increments and notional limits remain authoritative. All enabled markets are subscribed before startup requests any missing initial ticker snapshot through Binance WebSocket API `ticker.price` or waits for an initial strategy evaluation; a slow first market must not delay market-data intake for later enabled pairs. The bootstrap verifies that every enabled pair has a successful market-price subscription before startup proceeds.

Example (illustrative only; it does not identify the currently enabled default pair):

```js
import { NOTIFICATIONS_TG_PROFILES } from "./notifications-tg-profiles.js";

export const appConfig = {
  notifications: {
    telegram: {
      enabled: true,
      profile: NOTIFICATIONS_TG_PROFILES.TRADER,
      markets: [],
      events: {},
    },
  },
  strategies: {
    CG_coinGrabber: {
      enabled: true,
      settings: {
        conservative: { enabled: true },
        aggressive: { enabled: false },
      },
      pairs: {
        ZROUSDT: {
          enabled: true,
          enableVolatilityProtection: true,
          investment: 100,
          orderQuantity: 5,
          keepQuantity: 0.01,
          minProfit: 0.01,
          priceStepPercent: 0.05,
          makerPercent: 0.1,
          takerPercent: 0.1,
        },
      },
    },
  },
};
```

`makerPercent` and `takerPercent` are percentage values in the range 0 inclusive to 100 exclusive (for example, `0.1` means 0.1%). Startup validation rejects negative, non-finite, and 100-or-higher values. The current pair entries are maintained in `cg-coin-grabber.js`: enabled TESTNET markets are `LINKUSDT`, `ZROUSDT`, `DOGEUSDT`, and `ADAUSDT`; disabled TESTNET market `SOLFDUSD` remains disabled. Enabled LIVE markets are `LINKFDUSD`, `ZROFDUSD`, and `WLDFDUSD`; LIVE `ADAFDUSD` remains disabled. Every TESTNET entry, including disabled `SOLFDUSD`, uses 0.1% maker / 0.1% taker. LIVE rates remain unchanged: 0% maker / 0.075% taker for `LINKFDUSD`, `ADAFDUSD`, and `WLDFDUSD`, and 0% maker / 0.1% taker for `ZROFDUSD`. These are configuration assumptions, not exchange-side fee evidence, and this configuration is not authorization for a TESTNET or LIVE session. The controlled runbook remains CLOSED / PAUSED until the pair scope is reconciled. Conservative SELL planning reserves the higher configured maker/taker rate because maker execution is not guaranteed.

The named `appConfig` export in `config/index.js` contains strategy configuration under `strategies`; exchange selection is separate and comes from `TRADING_MODE`. `testnet` selects Binance Spot TESTNET and `live` selects Binance Spot LIVE. Trading is enabled in either mode. The runtime resolver reads only `TRADING_MODE`; `NODE_ENV` does not select the exchange.

## Volatility protection

Harvester's high-volatility protection is implemented and wired into the runtime in merged [PR #1041](https://github.com/45s/coinzilla/pull/1041), building on the Brokers candle API ([PR #1017](https://github.com/45s/coinzilla/pull/1017)), Harvester BrokerPort/adapter ([PR #1019](https://github.com/45s/coinzilla/pull/1019)) and candle-history service ([PR #1037](https://github.com/45s/coinzilla/pull/1037)). By default each enabled market starts protected until its candle history is ready. Every configured market pair must explicitly set `enableVolatilityProtection` to a boolean in its strategy pair config. The effective market map is strategy-neutral: an RS-only market receives protection when enabled, and CG/RS configs for the same market must agree. `true` enables protection and `false` opts that market out of the volatility state machine, Kline monitoring/warm-up, volatility submission gate and volatility-triggered BUY cancellation. Missing or non-boolean values fail config validation with a path-specific `ConfigValidationError`. Independent price/book freshness, account-integrity, ownership, Journal, exchange-filter and shutdown protections remain active. See [Volatility Protection](docs/volatility-protection.md#per-pair-configuration) for the complete contract. The initial thresholds remain provisional pending offline historical calibration; this does not authorize unattended production trading, TESTNET/LIVE operations or process-restart recovery.

## Runtime and safety

- Journal is enabled by default and writes its JSONL session into the process-specific `logs/sessions/<timestamp>-<runtime-session-id>/` directory. Cumulative diagnostics live under `logs/cumulative/`. The process entrypoint requires a ready Journal and a `flush()` capability before invoking the runtime. Broker-connected startup must durably complete the PREFLIGHT account audit before market subscriptions; Journal order/cancel/account audit barriers remain independent of ordinary SQLite history. See [Journal Operations](./docs/JOURNAL_OPERATIONS.md).
- The ADR-0001 Operational State Store is separate and conditional. The committed configuration currently sets `recovery.enabled: false`; `prepareProcessOperationalStateStore` therefore does not construct or verify the store in the default `main()` path. Telegram-only operator control does not create or require it. An explicitly supplied store is verified and can receive ADR-0001 facts, but this does not enable restart restoration. See [Harvester ADR-0001](./docs/architecture/decisions/0001-application-owned-recovery-facts.md).
- Pre-existing external/unowned orders are reported but are not adopted or canceled automatically.
- `TRADING_MODE=testnet` executes on Binance Spot TESTNET; `TRADING_MODE=live` executes on Binance Spot LIVE and can submit real orders. Selecting `live` is the explicit environment choice; no separate trading-enable flag is used. Operational State Store candidate projection and one-market reconciliation remain offline-only; startup never restores previous Portfolio, RecoveryLedger, or OrderRegistry state and never publishes READY from a recovered candidate. Do not assume restart-safe unattended operation until Step 9 is accepted.
- The process-ownership locks are described in [Journal Operations](./docs/JOURNAL_OPERATIONS.md#trading-process-ownership-locks).

## Documentation

- [Harvester documentation index](./docs/README.md) — all architecture, domain, operations, testing, audits and plans.
- [SQLite integration blueprint](./docs/persistence/sqlite-integration-blueprint.md) — source-verified persistence architecture and migration plan.
- [Operations index](./docs/operations/README.md) — Journal, logging, TESTNET runbooks and safety.
- [Architecture](./docs/architecture.md) and [architecture diagrams](./docs/architecture/README.md).
- [Volatility Protection](./docs/volatility-protection.md) — implemented runtime protection; provisional thresholds still require offline historical calibration.
- [Domain documentation](./docs/domain/README.md) — Conservative specification, accounting invariants, glossary and Portfolio.
- [Infrastructure](./docs/infrastructure/README.md) — broker port and adapter.
- [Audits and historical evidence](./docs/audits/README.md).
- [Harvester roadmap](./ROADMAP.md) — current priorities only; historical details are in the roadmap archive.

## Architecture direction

[Architecture](./docs/architecture.md) defines the current ports-and-adapters boundaries and implementation pattern.

### One-shot TESTNET account audit

See [Journal Operations](./docs/JOURNAL_OPERATIONS.md) for the required PREFLIGHT/RECOVERY/CLOSING audits and targeted COMMISSION_BASELINE and the [TESTNET runbook](./docs/TESTNET_VALIDATION_RUNBOOK.md) for controlled operator procedures.

### Trading process ownership

The broker-wide and Harvester process locks live under `~/.coinzilla/harvester/process-locks/`; Journal's own hidden writer lock stays with its active session directory. Acquisition/release order and stale-owner rules are defined in [Journal Operations](./docs/JOURNAL_OPERATIONS.md#trading-process-ownership-locks).

### Optional Telegram notifications

Telegram policy lives in `config/index.js` under `notifications.telegram`; bot credentials remain in `.env.development` / deployment environment variables and must never be committed.

- `enabled`: set to `false` to disable Telegram even when credentials exist. The default is `true`; transport is still created only when both credential variables are present.
- `profile`: `minimal` (safety and readiness alerts), `trader` (useful order/fill/recovery and lifecycle milestones), `verbose` (all supported low-volume operational events), or `custom` (only explicitly enabled ordinary events).
- `markets`: an empty array means all markets; otherwise ordinary symbol-specific notifications are limited to the listed symbols.
- `events`: optional boolean overrides keyed by `orderSubmitted`, `orderCancelled`, `orderFailed`, `fillReceived`, `pairPaused`, `recoveryCompleted`, `recoveryFailed`, `botStarted`, `botStopped`, `startupFailed`, `brokerConnected`, `brokerDisconnected`, and `accountSafetyAlert`. Overrides merge with the selected profile; with `custom`, unspecified ordinary events remain off.
- Critical startup, broker-disconnect, order-failure, pair-pause, recovery-failure, account-safety, blocked user-data readiness, and confirmed user-data readiness-restoration alerts cannot be disabled and bypass market filters. A recovered WebSocket transport is explicitly reported as still awaiting authoritative application reconciliation; it is never described as READY.
- A blocked `RECOVERY_CYCLE_NOT_COMPLETED` outcome is a safety alert; expected `CONTINUE_SELL_THROUGH` is intentionally suppressed to avoid false alarms.
- The exact user-selected icons apply only to notifications with an active producer in the Harvester Telegram bridge. The canonical [architecture icon table](./docs/architecture.md#operational-notifications) records the delivered icons, category-specific safety alerts, the five undecided icons that retain their current values, and formatter-only events that are not sent.
- Telegram delivery failures and queue overflow include the affected notification event name, a safe failure category, and immutable accepted/delivered/failed/overflow/pending counters in structured error logs. At shutdown, Harvester logs a final delivery summary after accepted sends drain and the subscriber closes. These records are operational log evidence; delivery counters remain process-local, and there is no durable notification outbox or Telegram self-alert. Automatic retries remain intentionally unsupported.

See [architecture — operational notifications](./docs/architecture.md#operational-notifications) and the [Notifiers package README](../../packages/notifiers/README.md) for the event vocabulary and delivery contract.

### Operational event journal

See [Journal Operations](./docs/JOURNAL_OPERATIONS.md) and the [Journal evidence contract](./docs/JOURNAL_EVIDENCE_CONTRACT.md).

### Process-restart recovery — active forensic workstream (#654)

Process-restart restoration is not implemented. Follow [#654](https://github.com/45s/coinzilla/issues/654), the [current Harvester roadmap](./ROADMAP.md) and [audit evidence](./docs/audits/README.md).

### Portfolio domain

See the [Portfolio domain reference](./docs/domain/portfolio.md).

## Strategy documentation

See [Trading strategies](./docs/trading-strategies.md) for an overview; the [Conservative Domain Specification](./docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md) is the sole current behavior authority.

## Logging

The development runner writes raw stdout/stderr to
`apps/harvester/logs/cumulative/terminal.log` and the `terminal.log` inside
the current `logs/sessions/<timestamp>-<session-id>/` directory. Structured
DEBUG/TRACE logs and the Journal JSONL file live in that same session directory.
Standalone `start` creates structured session files but does not create
terminal-capture files. See [Logging](./docs/LOGGING.md) for destinations, lifecycle and retention.

## Debug evidence archive

For a lightweight TESTNET debug archive, stop Harvester and run `pnpm --filter @coinzilla/harvester archive:debug`. It publishes only the newest completed TESTNET session logs and `recovery-facts/` as a directory under `archives/<timestamp>_<id>_debug/` in the private `45s/coinzilla-archive` repository. Databases and cumulative logs are excluded. The manifest records whether the selected log session and latest recovery-facts checkpoint share a runtime identity; a mismatch is warned about and preserved as independent, non-correlatable evidence. See the [local DEV reset and archive runbook](./docs/operations/local-dev-reset-and-archive.md).

## Implementation style

See [Architecture](./docs/architecture.md) and [Harvester agent instructions](./AGENTS.md).

## Engineering rules

Follow [Harvester AGENTS.md](./AGENTS.md), root [AGENTS.md](../../AGENTS.md) and [Documentation Governance](../../docs/DOCUMENTATION_GOVERNANCE.md).

## Startup and broker connection

See [Architecture](./docs/architecture.md), [Broker Port and Adapter](./docs/infrastructure/broker-port-and-adapter.md) and [Journal Operations](./docs/JOURNAL_OPERATIONS.md) for startup composition, broker lifecycle and safety gates.

### Trading-first implementation direction

See [Trading First](./docs/TRADING_FIRST.md) and the [Conservative Domain Specification](./docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md).

## Controlled TESTNET runbook

Use the [controlled TESTNET validation runbook](./docs/TESTNET_VALIDATION_RUNBOOK.md); it is a procedure, not standing authorization.

## Binance client order identifiers

See [Architecture — Client order identity](./docs/architecture.md#client-order-identity).

## Runtime boundary and startup reporting

See [Architecture — Runtime API and process boundary](./docs/architecture.md#runtime-api-and-process-boundary).

## Current status

Current priorities and blockers live in [ROADMAP.md](./ROADMAP.md). Historical audit evidence is indexed in [docs/audits/](./docs/audits/README.md); do not treat a historical snapshot as current runtime acceptance.

## Standalone Binance TESTNET order tools

Standalone TESTNET order, balance, and history commands are documented in [TESTNET order tools](./docs/testnet-order-tools.md). The interactive `pnpm --filter @coinzilla/harvester testnet` menu also exposes the exchange-read-only account audit and local Journal balance audit, documented in the [TESTNET runbook](./docs/TESTNET_VALIDATION_RUNBOOK.md) and [Journal Operations](./docs/JOURNAL_OPERATIONS.md). The menu includes destructive actions and adds no confirmation layer; the account-wide cancel proceeds after a warning without an interactive prompt.

## Standalone Binance TESTNET balance inspection

See [TESTNET order tools — balances](./docs/testnet-order-tools.md#list-non-zero-account-balances-read-only).

## Standalone Binance TESTNET ZRO market sell

See [TESTNET order tools — legacy ZROUSDT market sell](./docs/testnet-order-tools.md#sell-all-free-zro-at-market-destructive). This is a hardcoded ZROUSDT TESTNET MARKET SELL, not a general-purpose recovery or cleanup command; despite ZROUSDT being enabled in the committed TESTNET pair map, this command is outside the paused validation runbook and requires separate explicit authorization.

## Standalone Binance TESTNET order history

See [TESTNET order tools — order history](./docs/testnet-order-tools.md#list-recent-order-history-read-only).

### 2026-11-04 TESTNET incident remediation

Historical README notes are preserved in [README_HISTORY.md](./docs/audits/README_HISTORY.md); current incident evidence is indexed in [Harvester audits](./docs/audits/README.md).

## Standalone Binance TESTNET trade history (read-only)

See [TESTNET order tools — trade history](./docs/testnet-order-tools.md#list-actual-trade-history-read-only).

### Follow-up execution-history validation

See the preserved [README historical material](./docs/audits/README_HISTORY.md).

### TESTNET commission configuration note — 2026-11-04

See the preserved [README historical material](./docs/audits/README_HISTORY.md).

### Incident review status — 2026-11-04 (follow-up PR #515)

See the preserved [README historical material](./docs/audits/README_HISTORY.md).

### Incident audit logging requirement — 2026-11-04

See the preserved [README historical material](./docs/audits/README_HISTORY.md).

### Account-level balance audit

See [Journal Operations](./docs/JOURNAL_OPERATIONS.md) for PREFLIGHT/RECOVERY/CLOSING account snapshots, targeted commission baselines and balance evidence.

### Compare persisted PREFLIGHT and CLOSING balances

See [Journal Operations](./docs/JOURNAL_OPERATIONS.md) for account snapshot comparison and durability rules.

## Startup account preflight audit

See [Journal Operations](./docs/JOURNAL_OPERATIONS.md) for the broker-connected startup audit and fail-closed conditions.

## Development logging

See [Logging](./docs/LOGGING.md) for development commands and structured output.

## Local DEV reset and evidence archive

Use the [local DEV reset and archive runbook](./docs/operations/local-dev-reset-and-archive.md) for the repeatable TESTNET workflow. `pnpm run archive:push` publishes only completed TESTNET session evidence and excludes `data/production/`; `pnpm run operational-state:reset:dev -- --confirm` removes only the stopped process's `recovery-facts/` directory. Neither command deletes logs, databases, Journal sessions or existing archives.

## Operational State Store initialization

ADR-0001 defines the append-only record schema and integrity contract used by the Operational State Store. Startup initializes a missing or empty store, verifies an existing complete store, and fails closed for an existing corrupt or incomplete store. The local DEV reset command is a separate, explicit operation that removes only the configured `recovery-facts/` directory after Harvester has stopped.

The explicit command is documented in [ADR-0001 — Process-restart recovery record contract](./docs/architecture/decisions/0001-application-owned-recovery-facts.md). Run manual initialization only while Harvester is stopped and only when the target directory is empty. Never delete or reinitialize a production ledger, or reset an existing store to bypass a startup check. The separate recovery-facts-only reset is restricted to local TESTNET development and is documented in the local DEV reset and archive runbook.

The store directory must be on a local filesystem; network shares and cloud-synchronized folders are unsupported. Its SHA-256 chains detect accidental corruption and reordering, not malicious rewriting by a privileged local actor. The allowlisted `MARKET_HISTORY_COVERAGE_CONFIRMED` fact records only a reviewed per-market history interval and never certifies account-wide market-universe completeness.

## Process identity and build provenance

See [Journal Operations](./docs/JOURNAL_OPERATIONS.md) for process identity, Journal session metadata and provenance.

## Conservative Strategy authority

The [Conservative Domain Specification](./docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md) is the sole authority for Conservative behavior. Aggressive remains deferred; see [Trading strategies](./docs/trading-strategies.md) for non-authoritative proposal context.

## Operator control

The Telegram Command Center is a thin authorized interface over Harvester application queries and commands. It exposes `/start`, `/menu`, `/help`, `/status`, `/markets`, `/positions`, `/orders`, `/balances`, `/pause <SYMBOL>`, `/resume <SYMBOL>`, `/pauseallbuys`, `/resumeallbuys`, `/pausebuys <SYMBOL>`, and `/resumebuys <SYMBOL>`. It also provides inline navigation, confirmation-gated Pause/Resume and a persistent six-button keyboard (Pause, Resume, Status, Markets, Portfolio, Open Orders). The delivered implementation is recorded in PRs #1045, #1067, #1079, #1081, #1086, #1088, #1194, #1267 and #1215. The Command Center authenticates the operator, forwards the request to the application and reports its actual result; it does not own trading policy, persistence or startup policy. See the [operator-control contract](./docs/operator-control/README.md) and [Telegram runbook](./docs/operations/telegram-command-center.md).

## Telegram Command Center

The optional inbound operator interface, its inline navigation and control-confirmation behavior are documented in the [Telegram Command Center operator runbook](docs/operations/telegram-command-center.md). Inbound control is enabled by default and can be disabled with `operatorControl.telegram.enabled=false`; process-lifetime operator pauses are not restored after restart.

## Dashboard operator controls

The local Dashboard Operator workspace reads status, markets, portfolio positions, open orders, and balances from the running Harvester process. It also exposes confirmed BUY pause/resume commands (`pause`, `unpause`, `pauseallbuys`, `resumeallbuys`) through the same operator facade used by Telegram. The local API remains unauthenticated and must not be exposed beyond `127.0.0.1`. Browser access is restricted to HTTP origins on `localhost` or `127.0.0.1`; any valid local port is accepted because Angular CLI may select the next available port when `4200` is occupied. The API listener remains fixed to the loopback address `127.0.0.1` (default port `4201`). If relational trading-history persistence is unavailable, the runtime API still starts: operator status, markets and provider-account snapshots remain live, while persisted orders/fills/commissions return HTTP 503 rather than fabricated empty data.
