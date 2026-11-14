# Harvester

> **Documentation:** Start with the [Harvester documentation index](./docs/README.md). Repository-wide documentation lifecycle and AI-agent maintenance requirements are defined in [Documentation Governance](../../docs/DOCUMENTATION_GOVERNANCE.md). The [documentation migration plan](./docs/plans/DOCUMENTATION_MIGRATION.md) tracks the staged reorganization; historical evidence must be preserved.

> **Current status — 2026-11-12:** ADR-0001 Steps 1–7 are merged: one-market orchestration/READY-gated coverage confirmation in [PR #1047](https://github.com/45s/coinzilla/pull/1047), plus the offline JSON context adapter, audit-only/explicit-confirmation CLI and production-audit end-to-end matrix in [PR #1053](https://github.com/45s/coinzilla/pull/1053). [PR #1055](https://github.com/45s/coinzilla/pull/1055) is merged: Step 8 Operational State Store record producers/barriers, offline candidate Portfolio/RecoveryLedger/OrderRegistry projection, one-market read-only reconciliation and a fail-closed second-start fence. Process-restart recovery is explicitly disabled by `strategies.CG_coinGrabber.settings.recovery.enabled: false`; when both recovery and operator control are disabled, normal startup skips Operational State Store creation/verification and restart projection/reconciliation. Enabling Telegram operator control prepares the shared store but does not enable restart restoration. Conservative same-process BUY/SELL recovery-cycle accounting remains enabled and unchanged. ADR-0001 runtime restoration and Step 9 crash/restart proof require separate future acceptance; no TESTNET acceptance is claimed. Telegram Command Center CC-1 is implemented through [PR #1079](https://github.com/45s/coinzilla/pull/1079) and [PR #1081](https://github.com/45s/coinzilla/pull/1081): `/start`, `/help`, read-only `/status` and `/markets`, plus safe `/pause <SYMBOL>` and `/resume <SYMBOL>`. CC-2 trading visibility (`/positions`, `/orders`, `/balances`) is merged in [PR #1086](https://github.com/45s/coinzilla/pull/1086). CC-3 proactive alerts are the current highest-priority work under [issue #1077](https://github.com/45s/coinzilla/issues/1077). Inbound Telegram remains disabled by default. Operator pause is process-lifetime only and is not restored after restart. Separately, [PR #906](https://github.com/45s/coinzilla/pull/906) adds same-process Journal flush-failure classification and retains the process-ownership lock when runtime shutdown or Journal close is not confirmed. That hardening does not resolve #654. See the [Step 7 recovery operator guide](./docs/recovery/README.md), [Harvester Roadmap](./ROADMAP.md), [Journal Operations](./docs/JOURNAL_OPERATIONS.md), and [Conservative Strategy audit](./docs/audits/reports/AUDIT.md).

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

## Operational State Store (ADR-0001 Step 8)

Harvester bootstrap prepares the **Operational State Store**, backed by the ADR-0001 append-only ledger, whenever either restart recovery or Telegram operator control is enabled. When recovery is enabled, the entry point verifies the ledger before Journal composition. When Telegram operator control alone requires the store, Harvester bootstrap verifies it before broker-capable runtime startup. Normal startup never creates a missing ledger, repairs a corrupt chain, or treats missing history as empty.

Telegram operator control uses this same Operational State Store even when `recovery.enabled` is false. It records process, order, cancellation, fill, recovery and operator-control events. Operator-pause records are audit-only: the in-memory market pause set starts empty on each successful process start and is never restored from these records. Enabling operator control does not enable process-restart restoration. The store is never created or initialized automatically.

The default Operational State Store directory is `apps/harvester/recovery-facts/`, resolved relative to the Harvester application package (not the shell's current working directory). This directory is created only by the explicit initializer and is ignored by Git because it contains private runtime data. The initializer and runtime use the same resolver.

For a new installation, stop Harvester and run the one-time initializer without setting any directory variable:

```sh
pnpm --filter @coinzilla/harvester operational-state:init -- --confirm-initialize
```

To select another absolute local-filesystem directory, set `OPERATIONAL_STATE_DIRECTORY` for both the initializer and runtime. The default remains `apps/harvester/recovery-facts/` when the variable is absent. The former home-directory recovery-data location is not a supported default or automatic fallback. Existing runtime data is never moved, deleted, initialized, overwritten, or repaired by this path cleanup.

The command requires exactly `--confirm-initialize`, rejects unknown arguments and invalid directory overrides, acquires the same broker-wide and Journal process locks as Harvester, creates the selected private directory (0700) and its record/manifest files (0600), and refuses to overwrite any existing store. The runtime resolves the same directory; do not initialize one directory and run against another. Do not delete or manually edit these files. If verification fails, startup remains blocked; investigate the integrity error instead of reinitializing.

The Operational State Store currently supports append-only operational record production and offline candidate projection only. Acknowledged orders remain UNKNOWN until exchange reconciliation. Any second process start is deliberately blocked after a prior PROCESS_STARTED fact—even after a clean shutdown—until the complete Step 8 reconciliation and Step 9 crash/restart proof are accepted. The first start is permitted only when the verified store contains no prior PROCESS_STARTED session (a pre-start configuration-baseline record may remain after an aborted preflight). Automatic restoration and READY publication from recovered state remain disabled. The initialization command does not connect to Binance or place/cancel orders.

## Configuration

Harvester exposes one application-wide named `appConfig` export from `config/index.js`. Strategy-level switches remain in `config/strategies/cg-coin-grabber.js`. All strategy pair definitions live in one separate JavaScript module: `apps/harvester/cg-coin-grabber.js`, exported as the flat `tradingPairs` map. A symbol is defined once; do not duplicate markets in source modules or maintain separate TESTNET/LIVE maps.

Each pair must explicitly use `TRADING_ENVIRONMENTS.TESTNET`, `.LIVE`, or `.BOTH` from `src/domain/trading-environment.js`. `TRADING_MODE=testnet` includes TESTNET and BOTH; `TRADING_MODE=live` includes LIVE and BOTH. The serialized values remain `"testnet"`, `"live"`, and `"both"`. Non-matching pairs are excluded, and `tradingEnvironment` is removed from the effective runtime pair config. There is no default or fallback. If no pair matches (or no matching pair is enabled), startup fails before broker connection. The pair's `enabled` flag remains independent of its environment.

Other strategy-owned pair fields remain under `tradingPairs.<SYMBOL>`: `enabled`, `enableVolatilityProtection`, `externalOrdersPolicy`, `investment`, `orderQuantity`, `keepQuantity`, `minProfit`, and fee settings. Precision is not operator-owned pair configuration: it is resolved from `token-specification.json` by exact market symbol when `loadAppConfig` builds the effective runtime config. The external pair module uses `externalOrdersPolicy: EXTERNAL_ORDERS_POLICIES.IGNORE` (or `.BLOCK`) from `src/domain/external-orders-policy.js`; the serialized values remain `"ignore"` and `"block"`. Validation still allows the policy to be omitted and defaults it to ignore.

**Runtime environment contract:** `TRADING_MODE` is the only operator-facing Binance environment setting and accepts exactly `testnet` or `live`. It selects both the Binance API/stream endpoints and the eligible pair subset. `NODE_ENV` does not select the exchange environment. The intended environment files are `.env.development` with `TRADING_MODE=testnet` and `.env` with `TRADING_MODE=live`.

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

`makerPercent` and `takerPercent` are percentage values in the range 0 inclusive to 100 exclusive (for example, `0.1` means 0.1%). Startup validation rejects negative, non-finite, and 100-or-higher values. The committed `config/index.js` currently enables `LINKFDUSD` and `ZROFDUSD`; this is configuration, not authorization for a TESTNET session. The controlled runbook still contains the earlier DOGEUSDT/ZROUSDT plan and remains CLOSED / PAUSED until the pair scope is reconciled. Disabled `LINKUSDT` has configured maker/taker assumptions of 0.075% / 0.075%; enabled `LINKFDUSD` has maker 0% and taker 0.075%; enabled `ZROFDUSD` has maker 0% and taker 0.1%. These are configuration assumptions, not exchange-side fee evidence. Conservative SELL planning reserves the higher configured maker/taker rate because maker execution is not guaranteed.

The named `appConfig` export in `config/index.js` contains strategy configuration under `strategies`; exchange selection is separate and comes from `TRADING_MODE`. `testnet` selects Binance Spot TESTNET and `live` selects Binance Spot LIVE. Trading is enabled in either mode. The runtime resolver reads only `TRADING_MODE`; `NODE_ENV` does not select the exchange.

## Volatility protection

Harvester's high-volatility protection is implemented and wired into the runtime in merged [PR #1041](https://github.com/45s/coinzilla/pull/1041), building on the Brokers candle API ([PR #1017](https://github.com/45s/coinzilla/pull/1017)), Harvester BrokerPort/adapter ([PR #1019](https://github.com/45s/coinzilla/pull/1019)) and candle-history service ([PR #1037](https://github.com/45s/coinzilla/pull/1037)). By default each enabled market starts protected until its candle history is ready. Every pair must explicitly set `enableVolatilityProtection` to a boolean under its `strategies.CG_coinGrabber.pairs.<SYMBOL>` entry; `true` preserves protection and `false` opts that pair out. Missing or non-boolean values fail config validation with a path-specific `ConfigValidationError`. and disables only that pair's volatility state machine, Kline monitoring/warm-up, volatility submission gate and volatility-triggered BUY cancellation. Independent price/book freshness, account-integrity, ownership, Journal, exchange-filter and shutdown protections remain active. See [Volatility Protection](docs/volatility-protection.md#per-pair-configuration) for the complete contract. The initial thresholds remain provisional pending offline historical calibration; this does not authorize unattended production trading, TESTNET/LIVE operations or process-restart recovery.

## Runtime and safety

- Journal is enabled by default and writes its JSONL session into the process-specific `logs/sessions/<timestamp>-<runtime-session-id>/` directory. Cumulative diagnostics live under `logs/cumulative/`. The process entrypoint requires a ready Journal and a `flush()` capability before invoking the runtime in both TESTNET and LIVE. Broker-connected trading startup must durably complete the PREFLIGHT account audit before market subscriptions; order-intent, cancellation, fill, recovery-cycle and process-boundary records are committed to the Operational State Store; required Journal events retain their separate Journal flush barriers in both modes. A failed flush is retryable only when Journal status confirms an active, open writer with no recorded write failures; a poisoned writer or unclassified health state fails closed. See [Journal Operations](./docs/JOURNAL_OPERATIONS.md).
- Production `main()` verifies the application-owned ledger before Journal/runtime startup and injects it into `startHarvester`; `startHarvester` records the configuration baseline and PROCESS_STARTED boundary before broker connection. Any second process start is blocked before broker connection after a prior PROCESS_STARTED fact, whether the prior process stopped cleanly or crashed. This is a deliberate fence until Step 8 reconciliation and Step 9 crash/restart proof are accepted.
- Pre-existing external/unowned orders are reported but are not adopted or canceled automatically.
- `TRADING_MODE=testnet` executes on Binance Spot TESTNET; `TRADING_MODE=live` executes on Binance Spot LIVE and can submit real orders. Selecting `live` is the explicit environment choice; no separate trading-enable flag is used. Operational State Store candidate projection and one-market reconciliation remain offline-only; startup never restores previous Portfolio, RecoveryLedger, or OrderRegistry state and never publishes READY from a recovered candidate. Do not assume restart-safe unattended operation until Step 9 is accepted.
- The process-ownership locks are described in [Journal Operations](./docs/JOURNAL_OPERATIONS.md#trading-process-ownership-locks).

## Documentation

- [Harvester documentation index](./docs/README.md) — all architecture, domain, operations, testing, audits and plans.
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
- Telegram delivery failures and queue overflow include immutable accepted/delivered/failed/overflow/pending counters in structured error logs. A final delivery summary is logged after shutdown drains and closes the subscriber. These are process-local diagnostics, not a Telegram self-alert; automatic retries and durable delivery remain intentionally unsupported.

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

See [TESTNET order tools — legacy ZROUSDT market sell](./docs/testnet-order-tools.md#sell-all-free-zro-at-market-destructive). This is a hardcoded ZROUSDT TESTNET MARKET SELL, not the current ZROFDUSD configured pair; it is outside the paused validation runbook and requires separate explicit authorization.

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

## Operational State Store initialization

ADR-0001 defines the append-only record schema and integrity contract used by the Operational State Store. One-time initialization is a separate administrative operation; application startup never creates or repairs a missing store.

The explicit command is documented in [ADR-0001 — Process-restart recovery record contract](./docs/architecture/decisions/0001-application-owned-recovery-facts.md). Do not run it against a production directory until the runtime-integration step explicitly instructs you to initialize the store.

The store directory must be on a local filesystem; network shares and cloud-synchronized folders are unsupported. Its SHA-256 chains detect accidental corruption and reordering, not malicious rewriting by a privileged local actor. The allowlisted `MARKET_HISTORY_COVERAGE_CONFIRMED` fact records only a reviewed per-market history interval and never certifies account-wide market-universe completeness.

## Process identity and build provenance

See [Journal Operations](./docs/JOURNAL_OPERATIONS.md) for process identity, Journal session metadata and provenance.

## Conservative Strategy authority

The [Conservative Domain Specification](./docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md) is the sole authority for Conservative behavior. Aggressive remains deferred; see [Trading strategies](./docs/trading-strategies.md) for non-authoritative proposal context.

## Operator control

The transport-independent operator application, market-scoped engine pause and offline-testable Telegram adapter are implemented in [PR #1045](https://github.com/45s/coinzilla/pull/1045); disabled-by-default runtime configuration and lifecycle wiring are implemented in [PR #1067](https://github.com/45s/coinzilla/pull/1067). The Telegram Command Center exposes `/start`, `/help`, `/status`, `/markets`, `/positions`, `/orders`, `/balances`, `/pause <SYMBOL>`, and `/resume <SYMBOL>`, with authorized inline navigation and refresh. Inline market pause/resume buttons require confirmation. A market pause blocks new strategy BUYs and trailing-BUY replacements only; existing exchange orders remain open and may still fill, while fill accounting and recovery SELLs continue. The pause is durable within the current process session but is not restored after restart (ADR-0003). The separate ADR-0001 startup fence blocks any second process start until recovery Steps 8–9 are accepted. See the [operator-control contract](./docs/operator-control/README.md).

## Telegram Command Center

The optional inbound operator interface, its inline navigation and control-confirmation behavior are documented in the [Telegram Command Center operator runbook](docs/operations/telegram-command-center.md). Inbound control remains disabled by default; process-lifetime operator pauses are not restored after restart.
