# Database roadmap

---
status: active
type: roadmap
owner: db
---

## Purpose

The accepted architecture is recorded in [ADR-0001](./docs/decisions/0001-provider-neutral-record-crud-api.md); see the [local documentation index](./docs/README.md).

`@coinzilla/db` provides a provider-neutral record CRUD and transaction API. Node.js built-in `node:sqlite` is the first concrete provider. The package owns generic persistence infrastructure contracts only; application domains own their business entities, schemas and repository interfaces.

## Provider-neutral CRUD API — core implementation merged

**Core implementation:** [PR #1353](https://github.com/45s/coinzilla/pull/1353) merged into `develop` as `70f1345054bf619dca01896817967eeba6ad1141`; it delivered the provider-neutral CRUD facade, built-in SQLite provider, reusable conformance suite, and public documentation.

**Post-merge hardening:** [PR #1364](https://github.com/45s/coinzilla/pull/1364) covers validated CREATE snapshot consistency; [PR #1365](https://github.com/45s/coinzilla/pull/1365) covers synchronous transaction rollback isolation. The latest #1340 status records both as ready for review. Verify their live merge and CI state before treating them as complete.

**ESLint cleanup:** the package-specific `packages/db` ESLint cleanup is complete (validated commit `85ad08be61342d8f543d970f102fafeae367eb78`). It is not an active roadmap item. Continue to enforce the repository's strict `pnpm lint` gate and fix only new violations introduced by future changes.

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

See the [README](./README.md) for the current detailed contract, examples and SQLite runtime constraints. The core API is merged; the two post-merge hardening follow-ups above remain separately tracked until their own merge and required-check gates are verified.

## Existing SQLite functionality — preserved

The package already provides and must retain:

- Node.js built-in `node:sqlite`, with no external driver or ORM.
- File-backed and explicit `:memory:` databases.
- Foreign-key enforcement, WAL for file-backed databases and configurable lock timeout.
- Explicit connection lifecycle and close-time transaction draining.
- Synchronous SQLite transactions with commit/rollback and nested/async callback rejection.
- Ordered, atomic, versioned schema migrations and migration-history validation.
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

## Next work — Harvester-owned consumer integration

The first consumer integration is separately owned by Harvester and tracked in [issue #1327](https://github.com/45s/coinzilla/issues/1327), specifically Workstream B. Start with a source-backed audit and one narrow vertical slice; do not expand `packages/db` with Harvester concepts. See the [Harvester persistence roadmap](../../apps/harvester/ROADMAP.md#persistence--provider-agnostic-database-integration-1327).

## Deferred — evidence-driven

1. **First application-owned repository integration**
   - The consumer owns its repository contract, business schema and migrations.
   - Integrate only after this generic infrastructure contract is stable and the owning domain approves the consumer task.
   - Verify restart persistence, transaction behavior, concurrency, migration compatibility and deterministic cleanup in that consumer's tests.

2. **Backup and restore operations**
   - Document database location, permissions, consistent backup, restore validation, schema version and retention for the first persistent consumer.
   - Test backup/restore against an isolated temporary database before persistent deployment.

3. **Additional providers**
   - Reassess PostgreSQL or MongoDB only when measured deployment topology, concurrent writers, availability, dataset size or query requirements justify them.
   - A new adapter must pass the provider conformance suite and declare any capability differences.
   - Do not claim portability for guarantees a provider cannot provide.

## Completion policy

A roadmap item is complete only after implementation is merged into `develop`, relevant tests and coverage pass, required CI passes on the exact final PR head, and affected living documentation is current.
