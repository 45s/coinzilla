# Harvester

> **Documentation:** Start with the [Harvester documentation index](./docs/README.md). Repository-wide documentation lifecycle and AI-agent maintenance requirements are defined in [Documentation Governance](../../docs/DOCUMENTATION_GOVERNANCE.md). The [documentation migration plan](./docs/plans/DOCUMENTATION_MIGRATION.md) tracks the staged reorganization; historical evidence must be preserved.

> **Current status — 2026-11-12:** ADR-0001 Steps 1–6 and the one-market orchestration/READY-gated coverage confirmation in [merged PR #1047](https://github.com/45s/coinzilla/pull/1047) are on `develop`. The offline JSON context adapter, audit-only/explicit-confirmation CLI and production-audit end-to-end matrix are under review in [PR #1053](https://github.com/45s/coinzilla/pull/1053). Production startup now verifies and injects the application-owned durable-fact ledger; the explicit one-time genesis command is documented below. Offline candidate projection and per-market read-only exchange audit are in progress, but runtime startup never restores prior Portfolio/RecoveryLedger/OrderRegistry state or replays prior Journal sessions. Steps 8–9 remain separate gates; automatic restoration/readiness remains disabled and no TESTNET acceptance is claimed. Separately, [PR #906](https://github.com/45s/coinzilla/pull/906) adds same-process Journal flush-failure classification and retains the process-ownership lock when runtime shutdown or Journal close is not confirmed. That hardening does not resolve #654. See the [Step 7 recovery operator guide](./docs/recovery/README.md), [Harvester Roadmap](./ROADMAP.md), [Journal Operations](./docs/JOURNAL_OPERATIONS.md), and [Conservative Strategy audit](./docs/audits/reports/AUDIT.md).

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

The ADR-0001 Step 7 offline market audit is available through `pnpm --filter @coinzilla/harvester recovery:market -- --context ./recovery-evidence/linkusdt.json`. Audit-only is the default; `--confirm` is an explicit durable-fact append and requires an already initialized ledger. The command does not connect to Binance, place/cancel orders, or enable startup restoration. See the [recovery operator guide](./docs/recovery/README.md) for the evidence schema and safety contract.

## Application-owned recovery-facts ledger (ADR-0001 Step 8)

The production entry point verifies the application-owned recovery-facts ledger before Journal composition or broker-capable runtime startup. Normal startup never creates a missing ledger, repairs a corrupt chain, or treats missing history as empty.

For a new installation, initialize the ledger once while Harvester is stopped:

```sh
pnpm --filter @coinzilla/harvester durable-facts:init -- --confirm-initialize
```

The command acquires the same broker-wide and Journal process locks as Harvester, creates the private `~/.coinzilla/harvester/recovery-facts` directory (0700) and its fact/manifest files (0600), and refuses to overwrite any existing ledger. Do not delete or manually edit these files. If verification fails, startup remains blocked; investigate the integrity error instead of reinitializing.

This ledger currently supports durable fact production and offline candidate projection only. Acknowledged orders remain UNKNOWN until exchange reconciliation. Any second process start is deliberately blocked after a prior PROCESS_STARTED fact—even after a clean shutdown—until the complete Step 8 reconciliation and Step 9 crash/restart proof are accepted. The first start is permitted only from a verified genesis-only ledger. Automatic restoration and READY publication from recovered state remain disabled. The initialization command does not connect to Binance or place/cancel orders.

## Configuration

Harvester uses one application-wide `config.json`. The root contains `strategies` and `notifications` sections: strategies own their enabled flags, settings, and market pairs; application-wide concerns such as Telegram notification policy live beside them. The active strategy key is `CG_coinGrabber`.

- `strategies.CG_coinGrabber.enabled`: enables the strategy.
- `strategies.CG_coinGrabber.pairs.<SYMBOL>.minProfit`: minimum required net profit per completed recovery cycle, in that pair's quote currency (minimum `0.01`).
- `strategies.CG_coinGrabber.settings.conservative.enabled`: must remain `true`; Conservative is the first executable mode.
- `strategies.CG_coinGrabber.settings.aggressive.enabled`: must remain `false`; Aggressive is deferred until Conservative is proven on TESTNET.
- `strategies.CG_coinGrabber.pairs`: market-specific settings keyed by symbol; each pair owns its enabled flag, investment limit, sizing, reserve, minimum profit, precision, and fee settings.

`minProfit` is required on every pair and must be at least `0.01` in that pair's quote asset. The former global `settings.minProfit` is rejected; migrate it explicitly to each pair rather than relying on an implicit default.

Trading settings and pairs belong to their strategy. Future strategies can be sibling entries under `strategies`; they do not share this strategy's pairs. Application-wide settings such as `notifications` are sibling root sections. Strategy availability is not configured through environment variables.

**Runtime environment contract:** `TRADING_MODE` is the only operator-facing exchange-mode setting and accepts exactly `testnet` or `live`. Binance is the only broker, so there is no broker selector or exchange-mode profile selector. Trading is enabled in either selected mode; there is no trading-enable flag. Telegram notification profiles are independent and never select the exchange environment. Missing or invalid `TRADING_MODE` must fail startup rather than silently choose an exchange environment. `NODE_ENV` does not select the exchange environment. The intended environment files are `.env.development` with `TRADING_MODE=testnet` and `.env` with `TRADING_MODE=live`.

The implementation reads `TRADING_MODE` at startup, fixes the broker to Binance, and rejects missing or invalid mode values. Strategy and pair settings remain in `config.json` under `strategies`.

### Generate a new trading pair

Use the interactive generator instead of manually guessing Binance precision and trading filters:

```sh
# From the repository root:
pnpm --filter @coinzilla/harvester config:symbol

# Or from apps/harvester:
pnpm run config:symbol
```

The command asks for the Binance Spot symbol, total quote investment budget for the pair, the base-asset `orderQuantity` for each individual order, `keepQuantity`, maker commission percentage and taker commission percentage. It also requires the minimum profit per recovery cycle (in quote units) and price-step percentage. These two values are Conservative strategy settings, not exchange filters, so the generator does not guess them or apply market-independent defaults. The Binance environment is taken from the existing `TRADING_MODE` setting; when it is unset or is not `live`, the generator uses `testnet`. It does not prompt for an environment. `testnet` and `live` use their corresponding Binance Spot public API hosts; choose the same `TRADING_MODE` Harvester will use because exchange symbols and filters can differ between environments. The generator verifies that the returned metadata identifies the exact requested symbol and environment before creating the pair. The preview prints the exact symbol-keyed pair entry that will be written.

The generator then uses public, read-only Binance Spot endpoints to retrieve `exchangeInfo` and the current `ticker/price`. It derives `pricePrecision` from `PRICE_FILTER.tickSize`, `quantityPrecision` from `LOT_SIZE.stepSize`, and validates `LOT_SIZE.minQty/maxQty` plus the stricter available `MIN_NOTIONAL`/`NOTIONAL` minimum. `orderQuantity` is entered by the operator as the size of each individual order; it is not calculated by spending the whole pair allocation in one order. The generator validates the chosen quantity against Binance `LOT_SIZE` step/min/max and minimum/maximum notional filters. It also requires one order's reference notional to be smaller than the total `investment`, ensuring the pair allocation can be split across multiple orders. The strategy's `investment` remains the total quote-currency allocation cap for that pair. The reference price is checked against any active minimum/maximum price bounds, and the selected `orderQuantity` is rejected if it exceeds `NOTIONAL.maxNotional`.

Maker and taker percentages are supplied by the operator and stored independently; Binance's public exchange-info endpoint does not provide the account's commission schedule. A zero maker percentage requires the symbol to support `LIMIT_MAKER`; a non-zero maker percentage uses `LIMIT`.

The generator validates the complete result with the same `validateAppConfig` contract used by Harvester, then merges the pair into `strategies.CG_coinGrabber.pairs` in this existing `config.json`. It does not create a second pair-config format. It validates supported static public filters and records applicable filters it does not evaluate as `unvalidatedConstraints` diagnostics; their presence alone does not abort pair generation. This is deliberate: dynamic price bands require Binance reference-price semantics, while order-count, position and asset limits require current account/exchange state that this credential-free generator cannot authoritatively establish. Silently pretending those constraints were checked would be unsafe, but blocking every pair because they exist would also be incorrect: Binance remains authoritative when an order is submitted, and a definite filter rejection is handled as `DEFINITE_EXCHANGE_FILTER_REJECTED` (not an ambiguous/UNKNOWN outcome). Unknown active filters are preserved as diagnostics rather than discarded. Filters exclusive to unsupported order types/features may be excluded; the rationale is documented in [Exchange trading constraints](./docs/exchange-trading-constraints.md). Because the command deliberately uses no credentials, it does not query account-specific Binance `myFilters`; Harvester performs authenticated account-filter checks at startup before an enabled pair can trade. New pairs are written with `enabled: true` and `enableVolatilityProtection: true`, matching the required pair-entry shape in `config.json`. Operators can explicitly set the latter to `false` when they intend to disable volatility protection for that pair. The preview prints only the symbol-keyed pair object so it can be reviewed and copied directly; exchange-filter diagnostics remain internal metadata and are not mixed into the pair config. Existing symbols are rejected case-insensitively rather than overwritten. The generator uses the retrieved exchange limits internally to validate the pair entry; the CLI preview stays focused on the copyable `config.json` shape. Missing required fields or malformed metadata abort generation instead of producing a partial pair; optional price bounds and `NOTIONAL.maxNotional` are validated and applied when Binance supplies them; omitted optional bounds are not invented. File replacement is atomic and protected by an exclusive generator lock. The lock file records the owning process ID and creation timestamp. If the process is interrupted and leaves a `config.json.config-symbol.lock` file, inspect it and first confirm that no generator is running before removing a stale lock; the next successful locked run cleans abandoned generator temporary files.

This is configuration tooling only: it requires no Binance API credentials and never places, cancels or modifies orders. The reference ticker price is a sizing snapshot, not a guaranteed execution price; Harvester's normal startup exchange-rule validation remains in force.

`investment` is the maximum quote-currency capital allocated to that pair. It is denominated in the quote asset named by the symbol: `ZROUSDT` uses USDT, while `ZROFDUSD` uses FDUSD. It is a per-pair allocation limit, not an order size. `orderQuantity` is the base-asset size of each individual order; multiple orders can be placed over time while staying within the pair's total investment allocation. `keepQuantity` remains the retained base-asset quantity; `minProfit` is the minimum net profit in that pair's quote asset.

**Important — `keepQuantity` is retained per completed recovery cycle, not a total-balance cap.** Harvester sells all legally sellable strategy inventory above this amount, then retains the configured quantity when that recovery cycle completes. Each later completed cycle retains another `keepQuantity`, so the free/retained balance accumulates. Example: with `keepQuantity = 0.01 LINK`, four completed cycles retain 0.04 LINK in total; 100 cycles retain 1.00 LINK, assuming no dust bonus. Validated exchange-constrained dust is retained in addition to that cycle's `keepQuantity`. See the [canonical Conservative specification](./docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md) for the full rule and completion conditions. On startup, enabled pairs are checked against exchange metadata and actual tick/step/notional filters. `pricePrecision` and `quantityPrecision` do not override exchange increments. All enabled markets are subscribed before startup requests any missing initial ticker snapshot through Binance WebSocket API `ticker.price` or waits for an initial strategy evaluation; a slow first market must not delay market-data intake for later enabled pairs. The bootstrap verifies that every enabled pair has a successful market-price subscription before startup proceeds.

Example (illustrative only; it does not identify the currently enabled default pair):

```json
{
  "notifications": {
    "telegram": {
      "enabled": true,
      "profile": "trader",
      "markets": [],
      "events": {}
    }
  },
  "strategies": {
    "CG_coinGrabber": {
      "enabled": true,
      "settings": {
        "conservative": { "enabled": true },
        "aggressive": { "enabled": false }
      },
      "pairs": {
        "ZROUSDT": {
          "enabled": true,
          "investment": 100,
          "orderQuantity": 5,
          "keepQuantity": 0.01,
          "minProfit": 0.01,
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

`makerPercent` and `takerPercent` are percentage values in the range 0 inclusive to 100 exclusive (for example, `0.1` means 0.1%). Startup validation rejects negative, non-finite, and 100-or-higher values. The committed `config.json` currently enables only `LINKFDUSD`; this is configuration, not authorization for a TESTNET session. The controlled runbook still contains the earlier DOGEUSDT/ZROUSDT plan and remains CLOSED / PAUSED until the pair scope is reconciled. The disabled `LINKUSDT` pair currently has configured maker/taker assumptions of 0.075% / 0.075%; enabled `LINKFDUSD` has maker 0% and taker 0.075%. These are configuration assumptions, not exchange-side fee evidence. Conservative SELL planning reserves the higher configured maker/taker rate because maker execution is not guaranteed.

The strategy configuration remains in `config.json` under `strategies`; exchange selection is separate and comes from `TRADING_MODE`. `testnet` selects Binance Spot TESTNET and `live` selects Binance Spot LIVE. Trading is enabled in either mode. The runtime resolver reads only `TRADING_MODE`; `NODE_ENV` does not select the exchange.

## Volatility protection

Harvester's high-volatility protection is implemented and wired into the runtime in merged [PR #1041](https://github.com/45s/coinzilla/pull/1041), building on the Brokers candle API ([PR #1017](https://github.com/45s/coinzilla/pull/1017)), Harvester BrokerPort/adapter ([PR #1019](https://github.com/45s/coinzilla/pull/1019)) and candle-history service ([PR #1037](https://github.com/45s/coinzilla/pull/1037)). By default each enabled market starts protected until its candle history is ready. Every pair must explicitly set `enableVolatilityProtection` to a boolean under its `strategies.CG_coinGrabber.pairs.<SYMBOL>` entry; `true` preserves protection and `false` opts that pair out. Missing or non-boolean values fail config validation with a path-specific `ConfigValidationError`. and disables only that pair's volatility state machine, Kline monitoring/warm-up, volatility submission gate and volatility-triggered BUY cancellation. Independent price/book freshness, account-integrity, ownership, Journal, exchange-filter and shutdown protections remain active. See [Volatility Protection](docs/volatility-protection.md#per-pair-configuration) for the complete contract. The initial thresholds remain provisional pending offline historical calibration; this does not authorize unattended production trading, TESTNET/LIVE operations or process-restart recovery.

## Runtime and safety

- Journal is enabled by default and writes its JSONL session into the process-specific `logs/sessions/<timestamp>-<runtime-session-id>/` directory. Cumulative diagnostics live under `logs/cumulative/`. The process entrypoint requires a ready Journal and a `flush()` capability before invoking the runtime in both TESTNET and LIVE. Broker-connected trading startup must durably complete the PREFLIGHT account audit before market subscriptions; order-intent and cancellation durability barriers use the same Journal flush contract in both modes. A failed flush is retryable only when Journal status confirms an active, open writer with no recorded write failures; a poisoned writer or unclassified health state fails closed. See [Journal Operations](./docs/JOURNAL_OPERATIONS.md).
- Current startup creates fresh in-memory Portfolio, RecoveryLedger and OrderRegistry state; it does not replay prior Journal sessions. Do not treat a process restart after trading as reconciled or safe. Follow [#654](https://github.com/45s/coinzilla/issues/654).
- Pre-existing external/unowned orders are reported but are not adopted or canceled automatically.
- `TRADING_MODE=testnet` executes on Binance Spot TESTNET; `TRADING_MODE=live` executes on Binance Spot LIVE and can submit real orders. Selecting `live` is the explicit environment choice; no separate trading-enable flag is used. The current startup path does not restore previous Portfolio, RecoveryLedger, or OrderRegistry state after a process restart (tracked in #654); do not assume restart-safe unattended operation until that work is implemented and verified.
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

See [Journal Operations](./docs/JOURNAL_OPERATIONS.md) for the required durable PREFLIGHT audit and the [TESTNET runbook](./docs/TESTNET_VALIDATION_RUNBOOK.md) for controlled operator procedures.

### Trading process ownership

The broker-wide and Harvester process locks live under `~/.coinzilla/harvester/process-locks/`; Journal's own hidden writer lock stays with its active session directory. Acquisition/release order and stale-owner rules are defined in [Journal Operations](./docs/JOURNAL_OPERATIONS.md#trading-process-ownership-locks).

### Optional Telegram notifications

Telegram policy lives in `config.json` under `notifications.telegram`; bot credentials remain in `.env.development` / deployment environment variables and must never be committed.

- `enabled`: set to `false` to disable Telegram even when credentials exist. The default is `true`; transport is still created only when both credential variables are present.
- `profile`: `minimal` (safety alerts only), `trader` (useful order/fill/recovery and lifecycle milestones), `verbose` (all supported low-volume operational events), or `custom` (only explicitly enabled ordinary events).
- `markets`: an empty array means all markets; otherwise ordinary symbol-specific notifications are limited to the listed symbols.
- `events`: optional boolean overrides keyed by `orderSubmitted`, `orderCancelled`, `orderFailed`, `fillReceived`, `pairPaused`, `recoveryCompleted`, `recoveryFailed`, `botStarted`, `botStopped`, `startupFailed`, `brokerConnected`, `brokerDisconnected`, and `accountSafetyAlert`. Overrides merge with the selected profile; with `custom`, unspecified ordinary events remain off.
- Critical startup, broker-disconnect, order-failure, pair-pause, recovery-failure, and account-safety alerts cannot be disabled and bypass market filters.

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

See [Journal Operations](./docs/JOURNAL_OPERATIONS.md) for PREFLIGHT/CLOSING account snapshots and balance evidence.

### Compare persisted opening and closing balances

See [Journal Operations](./docs/JOURNAL_OPERATIONS.md) for account snapshot comparison and durability rules.

## Startup account preflight audit

See [Journal Operations](./docs/JOURNAL_OPERATIONS.md) for the broker-connected startup audit and fail-closed conditions.

## Development logging

See [Logging](./docs/LOGGING.md) for development commands and structured output.

## Durable-fact store initialization

ADR-0001 defines the application-owned durable-fact store. Genesis creation is a separate, one-time administrative operation; application startup never creates or repairs a missing store.

The explicit command is documented in [ADR-0001 — Application-owned recovery facts](./docs/architecture/decisions/0001-application-owned-recovery-facts.md). Do not run it against a production directory until the runtime-integration step explicitly instructs you to initialize the store.

The store directory must be on a local filesystem; network shares and cloud-synchronized folders are unsupported. Its SHA-256 chains detect accidental corruption and reordering, not malicious rewriting by a privileged local actor. The allowlisted `MARKET_HISTORY_COVERAGE_CONFIRMED` fact records only a reviewed per-market history interval and never certifies account-wide market-universe completeness.

## Process identity and build provenance

See [Journal Operations](./docs/JOURNAL_OPERATIONS.md) for process identity, Journal session metadata and provenance.

## Conservative Strategy authority

The [Conservative Domain Specification](./docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md) is the sole authority for Conservative behavior. Aggressive remains deferred; see [Trading strategies](./docs/trading-strategies.md) for non-authoritative proposal context.

## Operator control

The transport-independent operator application, market-scoped engine pause and offline-testable Telegram adapter are implemented in [PR #1045](https://github.com/45s/coinzilla/pull/1045). The first Telegram command is `/pause <SYMBOL>` only. It blocks new strategy BUYs and trailing-BUY replacements for one configured market; existing exchange orders remain open and may still fill, while fill accounting and recovery SELLs continue. The adapter is not started by Harvester: operator-fact projection, closed-gate startup restoration and process-restart recovery Steps 7–9 must be completed first. See the [operator-control contract](./docs/operator-control/README.md).
