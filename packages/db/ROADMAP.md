# Database package roadmap

**Owner:** Database Infrastructure domain (`packages/db/`)  
**Package:** `@coinzilla/db`  
**Purpose:** provide a provider-neutral infrastructure boundary while preserving DDD dependency direction.

Read [the package instructions](./AGENTS.md) and [the domain ownership guide](../../docs/engineering/DOMAIN_OWNERSHIP.md).

## Principles

- Domain/bounded contexts own their aggregate and repository contracts.
- Application workflows depend on domain-owned ports, not database clients.
- Provider adapters implement repository ports and translate between domain contracts and provider-specific persistence.
- Keep database lifecycle and transaction semantics explicit.
- Do not flatten relational and document databases into a generic CRUD/query API.
- Select a concrete provider only when a real consumer's consistency, query, deployment, operational, and recovery requirements are understood.

## Roadmap

- [x] Create the provider-neutral package boundary with no database driver or ORM dependency.
- [x] Define a minimal adapter lifecycle contract: connect, provider-managed transaction, close.
- [x] Implement concurrency-safe lifecycle handling, transaction draining during shutdown, retry after failed connect/close, and explicit invalid-state errors.
- [x] Add deterministic tests for lifecycle, transaction delegation, concurrency, failure propagation, and cleanup.
- [ ] Integrate the boundary with the first domain-owned repository contract when a consumer is selected.
- [ ] Evaluate PostgreSQL, MongoDB, and Node.js built-in SQLite against actual consumer requirements before choosing a provider.
- [ ] Add the selected provider adapter and its contract/integration tests without leaking provider types into domain policy.
- [ ] Define schema/migration, indexing, backup/recovery, connection pooling, and deployment procedures as part of the selected provider decision—not before it.

## Current contract

`createDatabase({ adapter })` returns a frozen lifecycle facade exposing `connect()`, `transaction(work)`, `close()`, and a read-only `state`.

- Concurrent `connect()` calls share one provider connection attempt.
- A failed connection returns to `disconnected` and may be retried.
- Transactions require `connected`; provider transaction errors propagate unchanged.
- Shutdown moves to `closing`, rejects new transactions, waits for in-flight transactions, then closes the adapter.
- A failed close remains in `closing` and can be retried; transactions remain blocked.
- Closing an unused database transitions directly to `closed`.
- The transaction context is opaque to this package.

## Explicit non-goals

This package does not own domain aggregates, domain repository interfaces, generic CRUD, SQL builders, MongoDB collection abstractions, ORM models, schema/migration tooling, or an application-wide data model. Those decisions require concrete consumer needs and a selected persistence provider.

## Completion policy

A roadmap item is complete only after implementation is merged into `develop` and required validation passes. Provider selection and persistent consumer adoption remain open; this initial package boundary does not claim that Coinzilla has a working persistent database configured.
