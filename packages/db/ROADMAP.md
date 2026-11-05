# Database roadmap

**Owner:** Database Infrastructure domain (`packages/db/`)  
**Package:** `@coinzilla/db`  
**Purpose:** provide reliable embedded SQL persistence while preserving DDD dependency direction.

Read [package instructions](./AGENTS.md) and the [domain ownership guide](../../docs/engineering/DOMAIN_OWNERSHIP.md).

## Principles

- This package's domain is database infrastructure: database lifecycle and immutable schema migrations.
- Business bounded contexts own their business aggregates and repository contracts.
- Application use cases depend on the database provider port, not SQLite connections.
- SQLite infrastructure owns SQL, driver APIs, transaction mechanics, and migration persistence.
- Keep database lifecycle, transaction, and migration behavior explicit.
- Use prepared statements and bound parameters for values.
- Do not build a generic CRUD/query API or ORM abstraction.
- Keep SQLite-specific types and SQL out of domain and application policy.
- Add another provider only when actual consumer requirements demonstrate the need.

## Roadmap

- [x] Establish the `@coinzilla/db` package and provider adapter lifecycle boundary.
- [x] Implement Node.js built-in `node:sqlite` persistence without an external driver or ORM.
- [x] Support in-memory and file-backed databases, foreign-key enforcement, WAL for file databases, and configurable lock timeout.
- [x] Implement explicit synchronous transactions with commit/rollback and nested/async callback rejection.
- [x] Implement ordered, atomic, versioned schema migrations and migration-history validation.
- [x] Add deterministic integration tests using real in-memory and temporary file-backed SQLite databases.
- [x] Separate the database infrastructure domain model, application provider port/use case, and SQLite infrastructure adapter without changing the public API.
- [ ] Integrate the first domain-owned repository contract with a real application consumer.
- [ ] Add domain-specific repositories and schema migrations alongside their owning bounded contexts.
- [ ] Reassess PostgreSQL or MongoDB only if deployment, concurrency, scale, or query requirements outgrow embedded SQLite.
- [ ] Document backup/restore and operational procedures for the first persistent application deployment.

## Architecture status

The database lifecycle aggregate owns provider-independent lifecycle state and transaction draining. Immutable migration entities own schema-change identity; a pure migration-history service enforces the rule that an applied version cannot be removed or renamed. SQLite-specific SQL and `node:sqlite` behavior live under `src/infrastructure/sqlite/`. The package does not own business aggregates or generic repositories.

## Implemented public API

- `createSqliteDatabase({ filename, timeout })`: create a SQLite database; the storage filename is required, and `:memory:` must be selected explicitly for ephemeral use.
- `connect()` / `close()`: explicit resource lifecycle.
- `exec(sql)` / `prepare(sql)`: execute SQL and create parameterized statements while connected.
- `transaction(work)`: run synchronous SQL work atomically using `BEGIN IMMEDIATE`.
- `migrate(migrations)`: apply ordered synchronous migrations and record versions in `schema_migrations`.
- `state`: read-only lifecycle state from the shared database facade.
- `createDatabase({ adapter })`: lower-level provider lifecycle boundary retained for future adapters.

## Runtime constraints

Node's built-in SQLite API is synchronous, so SQL calls and transactions block the event loop while executing. Transaction callbacks and migration functions must be synchronous. Do not put network calls, timers, or awaited work inside a transaction. SQLite is an embedded database, not a network database server.

## Explicit non-goals

This package does not own domain aggregates, domain repository interfaces, generic CRUD, an ORM, a universal SQL abstraction, or an application-wide data model. It does not yet migrate an application or claim that an application is using persistent storage.

## Completion policy

A roadmap item is complete only after implementation is merged into `develop` and required validation passes.
