# MongoDB provider support and limitations

## Architecture

createMongoProvider(options) is an infrastructure adapter for the provider-neutral createDatabase({ provider }) API. All MongoDB-specific behavior is confined to src/infrastructure/mongodb/: connection URI parsing, TCP/TLS transport, OP_MSG framing, BSON, hello negotiation, SCRAM, commands, sessions and topology facts.

The public API remains record-oriented. It does not expose MongoDB collections, BSON values, cursors, sessions, command documents, sockets or server errors. MongoDB records are stored in provider-owned collections with an encoded collection namespace and an internal document envelope. Inserts use OP_MSG document sequences so a near-limit BSON record does not also have to fit inside the command body. User keys are encoded so user-controlled keys cannot collide with the envelope or become MongoDB operator paths.

## Support matrix

| Area | Supported behavior | Explicit limitation |
| --- | --- | --- |
| Server protocol | OP_MSG; wire-version overlap 13–25 | Legacy OP_QUERY and unsupported OP_MSG sections/flags are not implemented |
| Server generations | MongoDB 5.0–8.0 protocol generations | No compatibility claim beyond the wire-version range |
| Topology | Standalone, replica set, sharded/mongos | Single seed only; no SRV, multi-seed discovery or topology monitoring |
| Transport | TCP and TLS | One socket per provider; no pool or transparent failover |
| Authentication | No authentication, SCRAM-SHA-256, SCRAM-SHA-1 | No X.509, PLAIN, GSSAPI, AWS or other mechanisms |
| SCRAM-SHA-256 password preparation | Printable ASCII | Unicode SASLprep is not implemented; non-ASCII/control input is rejected |
| CRUD | Create, read one/many, shallow update, delete | Only the package's generic record contract |
| Queries | Exact scalar equality, scalar sort, offset/limit | No operators, projections, aggregation API or user-defined MongoDB queries |
| BSON | JSON contract plus internal binary/date/int64 and ObjectId decoding | Unsupported BSON types are rejected |
| Transactions | Multi-document transactions on replica sets/sharded clusters with logical sessions | Standalone transactions are rejected; no nested transactions |
| Retry behavior | Bounded retry of ambiguous commit results; non-transactional writes are never replayed and may raise `DatabaseOperationOutcomeUnknownError` if the response is lost | No retryable writes |

The protocol implementation accepts a server when its advertised wire-version range intersects the supported range 13–25. This is a protocol compatibility gate, not a substitute for testing every server patch release. Real-server integration should cover the exact MongoDB versions used in deployment.

## Connection configuration

The provider accepts either uri or connectionString, or explicit connection fields:

- host, port (default 27017)
- databaseName (default admin)
- username, password, authSource (with a URI, defaults to its path database or admin if no path is supplied; with explicit fields and no URI, defaults to databaseName or admin)
- authMechanism (SCRAM-SHA-256 or SCRAM-SHA-1)
- replicaSet
- directConnection (defaults to false; prevents replica-set primary redirection when true; a replica-set secondary target is rejected because only primary routing is supported)
- readPreference=primary only; other read preferences are rejected
- retryWrites=false only; retryable writes are not implemented
- tls (true for Node TLS defaults, or a TLS options object)
- connectTimeoutMS (default 10,000)
- socketTimeoutMS (default 30,000)

When a URI supplies a path database, an explicit databaseName option changes the target database but does not change the URI-derived authSource; set authSource explicitly to override it. Explicit options override matching URI values. Supported URI options are authSource, tls or ssl (not both), authMechanism, replicaSet, directConnection, readPreference=primary, retryWrites=false, loadBalanced=false, empty compressors, and connection/socket timeouts. Unknown or repeated options are rejected. The URI form is deliberately restricted to one mongodb:// seed. mongodb+srv:// and comma-separated hosts are rejected. Do not place credentials in source control; pass secrets through the runtime's secret/configuration mechanism.

## Authentication behavior

SCRAM-SHA-256 and SCRAM-SHA-1 are supported. SCRAM-SHA-256 passwords must be printable ASCII because full Unicode SASLprep is not implemented. Usernames must be printable ASCII. The server-final proof is checked using strict Base64 alphabet/padding validation and a canonical round-trip before constant-time signature comparison; Node's permissive Base64 decoder must not silently ignore malformed characters.

## BSON and record mapping

The public record contract remains JSON-only. The codec supports strings, finite numbers, booleans, null, nested plain documents, dense arrays and the internal binary/date/signed-int64 forms. BSON Timestamp (type 0x11) is decoded as an unsigned 64-bit integer, returned as a Number when safe and otherwise as BigInt. Document nesting is limited to 100 levels. ObjectId values decode to their hexadecimal string representation. The provider rejects malformed lengths, truncated values, unsupported BSON element types, sparse arrays, accessors, non-plain objects, circular structures and documents above the 16 MiB BSON limit.

Database names and authentication source names are validated against portable MongoDB naming rules and limited to 63 UTF-8 bytes. The encoded database-plus-collection namespace is limited to 255 bytes. MongoDB document keys are not stored verbatim: keys are encoded with a reserved provider prefix and base64url representation. This protects user keys that begin with $ or contain dots from MongoDB field-path/operator interpretation. The collection name is encoded independently to isolate each logical collection. The provider stores the record's public id in MongoDB's internal _id and hides the storage envelope on reads.

## Query semantics

The adapter maps the shared query contract to MongoDB commands and aggregation stages:

- Equality is exact for top-level scalar fields. Explicit null matches BSON null only and does not match a missing field.
- Sort rank follows the shared order: missing/null, false, true, number, string. Direction applies to each sort key; the record identifier remains an ascending stable tie-breaker.
- Offset and limit are applied after filtering and sorting.
- Updates are shallow top-level merges. Updating the record identifier is rejected by shared validation.
- Duplicate MongoDB _id errors map to DatabaseConflictError; other server/transport failures map to DatabaseProviderError.

The adapter drains cursor batches with getMore. A failed cursor operation triggers best-effort killCursors cleanup and is surfaced; the provider does not expose the cursor to callers. Each provider read boundary accepts one logical read operation; getMore requests are internal parts of that read.

## Transaction guarantees

Standalone MongoDB servers cannot provide multi-document transactions. The provider declares multiDocument: topology-dependent; the public transaction facade delegates to the provider, which checks the connected topology and logical-session support before running the callback. On standalone deployments it throws DatabaseTransactionUnsupportedError without invoking user work.

On supported replica-set and sharded deployments:

1. One logical session ID and monotonically increasing transaction number are created per transaction.
2. The first database command starts a snapshot transaction.
3. Every callback operation uses that session and transaction number with autocommit: false.
4. A callback failure triggers abort. If abort also fails, both errors are preserved.
5. A successful callback commits with majority write concern. A commit frame rejected before dispatch is reported as a provider failure, not an unknown outcome; if a prior attempt may have reached the server, later failures cannot erase that ambiguity.
6. Commit attempts are bounded. If the final result cannot be confirmed, DatabaseTransactionOutcomeUnknownError is thrown.

An unknown commit outcome is not a rollback. Application code must reconcile the affected records/state before deciding whether to retry. The provider never automatically replays a transaction callback. A non-transactional create/update/delete whose request was sent but whose response is lost raises `DatabaseOperationOutcomeUnknownError`; the provider does not replay the write. A read timeout or a write rejected before it is sent remains a `DatabaseProviderError`.

## Lifecycle and failure behavior

- The provider has a single-use lifecycle, consistent with the composed database facade. Create a new provider/database instance after closing.
- The transport bounds message size, pending requests and queued socket bytes; replies are correlated by request ID. OP_MSG response document-sequence maps use a null prototype so server-supplied identifiers such as `__proto__` remain ordinary keys.
- Malformed frames or socket errors fail the connection and reject pending commands.
- Per-command timeouts reject that command. They do not replay the command.
- Provider-neutral database shutdown waits for active transactions and in-flight CRUD operations before closing the transport.
- There is no automatic reconnect, server discovery refresh, heartbeat monitor or transparent failover. On connection loss, treat the operation as failed/ambiguous according to the operation and reconcile before retrying non-idempotent work.

## Testing

Default unit tests are offline and deterministic. They cover BSON codec validation, OP_MSG framing and correlation, transport fragmentation/concurrency/timeouts/cleanup and interrupted-write outcome classification, URI parsing, hello/topology negotiation, SCRAM exchanges/signature verification, command mapping, provider CRUD and transaction commit/abort/unknown outcomes.

The shared provider-conformance suite is the authoritative contract for CRUD/query/lifecycle behavior. A real-server conformance suite is available in mongodb.integration.test.js and is opt-in through MONGODB_URI:

```sh
MONGODB_URI='mongodb://test-user:test-password@localhost:27017/admin?authSource=admin' pnpm --filter @coinzilla/db test
```

The integration suite creates a distinct database name for each test from the configured URI database name and an opaque test key, then drops only that generated database after the provider connection closes. The test account therefore needs permission to create and drop databases. Use a dedicated disposable MongoDB instance or test cluster, not a production database. The integration suite checks the shared CRUD/query/lifecycle contract and attempts transaction rollback; standalone topologies skip transaction verification explicitly. The deterministic unit tests remain offline and credential-free.

A test suite using fake transports does not prove compatibility with a live MongoDB server. Record the exact server version, topology and authentication mode whenever real-server conformance is run.


## Official driver reference

The implementation may consult and selectively adapt small, proven parts of the official MongoDB Node.js driver, but it does not vendor or recreate that driver. The pinned source baseline, component-by-component mapping, dependency analysis, mandatory porting workflow and Apache-2.0 attribution requirements are documented in [the official-driver reference and selective-port strategy](./mongodb-driver-reference-strategy.md). This package remains Node.js-built-ins-only; the official driver's `bson`, SASL preparation and connection-string dependencies must not be added as runtime dependencies.
