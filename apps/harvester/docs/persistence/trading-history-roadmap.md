# Harvester trading-history persistence roadmap

**Status:** Active — Phases 1–3 complete; Phases 4–6 planned
**Type:** Domain roadmap
**Owner:** Harvester
**Tracking:** [#1327 — Provider-neutral DB API and Harvester persistence integration](https://github.com/45s/coinzilla/issues/1327)
**Related infrastructure:** [#1486 — SQLite relational-schema infrastructure](https://github.com/45s/coinzilla/issues/1486)

## Purpose and authority

This document is the canonical phased plan for readable, queryable Harvester trading history. Harvester owns its business schemas, migrations, repository ports, mapping, lifecycle projections and operational policy. The `@coinzilla/db` package owns only generic database infrastructure and provider adapters.

The [persistence README](README.md) is the current implementation and safety-boundary reference. This roadmap records delivered phases and the remaining product work; GitHub issues and pull requests remain the live task records.

This roadmap does not authorize exchange activity, change strategy behavior, or make historical data authoritative for trading or recovery.

## Current implementation baseline

- [x] Generic provider-neutral database API, built-in SQLite provider and reusable conformance infrastructure are implemented in `packages/db`.
- [x] Generic SQLite migration integrity/order hardening is complete under [#1486 / PR #1489](https://github.com/45s/coinzilla/pull/1489). This infrastructure does not define Harvester business tables.
- [x] The best-effort `harvester_orders` projection was delivered by [PR #1469](https://github.com/45s/coinzilla/pull/1469), merge commit `39f098000d6c20cb596a9e6700250faa00bbd80e`.
- [x] Relational order/fill schema, versioned Harvester migrations, legacy-order conversion, and live applied-fill persistence were delivered by [PR #1555](https://github.com/45s/coinzilla/pull/1555), merge commit `9611dee32a7d5b3efa6737f6343b8553a2235022`.
- [x] Read-only Binance startup order/trade-history synchronization was delivered by [PR #1557](https://github.com/45s/coinzilla/pull/1557), merge commit `c2b0eba34ea2778be8d70212fd5e2e3144067aa5`; its backwards-compatible pagination contract was delivered by [PR #1559](https://github.com/45s/coinzilla/pull/1559), merge commit `b06f034daecbd2b6dee9ad68b8426ca3bab106cb`.
- [x] TESTNET and LIVE use separate environment-selected SQLite files. The temporary process-ID smoke-test write and trading-session-ID projection were removed.

The legacy `harvester_orders` collection remains part of the compatibility/dual-write period. Its records are cumulative order snapshots, not individual executions. Never convert cumulative quantities or repeated order snapshots into fabricated fill rows.

## Non-negotiable boundaries

1. **Ownership:** Harvester owns all trading-history tables, schemas, migrations, repository ports, mapping and business persistence. Do not add Harvester tables or trading concepts to `packages/db`.
2. **Exact values:** prices, quantities, quote amounts and commissions retain exact decimal representations. Never round-trip financial values through JavaScript floating-point arithmetic.
3. **Stable provenance:** scope every order and fill by environment, provider instance/type and account. Never merge TESTNET and LIVE or different provider instances/accounts.
4. **Order identity:** preserve the canonical order identity `(environment, providerInstanceId, providerType, accountId, clientOrderId)`.
5. **Fill identity:** use the provider's actual stable execution/trade ID within its environment, provider instance/type, account and market scope. Do not deduplicate only by order ID, timestamp, price or quantity.
6. **No fabricated history:** never derive individual fills, prices, fees, execution times or ownership from cumulative order quantities or lifecycle snapshots. Unknown facts remain unknown.
7. **Non-blocking persistence:** order/fill observers use bounded asynchronous work. SQLite writes must not block broker submission, user-data processing, fill application, accounting, Journal publication/flush or trading readiness. Persistence gaps remain diagnosable and must not become trading failures.
8. **Authority:** OrderRegistry remains authoritative for in-process order state and ownership. Journal remains ordered lifecycle evidence. ADR-0001 Operational State Store remains separate and unchanged. Trading-history tables are reporting/history projections, not restart restoration, order adoption, replay or trading authority.
9. **No scope resurrection:** do not reintroduce process-ID persistence, runtime-session-ID projection or a `sessions` table. No `errors` table is included in this workstream; error persistence needs a separate purpose, redaction, duplication and retention decision.
10. **Migration safety:** preserve existing `harvester_orders` history through verified, idempotent migration and retain the source during the compatibility period. Follow the backup, integrity and rollback procedure in the [persistence README](README.md).
11. **Exchange boundary:** history synchronization is read-only. It must not place, cancel or amend orders. It does not establish account-wide or historical-market completeness.

## Relational model delivered

| Table | Meaning | Identity / constraint |
| --- | --- | --- |
| `orders` | Latest canonical snapshot for one exchange order | Environment, provider instance/type, account and client order ID |
| `fills` | One row per actual exchange execution | Environment, provider instance/type, account, market and provider trade ID |
| `fill_commissions` | Actual commission facts associated with a fill | Fill ID and commission ordinal |
| `history_sync_cursors` | Last fully persisted order/trade IDs for a configured market | Environment, provider instance/type, account and symbol |

Financial values are stored as exact decimal text. Missing values remain SQL `NULL`; a reported zero remains distinct from unknown. A fill links to an order only through verified scoped identity. Strategy/position/cycle attribution remains nullable unless immutable ownership is established. See the [persistence README](README.md) for complete column semantics, migration behavior, indexes, provenance and rollback instructions.

## Delivered phases

### Phase 1 — Relational order/fill foundation and safe order-history migration

<badge>Complete — PR #1555</badge>

- Added Harvester-owned physical `orders`, `fills` and `fill_commissions` tables with versioned migrations and repository adapters using the public `@coinzilla/db` API.
- Migrated existing `harvester_orders` snapshots into relational `orders` with verified backup, source validation and idempotent conversion. The source collection remains available during dual-write compatibility.
- Preserved scoped identities, exact decimal values, nullable facts, known provenance and attribution.
- Did not synthesize fills from cumulative order quantities.

### Phase 2 — Persist actual live executions and commissions

<badge>Complete — PR #1555</badge>

- Persisted canonical applied fills as individual execution rows, with exact execution facts and scoped provider/account/environment/market identity.
- Persisted actual commission amount and asset in `fill_commissions`; missing exchange-supplied quote valuation remains unknown rather than estimated.
- Kept persistence on a bounded best-effort observer path. Queue overflow or write failure is observable and does not reverse or block successful fill accounting.
- Identical execution replay is idempotent; conflicting immutable facts for the same scoped execution identity are treated as an integrity failure.

### Phase 3 — Startup exchange-history synchronization

<badge>Complete — PR #1557 / broker pagination PR #1559</badge>

- Runs a read-only Binance order/trade-history scan for each configured execution market during startup, after market metadata initialization and before trading-engine activation. It is not a separately invoked import command.
- Fetches order history and trade history independently, with provider pagination and durable per-environment/provider-instance/provider-type/account/symbol cursors.
- Advances each cursor only after every record in its page is persisted. Interrupted pages safely replay through idempotent persistence.
- Refreshes the oldest stored non-terminal order on subsequent startups so an order that fills while Harvester is offline can still be discovered after the forward cursor advances.
- Persists unfilled order observations as well as executions, with explicit `exchange_history` provenance. Ambiguous order/fill linkage fails closed.
- A failed scan reports partial diagnostics and remains best-effort; it does not reverse accounting or change order ownership/readiness authority.

**Coverage limitation:** synchronization covers only configured execution markets and exchange-available history. It does not prove account-wide, delisted/unconfigured-market or exchange-retention completeness. Orders are not adopted, strategy ownership is not inferred, and process-restart restoration is not enabled.

## Planned phases

### Phase 4 — Strategy-cycle attribution

- Define a Harvester-owned strategy-cycle identity and lifecycle only when the actual domain model and event sequence support it.
- Attribute orders/fills only from immutable strategy ownership captured at order creation/registration, not current configuration, symbol or timestamp inference.
- Keep attribution nullable for legacy, external and unknown ownership.
- Specify partial fills, mixed ownership, replacement orders, cancellations and late-fill behavior.
- Report unattributed records separately; never fabricate ownership.

### Phase 5 — Historical analytics and reporting

- Build read-only queries/projections for order counts, execution counts, executed quantities, gross quote flows, commission totals by asset and completed strategy-cycle counts.
- Report orders, fills/executions and completed cycles as separate metrics; they are not interchangeable.
- Define realized PnL only after entry/exit allocation, inventory basis and commission-conversion rules are explicit and tested. Third-asset commissions require a defensible valuation source and timestamp.
- Define holding duration only when entry/exit execution linkage is known.
- Calculate equity and drawdown only from a defensible equity valuation time series; orders and fills alone are insufficient.
- Keep historical analytics read-only and separate from strategy decisions.

### Phase 6 — Operational hardening

- Define backup frequency, retention, access permissions, disk-space monitoring, corruption/disk-full diagnostics and tested restore drills.
- Define retention and archival separately for order/fill business history and operational diagnostics.
- Verify WAL/checkpoint behavior and safe shutdown/backup behavior using actual SQLite integration.
- Document database file locations and safe offline inspection/export procedures.
- Establish production readiness only after restore evidence, failure drills and monitoring are complete.

## Delivery and scope rules

- Keep each follow-on phase in a focused Harvester-owned issue/PR and update this roadmap when its status changes.
- Keep generic provider infrastructure in `packages/db`; no Harvester schema, SQL or business repository belongs there.
- Do not add account snapshots, strategy-cycle tables, PnL, equity/drawdown, `sessions` or `errors` without a separately justified and approved scope.
- Keep startup history synchronization read-only and best-effort. Do not expand configured-market coverage claims into account-wide completeness.
- Preserve OrderRegistry, Journal and ADR-0001 authority boundaries. No restart restoration, adoption or Journal replay is authorized by this roadmap.
