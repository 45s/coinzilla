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
  const created = await database.create("users", {
    id: "user-1",
    name: "John",
    status: "active",
  })

  const user = await database.readOne("users", "user-1")

  const activeUsers = await database.readMany("users", {
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
  })

  const updated = await database.update("users", "user-1", {
    name: "Peter",
  })

  const deleted = await database.delete("users", "user-1")
} finally {
  await database.close()
}
```

The methods have consistent provider-neutral results:

| Operation | Result |
| --- | --- |
| `create(collection, record)` | The stored record. Duplicate identifiers throw `DatabaseConflictError`. |
| `readOne(collection, id)` | The record, or `null` when it does not exist. |
| `readMany(collection, query?)` | An array of matching records; an empty array when none match. |
| `update(collection, id, changes)` | The complete updated record, or `null` when it does not exist. |
| `delete(collection, id)` | `true` when a record was removed; otherwise `false`. |

### Record and identifier rules

- A collection name is a non-empty string without surrounding whitespace.
- Every record is a plain JSON object with its own non-empty string `id`.
- Identifiers are unique inside a collection. Different collections may use the same identifier.
- Records support nested JSON objects and arrays. Values must be JSON-safe: no `undefined`, functions, symbols, `BigInt`, non-finite numbers, class instances, accessors, sparse arrays, or circular references.
- The `id` cannot be changed by `update`.
- Updates are shallow merges. Existing fields not included in `changes` remain unchanged.

### Filtering, sorting and pagination

`readMany(collection, query)` accepts a plain object:

```js
const page = await database.readMany("users", {
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
})
```

- Filters use exact equality on top-level field names. JSON types are significant; for example, boolean `true` does not equal number `1`. A missing field does not match an explicit `null`.
- Filter and sort field names use letters, numbers and underscores, and cannot start with a number.
- Sort is an ordered array of `{ field, direction }` entries. Direction is `asc` or `desc`. Records with equal sort values use the record identifier as a stable final tie-breaker.
- For portable sorting across providers, sort fields should contain scalar JSON values. Ordering of arrays and objects is not part of the portable contract.
- `limit` is an optional positive safe integer. `offset` is a non-negative safe integer and defaults to zero.
- Unsupported query options and non-scalar filter values are rejected with `TypeError`.

The first SQLite provider supports exact equality filters, sorting and pagination. More filter operators must be added to the provider-neutral contract and conformance tests before any provider implements them.

### Transactions

A transaction callback receives the same provider-neutral CRUD operations:

```js
await database.transaction((transaction) => {
  transaction.create("accounts", {
    id: "account-1",
    name: "Primary",
  })

  transaction.update("accounts", "account-1", {
    status: "active",
  })
})
```

A thrown error rolls back the complete transaction. SQLite transaction callbacks must be synchronous because Node's built-in SQLite API is synchronous; an async callback or a returned Promise is rejected. Do not use `await`, network calls, timers, or unrelated asynchronous work inside a SQLite transaction.

### Errors

- `DatabaseConflictError` identifies a duplicate record identifier. Its stable code is `DB_RECORD_CONFLICT`.
- `DatabaseProviderError` identifies an underlying provider operation failure. Its stable code is `DB_PROVIDER_OPERATION_FAILED`; the original provider failure is preserved as `cause`.
- Invalid collection names, identifiers, records and queries throw `TypeError`.
- Missing records are ordinary results (`null` or `false`), not exceptions.

Consumers should branch on the public error class or stable code, not provider error messages or SQLite error codes.

### Provider capabilities

Read `database.capabilities` to inspect the provider-neutral capability declaration. The declaration is a frozen snapshot. The SQLite provider currently reports:

- Transaction callbacks are synchronous.
- Exact equality filters, sorting and pagination are supported.
- Both file-backed and in-memory storage are supported.

A future provider must declare its own actual guarantees. The package will not silently emulate unsupported transaction, query, or durability guarantees.

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

SQLite uses prepared statements and bound parameters. Never interpolate untrusted values into SQL.

### SQLite runtime behavior

- Node.js 24 or later (the workspace runtime).
- Node's built-in `node:sqlite` module; no package installation is required.
- SQLite operations are synchronous and block the event loop while running.
- File-backed databases use WAL journal mode. Foreign-key enforcement is enabled for every connection.
- The lock timeout defaults to 5,000 milliseconds and must be a non-negative safe integer.
- The filename is required; use the explicit value `:memory:` for an ephemeral database.
- Parent directories are created for file-backed databases.
- SQLite is appropriate for embedded/local persistence. Workloads requiring many concurrent writers or multi-host access may justify a server provider later.

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

Migrations are identified by positive integer version. Applied versions must remain in the migration list with the same names; removing or renaming an applied migration causes a history-mismatch error. Never edit a migration after it has been applied; add a new version instead. Migration callbacks must be synchronous.

## Architecture and DDD boundaries

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
