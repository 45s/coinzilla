# ADR-0001: Provider-neutral record CRUD API

- Status: Accepted
- Date: 2026-11-17
- Owner: Database Infrastructure (`packages/db`)
- Issue: [#1340](https://github.com/45s/coinzilla/issues/1340)
- Implementation PR: [#1353](https://github.com/45s/coinzilla/pull/1353)

## Context

The package already provides a built-in SQLite lifecycle boundary, explicit transactions, and immutable schema migrations. Its public operations are SQL-oriented, however, so a consumer that uses persistence directly must understand SQLite statements and result shapes.

The approved direction is to let consumers use one provider-neutral CRUD API while keeping the concrete storage implementation behind an adapter. SQLite is the first provider; the dependency-free MongoDB adapter is the second provider, implemented under issue #1865. PostgreSQL remains a possible future provider, not a current implementation commitment.

The package must remain its own Database Infrastructure bounded context. It must not own business aggregates, business schemas, repositories, or trading/application concepts.

## Decision

### 1. Public record model

The generic API stores JSON records in named collections.

- A record is a JSON-safe plain object with a non-empty string `id`.
- Identifiers are unique within a collection; identifiers may repeat across collections.
- The public operations are `create`, `readOne`, `readMany`, `update`, and `delete`.
- Each operation accepts one named input object (for example, `{ collection, record }` for CREATE) rather than positional arguments.
- Updates are shallow merges and cannot change `id`.
- Missing records use explicit results: `null` for read/update and `false` for delete.
- Duplicate identifiers use the package-owned `DatabaseConflictError`.
- Invalid input uses `TypeError`; provider failures use `DatabaseProviderError`.

### 2. Query contract

The first portable query contract is deliberately small and declarative:

- Exact equality filters on top-level scalar fields.
- Ordered sorting on top-level fields.
- Positive `limit` and non-negative `offset`.
- A stable identifier tie-breaker for equal sort values.
- JSON types are significant; a missing field does not equal explicit `null`.

This is a plain data object, not a chainable query builder. New operators or nested-field behavior must be added to the provider-neutral contract and conformance tests before any provider implements them.

### 3. Provider boundary

- The application composition root selects and configures a provider.
- `createDatabase({ provider })` exposes provider-neutral CRUD, transaction, lifecycle and immutable capability information.
- A provider transaction callback receives only generic CRUD operations.
- Portable sorting uses `missing/null < false < true < number < string`; numeric values compare numerically, strings compare by binary UTF-8 order, and identifier tie-breaking is always ascending.
- The reusable conformance suite runs every declared storage mode and supports an optional provider-owned cleanup callback after all connections for an isolated key have closed.
- A provider implements `execute({ operation, input })` for atomic single-record mutations, `withReadTransaction(work)` for provider-neutral reads, and `withTransaction(work)` for explicit multi-operation transactions. The facade routes reads through the read-only boundary and mutations through single-operation execution. SQLite implements writes using its write transaction and reads using its read transaction; MongoDB uses atomic single-document commands and a read-only one-operation boundary.
- `transactions.multiDocument` is an explicit capability: `true`, `false`, or `"topology-dependent"`. The provider must reject an unsupported multi-document transaction before invoking user work. Standalone MongoDB reports topology-dependent capability and rejects the transaction after topology detection; replica-set/sharded deployments may support it when logical sessions are available.
- SQLite uses `BEGIN IMMEDIATE` for writes and `BEGIN DEFERRED` for reads. This preserves write reservation before read-modify-write operations while allowing WAL readers during a competing writer reservation.
- A synchronous callback provider cannot declare nested transactions because the facade's nested transaction call is asynchronous; capability validation rejects that incompatible declaration.
- Provider-native connections, SQL, statements, result objects and driver errors stay inside infrastructure.
- Provider capabilities must state the actual query, transaction and storage guarantees. Unsupported guarantees must not be silently emulated.
- The standard capability declaration describes transaction callback mode/nesting/multi-document guarantees, equality filtering/sorting/pagination, and supported storage modes (`file`, `memory`, `server`). The reusable conformance suite executes every declared storage mode with isolated keys; file/server modes must prove persistence across a new connection.

The original `createDatabase({ adapter })` lifecycle facade and `createSqliteDatabase(...)` low-level SQL/migration API remain available for compatibility and infrastructure use.

### 4. Initial providers

The SQLite adapter uses Node.js built-in `node:sqlite` only.

The SQLite adapter stores collection/id/JSON-record tuples in an internal table, uses prepared statements and bound values, and preserves the existing SQLite lifecycle, WAL, foreign-key, lock-timeout, synchronous transaction and cleanup behavior. It supports file-backed and in-memory databases.

SQLite transaction callbacks remain synchronous. They must reject async callbacks rather than committing before awaited work completes. A transaction context, prepared statements and iterators are valid only for the callback lifetime and are invalidated immediately after commit or rollback; retaining them must never permit SQL execution outside the transaction boundary.

The MongoDB adapter uses Node.js built-in modules only. It implements the required BSON subset, OP_MSG framing, TCP/TLS transport, hello/topology negotiation, SCRAM authentication, CRUD/query mapping and topology-dependent sessions/transactions under `src/infrastructure/mongodb/`. No MongoDB driver, BSON package or other external runtime dependency is permitted. Exact protocol, topology, authentication and transaction limitations are maintained in [`docs/mongodb.md`](../mongodb.md).

### 5. DDD ownership

- Domain owns provider-neutral record/query contracts, input validation, database error classification, lifecycle invariants and migration identity.
- Application owns CRUD orchestration and provider composition.
- Infrastructure owns concrete provider adapters, SQL, driver APIs, transaction mechanics and migration persistence.
- Consumer domains own business entities, schemas, repositories and business transaction policy.

## Alternatives considered

### Keep only a SQLite SQL API

Rejected as the only public API because each consumer would need SQLite knowledge and changing providers would require consumer-specific rewrites. The existing low-level API remains for infrastructure code and backward compatibility.

### Expose each provider's native CRUD API

Rejected because consumers would need provider-specific conditionals and provider-native error/result handling. That defeats the portability goal.

### Add an ORM or chainable query builder

Rejected because the task requires CRUD infrastructure, not object-relational mapping, schema generation, relationship management or a query language. A small declarative query object is sufficient for the initial contract.

### Build relational repositories or business schemas in this package

Rejected because repository and schema ownership follows the business bounded context. The database package must not become an application model registry.

## Consequences and trade-offs

- The generic API is a JSON record store, not a universal relational SQL interface. It does not expose joins, SQL expressions, arbitrary predicates or schema generation.
- The initial filter contract supports equality only. More expressive filtering requires evidence from real consumers and additional conformance tests.
- SQLite stores records as JSON text and evaluates supported filters/sorts using SQLite JSON functions. Query performance and indexing needs must be measured before adding generic indexing abstractions.
- JSON records require JSON-safe values. Consumers needing exact decimal or financial values should represent them using their owning domain's safe value contract rather than relying on JavaScript floating-point values.
- Provider differences remain visible through capabilities. The conformance suite defines shared guarantees but does not claim identical performance, deployment, concurrency or durability characteristics.
- The MongoDB adapter is an implemented second provider with explicit protocol and topology limits. No PostgreSQL adapter is promised; add one only when real deployment and consumer requirements justify it.

## Amendment — dependency-free MongoDB provider (2026-11-26)\n\nIssue [#1865](https://github.com/45s/coinzilla/issues/1865) implements MongoDB as the second infrastructure adapter. The amendment preserves the provider-neutral record/query model and adds the single-operation provider port plus explicit `transactions.multiDocument` capability so standalone MongoDB does not pretend to provide multi-document atomicity. MongoDB-specific protocol and serialization types remain infrastructure-only. See [PR #1868](https://github.com/45s/coinzilla/pull/1868) and [`docs/mongodb.md`](../mongodb.md) for implementation and support details.\n\n## Verification and implementation evidence

- Provider-neutral CRUD contract test and expected RED are recorded in PR #1353.
- SQLite provider conformance tests cover CRUD, collection isolation, duplicate handling, filtering, sorting, pagination, missing records, transaction rollback, declared nested-transaction rejection, capability immutability, both declared storage modes (memory and file), and persistence across a new file-backed connection. The reusable suite gives each test an isolated storage key and reuses it only for reconnect-persistence verification.
- A provider-specific concurrency regression proves read operations remain available while another connection holds an uncommitted write reservation; write operations still acquire an immediate write transaction and report lock failures through the shared provider error.
- SQLite connection/lock error normalization has separate test-first RED evidence in [closed evidence PR #1347](https://github.com/45s/coinzilla/pull/1347) and its [Actions run](https://github.com/45s/coinzilla/actions/runs/44050359180).
- Final acceptance depends on required CI passing on the exact final head and the implementation PR being merged into `develop`.
