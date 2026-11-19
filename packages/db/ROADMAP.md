# Database roadmap

---
status: active
type: roadmap
owner: db
---

## Purpose

The accepted architecture is recorded in [ADR-0001](./docs/decisions/0001-provider-neutral-record-crud-api.md); see the [local documentation index](./docs/README.md).

`@coinzilla/db` provides a provider-neutral record CRUD and transaction API. Node.js built-in `node:sqlite` is the first concrete provider. The package owns generic persistence infrastructure contracts only; application domains own their business entities, schemas and repository interfaces.

## Application-owned relational schema infrastructure — #1486

**Status: Implementation complete.** [PR #1489](https://github.com/45s/coinzilla/pull/1489) records the audit, compatibility-preserving implementation, regression tests and required verification. Merging it into `develop` closes this roadmap item; the completion policy below remains the merge gate.

The audit confirmed that the low-level SQL, prepared-statement, transaction, migration, backup and restore APIs already exist. The demonstrated gaps are migration callback mutation detection and rejection of a pending lower version after a higher version has already been applied.

The scoped implementation adds source fingerprints to newly applied migration history, safely upgrades legacy `schema_migrations` tables while preserving their existing rows, rejects modified checksummed migrations and out-of-order pending versions, and adds regression coverage for legacy upgrades, reconnect persistence and migrated-schema backup/restore. Legacy rows retain an explicit `legacy-unverified` marker and continue to use version/name validation because their original callback source cannot be reconstructed.

The accepted boundary remains unchanged: applications own physical relational schemas, migrations, repositories and business rules; this package owns generic SQLite infrastructure. No Harvester tables or persistence changes belong in this task. Mark complete only after the PR is merged and all required checks pass on its exact final head.

## SQLite infrastructure audit and hardening — #1395

**Status: Done.** [PR #1396](https://github.com/45s/coinzilla/pull/1396) merged into `develop` on 2026-11-18 as `81669ce2be6794b9bd03067f89b57f8fdb55f957`. The audit hardened SQLite connection lifecycle and cleanup, concurrent WAL initialization, transaction-handle lifetime, backup/restore failure preservation, and filesystem error classification. All implementation remains within this package's infrastructure boundary.

**Verification on exact PR validation head `75df31e7fcb8e123f86996dbf1876c4fc6073b6e`:**

- `@coinzilla/db`: 198 tests — 185 passed, 13 capability-specific skips, 0 failures.
- Production-source coverage: 100% lines / 99.64% branches / 100% functions; package thresholds (98% / 95% / 100%) passed.
- Required PR workflows passed: workspace unit tests and coverage, JavaScript syntax (including full-workspace and changed-file ESLint, agent-policy and actionlint), dependency audit, Utils tests, Harvester targeted tests, and external documentation links.
- Read-only Binance TESTNET integration was skipped by workflow policy and is outside this database-only task.

The merged commit retains the validated source tree. Detailed defect evidence and exact workflow history remain in [issue #1395](https://github.com/45s/coinzilla/issues/1395) and [PR #1396](https://github.com/45s/coinzilla/pull/1396), rather than being duplicated as a roadmap log.

**Operational limits remain:** SQLite serializes writers; WAL is same-host only (not NFS/SMB); synchronous `DatabaseSync` calls block the Node.js event loop; restore publication requires hard-link support. Disk-full, power-loss and hardware I/O behavior cannot be fully reproduced in shared CI. Backup schedules, retention, encryption, off-site storage, deployment paths, restore drills and runbooks remain application-owned.

**Next work is evidence-driven, not another speculative DB feature.** Consumer repository/schema integration belongs to the consumer domain and remains tracked by [umbrella issue #1327](https://github.com/45s/coinzilla/issues/1327). Add generic DB capabilities only when a concrete consumer requirement demonstrates a provider-neutral contract gap.

## Provider-neutral CRUD API — core implementation and hardening merged

**Core implementation:** [PR #1353](https://github.com/45s/coinzilla/pull/1353) merged into `develop` as `70f1345054bf619dca01896817967eeba6ad1141`; it delivered the provider-neutral CRUD facade, built-in SQLite provider, reusable conformance suite, and public documentation.

**Post-merge hardening — COMPLETE:** [PR #1364](https://github.com/45s/coinzilla/pull/1364) merged the validated CREATE snapshot consistency fix. [PR #1365](https://github.com/45s/coinzilla/pull/1365) merged synchronous transaction rollback isolation. Both fixes preserve the public API and existing SQLite lifecycle.

**ESLint cleanup — COMPLETE:** the package-specific `packages/db` ESLint cleanup is complete (validated commit `85ad08be61342d8f543d970f102fafeae367eb78`). It is not an active roadmap item. Continue to enforce the repository's strict `pnpm lint` gate and fix only new violations introduced by future changes.

The approved design is:

```text
Consumer / composition root
          |
          v
   createDatabase({ provider })
          |
          v
 Provider-neutral CRUD facade
          |
          v
   Database provider port
          |
          v
 Concrete infrastructure adapter
       (SQLite first)
```

The package defines what database operations mean. Each provider implements how those operations work. Provider-specific configuration is supplied only at composition. Consumers use the same CRUD and transaction methods regardless of provider.

### Delivered implementation

The following core delivery steps were completed by merged PR #1353:

1. **Provider-neutral contract and composition**
   - Define JSON record identity/shape, collection names, exact-match filters, sorting, pagination, operation results, error classes, transaction context and capability declarations.
   - Preserve the existing `createDatabase({ adapter })` lifecycle facade and `createSqliteDatabase(...)` low-level SQL/migration API.
   - Keep the new `createDatabase({ provider })` facade provider-neutral.
   - Verify invalid input, duplicate identifiers, missing records and capability snapshots.

2. **SQLite provider**
   - Use only built-in `node:sqlite`, prepared statements and bound parameters.
   - Support file-backed and in-memory storage.
   - Store generic JSON records by collection and string identifier; do not introduce application schemas.
   - Preserve current WAL, foreign-key, timeout, synchronous transaction and resource lifecycle behavior.

3. **Provider conformance suite**
   - Reusable tests cover CREATE/READ/UPDATE/DELETE, collection isolation, filtering, sorting, pagination, identifiers, duplicates, error semantics, transaction commit/rollback, lifecycle, reconnect persistence and cleanup.
   - Run the contract against every storage mode declared by the provider, using isolated test keys. Verify file/server persistence by reconnecting with the same key; explicitly skip reconnect persistence for ephemeral memory storage.
   - The suite verifies nested-transaction declarations, portable scalar sort ordering, close-time draining of active asynchronous transactions, and the optional provider-owned cleanup hook for server-backed test stores. Synchronous providers receive an explicit skip for the inapplicable async-drain case.
   - The SQLite provider must pass the complete applicable suite for both in-memory and file-backed modes.
   - Future providers must run the same suite; provider-specific capability differences must be declared rather than silently emulated.

4. **Documentation and hardening**
   - Publish copy-paste examples for provider composition, CRUD, query, transaction and error handling.
   - Verify public exports contain no driver objects, SQL statements or provider-native errors.
   - Run package tests/coverage, workspace tests, full lint, agent-policy checks and required CI on the exact PR head.

### Explicit boundaries

- No ORM, query builder, schema generator or universal SQL abstraction.
- No trading, Harvester, Journal, Operational State Store, order, fill, execution or portfolio entities/repositories/schemas.
- No speculative PostgreSQL or MongoDB adapter implementation.
- No consumer integration in this task. A real application's repository contract remains owned by that application's bounded context and its roadmap.

## Provider-neutral API contract

The intended public composition is:

```js
const database = createDatabase({
  provider: createSqliteProvider({
    filename: "./data/app.db",
  }),
})

await database.connect()
await database.create({
  collection: "users",
  record: { id: "user-1", name: "John" },
})
const user = await database.readOne({
  collection: "users",
  id: "user-1",
})
await database.update({
  collection: "users",
  id: "user-1",
  changes: { name: "Peter" },
})
await database.delete({
  collection: "users",
  id: "user-1",
})
await database.close()
```

- Records are JSON-safe plain objects with non-empty string identifiers.
- Identifiers are unique within a collection.
- READ ONE returns a record or `null`; UPDATE returns the updated record or `null`; DELETE returns a boolean.
- Duplicate identifiers raise a provider-neutral conflict error.
- READ MANY supports exact equality filters, ordered sorting and offset/limit pagination.
- Transactions expose the same CRUD methods, never provider-native transaction objects.
- Provider capabilities are exposed as a frozen, provider-neutral snapshot.

See the [README](./README.md) for the current detailed contract, examples and SQLite runtime constraints. Implementation status remains in the issue/PR; do not mark roadmap steps complete until the PR is merged and required checks pass.

## Generic SQLite backup and restore primitives — merged

**Implementation:** [PR #1382](https://github.com/45s/coinzilla/pull/1382) merged into `develop`; tracking issue [#1381](https://github.com/45s/coinzilla/issues/1381). The package provides native online backup, integrity/foreign-key validation, temporary-file staging, atomic backup publication, and no-overwrite restore publication. These are SQLite infrastructure primitives only; retention, encryption, off-site storage, scheduling, compatibility policy and restore runbooks remain application-owned.

**Follow-up reliability audit — COMPLETE:** [Issue #1395](https://github.com/45s/coinzilla/issues/1395) closed after [PR #1396](https://github.com/45s/coinzilla/pull/1396) merged. Exact-head tests, coverage and required CI passed; the audit included the merged backup/restore primitives. See the completed audit status above and the linked issue/PR for detailed evidence.

## Existing SQLite functionality — preserved

The package already provides and must retain:

- Node.js built-in `node:sqlite`, with no external driver or ORM.
- File-backed and explicit `:memory:` databases.
- Foreign-key enforcement, WAL for file-backed databases and configurable lock timeout.
- Explicit connection lifecycle and close-time transaction draining.
- Synchronous SQLite transactions with commit/rollback and nested/async callback rejection; transaction handles and prepared statements are invalidated after commit or rollback.
- Ordered, atomic, versioned schema migrations with source checksums for newly applied migrations, legacy-history compatibility, identity validation and out-of-order protection.
- WAL-aware native online backups, integrity and foreign-key validation, atomic backup publication, and atomic no-overwrite restore.
- Deterministic tests using real in-memory and temporary file-backed SQLite databases.

The low-level public API remains available:

- `createSqliteDatabase({ filename, timeout })`
- `connect()` / `close()`
- `exec(sql)` / `prepare(sql)`
- `transaction(work)`
- `readTransaction(work)` for deferred-lock read workloads
- `migrate(migrations)`
- `state`
- Legacy `createDatabase({ adapter })` lifecycle composition

## Consumer ownership boundary

Application domains own their business entities, schemas, repository interfaces, persistence workflows, and operational policies. This package supplies generic database APIs and concrete provider infrastructure only. No application-specific repositories, schemas, or operational workflows belong here.

## Deferred — evidence-driven

1. **Further application-owned repository integrations**
   - Each consumer owns its repository contract, business schema and migrations.
   - Keep consumer integrations outside `packages/db`; add generic database capabilities here only when a concrete consumer requirement exposes a provider-neutral contract gap.
   - Verify restart persistence, transaction behavior, concurrency, migration compatibility and deterministic cleanup in the owning consumer's tests.

2. **Application-owned backup and restore policy**
   - Generic SQLite backup/restore primitives were implemented by merged PR #1382.
   - Applications decide schedules, retention/rotation, encryption, off-site storage, deployment paths, version compatibility, permissions, restore drills, and operational runbooks. Do not move those policies into this package.

3. **Additional providers**
   - Reassess PostgreSQL or MongoDB only when measured deployment topology, concurrent writers, availability, dataset size or query requirements justify them.
   - A new adapter must pass the provider conformance suite and declare any capability differences.
   - Do not claim portability for guarantees a provider cannot provide.

## Completion policy

A roadmap item is complete only after implementation is merged into `develop`, relevant tests and coverage pass, required CI passes on the exact final PR head, and affected living documentation is current.
