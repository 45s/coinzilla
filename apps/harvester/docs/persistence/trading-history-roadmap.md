# Harvester trading-history persistence roadmap

**Status:** Active  
**Type:** Domain roadmap  
**Owner:** Harvester  
**Tracking:** [#1327 — Provider-neutral DB API and Harvester persistence integration](https://github.com/45s/coinzilla/issues/1327)  
**Related infrastructure:** [#1486 — SQLite relational-schema infrastructure](https://github.com/45s/coinzilla/issues/1486)

## Purpose and authority

This document defines the phased direction for readable, queryable Harvester trading history in SQLite. Harvester owns its business schemas, migrations, repository ports, mapping, lifecycle projections and operational policy. The `coinzilla/db` package owns only generic database infrastructure and provider adapters.

This is the canonical plan for Harvester trading-history persistence. The [persistence README](README.md) remains the current implementation and safety-boundary reference. GitHub issues and pull requests remain the live task records.

The roadmap does not authorize exchange activity, change strategy behavior, or make historical data authoritative for trading or recovery.

## Current baseline

- [x] Generic provider-neutral database API and built-in SQLite adapter are implemented in `packages/db`.
- [x] Generic SQLite migration integrity/order hardening was completed under [#1486 / PR #1489](https://github.com/45s/coinzilla/pull/1489). This is infrastructure only; it does not define Harvester business tables.
- [x] Harvester's best-effort `harvester_orders` order-history projection was merged in [PR #1469](https://github.com/45s/coinzilla/pull/1469), commit `39f098000d6c20cb596a9e6700250faa00bbd80e`.
- [x] TESTNET and LIVE persistence use separate environment-selected SQLite files.
- [x] The temporary process-ID smoke-test write and earlier trading-session-ID persistence were removed.
- [ ] A normalized per-execution fill/commission ledger does not exist yet.
- [ ] Historical exchange order/trade synchronization does not exist yet.
- [ ] Relational `orders` and `fills` tables are a target design, not current implementation.

The existing `harvester_orders` records represent an order's cumulative execution state. They are not individual executions. A partially filled order may be updated several times, but those snapshots must not be converted into multiple fill rows. A cumulative quantity cannot reveal individual execution IDs, prices, timestamps or commission facts.

## Non-negotiable boundaries

1. **Ownership:** Harvester owns all business tables, schema definitions, migrations, repository ports, mapping and business persistence. Do not add Harvester tables or domain concepts to `packages/db`.
2. **Exact values:** prices, quantities, quote amounts, commission amounts and derived financial values remain exact decimal strings/decimal values under existing domain conventions. Never round-trip financial values through JavaScript floating-point arithmetic.
3. **Stable provenance:** every order and fill is scoped by environment and immutable provider/account identity. Never merge TESTNET and LIVE or different provider instances/accounts.
4. **Order identity:** retain the existing composite identity `(environment, providerInstanceId, providerType, accountId, clientOrderId)` for Harvester-owned orders.
5. **Fill identity:** use the provider's actual stable execution/trade identifier within its environment, provider instance/type and account scope. Do not invent IDs or deduplicate solely by order ID, timestamp, price or quantity.
6. **No fabricated history:** never derive individual fills, prices, fees or execution times from cumulative order quantities or lifecycle snapshots. Preserve unknown values as unknown.
7. **Non-blocking observer:** SQLite writes remain best-effort and must not block broker submission, user-data processing, fill application, accounting, Journal publication/flush, or trading readiness. Persistence gaps must be diagnosable; they must not silently become trading failures.
8. **Authority:** OrderRegistry remains authoritative for in-process order state. Journal remains ordered lifecycle evidence. Harvester ADR-0001 Operational State Store remains separate and unchanged. Trading-history tables are reporting/history projections, not restart restoration, order adoption, replay, or trading authority.
9. **No scope resurrection:** do not reintroduce process-ID persistence, runtime-session-ID projection, or an undocumented `sessions` table. Do not add an `errors` table in the first relational slice. Error persistence needs a separate purpose, redaction, duplication and retention decision.
10. **Migration safety:** preserve existing `harvester_orders` history through an idempotent, verifiable migration with backup and rollback instructions. Do not drop or rewrite the source before validation and safe cutover.
11. **No exchange operations:** implementation and default tests are offline. Any future history retrieval is read-only, separately gated, and must not place, cancel or amend orders.

## Target data model

The first useful relational model is deliberately small: one row per order and one row per actual execution.

### `orders`

One row per Harvester-owned order, keyed by the existing stable composite identity. The row stores the latest known canonical order snapshot, not one row per lifecycle event.

Expected field groups:

- **Identity/provenance:** stable internal primary key; environment; provider instance ID; provider type; account ID; client order ID; broker order ID; canonical market ID and symbol.
- **Order facts:** side; order type; current canonical status; requested base quantity; cumulative executed base quantity; cumulative executed quote quantity; limit price where applicable; time-in-force where applicable.
- **Lifecycle facts:** submitted/created time; last exchange update time; first/last observed time; terminal time where known; source-event identity or revision metadata sufficient to reject stale updates.
- **Attribution:** nullable strategy ID and position/cycle reference only when immutable ownership is known. Never guess attribution from symbol, timing or current strategy configuration.
- **Migration provenance:** source collection/schema version and migration marker where needed to audit converted rows.

Use exact decimal text storage (or another explicitly exact representation already supported by the Harvester contract). Preserve nullable/unknown facts rather than substituting zero or fabricated timestamps.

### `fills`

One row per actual exchange execution/trade, not one row per order update.

Expected field groups:

- **Identity/provenance:** stable internal primary key; environment; provider instance ID; provider type; account ID; market ID/symbol; broker order ID; client order ID when supplied; provider execution/trade ID.
- **Execution facts:** side; exact executed base quantity; exact execution price; exact quote quantity when supplied or safely derived with exact decimal arithmetic; exchange execution timestamp; ingestion/observation timestamp.
- **Commission:** exact commission amount and commission asset; preserve zero versus unknown distinctly. Do not calculate a fee from configured rates when the exchange did not report one.
- **Attribution:** nullable strategy ID and position/cycle reference only when immutable order/fill provenance establishes it.
- **Source/provenance:** source channel (for example user stream or read-only trade-history import), source schema/version and migration/import metadata where applicable.

Enforce idempotency with a unique key based on actual provider execution identity plus environment/provider-instance/provider-type/account scope. An identical duplicate is idempotent. A duplicate identity with conflicting canonical facts is an integrity error, not an overwrite.

### Relationships and indexes

- Link each fill to its canonical order through the stable order identity and/or an internal order key, with foreign-key behavior chosen explicitly and tested.
- Add indexes for actual reporting/reconciliation access patterns: environment/provider/account/market and exchange execution time; order identity; broker order ID; strategy and cycle attribution when present.
- Keep indexes and constraints domain-owned in Harvester migrations.
- Avoid speculative generic query features or an ORM in `packages/db`.

## Delivery phases

### Phase 1 — Relational order/fill foundation and safe order-history migration

**Status: Planned.** This is the next implementation slice.

- Add Harvester-owned `orders` and `fills` relational schemas and versioned migrations.
- Define order and fill repository contracts in Harvester; implement them through the existing public `@coinzilla/db` API and available SQLite capabilities.
- Preserve the current order observer's bounded, serialized, best-effort, non-blocking behavior while moving its order projection to relational `orders`.
- Migrate existing `harvester_orders` records idempotently into `orders`, retaining identity, exact values, status, timestamps, provenance and nullable attribution.
- Do not synthesize `fills` from cumulative executed quantity. The initial `fills` table may remain empty until actual execution facts are wired in Phase 2.
- Provide an explicit backup, validation, cutover and rollback procedure. Retain the source collection until post-migration verification proves the destination is complete.
- Add repository, migration, real-SQLite, idempotency, conflict, isolation and observer failure/queue tests.
- Keep the old read/reporting behavior available or provide a deliberate compatible read path; document any operator-facing query change.

**Acceptance:** existing order history is preserved exactly and repeatably; new order snapshots update one relational row; no fill is fabricated; TESTNET/LIVE and provider/account scopes remain isolated; DB failures never block trading paths; migration rollback is documented and tested; relevant offline checks pass on the exact PR head.

### Phase 2 — Persist actual live executions and commissions

- Trace the canonical normalized fill event from broker adapter through Harvester fill application and event publication.
- Persist one row for each actual execution using the provider execution/trade ID and immutable order provenance.
- Capture actual execution price, quantity, quote amount, exchange timestamp, ingestion timestamp, commission amount and commission asset.
- Make duplicate delivery idempotent and conflicting duplicate identity fail visibly.
- Preserve existing fill-application/accounting order and Journal durability semantics. Database persistence must remain an observer/projection and must not become a prerequisite for applying a fill.
- Cover partial fills, multiple fills per order, duplicate/out-of-order delivery, cancel/fill overlap, reconnect overlap, missing optional facts and observer failure.
- Do not infer fill rows from order cumulative totals.

### Phase 3 — Read-only exchange history synchronization

- Add a separately invoked, explicitly scoped read-only import workflow for order history and trade/execution history. Orders and actual trades are distinct exchange resources and must be fetched independently.
- Support provider-specific pagination, bounded overlap windows, rate limits, retry policy and resumable cursors.
- Make imports idempotent under repeated runs and overlapping pages.
- Track synchronization progress, gaps and incomplete windows explicitly; never claim completeness from a single page or successful HTTP response alone.
- Reconcile imported orders with actual trades by stable exchange identifiers. Preserve unmatched trades/orders for investigation rather than guessing.
- Keep import away from trading startup/readiness and never submit, cancel or amend exchange orders.

### Phase 4 — Strategy-cycle attribution

- Define a Harvester-owned strategy-cycle identity and lifecycle only when the actual domain model and event sequence support it.
- Attribute orders/fills from immutable strategy ownership captured at order creation/registration, not current configuration or symbol-only inference.
- Keep attribution nullable for legacy/external/unknown ownership.
- Define how partial fills, mixed ownership, replacement orders, cancellations and late fills map to a cycle.
- Report unattributed records separately; never fabricate ownership.

### Phase 5 — Historical analytics and reporting

- Build read-only queries/projections for order counts, execution counts, executed quantities, gross quote flows, commission totals by asset, and completed strategy-cycle counts.
- Report **orders, fills/executions and completed cycles as separate metrics**; they are not interchangeable.
- Define realized PnL only after entry/exit allocation, inventory basis and commission conversion rules are explicit and tested. Third-asset commissions require a defensible valuation source and timestamp.
- Define holding duration only when entry/exit execution linkage is known.
- Calculate equity and drawdown only from a defensible equity valuation time series; orders and fills alone are insufficient.
- Keep historical analytics read-only and separate from strategy decisions.

### Phase 6 — Operational hardening

- Define backup frequency, retention, access permissions, disk-space monitoring, corruption/disk-full diagnostics and tested restore drills.
- Define retention and archival separately for order/fill business history and operational diagnostics.
- Verify WAL/checkpoint behavior and safe shutdown/backup behavior using actual SQLite integration.
- Document database file locations and safe offline inspection/export procedures.
- Establish production readiness only after restore evidence, failure drills and monitoring are complete.

## Phase 1 implementation prompt

The following is the implementation brief for the next Harvester-owned task. It is intentionally limited to Phase 1; do not start Phase 2 live fill persistence or historical exchange synchronization in the same change.

```text
Repository: 45s/coinzilla
Target: develop
Owning domain: apps/harvester
Tracking: #1327 (create/adopt a focused child issue if needed)
Scope: Harvester-owned persistence schema, migrations, repositories, tests and documentation. Do not modify packages/db unless a proven missing generic capability is separately approved and coordinated.

Implement Phase 1 of apps/harvester/docs/persistence/trading-history-roadmap.md.

Mandatory preflight:
1. Read root AGENTS.md, ENGINEERING_STANDARDS.md, AI_AGENT_WORKFLOW.md, docs/engineering/TASK_WORKFLOWS.md, docs/engineering/DOMAIN_OWNERSHIP.md, docs/DOCUMENTATION_GOVERNANCE.md and docs/MARKDOWN_STYLE.md in full.
2. Read apps/harvester/AGENTS.md, apps/harvester/ROADMAP.md, apps/harvester/docs/README.md, apps/harvester/docs/TRADING_FIRST.md, apps/harvester/docs/persistence/README.md, and the complete persistence/SQLite blueprint. Follow applicable architecture, DB API, Journal, order lifecycle and test references recursively.
3. Inspect current PR #1469 implementation and tests, public @coinzilla/db API/migration capabilities, SQLite filename/environment composition, current order observer/repository, and all callers/consumers. Verify current develop source; do not rely on historical inventories as current runtime truth.
4. Before editing, summarize ownership, current contracts, acceptance criteria, exact tests/checks and genuine conflicts.

Requirements:
- Harvester owns orders/fills business schemas, migrations, repository ports, mapping and business persistence. packages/db remains generic. Do not add Harvester tables, migrations, SQL, trading terminology or domain models to packages/db.
- Create readable relational orders and fills tables with Harvester-owned versioned migrations. Use the existing public @coinzilla/db capabilities; do not add an ORM or leak SQL/SQLite types into Harvester domain/application code.
- orders contains one row per stable Harvester-owned order identity: (environment, providerInstanceId, providerType, accountId, clientOrderId). Preserve broker order ID, market identity, side/type/status, requested quantity, cumulative executed base/quote quantities, optional limit price/time-in-force, lifecycle timestamps, source revision/event identity, and strategy/position attribution only when known.
- fills is designed for one row per actual provider execution/trade. Its identity includes environment, provider instance/type, account and provider's stable execution/trade ID. Include order linkage, market, side, exact executed quantity/price/quote quantity, exchange execution time, ingestion time, actual commission amount/asset, source and nullable strategy/cycle attribution.
- Store financial decimals exactly using established Harvester conventions. Never use JavaScript Number arithmetic for persisted financial values. Preserve zero separately from unknown/null.
- Keep the existing order observer bounded, serialized, best-effort and non-blocking. Database writes must not be awaited by broker submission, user-data processing, fill application, accounting, Journal or readiness. Queue overflow/write failures remain visible as history gaps but do not block trading.
- Migrate existing harvester_orders snapshots into orders idempotently and losslessly. Preserve composite identity, exact decimal strings, timestamps, status, provider/account/environment provenance and known attribution. Verify counts and canonical content before cutover.
- Do not derive fills from cumulative executed quantity. Do not invent execution IDs, per-fill prices, commissions, or execution timestamps. Phase 1 fills table may contain zero rows until Phase 2 connects actual fill events.
- Design backup-before-migration, validation, rollback and source-retention behavior. Do not drop the source collection or make an irreversible cutover before migration is verified and rollback is documented/tested.
- Preserve separate TESTNET/LIVE database files and provider/account isolation.
- Keep OrderRegistry authoritative for in-process state, Journal ordered and unchanged, and ADR-0001 Operational State Store separate and unchanged. No startup restoration, adoption, replay, or trading authority.
- Do not add sessions or errors tables. Do not restore process-ID or trading-session-ID persistence. No broker API, strategy, or exchange-operation changes.

TDD and verification:
- For every behavior/schema/migration behavior, write the regression test first and prove RED before implementation, then GREEN and REFACTOR. If local execution is unavailable, use required remote GitHub Actions TDD and inspect the exact failing test log.
- Test fresh schema creation, migration from representative existing harvester_orders records, repeated/idempotent migration, preservation of null/zero/exact decimals/timestamps/provenance, duplicate/conflicting identities, partial order updates, environment/provider/account isolation, transaction/rollback behavior, observer queue overflow and persistence failure non-blocking semantics.
- Add assertion messages to every assertion in edited tests; use human-readable test names and named fields.
- Run focused Harvester persistence tests and coverage, full Harvester tests, workspace checks and required CI as applicable. Verify required checks on the exact final PR head SHA. Do not claim a check passed unless GitHub reports success for that SHA.
- Update persistence README, Harvester roadmap and local documentation index in the same PR. Perform repository-wide living-document freshness and Markdown/link/anchor checks.
- Open a normal non-draft PR targeting develop once the increment is coherent. Include Documentation impact and exact validation evidence. Do not merge until all required checks pass and branch freshness is verified.

Acceptance:
1. Harvester has readable relational orders and fills tables with enforced identity/constraints/indexes.
2. Existing harvester_orders history migrates losslessly and idempotently with a verified backup/rollback path.
3. No synthetic fills or fabricated financial/attribution facts exist.
4. Existing order-history writes remain best-effort and cannot block trading.
5. TESTNET/LIVE and provider/account isolation are preserved.
6. packages/db, Journal, ADR-0001, strategy behavior and broker contracts remain unchanged.
7. Relevant tests and exact-head required CI pass; documentation and roadmap distinguish delivered behavior from deferred phases.
```

The Phase 1 prompt above is the task brief, not evidence that implementation has begun or that any schema has been delivered.
