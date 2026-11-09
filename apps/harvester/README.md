# Harvester

> **Documentation:** Start with the [Harvester documentation index](./docs/README.md). Repository-wide documentation lifecycle and AI-agent maintenance requirements are defined in [Documentation Governance](../../docs/DOCUMENTATION_GOVERNANCE.md). The [documentation migration plan](./docs/plans/DOCUMENTATION_MIGRATION.md) tracks the staged reorganization; historical evidence must be preserved.

> **Current status — 2026-11-09:** Process-restart reconciliation is an active forensic/release-readiness workstream under [#654](https://github.com/45s/coinzilla/issues/654). Current startup creates fresh in-memory Portfolio/RecoveryLedger/OrderRegistry state and does not replay prior Journal sessions. This integration gap is source-confirmed; end-to-end restart consequences and history-retention completeness remain under investigation. This phase is documentation/evidence only: no runtime implementation, test changes, or TESTNET acceptance are claimed. See [Harvester Roadmap](./ROADMAP.md) and [Conservative Strategy audit](./AUDIT.md).


> **Latest TESTNET session audit — 2026-11-08:** Source review traced the DOGE follow-up gap to an unowned ZRO execution closing global accounting readiness while an already-resting Harvester BUY remained live. The BUY-cancellation safety fix is in [PR #669](https://github.com/45s/coinzilla/pull/669). The configured-asset snapshot allowlist correction is implemented in [PR #670](https://github.com/45s/coinzilla/pull/670) and tracked in [#667](https://github.com/45s/coinzilla/issues/667). The audit readiness label BLOCKED describes unowned-order reconciliation, not startup readiness. See the [session audit in AUDIT.md](./AUDIT.md#2026-11-0708-binance-spot-testnet-session-audit--issue-667). This is retrospective evidence, not TESTNET acceptance or authorization to trade.


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

## Configuration

Harvester uses one `trading-config.json` with strategy-scoped configuration. The root contains a `strategies` object; each strategy owns its enabled flag, settings, and market pairs. The active strategy key is `CG_coinGrabber`.

- `strategies.CG_coinGrabber.enabled`: enables the strategy.
- `strategies.CG_coinGrabber.settings.minProfit`: minimum required net profit per completed recovery sale, in the pair's quote currency.
- `strategies.CG_coinGrabber.settings.conservative.enabled`: must remain `true`; Conservative is the first executable mode.
- `strategies.CG_coinGrabber.settings.aggressive.enabled`: must remain `false`; Aggressive is deferred until Conservative is proven on TESTNET.
- `strategies.CG_coinGrabber.pairs`: market-specific settings keyed by symbol; each pair owns its enabled flag, investment limit, sizing, reserve, precision, and fee settings.

All settings and pairs belong to their strategy. Future strategies can be sibling entries under `strategies`; they do not share this strategy's pairs. Strategy availability is not configured through environment variables.

**Runtime environment contract:** `TRADING_MODE` is the only operator-facing exchange-mode setting and accepts exactly `testnet` or `live`. Binance is the only broker, so there is no broker selector. Trading is enabled in either selected mode; there is no profile selector or trading-enable flag. Missing or invalid `TRADING_MODE` must fail startup rather than silently choose an exchange environment. `NODE_ENV` does not select the exchange environment. The intended environment files are `.env.development` with `TRADING_MODE=testnet` and `.env` with `TRADING_MODE=live`.

The implementation reads `TRADING_MODE` at startup, fixes the broker to Binance, and rejects missing or invalid mode values. Strategy and pair settings remain in `trading-config.json`.

`investment` is the maximum quote-currency capital allocated to that pair. It is denominated in the quote asset named by the symbol: `ZROUSDT` uses USDT, while `ZROFDUSD` uses FDUSD. It is a per-pair allocation limit, not an order size. `orderQuantity` remains a separate configured order quantity; `keepQuantity` remains the retained base-asset quantity. On startup, enabled pairs are checked against exchange metadata and actual tick/step/notional filters. `pricePrecision` and `quantityPrecision` do not override exchange increments. All enabled markets are subscribed before startup requests any missing initial ticker snapshot through Binance WebSocket API `ticker.price` or waits for an initial strategy evaluation; a slow first market must not delay market-data intake for later enabled pairs. The bootstrap verifies that every enabled pair has a successful market-price subscription before startup proceeds.

Example (illustrative only; it does not identify the currently enabled default pair):

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

`makerPercent` and `takerPercent` are percentage values in the range 0 inclusive to 100 exclusive (for example, `0.1` means 0.1%). Startup validation rejects negative, non-finite, and 100-or-higher values. The committed config enables only `ZROFDUSD`; this is configuration, not authorization for a TESTNET session. The controlled runbook still contains the earlier DOGEUSDT/ZROUSDT plan and remains CLOSED / PAUSED until the pair scope is reconciled. The current USDT pair configuration reflects the reported 0.1% maker/taker setting; FDUSD pairs retain `makerPercent: 0` and use `takerPercent: 0.1`. Conservative SELL planning reserves the higher configured maker/taker rate because maker execution is not guaranteed.

The strategy configuration remains in `trading-config.json`; exchange selection is separate and comes from `TRADING_MODE`. `testnet` selects Binance Spot TESTNET and `live` selects Binance Spot LIVE. Trading is enabled in either mode. The runtime resolver reads only `TRADING_MODE`; `NODE_ENV` does not select the exchange.

## Runtime and safety

- Journal is enabled by default and writes its JSONL session into the current process directory under `logs/sessions/`. Cumulative diagnostics live under `logs/cumulative/`. Every broker-connected startup, including production LIVE trading mode, requires a ready Journal and a durable PREFLIGHT account audit before market subscriptions. TESTNET trading additionally fails closed unless the Journal exposes durable `flush()` support before the trading engine activates.
- Current startup creates fresh in-memory Portfolio, RecoveryLedger and OrderRegistry state; it does not replay prior Journal sessions. Do not treat a process restart after trading as reconciled or safe. Follow [#654](https://github.com/45s/coinzilla/issues/654).
- Pre-existing external/unowned orders are reported but are not adopted or canceled automatically.
- `TRADING_MODE=testnet` executes on Binance Spot TESTNET; `TRADING_MODE=live` executes on Binance Spot LIVE and can submit real orders. Selecting `live` is the explicit environment choice; no separate trading-enable flag is used. The current startup path does not restore previous Portfolio, RecoveryLedger, or OrderRegistry state after a process restart (tracked in #654); do not assume restart-safe unattended operation until that work is implemented and verified.
- The process-ownership locks are described in [Journal Operations](./docs/JOURNAL_OPERATIONS.md#trading-process-ownership-locks).

## Documentation

- [Harvester documentation index](./docs/README.md) — all architecture, domain, operations, testing, audits and plans.
- [Operations index](./docs/operations/README.md) — Journal, logging, TESTNET runbooks and safety.
- [Architecture](./docs/architecture.md) and [architecture diagrams](./docs/architecture/README.md).
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

See [architecture — operational notifications](./docs/architecture.md#operational-notifications) and the [Notifiers package README](../../packages/notifiers/README.md).

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

## Process identity and build provenance

See [Journal Operations](./docs/JOURNAL_OPERATIONS.md) for process identity, Journal session metadata and provenance.

## Conservative Strategy authority

The [Conservative Domain Specification](./docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md) is the sole authority for Conservative behavior. Aggressive remains deferred; see [Trading strategies](./docs/trading-strategies.md) for non-authoritative proposal context.
