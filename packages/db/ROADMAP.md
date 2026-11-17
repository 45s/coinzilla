# Database roadmap

---
status: active
type: roadmap
owner: db
---

## Purpose and ownership

`@coinzilla/db` is a provider-agnostic database infrastructure package.

Its responsibility is to expose a consistent database API to consuming applications while hiding the concrete database engine and driver. The package owns database contracts, provider selection/registration, provider adapters, connection lifecycle, CRUD operations, transaction coordination, and provider-specific infrastructure.

It must not know about any consuming application's business domain.

**This roadmap is exclusively about generic database capabilities.** It must not contain application-specific entities, repositories, schemas, migrations, workflows, trading concepts, or business rules. Those belong in the owning application's roadmap and bounded context.

## Architecture contract

- Consumers depend on the public `@coinzilla/db` API, not on a concrete provider or driver.
- Concrete provider selection and configuration happen at the outer composition boundary. Application/domain policy must not branch on provider identity.
- Provider adapters implement the package's provider-neutral contracts.
- The public API must not leak `node:sqlite`, SQLite statement/connection types, SQL syntax, MongoDB driver types, PostgreSQL client types, or provider-specific result objects.
- Keep provider-specific implementation details inside their respective infrastructure adapters.
- Define portable behavior explicitly. Do not claim that providers have identical capabilities where they do not.
- Do not introduce ORM, query builder, entity modeling, business repositories, or application-specific abstractions.
- Keep dependencies minimal. The initial SQLite provider must use Node.js built-in `node:sqlite`, with no external database driver.

## Provider strategy

### First provider — Node.js built-in SQLite

SQLite is the initial concrete adapter because it is embedded, file-backed, and available in the supported Node.js runtime without a separate database server or third-party driver.

The provider implementation must remain replaceable through the public database contract.

### Future providers — PostgreSQL and MongoDB

PostgreSQL and MongoDB are possible future adapters, not current implementation requirements.

Add a provider only when a real consumer requirement justifies it. Each provider must implement the same supported public contract or explicitly declare unsupported optional capabilities. Do not add speculative drivers or dependencies.

## Delivery roadmap

1. **Audit the existing package and public API.**
   - Review current domain, application, provider port, SQLite adapter, lifecycle, transactions, migrations, tests, package exports and dependency graph.
   - Identify which existing APIs are provider-neutral and which currently expose SQLite/SQL details.
   - Preserve working functionality and backward compatibility where required by existing consumers.
   - Record concrete gaps before changing implementation.

2. **Define the provider-neutral database contract.**
   - Define the smallest useful public API for database lifecycle and generic record CRUD: create/insert, read/find, update, and delete.
   - Define identifiers, records, filters, projections, ordering, pagination, result shapes, not-found behavior, duplicate-key behavior, and error categories without exposing a provider's native types.
   - Specify the portable query/filter subset supported by every implemented provider. Avoid exposing raw SQL or Mongo query documents as the common contract.
   - Define transaction semantics and whether transactions are a required capability or an explicitly discoverable optional capability. Never silently emulate atomicity when a provider cannot guarantee it.
   - Keep the API cohesive; do not build a speculative universal data platform.

3. **Implement and prove the SQLite adapter.**
   - Implement the provider-neutral CRUD contract using Node.js built-in `node:sqlite`.
   - Keep SQL statements, SQLite schema mechanics, row mapping and driver error translation inside the SQLite adapter.
   - Use prepared statements and bound parameters.
   - Preserve exact values supported by the public record contract; do not silently coerce values or use lossy representations.
   - Keep transactions short and synchronous where required by the built-in SQLite API.
   - Add contract tests against real in-memory and temporary file-backed SQLite databases.

4. **Provider conformance and lifecycle tests.**
   - Test create/read/update/delete, filtering, sorting, pagination, identifiers, duplicate handling, missing records, error translation, transaction commit/rollback, close/reopen, and resource cleanup.
   - Test concurrent access and lock timeout behavior appropriate to SQLite.
   - Establish a reusable provider contract test suite so future adapters must prove the same portable semantics.
   - Verify that no provider-specific types or errors escape the public API.

5. **Provider configuration and selection.**
   - Define a single explicit composition API for selecting/configuring a provider.
   - Validate provider configuration at startup and fail clearly for unknown or unsupported providers.
   - Keep credentials, connection strings and filenames in provider configuration, not in domain/application policy.
   - Ensure consumers do not need provider-specific conditionals.

6. **Migration and schema capabilities.**
   - Audit the current migration API and distinguish portable migration orchestration from provider-specific schema changes.
   - Keep generic migration lifecycle/history behavior in the package only where it can be defined consistently.
   - Allow provider-specific migration implementations where relational DDL and document-store evolution genuinely differ.
   - Do not force SQL migrations or relational schema assumptions onto MongoDB.

7. **Future provider implementation — only when justified.**
   - Add PostgreSQL or MongoDB as a separate adapter with its own driver dependency and infrastructure tests.
   - Run the shared provider conformance suite.
   - Document capability differences and reject unsupported operations explicitly.
   - Prove a consumer can switch providers through composition/configuration without changing its domain/application code.

## Existing foundation — implemented

- [x] Establish `@coinzilla/db` package and workspace integration.
- [x] Implement Node.js built-in `node:sqlite` without an external SQLite driver or ORM.
- [x] Support in-memory and file-backed SQLite databases.
- [x] Enable foreign-key enforcement and WAL for file-backed databases.
- [x] Support configurable SQLite lock timeout.
- [x] Implement transaction commit/rollback and reject nested or asynchronous transaction callbacks.
- [x] Implement ordered, atomic, versioned SQLite schema migrations and migration-history validation.
- [x] Add deterministic tests using real in-memory and temporary file-backed SQLite databases.
- [x] Separate database lifecycle domain, application provider port/use case, and SQLite infrastructure adapter.

## Current implementation boundary

The current public API includes `createDatabase({ adapter })` for provider lifecycle composition and `createSqliteDatabase({ filename, timeout })` for the concrete SQLite implementation.

The current SQLite API exposes SQL-oriented operations to infrastructure consumers. It is therefore a useful SQLite foundation, but it is **not yet proof of a complete provider-neutral CRUD API**.

The next priority is to define and implement the generic contract without leaking SQL or SQLite types. Do not move application-specific repository contracts into this package.

Node's built-in SQLite API is synchronous. Statements, transactions and migrations block the event loop while executing. Transaction callbacks and migration functions must remain synchronous; do not put network calls, timers or awaited work inside transactions.

## Explicit non-goals

- No application-specific domain entities, repository ports, business schemas, migrations, or workflows.
- No ORM, query builder, or business-object mapper.
- No PostgreSQL/MongoDB implementation until justified by a real requirement.
- No promise of identical semantics across providers where their capabilities differ.

## Completion policy

A roadmap item is complete only after implementation is merged into `develop` and required validation passes. Provider portability is not proven by an interface alone: every provider must pass the shared conformance contract, and at least one real consumer must demonstrate that provider selection does not leak into its domain/application code.
