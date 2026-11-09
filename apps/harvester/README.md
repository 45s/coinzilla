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

The development launcher starts Node with `--env-file=.env.development` and sets `NODE_ENV=development` in the child environment before application and broker modules load. This selects the Binance Spot TESTNET profile and enables the Conservative TESTNET strategy. Put TESTNET API credentials in `.env.development`; do not add broker, trading-mode, trading-enable, or Journal flags.

For production, prepare a separate secrets file and start command:

```sh
cp apps/harvester/.env.production.example apps/harvester/.env.production
pnpm --filter @coinzilla/harvester start
```

The production launcher loads `.env.production` when that file exists and preloads an initializer that sets `NODE_ENV=production` before application and broker modules load. This selects Binance Spot LIVE market/account endpoints in read-only mode. Provide LIVE API credentials through `.env.production` or the deployment secret manager. Use an API key with account-read permissions; keep trading and withdrawals disabled. Externally injected credentials remain supported. Never copy TESTNET credentials into production.

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

Runtime connectivity and execution policy also belong in the same JSON file, under `runtime.profiles`. The `development` profile selects Binance TESTNET and explicitly opts into Conservative TESTNET execution; the `production` profile selects Binance LIVE connectivity but keeps order execution disabled. `NODE_ENV` selects the profile. The `test` profile permits broker fakes but keeps execution disabled; an unspecified environment uses the safe no-broker/read-only default. Environment files contain only standard process settings and secrets (Binance API credentials and optional Telegram credentials), never broker, trading-mode, Journal, or application feature flags.

`investment` is the maximum quote-currency capital allocated to that pair. It is denominated in the quote asset named by the symbol: `ZROUSDT` uses USDT, while `ZROFDUSD` uses FDUSD. It is a per-pair allocation limit, not an order size. `orderQuantity` remains a separate configured order quantity; `keepQuantity` remains the retained base-asset quantity. On startup, enabled pairs are checked against exchange metadata and actual tick/step/notional filters. `pricePrecision` and `quantityPrecision` do not override exchange increments. All enabled markets are subscribed before startup performs REST ticker seeding or waits for an initial strategy evaluation; a slow first market must not delay market-data intake for later enabled pairs. The bootstrap verifies that every enabled pair has a successful market-price subscription before startup proceeds.

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

The configuration loader and validation live in `src/infrastructure/config/load-trading-config.js` and `src/domain/trading-config.js`. Conservative is the first executable mode. The development profile explicitly enables TESTNET execution; test and unspecified profiles remain read-only/no-broker; production selects LIVE connectivity but remains read-only.

## Runtime and safety

- Journal is enabled by default and writes to the application-local `logs/` directory. Every broker-connected startup, including production read-only mode, requires a ready Journal and a durable PREFLIGHT account audit before market subscriptions. TESTNET trading additionally fails closed unless the Journal exposes durable `flush()` support before the trading engine activates.
- Current startup creates fresh in-memory Portfolio, RecoveryLedger and OrderRegistry state; it does not replay prior Journal sessions. Do not treat a process restart after trading as reconciled or safe. Follow [#654](https://github.com/45s/coinzilla/issues/654).
- Pre-existing external/unowned orders are reported but are not adopted or canceled automatically.
- Order execution is TESTNET-only. Production connects to Binance LIVE in read-only mode; live order execution is not implemented and is rejected by configuration validation. Use the documented TESTNET runbook and explicit authorization for any operator action.
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

The actual broker-wide host lock and Journal-directory lock, acquisition/release order and stale-owner rules are defined in [Journal Operations](./docs/JOURNAL_OPERATIONS.md#trading-process-ownership-locks).

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

The development runner writes raw stdout/stderr to the cumulative
`apps/harvester/logs/terminal.log` and one timestamped terminal session file.
Structured DEBUG/TRACE logs use matching process-session identities. Standalone
`start` creates structured session files but does not create terminal-capture
files. See [Logging](./docs/LOGGING.md) for destinations, lifecycle and retention.

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

All standalone TESTNET account/order tools are documented in [TESTNET order tools](./docs/testnet-order-tools.md).

## Standalone Binance TESTNET balance inspection

See [TESTNET order tools — balances](./docs/testnet-order-tools.md#list-non-zero-account-balances-read-only).

## Standalone Binance TESTNET ZRO market sell

See [TESTNET order tools — ZRO market sell](./docs/testnet-order-tools.md#sell-all-free-zro-at-market-destructive). This command is destructive and requires explicit operator authorization.

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
