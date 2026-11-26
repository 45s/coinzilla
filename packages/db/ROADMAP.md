# Database roadmap

---
status: active
type: roadmap
owner: db
---

## Purpose

The accepted architecture is recorded in [ADR-0001](./docs/decisions/0001-provider-neutral-record-crud-api.md); see the [local documentation index](./docs/README.md).

`@coinzilla/db` provides a provider-neutral record CRUD and transaction API. Node.js built-in `node:sqlite` is the first concrete provider; the dependency-free MongoDB infrastructure adapter is being completed under issue #1865. The package owns generic persistence infrastructure contracts only; application domains own their business entities, schemas and repository interfaces.

## Official MongoDB driver reference strategy — #1865

**Decision recorded:** use the official MongoDB Node.js driver as a pinned source-level reference and selectively port/adapt small, proven implementation units where that is safer than independent reinvention. Do not vendor the complete driver or its public API. The adapter remains Node.js-built-ins-only and must preserve the provider-neutral Database API and infrastructure boundary.

- Reference: [mongodb/node-mongodb-native](https://github.com/mongodb/node-mongodb-native), inspected version `mongodb@7.9.1`, commit [`2ed780df2a57884c3fa597da9ebbb6256ae0a5ea`](https://github.com/mongodb/node-mongodb-native/commit/2ed780df2a57884c3fa597da9ebbb6256ae0a5ea), Apache-2.0.
- Its runtime dependencies include `@mongodb-js/saslprep`, `bson` and `mongodb-connection-string-url`; none may be introduced into this package. Copying it wholesale would violate our dependency and scope constraints.
- The component mapping, pinned upstream paths, review order, mandatory RED/GREEN workflow, non-goals and Apache-2.0 attribution ledger are maintained in [Official MongoDB driver reference and selective-port strategy](./docs/mongodb-driver-reference-strategy.md).
- Selective source adaptation is permitted only when a concrete defect/requirement and regression test justify it. Every adapted unit must record exact upstream file/commit, license, local destination and modifications; preserve notices and mark changed files. Specs remain normative.
- No upstream implementation has been copied by this documentation decision. The attribution ledger currently has no entries.

## Dependency-free MongoDB provider — #1865

**Status: In progress.** Implementation PR [#1868](https://github.com/45s/coinzilla/pull/1868) targets `develop`; assessment and original scope are recorded in [PR #1866](https://github.com/45s/coinzilla/pull/1866).

### Current implementation

The provider is implemented as an infrastructure adapter under `src/infrastructure/mongodb/` and is exported through the package entry point.

- Bounded BSON encoding/decoding for the JSON record contract and internal binary/date/int64 values.
- OP_MSG framing, response correlation and document-sequence handling.
- TCP/TLS transport with bounded pending requests, socket buffering, command timeouts and cleanup.
- Single-seed hello negotiation, topology detection and replica-set primary redirection.
- SCRAM-SHA-256 and SCRAM-SHA-1 authentication using `node:crypto`.
- Provider-neutral CRUD/query command mapping, cursor batch draining, duplicate/error normalization and topology-dependent transaction handling.
- Replica-set/sharded transactions with logical sessions, snapshot reads, majority commit, abort handling and explicit ambiguous commit outcomes; standalone multi-document transactions fail explicitly.
- In-flight CRUD and transactions participate in provider shutdown draining.
- Deterministic fake-transport tests, shared provider-conformance coverage and opt-in real-server integration tests through `MONGODB_URI`.

The public CRUD API remains provider-independent. MongoDB collections, BSON, commands, sessions, cursors, sockets and native errors remain inside infrastructure. No MongoDB driver, BSON package or other external runtime dependency is added.

**Current verification:** the first exact-head DB test run exposed stale SCRAM nonce fixtures and handshake error-message expectations; these were corrected in `b4ed871e1e3d17fd1300dc7952fafb96b6ac082d`. The next exact-head DB run then exposed a parse-time syntax error in the BSON int32 minimum constant (`-2 ** 31`), preventing the BSON module and dependent provider tests from loading; corrected to `-(2 ** 31)` in `dd7e21adf4cd8ae81d955f6fbf0d85d654275ef3`. That run also exposed stale URI error-message assertions and an endless-SCRAM fixture whose server nonce did not match the 24-byte deterministic client nonce; corrected in `d34a289262513d6502b41f413f34ceac5a6289fd`. A test-first regression was added in `aaad863e21354850957e393ac8224159719ac165` and corrected in `64f6fdd8c8d95f0901c747e382acac906f0224ec` to enforce MongoDB URI semantics: when a URI path is present, its default authentication database remains authoritative even if the explicit `databaseName` option changes the target database; an explicit URI or option `authSource` takes precedence. When no URI is supplied, the configured `databaseName` or `admin` is the default. The provider/parser correction is in `c5d7ca829eeb92865f56056bd4a9f54e368c6930`. The next exact-head DB run (`d134a1beff3bdabb97fb114302c40bf387f49a9d`) progressed past module loading and exposed additional failures: transaction capability rejection was synchronous where the public async contract expects a rejected promise; nested-transaction rejection did not use the dedicated transaction-unsupported error; cursor test fixtures omitted the mandatory cursor id; provider transaction fixtures compared encoded collection names to raw names; and transport tests captured the fake socket before connection plus supplied incomplete fake sockets. These were corrected test-first/implementation increments in `ccb0d1295f7218ad1181a72037fdbaf29df136d5` and `d9c06bd427169462e0f5cdbc41e94c7817391bc3`. The API now returns explicit promise rejections for unsupported transaction requests, returns `DatabaseTransactionUnsupportedError` with `context.capability: "nestedTransactions"` when nested transactions are unsupported, and delegates nested calls to the provider when the capability is true. README transaction semantics were synchronized in `94e96d3d9c9b4140f2a3d796e274205802dcf12f`. A post-fix test/coverage result is not yet available. The `d134` coverage report was 93.15% lines, 88.88% branches and 96.39% functions, below package thresholds; the exact-head changed-file ESLint check also failed. These quality gates remain recorded for follow-up as requested, not treated as a reason to stop functional implementation. A further transaction-safety review found that a synchronous `socket.write()` throw was marked as sent before the socket accepted the frame, which could incorrectly classify a definitely-unsent write as outcome-unknown. A regression test was added first in `588d1224c796d27ce2e6da0b47961a4377b02285`; the transport now resets the sent marker in the synchronous-throw path (`49b9b3ee1216ccb7c8c9a5fc099d0dba35d1c616`). Callback-reported and interrupted writes remain outcome-unknown when the frame may have reached the server. The opt-in integration cleanup path was also aligned with the provider's effective authentication source and now redirects a replica-set secondary seed to the primary before dropping only the generated test database, including when the supplied URI requests directConnection. This prevents cleanup from using a different auth database or attempting a cluster-wide drop on a secondary. A later exact-head review found seven fake-socket tests missing the `transport` binding after the fixture migration; all bindings were restored in `c4c84b3508247469f40781277afdfd2655e1939e`. No post-fix test result is claimed. No live MongoDB result is claimed.

**Remaining acceptance work:** complete the final adversarial protocol/authentication and lifecycle review; inspect the corrected exact-head package test result when available; run package tests, coverage and lint when a runnable checkout is available; and verify command semantics against the MongoDB server versions, topologies and authentication modes used in deployment. No live-server result is claimed.

Supported protocol generations, topology/authentication limits, BSON subset, transaction guarantees and explicit exclusions are documented in [MongoDB provider support and limitations](./docs/mongodb.md). The roadmap remains in progress until the implementation PR is merged and all required validation passes on its exact final head.

### Official-source review finding — BSON Timestamp

A source-level comparison with the official driver and its separate `mongodb/js-bson` dependency found a signedness defect in our BSON decoder: BSON Timestamp (type `0x11`) is unsigned 64-bit, but the previous implementation decoded it using a signed int64 read. A regression test was committed first (`73494aa26b6059428ecf61a9584f273ecc88cc7a`), followed by the unsigned decoder correction. See [the official-driver reference strategy](./docs/mongodb-driver-reference-strategy.md) for the pinned source evidence and review method. This is an independently implemented fix, not copied upstream code. A second SCRAM review added strict Base64 validation for server signatures after demonstrating that Node's permissive decoder ignores invalid trailing characters; the test-first regression is `32dad94bfaab85e559cb6a34cb97b2802b8a3afe`. A third protocol review replaced the OP_MSG response sequence map with a null-prototype object after a regression demonstrated that the `__proto__` identifier otherwise mutates the map prototype; test-first commit `30cb243927dfd8b172b2a6edeebe431c94201ff9`. A fourth transaction review now distinguishes a definitely-unsent commit from an interrupted commit request that may have reached MongoDB; regression tests are in `94f24123ddfac6156f12c61e07b624d6f8bafc83`.

### Audit conclusion

The accepted provider-neutral architecture has enabled MongoDB to be implemented as an infrastructure adapter. The public `createDatabase({ provider })` facade, asynchronous provider transaction contract, immutable capability declarations, and reusable provider-conformance suite keep MongoDB details out of consumer-facing CRUD without redesigning application APIs.

Relevant existing contracts and implementation:

- `src/application/ports/database-provider.js` — provider contract and capability types.
- `src/domain/contracts/record.js` — JSON-safe record validation and portable query normalization.
- `src/domain/entities/database.js` — lifecycle, active-transaction tracking and close-time draining.
- `src/infrastructure/sqlite/provider.js` — existing provider behavior and error mapping.
- `test-support/provider-conformance.js` — shared provider contract suite.
- [ADR-0001](./docs/decisions/0001-provider-neutral-record-crud-api.md) — accepted provider-neutral architecture.

MongoDB is a network database, unlike built-in `node:sqlite`. Without an external driver, a MongoDB provider must own a deliberately limited client implementation: TCP/TLS transport, wire-protocol framing and request correlation, BSON encoding/decoding, handshake/authentication, CRUD command mapping, session/transaction behavior where supported, connection lifecycle and provider-error normalization.

### Dependency and implementation constraints

- Node.js built-ins only. Do not add a MongoDB driver, BSON package, ORM, query builder, or other external runtime dependency.
- Keep MongoDB-specific code under `src/infrastructure/mongodb/`; do not leak BSON values, MongoDB documents/commands, sessions, sockets, or native errors through public APIs.
- Implement only the protocol surface required by the existing database contract. Do not recreate the full official MongoDB driver.
- Preserve record validation, collection/id isolation, duplicate-to-`DatabaseConflictError` mapping, shallow updates, missing-record results, exact scalar equality, portable sorting/pagination, lifecycle and transaction behavior.
- Declare actual query, transaction, topology and storage capabilities. Unsupported guarantees must fail explicitly rather than be silently emulated.
- MongoDB multi-document transactions require a replica set or sharded cluster. A standalone server must not be advertised as providing equivalent transaction guarantees. Commit uncertainty must never be reported as a confirmed rollback.
- Keep application schemas, repositories, business entities, trading/Harvester concepts and consumer integrations outside this package.

### Initial effort estimate

**Approximately 3–5 weeks for one experienced Node.js developer** for a production-oriented, deliberately limited implementation, including protocol/BSON work, authentication, CRUD, transactions, reliability, conformance and documentation. This is a planning estimate, not a delivery commitment; refine it when supported server versions, topology, authentication, TLS and protocol scope are finalized.

### Proposed implementation phases

1. **Protocol and scope:** select supported MongoDB server versions, wire protocol messages, BSON subset, handshake/authentication mechanisms, TLS/configuration requirements, timeouts, message-size limits and explicit exclusions.
2. **BSON codec:** implement the minimum correct BSON types needed by the public JSON record contract; cover nested objects/arrays, strings, booleans, null, numeric values and any required date/ObjectId representation. Reject unsupported values safely.
3. **Transport and wire protocol:** TCP/TLS lifecycle, message framing, request IDs, response correlation, concurrent requests, bounded buffers, malformed frames, timeouts, socket failures and shutdown.
4. **Handshake and authentication:** negotiate supported wire versions and implement the selected SCRAM flow using `node:crypto`; fail closed on unsupported mechanisms and invalid server responses.
5. **CRUD/query adapter:** map existing CRUD and query semantics to MongoDB commands, including collection isolation, duplicate handling, equality, portable sorting/pagination and shallow updates.
6. **Sessions and transactions:** support transactions only on eligible replica-set/sharded deployments; correctly handle commit uncertainty and retry rules. Explicitly reject unsupported topologies.
7. **Conformance and reliability:** run the shared provider-conformance suite against an isolated real MongoDB server in an opt-in/controlled CI integration environment. Keep default tests offline and deterministic; use fake transport and protocol fixtures for codec, framing, command mapping, malformed responses, authentication and failure paths.
8. **Documentation and release readiness:** document provider composition, configuration, supported server/topology/authentication matrix, capabilities, limitations, operational requirements, test setup and proof that no external runtime dependency was added.

### Acceptance gates

- Public composition uses the existing provider-neutral facade; no consumer-side provider branching.
- No external runtime dependency is added for MongoDB, BSON, transport, authentication or ORM functionality.
- Supported server versions, topology, wire protocol, authentication and BSON subset are explicit and tested.
- Codec/protocol tests cover malformed and adversarial input, resource limits, timeouts and transport failures.
- CRUD/query semantics pass the shared conformance suite for every declared capability.
- Transaction guarantees distinguish standalone from replica-set/sharded deployments; unknown commit outcomes remain explicitly unknown.
- Connection concurrency, reconnect, close/drain and error normalization are covered.
- Existing SQLite behavior and public APIs remain compatible.
- Package/workspace checks and required CI pass on the exact final PR head.

Default unit tests remain offline, deterministic and credential-free. Real MongoDB integration/conformance must be explicitly opt-in or use a controlled CI service; it must not silently depend on a developer's local server or credentials.

## Application-owned relational schema infrastructure — #1486

**Status: Done.** [PR #1489](https://github.com/45s/coinzilla/pull/1489) merged into `develop` on 2026-11-19 as `ee38250521d6386ce53b080b4fb6414812cf9e91`. All required checks passed on the exact final PR head before merge.

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
- No speculative PostgreSQL adapter implementation. MongoDB is the scoped, approved additional provider under issue #1865; do not expand it beyond the documented Database API contract.
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
   - The dependency-free MongoDB provider is now an approved, tracked initiative under [issue #1865](https://github.com/45s/coinzilla/issues/1865); see the scope, phases and acceptance gates above.
   - PostgreSQL remains deferred until measured deployment topology, concurrent writers, availability, dataset size or query requirements justify it.
   - Every new adapter must pass the provider-conformance suite and declare actual capability differences. Do not claim portability for guarantees a provider cannot provide.

## Completion policy

A roadmap item is complete only after implementation is merged into `develop`, relevant tests and coverage pass, required CI passes on the exact final PR head, and affected living documentation is current.
