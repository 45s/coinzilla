# Database boundary

`@coinzilla/db` is Coinzilla's provider-neutral database lifecycle boundary.

It deliberately does **not** select or bundle a database engine. PostgreSQL, MongoDB, and Node.js SQLite remain future adapter choices. The package currently owns only the shared lifecycle and transaction boundary needed to keep provider code out of application/domain code.

## DDD boundaries

- Bounded contexts own their domain models and repository interfaces.
- A domain repository expresses the persistence needs of its aggregate/use case; it must not expose SQL, MongoDB collections, driver sessions, or provider query syntax to domain policy.
- A provider adapter translates that repository contract to the selected database and owns provider-specific client/query/session details.
- The composition root constructs the provider adapter and injects it into the application.
- This package does not define generic CRUD repositories, table/collection models, ORM entities, schemas, migrations, or a universal query language.

A SQL database and a document database have different modeling and query capabilities. Hiding those differences behind a lowest-common-denominator CRUD API would weaken the domain model rather than protect it.

## Public API

`createDatabase({ adapter })` wraps a provider adapter with a consistent lifecycle:

- `connect()` coalesces concurrent connection attempts and can be retried after a failed connection.
- `transaction(work)` requires a connected database and delegates transaction creation/commit/rollback to the provider adapter. The transaction context is opaque to this package and is intended for infrastructure repository adapters.
- `close()` prevents new transactions, waits for active transactions, then closes the provider connection. It is safe to call repeatedly. A failed close remains retryable.
- `state` exposes the read-only lifecycle state: `disconnected`, `connecting`, `connected`, `closing`, or `closed`.

Adapter contract:

```js
const adapter = {
  async connect() {
    // Create/connect the selected provider client and retain it privately.
  },
  async withTransaction(work) {
    // Start a provider transaction, pass its opaque context to work,
    // commit on success, and roll back before rethrowing on failure.
  },
  async close() {
    // Release the provider client and its resources.
  },
}

const database = createDatabase({ adapter })
await database.connect()
try {
  await database.transaction(async (transaction) => {
    // Infrastructure repository adapters use this transaction context.
  })
} finally {
  await database.close()
}
```

The adapter owns provider-specific transaction guarantees. It must not report a successful transaction if commit failed, and it must roll back on callback failure where the provider supports transactions. If a selected deployment cannot provide the required atomicity, the adapter must fail explicitly rather than silently emulate it.

## Current scope and limitations

- No database driver or ORM dependency is installed.
- No application is wired to this package yet.
- No persistent repository implementation is included; those contracts belong to the consuming bounded context.
- No migrations/schema management or connection-pool policy is defined before a provider and real consumer requirements are selected.
- The default package tests are deterministic, offline, and use a fake provider adapter.

## Development

```sh
pnpm --filter @coinzilla/db test
pnpm --filter @coinzilla/db test:coverage
```
