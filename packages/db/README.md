# Database

`@coinzilla/db` provides a provider-neutral record CRUD API and database lifecycle. The first provider is Node.js' built-in `node:sqlite`; no external SQLite driver, ORM, query builder, or database server is required.

The package owns generic database infrastructure contracts only. It does not own application schemas, business entities, repositories, or trading concepts.

## Provider-neutral CRUD API

Choose and configure the provider at the application composition boundary. Pass the configured provider to `createDatabase`; application services then use only the generic database API.

```js
import { createDatabase, createSqliteProvider } from "@coinzilla/db"

const database = createDatabase({
  provider: createSqliteProvider({
    filename: "./data/app.db",
    timeout: 5_000,
  }),
})

await database.connect()

try {
  const created = await database.create({
    collection: "users",
    record: {
      id: "user-1",
      name: "John",
      status: "active",
    },
  })

  const user = await database.readOne({
    collection: "users",
    id: "user-1",
  })

  const activeUsers = await database.readMany({
    collection: "users",
    query: {
      filter: {
        status: "active",
      },
      sort: [
        {
          field: "name",
          direction: "asc",
        },
      ],
      limit: 20,
      offset: 0,
    },
  })

  const updated = await database.update({
    collection: "users",
    id: "user-1",
    changes: {
      name: "Peter",
    },
  })

  const deleted = await database.delete({
    collection: "users",
    id: "user-1",
  })
} finally {
  await database.close()
}
```

The methods have consistent provider-neutral results:

| Operation | Result |
| --- | --- |
| `create({ collection, record })` | The stored record. Duplicate identifiers throw `DatabaseConflictError`. |
| `readOne({ collection, id })` | The record, or `null` when it does not exist. |
| `readMany({ collection, query? })` | An array of matching records; an empty array when none match. |
| `update({ collection, id, changes })` | The complete updated record, or `null` when it does not exist. |
| `delete({ collection, id })` | `true` when a record was removed; otherwise `false`. |

### Record and identifier rules

- A collection name is a non-empty string without surrounding whitespace.
- Every record is a plain JSON object with its own non-empty string `id`.
- Identifiers are unique inside a collection. Different collections may use the same identifier.
- Records support nested JSON objects and arrays. Values must be JSON-safe: no `undefined`, functions, symbols, `BigInt`, non-finite numbers, class instances, accessors, sparse arrays, or circular references.
- The `id` cannot be changed by `update`.
- Updates are shallow merges. Existing fields not included in `changes` remain unchanged.

### Filtering, sorting and pagination

`readMany({ collection, query })` accepts a plain object:

```js
const page = await database.readMany({
  collection: "users",
  query: {
    filter: {
      status: "active",
      verified: true,
    },
    sort: [
      {
        field: "name",
        direction: "asc",
      },
      {
        field: "createdAt",
        direction: "desc",
      },
    ],
    limit: 25,
    offset: 50,
  },
})
```

- Filters use exact equality on top-level field names. JSON types are significant; for example, boolean `true` does not equal number `1`. A missing field does not match an explicit `null`.
- Filter and sort field names use letters, numbers and underscores, and cannot start with a number.
- Sort is an ordered array of `{ field, direction }` entries. Direction is `asc` or `desc`. Records with equal sort values use the record identifier as a stable final tie-breaker, always ascending.
- Portable scalar ordering is `missing/null < false < true < number < string`. Numbers compare numerically; strings compare by binary UTF-8 order. Missing fields and explicit `null` share the same sort rank and are then ordered by identifier.
- For portable sorting across providers, sort fields should contain scalar JSON values. Ordering of arrays and objects is not part of the portable contract.
- `limit` is an optional positive safe integer. `offset` is a non-negative safe integer and defaults to zero.
- Unsupported query options and non-scalar filter values are rejected with `TypeError`.

The first SQLite provider supports exact equality filters, sorting and pagination. More filter operators must be added to the provider-neutral contract and conformance tests before any provider implements them.

### Transactions

A transaction callback receives the same provider-neutral CRUD operations:

```js
await database.transaction((transaction) => {
  transaction.create({
    collection: "accounts",
    record: {
      id: "account-1",
      name: "Primary",
    },
  })

  transaction.update({
    collection: "accounts",
    id: "account-1",
    changes: {
      status: "active",
    },
  })
})
```

A thrown error rolls back the complete transaction. SQLite transaction callbacks must be synchronous because Node's built-in SQLite API is synchronous; an async callback or a returned Promise is rejected. Transaction handles, prepared statements and iterators are invalidated immediately after either COMMIT or ROLLBACK; do not retain them or use them after the callback returns. Do not use `await`, network calls, timers, or unrelated asynchronous work inside a SQLite transaction.

For the provider-neutral SQLite facade, an async-function callback is rejected before its body runs. If a non-async callback returns a Promise or thenable, SQLite rolls back and invalidates the transaction handle and prepared statements before deferred continuations can use them. Such a continuation cannot perform work outside the failed transaction. The low-level `createSqliteDatabase` transaction handle follows the same rollback rule.

For example, a Promise-returning callback is rejected and its deferred write does not escape the rollback:

```js
await assert.rejects(
  database.transaction((transaction) => Promise.resolve().then(() => transaction.create({
    collection: "accounts",
    record: {
      id: "account-2",
      name: "Deferred write",
    },
  }))),
  /must be synchronous/,
)

assert.equal(
  await database.readOne({
    collection: "accounts",
    id: "account-2",
  }),
  null,
)
```

### Errors

- `DatabaseConflictError` identifies a duplicate record identifier. Its stable code is `DB_RECORD_CONFLICT`.
- `DatabaseProviderError` identifies an underlying provider operation failure. Its stable code is `DB_PROVIDER_OPERATION_FAILED`; the original provider failure is preserved as `cause`.
- Invalid collection names, identifiers, records and queries throw `TypeError`.
- Missing records are ordinary results (`null` or `false`), not exceptions.
- If transaction work fails and SQLite rollback also fails, the low-level transaction rejects with an `AggregateError` whose `errors` preserve the work error first and rollback error second; its `cause` is the original work error. A failed rollback can leave the connection inside a native transaction; do not continue using it until the underlying transaction state has been recovered or the connection has been closed.
- If connection initialization fails and closing the partially initialized native connection also fails, the low-level connection attempt rejects with an `AggregateError` containing both failures. The facade retains ownership of the native handle: a subsequent `close()` retries cleanup, and a subsequent `connect()` first closes the retained handle before opening a replacement. The provider facade wraps the aggregate in `DatabaseProviderError` as its `cause`.

Consumers should branch on the public error class or stable code, not provider error messages or SQLite error codes. Inspect nested `cause` and `AggregateError.errors` when operational recovery requires the underlying SQLite or filesystem failure.

### Provider capabilities

Read `database.capabilities` to inspect the provider-neutral capability declaration. The declaration is a frozen snapshot. The SQLite provider currently reports:

- Transaction callbacks are synchronous; nested transactions are not supported.
- Exact equality filters, sorting and pagination are supported.
- Storage modes are file-backed and in-memory.

A provider passed to `createDatabase({ provider })` implements both `withTransaction(work)` and `withReadTransaction(work)`. Creates, updates, deletes and explicit `database.transaction(work)` callbacks use the write transaction path; `readOne` and `readMany` use the read transaction path. Providers preserve the same CRUD and transaction semantics across both paths while selecting appropriate locking behavior. SQLite uses `BEGIN IMMEDIATE` for writes and `BEGIN DEFERRED` for reads, allowing WAL readers to continue while another connection holds a write reservation. The legacy `adapter` lifecycle/SQL API remains compatible with adapters that only implement `withTransaction`.

A synchronous provider cannot declare `nestedTransactions: true`; the provider-neutral facade requires asynchronous callbacks to invoke nested transactions safely. The capability validator rejects that incompatible declaration at composition time.

A future provider must declare its own actual guarantees. The package will not silently emulate unsupported transaction, query, or durability guarantees.

## Provider conformance tests

Future provider packages can reuse the same public contract suite instead of writing a separate interpretation of CRUD behavior:

```js
import { basename } from "node:path"

import { createDatabase } from "@coinzilla/db"
import { runDatabaseProviderConformanceTests } from "@coinzilla/db/testing"

runDatabaseProviderConformanceTests({
  name: "PostgreSQL provider",
  createDatabase: ({ storageKey, storageMode }) => createDatabase({
    provider: createPostgresProvider({
      connectionString: process.env.DATABASE_URL,
      testDatabase: `coinzilla_test_${basename(storageKey, ".sqlite")}`,
      storageMode,
    }),
  }),
  cleanupStorage: async ({ storageKey, storageMode }) => {
    if (storageMode === "server") {
      // Use the provider's administrative connection to drop the isolated test database.
      await postgresAdmin.dropDatabase(
        `coinzilla_test_${basename(storageKey, ".sqlite")}`,
      )
    }
  },
})
```

The example is illustrative; no PostgreSQL provider is included. The factory receives a unique `storageKey` and one declared `storageMode`. The suite runs the contract against every mode in `database.capabilities.storage.modes`, using an isolated key for each test. For `file` and `server` modes it reuses the same key across a new connection to verify persistence; the reconnect test is explicitly skipped for `memory` mode. SQLite maps `memory` to `:memory:` and `file` to the isolated temporary file path. For server-backed providers, supply the optional `cleanupStorage({ storageKey, storageMode })` callback to drop the temporary database or namespace after all connections for that test have closed. The callback runs once per isolated key, including after both connections in the persistence test; `close()` should close the connection, not destroy the store before reconnect verification. The suite removes its local temporary directory automatically. Providers must not silently skip a declared storage mode or a supported contract.

The suite verifies CRUD and collection isolation, duplicate handling, every declared storage mode, each declared query capability, portable scalar sorting, missing-record results, transaction commit/rollback, declared nested-transaction behavior, the synchronous/asynchronous callback mode, immutable capability snapshots, lifecycle closure, close-time draining of active asynchronous transactions, cleanup-hook invocation, and persistence across a new connection where storage is persistent. Query cases are skipped with a reason only when the provider declares the corresponding capability unavailable. The in-memory reconnect-persistence case is skipped because that storage mode is explicitly ephemeral. Add provider-specific lifecycle, lock/concurrency and cleanup tests where the generic contract cannot express the provider's operational guarantees.

## Provider composition

Provider-specific options belong only where the application is assembled:

```js
// SQLite today
const database = createDatabase({
  provider: createSqliteProvider({
    filename: "./data/app.db",
  }),
})
```

A future provider can be selected at that same boundary:

```js
// Illustrative future composition; no PostgreSQL adapter is included today.
const database = createDatabase({
  provider: createPostgresProvider({
    connectionString: process.env.DATABASE_URL,
  }),
})
```

Code that receives the composed `database` uses `create`, `readOne`, `readMany`, `update`, `delete`, `transaction`, `connect` and `close`; it does not import or branch on a provider.

## SQLite low-level API

The original `createSqliteDatabase({ filename, timeout })` API remains available for infrastructure code that needs explicit SQL or schema migrations. It is intentionally provider-specific and must not be used by provider-neutral consumers.

```js
import { createSqliteDatabase } from "@coinzilla/db"

const database = createSqliteDatabase({
  filename: "./data/coinzilla.sqlite",
  timeout: 5_000,
})

await database.connect()

try {
  database.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    )
  `)

  database.prepare(
    "INSERT INTO accounts (name) VALUES (?)",
  ).run("primary")
} finally {
  await database.close()
}
```

The low-level facade also exposes `transaction(work)` for write-capable atomic work and `readTransaction(work)` for deferred-lock read workloads. Use `readTransaction` for reads only; it is a transaction scheduling path, not a SQL-level read-only security boundary.

SQLite uses prepared statements and bound parameters. Never interpolate untrusted values into SQL.

### SQLite runtime behavior

- Node.js 24 or later (the workspace runtime).
- Node's built-in `node:sqlite` module; no package installation is required.
- SQLite operations are synchronous and block the event loop while running.
- File-backed databases use WAL journal mode. Foreign-key enforcement is enabled for every connection.
- The lock timeout defaults to 5,000 milliseconds and must be a non-negative safe integer. It is applied to the native SQLite connection as its busy timeout; lock contention beyond that timeout is surfaced as an operation failure, not silently retried forever.
- The filename is required; use the explicit value `:memory:` for an ephemeral database.
- Parent directories are created for file-backed databases.
- File-backed databases use WAL. Concurrent connection initialization retries transient SQLite `BUSY`/`LOCKED` failures while enabling WAL, bounded by the configured connection timeout. Timeout exhaustion is surfaced as a connection failure; if cleanup also fails, the partially opened handle remains owned by the facade and can be released by a later `close()` or `connect()` retry. A read transaction starts with `BEGIN DEFERRED`; a write transaction starts with `BEGIN IMMEDIATE`. WAL allows readers to continue while a writer holds a write reservation, but SQLite still serializes writers across independent connections/processes.
- SQLite calls on one `DatabaseSync` connection are synchronous and run serially on the Node.js event loop. WAL coordination uses shared memory and requires processes to access the database on the same host; do not place WAL databases on network filesystems such as NFS or SMB. WAL is not a substitute for a server database when many concurrent writers or multi-host access are required.
- A database facade coalesces concurrent connection attempts and treats `close()` as terminal. Create a new facade to establish a new lifecycle after shutdown. A failed close remains retryable; callers must not treat a failed close as successful resource release.
- Provider-neutral `close()` waits for active transactions. The low-level SQLite facade also waits for active online backups before closing and rejects new SQL, transaction and backup work after shutdown begins.

### SQLite backup and restore

Backup and restore are SQLite-specific infrastructure operations on the low-level facade. They are intentionally not methods on the provider-neutral `createDatabase({ provider })` CRUD API because backup guarantees and mechanisms differ between providers.

The read-only connection used to validate a staged backup or restore artifact is explicitly closed after validation. If integrity/foreign-key validation and closing that verification connection both fail, the operation preserves both failures in an `AggregateError` (as the `cause` of `DatabaseProviderError` when the backup/restore boundary wraps it).

**Create a backup from an open SQLite database:**

```js
import { createSqliteDatabase } from "@coinzilla/db"

const database = createSqliteDatabase({
  filename: "./data/app.sqlite",
})

await database.connect()

try {
  const copiedPages = await database.backup({
    destination: "./backups/app.sqlite",
    rate: 100,
    progress({ remainingPages, totalPages }) {
      // Optional progress reporting.
    },
  })

  console.log(`Backed up ${copiedPages} SQLite pages`)
} finally {
  await database.close()
}
```

- `backup({ destination, rate?, progress? })` is asynchronous and returns the number of pages copied. `rate` is a positive safe integer and defaults to 100 pages per step.
- The backup uses Node.js' native SQLite online-backup API. It includes committed data held in WAL; do not copy a live SQLite main file directly.
- The destination parent directory is created when needed. The backup is written to a temporary file in that directory, checked with `PRAGMA integrity_check` and `PRAGMA foreign_key_check`, then atomically renamed into place. A previous destination backup is preserved if backup creation or validation fails.
- The source and destination must resolve to different files. The source must be connected and outside an active transaction.
- The optional progress callback receives a frozen `{ remainingPages, totalPages }` snapshot. The API does not accept an `AbortSignal`; callers can stop an in-progress backup by throwing from the progress callback. If the callback throws and cleanup succeeds, the backup rejects with that callback error and the previous destination remains untouched. If cleanup also fails, the provider error's `cause` is an `AggregateError` containing the callback and cleanup failures exactly once each.
- The backup uses a temporary directory beside the destination so final rename stays on the same filesystem. Creation/validation failures do not replace the previous backup. The destination must not be open or in use by another SQLite connection/process while it is being replaced; stop consumers of an existing backup before publishing a replacement. A cleanup failure after the final rename can still make the operation reject even though the newly validated backup has already been published; inspect the destination before retrying.
- `close()` waits for an active backup to finish. Once closing begins, new backup requests and new SQL/transaction operations are rejected.

**Restore a validated backup into a new database file:**

```js
import { restoreSqliteDatabase } from "@coinzilla/db"

const restoredFilename = await restoreSqliteDatabase({
  backupFilename: "./backups/app.sqlite",
  filename: "./data/restored-app.sqlite",
  timeout: 5_000,
  rate: 100,
})

// Open a new connection using restoredFilename after the restore completes.
```

- `restoreSqliteDatabase({ backupFilename, filename, timeout?, rate? })` returns the absolute path of the restored database.
- The source backup is opened read-only and checked for SQLite integrity and foreign-key violations before it is copied and validated again.
- Restore never overwrites an existing destination. It stages the restored database in the destination directory and publishes it with an atomic no-overwrite hard link. The destination filesystem must support hard links; failures are reported without replacing an existing file. Competing restore attempts to one destination cannot overwrite each other: one can publish, and the other receives an existing-destination conflict. Destination preflight treats only `ENOENT` as absence; every other filesystem lookup failure is propagated rather than being mistaken for an existing-destination conflict.
- The caller must stop every process that could be using the destination path before restoring. The operation creates a new file; it does not replace or switch an already-open database connection.
- A cleanup failure after successful publication can make restore reject even though the complete validated destination already exists. Check the destination's integrity before retrying a restore after such an error.
- Restore does not run application migrations or check application-version compatibility. The caller owns those decisions and must validate compatibility before using the restored database.
- Invalid arguments and invalid backup integrity raise `TypeError`; SQLite/filesystem provider failures raise `DatabaseProviderError` with the original cause.

These APIs provide database primitives only. Scheduling, backup rotation/retention, encryption, remote/off-site copies, storage permissions, deployment-specific paths, restore drills, and operational runbooks belong to the application that owns the database.

See the [Node.js SQLite API documentation](https://nodejs.org/api/sqlite.html) for runtime details and stability status.

## Schema migrations

The low-level SQLite database API supports ordered, atomic migrations:

```js
await database.migrate([
  {
    version: 1,
    name: "create-accounts",
    up(transaction) {
      transaction.exec(`
        CREATE TABLE accounts (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL UNIQUE
        )
      `)
    },
  },
])
```

Migrations are identified by positive integer version and unique name, and are applied in ascending version order regardless of input order. The `schema_migrations` history table is initialized before the migration transaction; each migration's schema/data changes and its history row are then committed together in one transaction. If a migration fails, all changes made in that migration batch roll back; the empty history table may remain. Re-running an already applied migration list is idempotent. Applied versions must remain in the migration list with the same names; removing or renaming an applied migration causes a history-mismatch error. Never edit a migration after it has been applied; add a new version instead. Migration callbacks must be synchronous. Concurrent migration attempts from independent connections serialize under SQLite write locking: one applies and commits each version, and the others observe that version as already applied.

## Architecture and DDD boundaries

The accepted architecture decision is recorded in [ADR-0001](./docs/decisions/0001-provider-neutral-record-crud-api.md). See the [local documentation index](./docs/README.md) for package architecture records.

`@coinzilla/db` is the **Database Infrastructure** bounded context.

- Domain owns provider-independent record/query contracts, database error classification, lifecycle invariants and migration identity.
- Application owns provider composition and provider-neutral CRUD orchestration.
- Infrastructure owns concrete adapters. `infrastructure/sqlite/` owns `node:sqlite`, SQL, prepared statements, JSON storage, transaction mechanics and migration persistence.
- Consumers own their business entities, aggregate invariants, schemas and repository interfaces. Do not add application-specific repositories or schemas here.

Dependency direction is inward: infrastructure implements the application-facing provider port; application depends on provider-neutral contracts; domain policy does not import database drivers or SQL.

The legacy `createDatabase({ adapter })` lifecycle facade and `createSqliteDatabase(...)` low-level API remain available for compatibility. The provider-neutral CRUD facade is composed with `createDatabase({ provider })`.

## Development

```sh
pnpm --filter @coinzilla/db test
pnpm --filter @coinzilla/db test:coverage
```

Coverage thresholds are enforced for all production modules matched by `src/**/*.js`; package test files are excluded. Node's diagnostic coverage table can also show imported test-support and workspace dependency files, but those files are not part of the `@coinzilla/db` threshold. The provider-conformance harness is exercised by the SQLite and asynchronous fake-provider conformance suites; `@coinzilla/utils` is owned and tested by its own package. No `@coinzilla/db` production implementation file is excluded.
