# Database

`@coinzilla/db` provides SQLite persistence using Node.js' built-in `node:sqlite` module. It has no external database driver or ORM dependency.

A storage filename is required so applications cannot accidentally start with an ephemeral in-memory database. Use the explicit filename `:memory:` in isolated tests.

## Requirements and runtime characteristics

- Node.js 24 or later (the workspace runtime).
- Node's built-in `node:sqlite` module; no package installation is required.
- Node's SQLite API currently uses synchronous operations. SQL statements and transaction callbacks block the event loop while they run.
- SQLite transaction callbacks and migration `up` functions must be synchronous. Async callbacks are rejected; do not use `await` inside a SQLite transaction.
- SQLite is appropriate for embedded/local persistence and moderate workloads. A workload requiring many concurrent writers or multi-host database access may justify a server database later.

See the [Node.js SQLite API documentation](https://nodejs.org/api/sqlite.html) for the runtime API and stability status.

## Create a database

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

  const insertAccount = database.prepare(
    "INSERT INTO accounts (name) VALUES (?)",
  )
  insertAccount.run("primary")

  const account = database
    .prepare("SELECT id, name FROM accounts WHERE name = ?")
    .get("primary")
} finally {
  await database.close()
}
```

Options:

| Option | Default | Meaning |
| --- | --- | --- |
| `filename` | Required | SQLite database file, or the explicit value `:memory:` for an ephemeral database. Parent directories are created for file-backed databases. |
| `timeout` | `5000` | SQLite lock wait timeout in milliseconds. Must be a non-negative safe integer. |

File-backed databases use WAL journal mode. Foreign-key enforcement is enabled for every connection. Always use prepared statements and bound parameters for values; never interpolate untrusted input into SQL.

## Transactions

A transaction receives a restricted SQL context with `exec` and `prepare`:

```js
await database.transaction((transaction) => {
  transaction.prepare(
    "UPDATE accounts SET name = ? WHERE id = ?",
  ).run("main", 1)

  transaction.prepare(
    "INSERT INTO audit_log (message) VALUES (?)",
  ).run("account renamed")
})
```

Transactions use `BEGIN IMMEDIATE` and commit only when the callback returns successfully. A thrown error rolls back all writes. Nested transactions are rejected.

Because Node's built-in SQLite API is synchronous, transaction callbacks must not be `async` and must not return a Promise. This prevents a transaction from being committed before awaited work finishes or from being interleaved with another operation on the same connection.

## Schema migrations

Migrations are ordered by their positive integer version and run atomically. The package records applied migrations in `schema_migrations`.

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
  {
    version: 2,
    name: "add-account-status",
    up(transaction) {
      transaction.exec(
        "ALTER TABLE accounts ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
      )
    },
  },
])
```

Migration functions must be synchronous. Applied versions must remain in the migration list with the same names; removing or renaming an applied migration causes a history-mismatch error. Never edit a migration after it has been applied; add a new version instead.

## DDD boundaries

- Bounded contexts own their domain models, aggregate invariants, and repository interfaces.
- Infrastructure repository adapters translate those contracts to SQL using this package.
- Domain and application policy must not import `node:sqlite`, SQL statements, database connections, or SQLite statement types.
- This package owns SQLite lifecycle, transactions, SQL execution, and migration history.
- Do not add generic CRUD repositories or ORM-style entities. Design each repository around the aggregate and use cases it serves.

The existing `createDatabase({ adapter })` lifecycle boundary remains available for a future provider adapter. PostgreSQL or MongoDB should be added only when a real consumer's consistency, query, deployment, and operational requirements justify them. Do not pretend their capabilities are identical to SQLite.

## Development

```sh
pnpm --filter @coinzilla/db test
pnpm --filter @coinzilla/db test:coverage
``
