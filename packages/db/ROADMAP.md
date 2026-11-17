# Database roadmap

---
status: active
type: roadmap
owner: db
---

## Current priority — first real consumer: Harvester (#1327)

**Goal:** make Harvester persistence provider-agnostic through domain-owned repository ports, using `@coinzilla/db` as shared database infrastructure and Node.js built-in SQLite as the first provider.

The SQLite lifecycle/transaction/migration foundation is already implemented. The missing proof is a real application-owned persistence workflow. Do not add generic repositories or expand the database package around hypothetical consumers.

### Architecture contract

- `packages/db` owns provider-neutral database lifecycle, transaction/resource coordination, and provider infrastructure mechanics. It currently supplies the built-in SQLite adapter and migration runner.
- Harvester owns its business persistence contracts: repository ports, data meaning, schema definitions, mapping, idempotency rules, and application transaction boundaries.
- Harvester domain and application policy depend only on Harvester-owned ports and domain contracts. They must not import `node:sqlite`, SQL, SQLite statement/connection types, or concrete provider adapters.
- Provider-specific wiring belongs only at the outer composition root/infrastructure bootstrap. No strategy, use case, domain entity, or application service may branch on provider identity.
- SQLite repositories and SQL migrations belong to Harvester infrastructure; the generic migration runner and SQLite connection/transaction mechanics remain in `@coinzilla/db`.
- Do not invent a universal SQL-shaped repository API to make MongoDB appear equivalent to relational databases. Future providers must implement the same domain-owned repository contracts where semantics genuinely match; differences in transactions, consistency, uniqueness, and capabilities must be explicit.
- Do not add generic CRUD, ORM, query builder, schema generator, or speculative abstractions.

### First consumer scope

Persist the reporting/trading-history records required by Harvester through narrow repository contracts:

- Trading sessions and process/runtime identity.
- Broker orders and their current canonical state.
- Order lifecycle events, independently from order snapshots.
- Individual executions/fills, including commissions and fee assets.
- Account/balance/open-order snapshots.
- Required bounded metadata and provenance.

A single order can have multiple lifecycle events and multiple fills. Preserve canonical broker order/execution identities, idempotent duplicate delivery, conflict detection, exact decimal values, and UTC timestamps. Do not reconstruct executions from terminal order status.

Production and Testnet must use separate database files and separate database lifecycles, for example:

```text
apps/harvester/data/
  production/harvester.db
  testnet/harvester.db
```

Resolve the environment only from the validated explicit `TRADING_MODE` contract (see [ADR-0002](../../docs/architecture/decisions/ADR-0002-explicit-binance-trading-environment.md)); never use `NODE_ENV` to select an exchange environment or database file. Keep the path configurable through the established Harvester configuration conventions, prevent path traversal/accidental shared-file selection, and keep runtime data out of Git.

### Operational State safety boundary

Harvester's ADR-0001 Operational State Store is authoritative recovery evidence. It is not interchangeable with reporting history or the Journal.

- Preserve the existing append acknowledgement, global sequence, committed-head/hash-chain integrity, stable fact identities, conflict detection, fail-closed verification, explicit genesis, private file permissions, and mandatory Journal barriers.
- Do not silently replace, weaken, dual-write, or automatically fall back between the existing file store and a database.
- Assess a SQLite-backed Operational State adapter only as a separate gated phase. It must prove complete ADR-0001 contract parity, including crash/torn-write behavior, durability acknowledgement, integrity verification, initialization, disk-full/error handling, backup/restore, and concurrent-process ownership.
- Coordinate any cutover with [Harvester restart-recovery issue #654](https://github.com/45s/coinzilla/issues/654). Restart restoration remains disabled until that issue's independent readiness and reconciliation gates are complete.
- Existing Journal barriers and Journal's observer-only role remain unchanged unless a separate accepted decision explicitly supersedes them.

## Delivery plan

1. **Contract and boundary audit — first implementation step (#1327).**
   - Re-read current package/app instructions, roadmaps, ADRs, persistence ports, adapters, consumers and tests.
   - Map the existing `@coinzilla/db` lifecycle/transaction API and identify only concrete gaps needed by the first Harvester repository.
   - Define the first Harvester-owned repository port and its observable consistency/idempotency contract. Keep this slice small; do not design every future repository before validating one real use case.
   - Document the dependency direction and provider-selection boundary.

2. **First repository vertical slice — SQLite.**
   - Start with trading-session persistence: create a unique session for every process startup; retain process/runtime ID, environment, broker, strategy/config fingerprint, enabled markets, application/build provenance, timestamps and lifecycle outcome.
   - Implement the Harvester-owned port, SQLite infrastructure adapter, versioned Harvester-owned migration, and composition-root wiring.
   - Prove create/read/update, restart persistence, uniqueness, transaction rollback, failure propagation and resource cleanup with temporary file-backed SQLite integration tests.
   - Keep `packages/db` generic; change it only for a concrete missing provider capability proven by the consumer.

3. **Trading history repositories.**
   - Add orders, order events, executions/fills, commissions and account snapshots as focused vertical slices with their own contracts, migrations and tests.
   - Use unique constraints for broker identities and idempotency. Conflicting reuse of an identity with different economic facts is an integrity failure.
   - Persist monetary/quantity values as canonical decimal TEXT or safe scaled integers; never SQLite REAL. Preserve original broker payload only where bounded and useful for audit.
   - Keep event history append-only; do not collapse multiple fills into one order-level execution.

4. **Environment isolation and process concurrency.**
   - Verify Production and Testnet open different files and cannot read/write each other's records.
   - Use two real independent Node.js processes in integration tests to create sessions and concurrently write events/fills.
   - Verify SQLite WAL/read behavior, same-file writer serialization, configured busy timeout, lock errors, rollback and retry classification. Do not claim multiple simultaneous writers inside one SQLite file.
   - Verify shutdown and abrupt process termination leave committed records valid and uncommitted transactions rolled back.

5. **Operational State adapter assessment — gated.**
   - Compare the SQLite transaction/commit model with every ADR-0001 guarantee and existing filesystem adapter behavior.
   - Add a separate accepted/superseding ADR before changing the authoritative store contract.
   - Do not cut over until exact parity tests, crash/failure tests, backup/restore proof, rollback plan and #654 owner approval exist. Keep the existing file store intact until a verified cutover is explicitly authorized.

6. **Historical migration and operating procedures.**
   - Provide an explicit, repeatable import command; never migrate silently during normal startup.
   - Verify source integrity before import; preserve original fact IDs, sequences, timestamps, payloads and provenance; detect conflicts; verify counts and digests; retain source files; document rollback.
   - Document database locations, inspection tools, consistent backup/restore, schema upgrade policy, disk-full behavior, corruption handling and Windows restart/crash behavior before persistent deployment.

7. **Provider portability and future providers.**
   - Add architecture/contract tests proving application/domain code imports only domain-owned ports and that the SQLite adapter is replaceable at the composition boundary.
   - Reassess PostgreSQL or MongoDB only when measured deployment, concurrency, scale, availability or query requirements justify them. Implement another provider as a separate adapter and prove the same domain contract; do not add it preemptively.

## Existing package foundation — implemented

- [x] Establish `@coinzilla/db` and the provider adapter lifecycle boundary.
- [x] Implement Node.js built-in `node:sqlite` without an external SQLite driver or ORM.
- [x] Support in-memory and file-backed SQLite, foreign-key enforcement, WAL for file databases, and configurable lock timeout.
- [x] Implement explicit synchronous transactions with commit/rollback and nested/async callback rejection.
- [x] Implement ordered, atomic, versioned schema migrations and migration-history validation.
- [x] Add deterministic tests using real in-memory and temporary file-backed SQLite databases.
- [x] Separate database lifecycle domain, application provider port/use case, and SQLite infrastructure adapter.

## Current architecture and API

The database lifecycle aggregate owns provider-independent connection lifecycle and transaction draining. The JSDoc `DatabaseProvider` port defines `connect`, `close`, and `withTransaction`. `createDatabase({ adapter })` composes that lifecycle boundary. `createSqliteDatabase({ filename, timeout })` supplies the current SQLite implementation and exposes its SQL/transaction/migration operations to infrastructure consumers.

The existing API is a provider-neutral lifecycle foundation, **not** a universal data-access API. SQL and `node:sqlite` remain provider-specific. Business repositories belong to the consuming bounded context and must hide these details from its domain/application layers.

Node's built-in SQLite API is synchronous. SQL statements and transaction callbacks block the event loop while executing; transaction callbacks and migration functions must remain synchronous. Do not put network calls, timers or awaited work inside a transaction. Keep transactions short and test their impact on Harvester's event-driven runtime.

## Explicit non-goals

- No business aggregates or Harvester repository contracts inside `packages/db`.
- No generic CRUD, ORM, query builder, universal SQL abstraction, or application-wide data model.
- No PostgreSQL/MongoDB provider until a real consumer demonstrates the need.
- No change to trading strategy behavior, Journal semantics, ADR-0001 safety guarantees, or restart-restoration readiness.
- No silent persistence fallback or automatic migration of existing runtime data.

## Completion policy

A roadmap item is complete only after implementation is merged into `develop` and required validation passes. A proposed provider abstraction is not proven portable until a real consumer contract is implemented and tested through its adapter boundary.
