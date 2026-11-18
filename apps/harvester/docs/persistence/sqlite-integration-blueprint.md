# Harvester SQLite integration blueprint

**Status:** preparation/design only; no runtime migration is authorized by this document  
**Tracking:** [#1327 — Provider-neutral DB API and Harvester persistence integration](https://github.com/45s/coinzilla/issues/1327)  
**Source baseline:** develop commit 5c517f677232ea3aa2ec72053087307693f97919 (2026-11-18)  
**Primary owner:** Harvester (apps/harvester)  
**Database infrastructure owner:** Database (packages/db)

> This is a source-verified integration plan, not a claim of production readiness. Existing Journal, Operational State Store, trading, broker, and market-data behavior must remain unchanged while this plan is implemented in later, separately reviewed tasks.

## 1. Purpose and non-goals

Prepare a predictable, incremental path for Harvester-owned historical repositories to use the existing provider-neutral API from @coinzilla/db, with SQLite as the only currently implemented provider.

This document does not authorize:

- replacing Journal or the ADR-0001 Operational State Store;
- restoring Portfolio, RecoveryLedger, OrderRegistry, reservations, or exchange state from SQLite;
- adding synchronous database writes to broker/order/fill critical paths;
- changing TESTNET/LIVE behavior, readiness gates, startup/shutdown ordering, or process locks;
- introducing a new provider, ORM, SQL layer, database dependency, or Harvester business repository in packages/db;
- deleting, rewriting, or silently migrating existing Journal/Operational State Store files.

The first Harvester consumer already exists: process trading-session history merged in [PR #1369](https://github.com/45s/coinzilla/pull/1369). The remaining work is to decide, one concrete use case at a time, whether another projection belongs in SQLite at all.

### ADR-0001 naming

There are two distinct ADR-0001 documents:

1. **Database ADR-0001** — [Provider-neutral record CRUD API](../../../../packages/db/docs/decisions/0001-provider-neutral-record-crud-api.md). This is the primary database architecture reference for #1327.
2. **Harvester ADR-0001** — [Application-owned recovery facts](../architecture/decisions/0001-application-owned-recovery-facts.md). This is a separate safety contract and remains authoritative for its recovery boundary.

Do not conflate the two decisions.

## 2. Verified implementation baseline

### 2.1 Existing database consumer

The current session-history integration is implemented in:

- ../../src/infrastructure/persistence/prepare-trading-session-persistence.js — creates the provider-neutral facade and SQLite provider in the Harvester infrastructure composition.
- ../../src/infrastructure/persistence/resolve-trading-session-database-filename.js — resolves the file from validated TRADING_MODE and the optional base-directory override.
- ../../src/infrastructure/persistence/trading-session-repository.js — implements the narrow repository object using create, readOne, update, and transaction.
- ../../src/infrastructure/persistence/create-trading-session-history-observer.js — queues lifecycle-event projections without awaiting database work in the EventBus handler.
- ../../src/infrastructure/persistence/close-trading-session-persistence.js — drains/closes the observer and database.
- ../../src/domain/trading-session/trading-session.js — owns the session record validation, identity comparison, and lifecycle transition rules.
- ../../src/index.js — owns process composition and startup/shutdown resource ordering.

The repository contract is currently an injected object returned by the infrastructure factory; there is no separate application/ports/trading-session-repository.js file. Keep that seam consistent unless a later concrete consumer justifies a separate port module.

The collection is harvester_trading_sessions. One record represents one process/session UUID. Its versioned JSON record contains validated environment, broker and strategy identity, configuration fingerprint, enabled markets, sanitized build provenance, lifecycle timestamps/status, and bounded non-secret metadata.

The observer records CONFIG_VALIDATED, STARTED, STARTUP_FAILED, and successful STOPPED lifecycle transitions. It is a best-effort history projection. It is not consulted for trading readiness, order recovery, Portfolio restoration, or restart decisions.

### 2.2 Runtime composition behavior

The default main() path prepares session persistence before the trading runtime starts. Database preparation is awaited, but failure is caught, logged with sanitized context, and converted into an unavailable optional history projection; startup continues without it. A successful open adds a small synchronous SQLite workload to the process. The current event observer serializes its own writes and returns synchronously to EventBus callers.

If a custom start adapter is injected into main(), session persistence is not silently enabled; a matching prepareTradingSessionPersistence seam must be supplied explicitly. This is used by tests to avoid shared runtime files.

The observer/database resources are closed during startup-failure cleanup and graceful shutdown. The observer queue is drained before the database connection is closed; process-lock release remains governed by the existing process cleanup rules.

### 2.3 @coinzilla/db API baseline

The accepted [Database ADR-0001](../../../../packages/db/docs/decisions/0001-provider-neutral-record-crud-api.md) defines JSON records in named collections:

- required non-empty string id, unique within a collection;
- create, readOne, readMany, update, and delete;
- exact equality filters on top-level scalar fields;
- top-level sorting, positive limit, non-negative offset, and stable ID tie-breaking;
- explicit null/missing behavior and package-owned DatabaseConflictError;
- provider-neutral lifecycle, transaction, and immutable capability declarations.

createDatabase({ provider }) is the consumer-facing facade. Harvester's outer persistence composition currently selects createSqliteProvider({ filename, timeout }); the repository itself uses only the generic facade. Provider-native SQL, statements, connections, result objects, and native errors remain inside packages/db.

SQLite is the only implemented provider today. PostgreSQL and MongoDB are possible future providers in the ADR, not current capabilities or delivery commitments. The generic record API is not a relational ORM: it has no joins, arbitrary SQL predicates, nested query language, or automatic domain schema validation.

The low-level SQLite public API (createSqliteDatabase) remains available for database-infrastructure operations, including SQLite migrations and backup/restore. Those provider-specific operations are not methods on the provider-neutral CRUD facade. Do not call SQL or node:sqlite from Harvester application/domain code.

## 3. Existing persistence inventory

The table distinguishes durable local stores from in-memory state and external exchange state. Paths below are actual current implementation/documentation locations.

| Component | Purpose and stored shape | Writers / readers / consumers | Lifecycle and consistency | Classification / risk |
|---|---|---|---|---|
| Trading-session history | Generic JSON records in SQLite collection harvester_trading_sessions; one row per runtime session, schema version 1 | Writer: create-trading-session-history-observer.js through trading-session-repository.js. Reader: repository findById; current runtime does not use the data to trade or restore state. | Opened by prepare-trading-session-persistence.js; observer queue drains before DB close. Lifecycle transitions are transactional; duplicate identical session creation is idempotent; conflicting identity reuse is an integrity error. | **SQLite candidate — already integrated.** Low/medium risk; optional history only. Existing data is not an authority for trading/recovery. |
| Journal | Process-scoped append-only JSONL event evidence under logs/sessions/<UTC timestamp>-<runtime session ID>/; includes event envelope and account/order/fill evidence | Writer: prepare-optional-journal.js and the @coinzilla/journal adapter. Readers: Journal history/replay helpers and scripts/reconcile-journal-account-balances.js; operational audit tools consume it. Event publishers include order lifecycle, fills, account audits, and runtime lifecycle. | One writer per process session with a Journal-owned lock; ordered append/flush/close semantics. Required Journal flush barriers precede selected broker/account side effects. The main entry point requires a ready Journal and flush() capability before runtime start. | **Keep as-is.** High risk to change: Journal ordering, acknowledgement, flush, durability, and failure semantics are trading safety contracts. SQLite must not replace or weaken them. |
| Operational State Store (Harvester ADR-0001) | Separate append-only facts.jsonl and manifest.jsonl; global sequence, stable fact identity, committed-head/hash-chain verification, explicit genesis, private permissions | Writer: create-file-operational-state-store.js plus application fact recorders when a store is injected. Readers: prepare-process-operational-state-store.js, offline projection/reconciliation tools, and recovery use cases when enabled. | Acknowledgement follows the store's durable append/manifest protocol. Directory defaults to apps/harvester/recovery-facts/; OPERATIONAL_STATE_DIRECTORY is an absolute local-filesystem override. Directory/files are created by explicit initialization with private permissions; runtime must not create, repair, or silently initialize a missing store. | **Keep as-is / out of #1327 migration.** Very high risk. Any database adapter requires a separate accepted ADR and full parity/recovery proof under [#654](https://github.com/45s/coinzilla/issues/654). |
| Operational State Store default wiring | The store implementation and fact recorders exist, but current config/strategies/cg-coin-grabber.js sets recovery.enabled: false. prepare-process-operational-state-store.js returns no store unless recovery is enabled; Telegram-only control does not create or require one. | Default main() therefore does not construct/verify/inject this store. startHarvester can use an explicitly supplied store; fact recorders are active only when one is supplied. | Restart restoration remains disabled. If a store is supplied and prior process facts are present, startup safety rules apply; no automatic initialization/repair occurs. | **Keep current gate unchanged.** The default runtime must not be described as writing ADR-0001 facts when no store is supplied. |
| Process ownership locks | Exclusive filesystem lock records under ~/.coinzilla/harvester/process-locks/; coordinate broker/environment process ownership, not business history | Writer/reader: acquire-harvester-process-locks.js and its release/recovery helpers; process composition acquires before runtime resources. | Host-local filesystem ownership tokens and conservative stale-owner handling. Current lock identity is broker + TRADING_MODE, not account ID. TESTNET and LIVE can coexist because their identity/path scopes differ. | **Keep as-is.** Not a database repository. Lock scope/account isolation must be revisited with #1339; SQLite WAL is not a cross-host lock. |
| Diagnostic logs | Process/session logs under logs/sessions/...; append-only cumulative diagnostics under logs/cumulative/ | Writer: configure-harvester-logging.js and create-harvester-log-session-paths.js; read by operators and diagnostics. | Process lifecycle and retention are owned by logging/operations. Logs are not transactional business records and may contain diagnostic gaps. | **Keep as-is.** Do not move logs into SQLite or use them as authoritative order/fill history. |
| In-memory trading aggregates | Portfolio, RecoveryLedger, OrderRegistry, order ownership, and current AccountSnapshot objects | Writers/readers are Harvester domain/use cases and runtime services. record-execution-fill.js, order workflows, create-account-snapshot-manager.js, and event publishers update/publish their facts. | Created for the current process and mutated through domain transitions. They are not themselves durable stores and are not restored by the current runtime. | **Not a direct SQLite replacement candidate.** A separate read-only historical projection may be useful; do not persist/restore these aggregates as a side effect of #1327. |
| Historical Journal reporting/import | Existing read-only history scan/projection helpers and journal:balance-audit command | read-harvester-journal-history.js, project-harvester-journal-recovery.js, and scripts/reconcile-journal-account-balances.js read historical records; no SQLite import is currently wired. | Offline/read-only. Source records have per-session positions and may represent incomplete/crashed sessions. | **Candidate for a later offline import/reporting task**, not runtime dual-write. Preserve source files and completeness/uncertainty metadata. |
| Configuration and credentials | ESM config modules, .env / .env.development, environment variables | Read by config/bootstrap; not mutable operational history. | Loaded/validated at process startup. TRADING_MODE explicitly selects TESTNET/LIVE. | **Out of scope.** Do not copy secrets, full environment dumps, raw config, API keys, or tokens into database records. |
| Exchange account/order state | Current remote balances, open orders, order status, and executions held by the exchange | Read through broker adapters and reconciled into current in-memory domain state. | Exchange is the remote authority for current account/order state; availability/freshness and provider semantics vary. | **Out of scope as a local persistence replacement.** A local history projection must retain source/provenance and never masquerade as current exchange state. |

### 3.1 Candidate classification

| Data/use case | Decision | Reason |
|---|---|---|
| Trading sessions | **SQLite — done** | Low-volume lifecycle history with a clear process/session identity and no recovery authority. |
| Orders | **Candidate, read-side only** | Useful for historical queries, but current canonical order state is in-memory and its durable facts are Journal/conditional ADR-0001. Do not make the DB the order-submission or recovery authority. |
| Order lifecycle events | **Keep Journal; investigate DB projection** | Journal already records event history and ordering. A second copy is justified only by a concrete query/reporting requirement that Journal scanning cannot meet. |
| Individual fills | **Candidate, read-side only, after identity prerequisites** | Structured fill queries are useful, but fill IDs are not globally unique across providers/accounts and exact financial values/provenance must be retained. Do not add a blocking database write to fill application. |
| Account snapshots/open-order audits | **Candidate for history, not current state** | Useful for comparing PREFLIGHT/RECOVERY/CLOSING history. Snapshots are filtered to configured market assets and known commission assets; they are not a complete inventory of every unrelated wallet asset. Open-order audits are a distinct dataset. |
| Operational State Store | **Keep; separate #654 decision** | Hash-chain, durable acknowledgement, sequence, integrity, genesis, and recovery guarantees are stronger/different than ordinary CRUD. |
| Journal | **Keep** | Existing event evidence and durability barriers must remain independent. |
| Process locks and logs | **Keep** | Coordination and diagnostics are not business repositories. |
| Historical import/reporting | **Investigate as an offline task** | Can produce searchable history without replacing the source evidence; completeness must be explicit. |
| Portfolio/RecoveryLedger/OrderRegistry runtime state | **Out of scope** | Runtime aggregates are not equivalent to historical records and must not be hydrated from this DB. |

No repository-level evidence justifies moving every persisted artifact to SQLite.

## 4. Target architecture and ownership

The required dependency direction is:

```text
Harvester application services
          |
          v
Harvester-owned repository contracts / ports
          |
          v
Harvester persistence adapters and mappers
          |
          v
@coinzilla/db public provider-neutral API
          |
          v
Selected provider adapter (SQLite today)
          |
          v
node:sqlite / SQLite infrastructure inside packages/db
```

### Layer responsibilities

| Layer | Owns | Must not own |
|---|---|---|
| Harvester domain | Canonical order/fill/snapshot/session models, validation, immutable identity, state transition rules, decimal semantics | SQL, SQLite types, DB provider errors, file paths |
| Harvester application | Repository port contracts, use-case orchestration, transaction intent, read/write policy, error translation boundary | SQLite provider selection, SQL, connection lifecycle |
| Harvester persistence infrastructure | Repository implementations, mapping, record schema versions, idempotency keys, projection queue, import/export workflows, backup scheduling/runbooks | Generic DB CRUD framework, direct node:sqlite |
| Harvester composition root | Validates environment/config, resolves paths, selects provider, opens DB, runs approved setup, constructs repositories, injects dependencies, closes resources | Business rules or SQL |
| packages/db | Generic record CRUD/query, provider lifecycle/capabilities/transactions, SQLite adapter, generic SQLite migrations and backup/restore primitives, conformance suite | Harvester models, order/fill/account repositories, trading policy |

The current session integration is the working example. Keep provider-specific selection in the outer infrastructure composition; application/domain services depend only on Harvester repository contracts. Do not add a dependency-injection framework for this.

### Composition outline

```js
const persistence = await prepareHarvesterPersistence({
  config: appConfig,
  environment: validatedTradingMode,
})

const services = createHarvesterServices({
  orderHistoryRepository: persistence.repositories.orderHistory,
  fillHistoryRepository: persistence.repositories.fillHistory,
  accountSnapshotHistoryRepository: persistence.repositories.accountSnapshotHistory,
})

try {
  await startHarvester({ services })
} finally {
  await persistence.close()
}
```

This is a target shape, not an existing function or approved code change. The real composition should follow the current main() and prepareTradingSessionPersistence conventions.

Initialization order:

1. Load and validate the named appConfig and explicit TRADING_MODE.
2. Resolve the mode-specific DB directory/file and validate path isolation.
3. Acquire the existing process ownership lock before opening resources that assume single-process ownership.
4. Open the selected provider through createDatabase({ provider }).
5. Run only the migrations/setup explicitly required by that provider adapter and the deployed record version.
6. Construct Harvester repositories and observers.
7. Inject them into application services.
8. Start Journal/runtime and normal functionality without adding new trading gates for optional reporting projections.
9. During shutdown, stop accepting new runtime work, drain EventBus deliveries, drain/close each projection observer, close the database, then release process ownership according to the existing cleanup contract.

On partial startup failure, close every resource already acquired. Never leave an opened DB connection or observer behind because Journal startup, service construction, or a later initialization step failed.

## 5. Repository contracts for actual candidates

These are proposed Harvester-owned contracts. They are not implemented by this task. Each contract must be introduced only with its corresponding independently reviewable vertical slice.

### 5.1 Existing TradingSessionRepository

Current contract:

```js
{
  create(record),
  findById(runtimeSessionId),
  transition({ id, status, endedAt }),
}
```

- Domain validation and allowed lifecycle transitions live in domain/trading-session/trading-session.js.
- Infrastructure maps to harvester_trading_sessions.
- Same ID + same immutable identity is idempotent; same ID + conflicting immutable facts is an integrity error.
- Lifecycle read/validate/update is one DB transaction.
- The SQLite callback is synchronous; the adapter branches on the provider's declared transaction callback mode.
- Database errors are translated at the repository/observer boundary; provider-native errors must not escape into domain/application code.

### 5.2 Order history projection

Name the future contract OrderHistoryRepository, not OrderRegistryRepository, to make the read-side/non-authoritative boundary explicit.

Proposed methods:

```js
{
  recordIntent({ order, ownership, provenance, sourceEventId }),
  recordUpdate({ order, ownership, provenance, sourceEventId }),
  findByIdentity({ providerInstanceId, accountId, clientOrderId }),
  list({ providerInstanceId, accountId, marketId, status, from, to, limit, offset }),
}
```

The serialized order value must be mapped from the actual CanonicalOrder.value contract: clientOrderId, optional brokerOrderId, market, side, type, optional limitPrice, originalQuantity, executedQuantity, remainingQuantity, status, and optional lifecycle timestamps. Preserve Money/Quantity decimal strings; never convert financial amounts to JavaScript floating-point values.

Ownership is a separate Harvester concept. Preserve the actual strategy/position/cycle/purpose attribution when present; do not fabricate it from symbol or client-order-ID patterns.

**Identity prerequisite:** current CanonicalOrder does not contain provider-instance/account identity. The accepted multi-provider migration work (#1339) must establish immutable provider/account provenance before broker I/O. The current BINANCE_PROVIDER_INSTANCE_ID and BINANCE_ACCOUNT_ID are non-secret labels, but the current session record/path and canonical order model are not yet a complete multi-account persistence contract. Do not begin this repository before the #1339 provenance decision and schema are merged.

Example proposed record (fields marked as provenance are prerequisites, not current CanonicalOrder fields):

```json
{
  "id": "provider-instance/account-id/client-order-id",
  "schemaVersion": 1,
  "recordKind": "order-history",
  "providerInstanceId": "binanceTestnet",
  "providerType": "binance",
  "accountId": "binance-primary",
  "clientOrderId": "h-BTCUSDT-001",
  "brokerOrderId": "exchange-order-id",
  "market": {
    "id": "binance:BTCUSDT",
    "venue": "binance",
    "symbol": "BTCUSDT",
    "baseAsset": { "id": "BTC", "code": "BTC" },
    "quoteAsset": { "id": "USDT", "code": "USDT" }
  },
  "side": "BUY",
  "type": "LIMIT",
  "limitPrice": { "amount": "65000.00", "asset": { "id": "USDT", "code": "USDT" } },
  "originalQuantity": { "amount": "0.001", "asset": { "id": "BTC", "code": "BTC" } },
  "executedQuantity": { "amount": "0.0004", "asset": { "id": "BTC", "code": "BTC" } },
  "remainingQuantity": { "amount": "0.0006", "asset": { "id": "BTC", "code": "BTC" } },
  "status": "PARTIALLY_FILLED",
  "createdAt": 1795000000000,
  "updatedAt": 1795000001000,
  "sourceEventId": "event-uuid",
  "runtimeSessionId": "runtime-session-uuid"
}
```

The ID format above is illustrative. A production key must be deterministic, collision-safe, normalized, and tested; use a stable encoding or hash of the complete identity tuple rather than naïve delimiter concatenation.

Do not use this repository to authorize order submission, infer an unknown broker outcome, adopt external orders, or restore OrderRegistry after restart.

### 5.3 Order event history

Journal already records ordered process events. Do not duplicate its entire stream in SQLite by default.

Only if a concrete indexed-query/reporting use case justifies a second projection, introduce an append-only OrderEventHistoryRepository:

```js
{
  append({ event, sourcePosition, provenance }),
  listForOrder({ orderIdentity, limit, offset }),
  listForSession({ runtimeSessionId, from, to, limit, offset }),
}
```

Preserve the existing event envelope (id, timestamp, source, name, data) and a stable source position (Journal file/session plus record position, or a verified source sequence). Timestamp alone is not a total ordering guarantee. Do not rewrite or compact the source Journal.

### 5.4 Execution/fill history

Proposed ExecutionHistoryRepository:

```js
{
  append({ fill, provenance, sourceEventId, runtimeSessionId }),
  findByIdentity({ providerInstanceId, accountId, marketId, tradeId }),
  listByOrder({ orderIdentity, limit, offset }),
  list({ providerInstanceId, accountId, marketId, from, to, limit, offset }),
}
```

Map the actual Fill value, including market, trade/execution identity, order/client identity, side, exact price/quantity/quote quantity, execution timestamp, liquidity role, commission entries and commission status where present. Preserve each amount as its canonical decimal string and each commission asset identity. Do not reconstruct individual fills from terminal order status.

**Identity prerequisite:** current fill identity includes market/trade identity, which is not proven globally unique across provider instances and accounts. Scope it with the immutable #1339 provider/account provenance. Bitunix Spot remains read-only/not Harvester-ready under [#1185](https://github.com/45s/coinzilla/issues/1185); its current matching-detail endpoint does not establish canonical fill denomination, stable execution ID, or complete partial-fill history. Do not claim provider-neutral fill completeness until each provider proves its fill contract.

The actual `Fill.value` shape is:

```json
{
  "id": "binance:BTCUSDT:trade-123",
  "tradeId": "trade-123",
  "brokerOrderId": "exchange-order-id",
  "clientOrderId": "h-BTCUSDT-001",
  "market": {
    "id": "binance:BTCUSDT",
    "venue": "binance",
    "symbol": "BTCUSDT",
    "baseAsset": { "id": "BTC", "code": "BTC" },
    "quoteAsset": { "id": "USDT", "code": "USDT" }
  },
  "side": "BUY",
  "price": { "amount": "65000.00", "asset": { "id": "USDT", "code": "USDT" } },
  "quantity": { "amount": "0.0004", "asset": { "id": "BTC", "code": "BTC" } },
  "quoteQuantity": { "amount": "26.00", "asset": { "id": "USDT", "code": "USDT" } },
  "liquidityRole": "MAKER",
  "executedAt": 1795000001000,
  "commissions": [],
  "commissionStatus": "COMPLETE"
}
```

The domain-generated `Fill.id` is market ID plus trade ID (for example, `binance:BTCUSDT:trade-123`); that does not include provider-instance/account identity. The repository key therefore needs the full provenance tuple in addition to the canonical fill value.

Never synchronously write to SQLite from the fill-application path before Portfolio/RecoveryLedger accounting. A history projection must be non-authoritative, queue/observe published evidence, expose write failures/gaps, and be repairable from verified source evidence. The SQLite write still blocks the Node event loop while executing; batching/worker isolation must be based on measured throughput and latency, not assumed.

### 5.5 Account snapshot history

Proposed AccountSnapshotHistoryRepository:

```js
{
  append({ snapshot, phase, auditStatus, auditReasons, sourceEventId, provenance }),
  listBySession({ runtimeSessionId, phase, limit, offset }),
  list({ providerInstanceId, accountId, from, to, limit, offset }),
}
```

Use the existing account-snapshot/event DTO rather than serializing private class internals. Preserve exchange sourceTime, local event timestamp, phase (PREFLIGHT, RECOVERY, CLOSING, or targeted COMMISSION_BASELINE), balances, audit status/reasons, source event identity, and provider/account/session provenance when available. Keep account-wide open-order audit records separate from balance snapshots.

The published snapshot DTO is explicitly mapped and allowlisted. Its balance event contains `phase`, `auditStatus`, `sourceTime`, `assetCount`, sorted `balances` rows (`asset`, `free`, `locked`, `total`), and `auditReasons`. The separate open-order audit DTO contains `phase`, `observedAt`, `readiness`, `orderCount`, normalized `orders`, and `blockReasons`. `AccountSnapshot.value` itself contains only `sourceTime` and `balances`; its private reconciliation-baseline maps are not part of that value. Do not silently add those private maps to the history schema.

Important limitation: current account audits intentionally include configured market base/quote assets and known commission assets, not every unrelated wallet asset. Label them as filtered strategy/account evidence; never report them as a complete wallet inventory.

### 5.6 Validation, errors and transactions

- Harvester domain owns validation, canonical decimal rules, immutable identity, lifecycle transitions, and record schema versions.
- Repository adapters validate JSON-safe records before calling the generic API; @coinzilla/db validates generic record/query contracts, not Harvester business schemas.
- Translate DatabaseConflictError into an idempotent duplicate only after comparing immutable business identity. Conflicting identity reuse is an integrity failure.
- Map missing records to the explicit repository contract (null for lookup; a Harvester-owned not-found error for a required transition).
- Wrap provider/closed/locked/storage failures in a Harvester-owned persistence error at the infrastructure boundary, preserving cause and bounded safe context. Never expose SQL, file paths containing secrets, or native driver messages to domain code.
- Use a transaction only when a business projection requires atomic multi-record consistency (for example, update one order projection and append its corresponding event together). Do not wrap independent reads/writes in unnecessary transactions.
- SQLite transaction callbacks are synchronous. Perform validation/mapping before entering the callback; never await, perform network I/O, schedule timers, or call unrelated async services inside a SQLite transaction. The repository must honor the provider's declared callback mode as the current session adapter does.
- Do not attempt a cross-store transaction between SQLite, Journal, and the Operational State Store. They have separate ownership and durability protocols.

## 6. Configuration and TESTNET/LIVE isolation

### 6.1 Existing contract

The current names are already established in apps/harvester/.env.example:

- TRADING_MODE=testnet selects Binance Spot TESTNET.
- TRADING_MODE=live selects Binance Spot LIVE (REAL account).
- NODE_ENV does not select exchange environment or database file.
- HARVESTER_DATABASE_DIRECTORY is an optional absolute base-directory override.
- OPERATIONAL_STATE_DIRECTORY is a separate setting for the ADR-0001 file store; it must not be reused as a database path.

Current default database files:

| TRADING_MODE | Directory | File |
|---|---|---|
| live | apps/harvester/data/production/ | harvester.db |
| testnet | apps/harvester/data/testnet/ | harvester.db |

The resolver is anchored to the Harvester package/source location, not the shell working directory. It creates both environment child directories, canonicalizes them, and rejects root/relative overrides, overlapping directories, directory aliases, database-file symlinks, and production/Testnet hard-linked files.

### 6.2 Recommended deployment configuration

Use an explicit stable local-filesystem directory for production rather than relying on a release/worktree-local default:

```bash
# .env.development — Binance Spot TESTNET
TRADING_MODE=testnet
HARVESTER_DATABASE_DIRECTORY=/var/lib/coinzilla/harvester

# .env — Binance Spot LIVE / REAL account
TRADING_MODE=live
HARVESTER_DATABASE_DIRECTORY=/var/lib/coinzilla/harvester
```

With the same base directory, the resolver still selects separate testnet/ and production/ child directories. Separate base directories are also valid when deployment ownership requires them. The application must log the resolved environment and a sanitized path identity, never credentials.

The current runtime does not require an explicit production override; without one it creates the package-local apps/harvester/data/production/harvester.db. For a durable production deployment, an explicit absolute path on a persistent local volume should be a deployment acceptance requirement. If the product later requires startup to reject a missing production override, that is a separate behavior-changing config task, not this preparation task.

### 6.3 Permissions and collisions

- The current path resolver validates path shape and TESTNET/LIVE aliasing; it does not implement a portable filesystem-mount detector for NFS/SMB.
- The current database-directory creation relies on OS defaults/umask; it does not enforce the Operational State Store's explicit 0700 directory / 0600 file policy. Production deployment must use a dedicated service account and restrictive owner-only permissions. Verify effective permissions in the deployment test; do not claim the application currently enforces them.
- Never place the DB on NFS/SMB or a shared network volume.
- Keep the database directory outside source-controlled worktrees where practical; database files are Git-ignored.
- Current DB paths are environment-scoped, not provider/account-scoped. Current process locks are broker + trading mode, not account ID. Two accounts/providers in the same trading mode must not be assumed isolated. #1339 must decide stable provider/account record identity, lock scope, and whether the DB remains one environment-scoped file or is partitioned by provider/account before multi-account operation is enabled.
- Same-mode multiple Harvester processes are not a supported deployment pattern. The process lock prevents the current broker/mode duplicate on one host; SQLite's lock timeout is not a substitute for application ownership. A maintenance/backup process must coordinate with the running instance.

## 7. SQLite operational constraints and integration impact

| Constraint | Verified package behavior | Harvester consequence |
|---|---|---|
| Node version | Harvester and @coinzilla/db require Node.js 24+; SQLite uses built-in node:sqlite. | Do not add a third-party driver/ORM. Keep CI and production Node versions aligned. |
| Synchronous operations | SQLite is backed by DatabaseSync; provider operations execute synchronously. | Every SQLite read/write/transaction blocks the Harvester event loop for its execution time. The session projection is low-volume; orders/fills may not be. Measure p95/p99 write duration and event-loop delay before high-volume adoption. |
| Single writer | SQLite serializes write transactions. The provider uses an immediate write reservation; WAL allows readers while a writer is active, not concurrent writers. | Keep one Harvester writer per DB file. Batch related projection writes in a single short transaction. Never treat the DB as an unlimited concurrent-write service. |
| WAL locality | WAL requires same-host local filesystem coordination and is not supported as a multi-host NFS/SMB shared database. | DB file, -wal, and -shm must remain on a supported local filesystem. No shared network path or cross-host access. |
| Lock timeout | Harvester currently configures a 5,000 ms SQLite busy timeout. | Contention can delay startup/write work up to the configured timeout and then surface as a provider error. Do not silently retry indefinitely. |
| Query contract | Generic API supports top-level scalar equality, sorting, limit/offset and stable ID tie-breaks; JSON records are stored in the SQLite record table. | Design stable IDs and top-level query fields. Do not assume joins, nested predicates, or secondary indexes. Measure before proposing generic DB changes. |
| Transaction callbacks | SQLite callbacks are synchronous and reject async callbacks. | No await inside transactions. Keep transactions short and deterministic. |
| Migrations | The low-level SQLite public API has immutable, synchronous migration support. The provider-neutral CRUD facade does not expose a generic migration method. | Current session records use application schemaVersion and generic JSON records; there is no Harvester SQL migration. For record-shape changes, use Harvester-owned versioned mappers/data transformations. Any physical SQLite migration must stay behind a DB-owned/public provider adapter; do not add SQL to Harvester. |
| Backup | The DB package exposes WAL-aware SQLite backup primitives, including integrity checks and atomic publication. | Harvester owns backup schedules, destination policy, retention, encryption, offsite copy, monitoring and runbooks. A future Harvester BackupPort may be implemented by a provider-specific infrastructure adapter that calls only exported `@coinzilla/db` backup/restore operations; application/domain services must depend on the Harvester port, not `createSqliteDatabase`, SQL, or driver objects. The current Harvester integration does not schedule or invoke backups. |
| Restore | restoreSqliteDatabase publishes to a new destination and requires hard-link support; it does not overwrite an existing destination. | Stop all users of the target DB, restore to a new/staged path, verify, then perform a controlled path switch. Test hard-link support on the actual deployment filesystem. |
| Close | DB lifecycle waits for active transactions/backups before closing. | Drain observers and outstanding persistence operations before closing; do not release the process lock while DB resources remain active. |

### 7.1 Migration API distinction

The public provider-neutral facade is intentionally smaller than the low-level SQLite API:

- createDatabase({ provider }) is the portable consumer CRUD/transaction/lifecycle boundary.
- createSqliteDatabase(...) is the SQLite-specific infrastructure API and retains SQL/migration/backup primitives.

There is no demonstrated need to add a provider-neutral schema migration API for the current generic JSON-record consumer. Do not add one speculatively. If a future Harvester slice needs physical schema migration or backup under multiple providers, record the concrete use case and provider capability requirements first.

### 7.2 Performance and reliability measurements required

Before orders/fills are added, measure with realistic record sizes and event rates:

- SQLite operation and transaction duration (p50/p95/p99);
- event-loop delay while writes and batch imports execute;
- queue depth, oldest pending projection age, dropped/failed write count;
- WAL growth/checkpoint behavior and disk consumption;
- write-lock wait/busy failures with a second reader/maintenance connection;
- process termination with queued/uncommitted work;
- recovery/import time for a realistic Journal history volume.

A passing CRUD test is not evidence that a high-volume fill projection is safe on the trading event loop.

## 8. Lifecycle, transactions and failure policy

### 8.1 Intended lifecycle

1. Load and validate appConfig, TRADING_MODE, and database override.
2. Resolve the environment-specific path and reject unsafe aliases/collisions.
3. Acquire the existing process ownership lock.
4. Open the provider-neutral DB facade using the selected provider.
5. Run only required migrations/setup under controlled ownership.
6. Construct repositories and read-side observers.
7. Inject repository contracts into application services.
8. Start normal functionality; optional history must not add a trading-readiness gate.
9. On shutdown, stop new work and stop the runtime.
10. Drain EventBus deliveries and projection queues; finish or reject outstanding DB operations.
11. Close observer resources and the DB connection.
12. Release process locks only after the existing cleanup contract permits it.

### 8.2 Preventing lifecycle hazards

- **Access before initialization:** do not publish repositories until connect() and required setup complete. The composition object should expose no repository when preparation failed.
- **Use after closure:** close observers first, then the DB. Repositories must surface the provider's closed-state error through a Harvester-owned error boundary.
- **Partial startup:** every successfully acquired resource is registered for cleanup immediately. A later Journal/runtime failure must close the DB/observer.
- **Shutdown failures:** aggregate cleanup errors without masking the original runtime failure. Keep the existing process-lock retention/release safety rules.
- **Concurrent migration races:** acquire process ownership before migration. SQLite busy timeout alone is not a migration coordination protocol. Any external maintenance command needs an explicit maintenance lock and a documented stop/online-backup policy.
- **Inconsistent multi-record projection:** use one short provider-neutral transaction when two or more records represent one projection transition. Do not make an unrelated DB write part of broker/Portfolio/Journal atomicity.
- **Unbounded queue:** define a bounded queue/backpressure policy, observable failure counters, and an explicit drop/retry/rebuild decision before high-volume event projections are implemented.

### 8.3 Current versus future failure behavior

Current session history is explicitly optional: DB preparation or projection failure is logged and isolated; it does not prevent trading. This is acceptable only because the record is non-authoritative session history.

Future repositories must state their failure policy per use case:

- Reporting/read-side projection: fail soft, expose missing/gapped history, and provide a repair/import path.
- Any future authoritative operational record: fail closed at its owning application boundary and require a separate accepted ADR; it cannot inherit the session observer's best-effort policy.
- Never silently switch providers, paths, databases, Journal, or Operational State Store after an error.
- Never mark a projection complete when its source sequence or import coverage is unknown.

## 9. Gradual migration and delivery plan

Each phase is independently reviewable. No phase deletes or replaces its source evidence.

| Phase | Scope and changes | Dependencies / data migration | Tests and acceptance | Rollback |
|---|---|---|---|---|
| 0 — Blueprint (this task) | Inventory, ownership, contracts, path/operations constraints, migration/test plan, issue/roadmap synchronization. No runtime changes. | Source audit only. | Docs links/policy checks pass; source baseline and unresolved decisions recorded. | Revert documentation commit. |
| 1 — Trading sessions (complete) | harvester_trading_sessions repository and best-effort lifecycle observer via @coinzilla/db. | No legacy session-store import; new rows are written after integration. Existing Journal/ADR-0001 files untouched. | Merged [PR #1369](https://github.com/45s/coinzilla/pull/1369); exact PR head passed 32 Actions checks. Optional read-only Binance TESTNET integration was skipped; this is not production deployment evidence. | Disable/omit the optional session persistence preparer; retain DB file for later inspection. Do not delete it automatically. |
| 2 — Order history projection | Add an order-history repository and mapper only for structured historical inspection; keep OrderRegistry/in-memory state authoritative. | Blocked on #1339 immutable provider/account provenance before broker I/O and account-scoped identity decision. Existing Journal/conditional ADR-0001 facts remain source evidence; no destructive import. | Domain mapping, idempotent identity, duplicate/conflict, lifecycle update, exact decimal, transaction rollback, source-event linkage, and restart/reopen tests. Prove DB failure cannot block order submission/readiness. | Disable the observer/repository wiring; keep original Journal and Operational State Store. Preserve any partial projection for audit. |
| 3 — Order-event query projection (conditional) | Add a separate append-only query projection only if Journal scan/reporting cannot satisfy a measured query need. | Requires stable source event identity/position and #1339 provider/account provenance where order identity is involved. No bulk copy by default. | Event ordering, duplicate delivery, per-session/order query, gap detection, crash tail, and source reconciliation tests. | Stop projection; Journal remains authoritative evidence. |
| 4 — Fill history projection | Add idempotent individual-fill records for analytics/reporting; never use as the Portfolio/recovery source. | Requires #1339 provenance and a proven provider fill identity/denomination/completeness contract. Binance first; Bitunix remains blocked by #1185. No float conversion. | Duplicate fill, partial fills, commission asset/amount, exact decimals, order linkage, provider/account scoping, queue failure, process crash, and source reconciliation tests. | Disable projection; rebuild from verified source evidence where complete. Never rewrite source fills. |
| 5 — Account snapshot history | Store explicitly phased balance and open-order audit snapshots as historical evidence. | Requires provider/account provenance and an explicit statement that filtered asset snapshots are not full wallet inventory. No migration of current in-memory state. | Phase ordering, exchange source timestamp, filtered asset coverage, open-order snapshot separation, duplicate snapshot, and session linkage tests. | Disable projection; retain Journal/account-audit evidence. |
| 6 — Historical import/reporting | Offline idempotent importer from verified Journal sessions and, only when present, verified Operational State Store facts. | Inventory deployed files first. Preserve originals; import metadata includes source path identity, file digest, record position, source session, import batch, warnings and completeness. | Repeatable import, counts/digests, duplicate/conflict, malformed/torn tail, resource limits, incomplete-session labeling, and no-source-mutation tests. | Delete/ignore only the newly generated projection after an explicit verified backup; source files are never modified or deleted. |
| 7 — Operational readiness | Backup scheduling, retention, permissions, disk monitoring, corruption/disk-full handling, restore drill, and production deployment runbook. | Requires stable local persistent volume, owner-only permissions, restore destination hard-link support, and a named operational owner. | Restore to a new path, integrity check, compare record counts/digests, verify application compatibility, and prove rollback to prior DB/source. | Stop DB projection and return to existing source evidence; do not remove backups or source files. |

### Explicit separate workstream: Operational State Store migration

A database-backed ADR-0001 adapter is not Phase 2–7. It is a separate gated architecture change coordinated with [#654](https://github.com/45s/coinzilla/issues/654). It requires an accepted/superseding Harvester ADR and proof of durable acknowledgement, sequence/hash-chain integrity, torn-write/crash behavior, explicit genesis, corruption handling, disk-full behavior, backup/restore, process ownership, full projection parity, and rollback. No dual-write or automatic fallback is permitted.

## 10. Testing strategy

Reuse the @coinzilla/db provider conformance suite for generic CRUD/provider behavior. Harvester tests must focus on domain mapping, repository semantics, application lifecycle, and environment isolation; do not copy generic database tests into Harvester.

### Existing evidence

- ../../src/domain/trading-session/trading-session.test.js — session schema/identity/transition rules.
- ../../src/infrastructure/persistence/trading-session-repository.test.js — repository idempotency, conflict mapping, and transaction behavior.
- ../../src/index.test.js — process composition, optional persistence, startup failure and cleanup behavior.
- The Harvester persistence suite includes real child-process isolation checks for TESTNET/LIVE database paths; preserve and extend these rather than replacing them with mocks.
- packages/db/README.md and package tests cover generic CRUD/conformance, transactions, reconnect, lock handling, and SQLite backup/restore behavior.

### Required tests for future repository slices

**Repository/unit**
- create/read/update/delete only where the repository contract needs them;
- domain-to-record and record-to-domain mapping;
- invalid and missing fields, schema-version validation, unknown values;
- missing record and duplicate ID;
- identical duplicate delivery is idempotent; conflicting identity reuse fails;
- exact decimal strings, fee assets, timestamps and provider/account provenance;
- filtering/sorting/pagination within the generic query contract;
- error translation with original cause preserved and no provider-native error leakage.

**SQLite integration**
- actual file-backed SQLite repository, close/reopen persistence, multiple connections;
- multi-record transaction commit and rollback;
- lock contention and configured timeout;
- idempotent retry after uncertain projection result;
- migration/version behavior where a real migration exists;
- backup/restore through the public DB API, including WAL data and hard-link failure;
- realistic load and event-loop-delay measurement.

**Lifecycle**
- provider open failure and migration/setup failure;
- partial startup cleanup after DB open;
- observer failure and queue drain;
- shutdown while writes are pending;
- repeated shutdown and close failure;
- access after close;
- original runtime failure is not masked by cleanup failure;
- process lock remains held until DB cleanup is complete.

**Isolation and process behavior**
- TESTNET and LIVE use distinct files even when NODE_ENV values are deliberately inverted;
- explicit override, invalid relative/root paths, symlink/alias/hard-link collision;
- tests never open production defaults;
- same-mode duplicate Harvester process is rejected by the process lock;
- separate process handles obey SQLite writer/reader and busy-timeout behavior;
- unsupported NFS/SMB deployments are rejected by deployment policy (the current path resolver cannot portably detect every network mount).

**Import**
- deterministic source file discovery and resource limits;
- record/file digests and source positions;
- malformed/truncated tail handling;
- incomplete/crashed sessions are labeled incomplete, not silently certified;
- rerunning the importer does not duplicate records;
- import never modifies Journal or Operational State Store source files.

## 11. Backup, restore, retention and operations

packages/db owns generic SQLite backup/restore primitives. Harvester owns the policy and operational workflow.

Before any production domain history is added, define:

- backup frequency and maximum acceptable data-loss window;
- retention and disk budget;
- encryption at rest/in transit and access control;
- off-host/offsite copy policy (the live DB itself remains local/same-host);
- backup verification and integrity-check schedule;
- restore operator, recovery-time objective, and restore drill frequency;
- migration compatibility between backup version and deployed Harvester version;
- disk-full, permission, corruption, busy-timeout and shutdown-failure alerting.

Use the DB package backup API, not a raw copy of the main .db file while WAL is active. Restore to a new destination; stop every process using the target; verify integrity and record counts/digests; then switch the configured path in a controlled deployment. Restore publication requires hard-link support and does not overwrite an existing destination.

Current Harvester session persistence has no backup schedule, retention job, encryption/offsite workflow, or restore runbook. This task must not claim those operations are production-ready.

## 12. Risks and unresolved decisions

| Risk / decision | Evidence | Required resolution |
|---|---|---|
| Provider/account identity not yet immutable in canonical order/fill provenance | #1339 Phase 2/3 is not complete; current lock/path is broker + trading mode | Block order/fill repositories until #1339 defines and persists provider-instance/account identity before broker I/O. |
| DB path is environment-scoped, not account-scoped | resolve-trading-session-database-filename.js uses TRADING_MODE; account ID is not a path component | #1339 must decide shared environment DB with scoped records versus provider/account-partitioned files. |
| Event/fill duplication and loss | Journal already stores events; observer DB writes are best-effort and SQLite blocks the event loop | Add only a measured read-side projection, with queue metrics, source watermarks, gap detection and repair/import. Never make it a trading barrier. |
| Journal/ADR-0001 default status is easy to misstate | Current recovery.enabled is false; the default main path does not construct the Operational State Store; Telegram-only control does not create it | Keep docs explicit: Journal remains active; ADR-0001 store is conditional/injected; restart restoration stays disabled. |
| SQLite synchronous write latency | DatabaseSync runs on the main thread | Measure realistic event rates before fills; batch only when atomicity requires; consider worker isolation only if measurements justify it. |
| Single-writer and network filesystem limits | SQLite WAL and 5s busy timeout | One writer per local DB file on one host; no NFS/SMB/shared multi-host DB. |
| File permissions not explicitly enforced by current DB path helper | Resolver creates/canonicalizes directories but does not chmod to private modes | Production deployment must enforce restrictive ownership/permissions; decide whether a later code hardening task is required. |
| Production default is package-local | No explicit override is required by current runtime | Deployment must set a stable absolute persistent path; a fail-closed live-mode requirement would be a separate behavior change. |
| No provider-neutral migration/backup facade | Generic CRUD facade is distinct from SQLite-specific low-level migration/backup API | No DB change now. Add only after a concrete non-SQLite consumer requirement exists. |
| Existing runtime files are not visible in source review | data/, logs/, and recovery-facts/ are private runtime directories and Git-ignored | Inventory and back up deployed files before any import or cutover; do not infer their presence/absence from the repository. |
| Account snapshots are filtered | Current audit includes configured market base/quote and known commission assets, not every unrelated wallet asset | Preserve coverage metadata; do not label as a complete wallet snapshot. |
| Bitunix fill contract remains incomplete | #1185 remains read-only/not Harvester-ready; matching-detail API lacks denomination/completeness/stable identity guarantees | Do not claim provider-neutral fill persistence until the provider's canonical fill contract is accepted. |

## 13. Production acceptance boundary

This blueprint and the merged session-history slice do not make Harvester's database production-ready.

Before any persistent orders/fills/snapshot deployment, require all of the following on the exact PR head:

- source-derived repository schema and ownership contract;
- provider/account provenance and collision-safe identities;
- environment/account file isolation and real process tests;
- realistic event-loop and write-load measurements;
- transaction/rollback/restart/queue-gap proof;
- source import count/digest and completeness verification where historical data is imported;
- backup/restore drill on the actual deployment filesystem;
- owner-only permissions, stable local volume, disk monitoring and operational runbook;
- successful required CI and explicit review of any skipped integration checks;
- confirmation that Journal/ADR-0001/trading behavior is unchanged.

Do not use "SQLite is available" or "the tests pass" as a production-readiness claim.

## 14. Recommended next implementation task

Do not start order/fill repositories immediately. The next task should be a **Harvester persistence contract alignment with #1339 provider/account provenance**:

1. finish the #1339 source-of-truth decision for provider-instance/account identity and immutable order provenance before broker I/O;
2. decide whether one environment DB can safely contain multiple account partitions or whether file paths must be provider/account-scoped;
3. update the proposed order/fill/session record identities and migration compatibility;
4. then implement one read-only OrderHistoryRepository vertical slice, sourced from already-published evidence, with no change to broker submission, Journal barriers, Operational State Store behavior, or restart restoration.

The order-event SQLite projection remains conditional on a demonstrated query need; Journal already owns the ordered event evidence. Fills follow only after canonical provider fill identity/denomination/completeness is proven. Operational State Store migration remains separately gated by #654.

## 15. Source references

- [Database ADR-0001 — Provider-neutral record CRUD API](../../../../packages/db/docs/decisions/0001-provider-neutral-record-crud-api.md)
- [Database package README](../../../../packages/db/README.md)
- [Database package roadmap](../../../../packages/db/ROADMAP.md)
- [Harvester ADR-0001 — Application-owned recovery facts](../architecture/decisions/0001-application-owned-recovery-facts.md)
- [Harvester persistence entry point / current session contract](README.md)
- [Harvester roadmap](../../ROADMAP.md#persistence--provider-agnostic-database-integration-1327)
- [Harvester documentation index](../README.md)
- [Multi-provider ADR-0003](../../../../docs/architecture/decisions/ADR-0003-multi-provider-routing.md)
- [Multi-provider migration plan](../../../../docs/architecture/multi-provider-migration-plan.md)
- [Journal package README](../../../../packages/journal/README.md)
- [Journal Operations](../JOURNAL_OPERATIONS.md)
- [Journal Evidence Contract](../JOURNAL_EVIDENCE_CONTRACT.md)
- [Trading First](../TRADING_FIRST.md)
- [Harvester .env.example](../../.env.example)
- [Issue #1327](https://github.com/45s/coinzilla/issues/1327)
- [Issue #1339](https://github.com/45s/coinzilla/issues/1339)
- [Issue #654](https://github.com/45s/coinzilla/issues/654)
