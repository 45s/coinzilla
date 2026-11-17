# Harvester ordinary persistence

**Tracking issue:** [#1327 — Provider-neutral DB API and Harvester persistence integration](https://github.com/45s/coinzilla/issues/1327)

**First slice:** Trading-session history

**Implementation status:** In progress in [PR #1369](https://github.com/45s/coinzilla/pull/1369). This slice is not complete until the exact PR head is green, merged into `develop`, and verified after merge.

## 1. Scope and authority

This database stores ordinary historical trading-session records for reporting and operational inspection. It is not a recovery store and is not evidence that a previous process is safe to resume.

The Harvester ADR-0001 Operational State Store remains the authoritative recovery evidence. Its file format, append acknowledgement, sequence, hash-chain, integrity verification, durability barriers, startup checks, and recovery policy are unchanged.

The session history observer consumes already-published Harvester lifecycle events and projects them into the database. It is an independent, best-effort read-side observer; it does not write to, replace, replay, or cut over the Operational State Store. The database is never consulted to restore process, order, portfolio, strategy, or exchange state.

Journal remains an observer. This work does not change Journal event ordering, acknowledgement, flush, durability, or failure semantics. The database observer queues its work and returns synchronously to the EventBus; it adds no Journal durability barrier and no trading-readiness gate.

If database preparation or a history write fails, Harvester logs a sanitized failure and continues without that historical projection. There is no fallback to the Operational State Store, no dual-write from an Operational State Store use case, and no silent provider/path fallback.

## 2. Ownership and dependency direction

`packages/db` owns generic provider-neutral record operations, provider composition/lifecycle, transaction contracts, capability declarations, and concrete database adapters.

Harvester owns the session model, lifecycle rules, repository port, use cases, identity/idempotency rules, environment isolation, and the read-side event observer.

Required dependency direction:

```text
Harvester Domain
       |
       v
Harvester Application
       |
       v
Harvester Repository Port
       ^
       |
Harvester Persistence Infrastructure
       |
       v
@coinzilla/db public API
       |
       v
Selected Provider (SQLite initially)
```

Domain, application, and strategy code must not import SQLite, SQL, database drivers, provider-native results, or provider-native errors. The infrastructure repository uses only the public `@coinzilla/db` facade. It does not create generic CRUD repositories in Harvester.

The repository port is deliberately narrow:

- `create(record)` — create a session, or return the original record for an identical duplicate.
- `findById(runtimeSessionId)` — read one historical session by its process/session identity.
- `transition({ id, status, endedAt? })` — atomically validate and apply one lifecycle transition.

The first slice does not add orders, order events, fills, account snapshots, imports, or recovery restoration.

## 3. Trading-session record schema

Collection name: `harvester_trading_sessions`

Application record schema version: `1`

The record ID is the existing immutable `runtimeSessionId` generated for the Harvester process. It is not a broker order ID and is not generated from mutable configuration.

Example (illustrative values):

```json
{
  "id": "runtime-session-001",
  "schemaVersion": 1,
  "runtimeSessionId": "runtime-session-001",
  "environment": "testnet",
  "broker": "binance",
  "strategyId": "CG_coinGrabber",
  "strategyMode": "conservative",
  "configurationFingerprint": "<64 lowercase SHA-256 hex characters>",
  "enabledMarkets": ["BTCUSDT", "ETHUSDT"],
  "buildProvenance": {
    "application": "harvester",
    "version": "1.0.001",
    "processId": 12345,
    "source": {
      "branch": "develop",
      "commit": "<40-64 hexadecimal Git SHA or null>",
      "shortCommit": "<first 8 SHA characters or null>",
      "commitMessage": "<bounded sanitized message or null>",
      "commitDate": "2026-11-17T15:00:00.000Z",
      "workingTree": "clean",
      "metadataSource": "git"
    }
  },
  "startedAt": "2026-11-17T16:00:00.000Z",
  "endedAt": null,
  "status": "STARTING",
  "metadata": {
    "recordKind": "ordinary-trading-history"
  }
}
```

### Field rules

| Field | Contract |
|---|---|
| `id`, `runtimeSessionId` | Same immutable process/session UUID |
| `schemaVersion` | Harvester-owned record schema version; currently `1` |
| `environment` | Explicit `testnet` or `live`; never inferred from `NODE_ENV` |
| `broker` | Canonical configured broker identity; initially `binance` |
| `strategyId`, `strategyMode` | Harvester-owned strategy identity and validated mode |
| `configurationFingerprint` | Existing non-secret SHA-256 effective-configuration digest; raw configuration and credentials are not stored |
| `enabledMarkets` | Unique canonical symbols, sorted before persistence |
| `buildProvenance` | Allowlisted, bounded process/build provenance from the existing sanitized process identity DTO |
| `startedAt`, `endedAt` | Canonical UTC ISO-8601 timestamps with milliseconds |
| `status` | Validated lifecycle state |
| `metadata` | Fixed bounded classification only; no arbitrary configuration or secret-bearing metadata |

The domain model rejects unknown environments, unsupported strategy modes, invalid timestamps, invalid fingerprints, malformed Git identity, duplicate/non-canonical markets, and invalid process IDs.

Do not add API keys, API secrets, tokens, account identifiers, raw configuration, full environment dumps, or arbitrary metadata to this record. Do not put secrets in database paths, logs, or configuration fingerprints.

## 4. Identity, duplicate delivery, and lifecycle

### Identity and duplicate handling

The unique record identity is the process/session UUID.

- Creating the same identity with the same immutable business facts is idempotent and returns the existing record, including its current lifecycle state.
- Reusing that identity with a different environment, broker, strategy, configuration fingerprint, market set, build provenance, or start timestamp raises `HARVESTER_TRADING_SESSION_IDENTITY_CONFLICT`.
- Provider failures are not treated as duplicate conflicts. They propagate through the repository port to the infrastructure observer boundary.

### Allowed lifecycle transitions

```text
                 +----------+
                 | STARTING |
                 +----------+
                   |      |
          started  |      | startup failed
                   v      v
              +---------+ +----------------+
              | RUNNING | | STARTUP_FAILED |
              +---------+ +----------------+
                   |
          shutdown | successful
                   v
              +---------+
              | STOPPED |
              +---------+
```

Allowed transitions:

- `STARTING -> RUNNING`
- `STARTING -> STARTUP_FAILED`
- `RUNNING -> STOPPED`

Repeating the current state is idempotent and does not rewrite the first terminal timestamp. Terminal states cannot be reopened. A failed shutdown does not falsely mark a session `STOPPED`; the historical record remains `RUNNING` until an independently valid terminal fact exists.

Lifecycle read/validate/update is one provider-neutral database transaction. The SQLite callback is synchronous, as required by its public capability declaration. The adapter does not return a Promise from a synchronous SQLite transaction callback. A provider declaring an asynchronous transaction callback mode is handled through an asynchronous callback without leaking provider identity into Harvester application code.

## 5. Event observer and failure behavior

The infrastructure observer listens to these existing lifecycle events:

| Event | History action |
|---|---|
| `CONFIG_VALIDATED` | Create `STARTING` record using process identity plus validated environment, strategy, enabled markets, and configuration fingerprint |
| `STARTED` | Transition to `RUNNING` |
| `STARTUP_FAILED` | Transition to `STARTUP_FAILED` with the event timestamp |
| `STOPPED` with successful outcome | Transition to `STOPPED` with the event timestamp |
| `STOPPED` with failed outcome | Do not claim a successful stop; retain the current state |

The observer serializes its own persistence queue so lifecycle events cannot overtake one another. Its EventBus handler returns immediately and does not await database I/O. EventBus/Journal publication and durability semantics remain unchanged.

On shutdown or startup cleanup, the observer queue is drained before its database resource is closed. Observer/database close failures are reported as ordinary-history cleanup errors; they do not weaken the existing Journal close decision or process-lock safety rules.

Database preparation uses the provider-neutral public API:

```js
const database = createDatabase({
  provider: createSqliteProvider({
    filename,
    timeout: 5_000,
  }),
})

await database.connect()
const repository = createTradingSessionRepository({ database })
```

The repository uses `create`, `readOne`, `update`, and `transaction`. It does not issue SQL or use SQLite prepared statements. Database composition and lifecycle are owned by Harvester infrastructure.

## 6. Production/Testnet file isolation

Only validated explicit `TRADING_MODE=testnet|live` selects the database environment:

| `TRADING_MODE` | Directory | Default file |
|---|---|---|
| `live` | `production/` | `apps/harvester/data/production/harvester.db` |
| `testnet` | `testnet/` | `apps/harvester/data/testnet/harvester.db` |

`NODE_ENV` is never used to select the trading environment or database file.

Optional configuration:

```bash
# Absolute base directory; Harvester creates separate production/ and testnet/ children.
HARVESTER_DATABASE_DIRECTORY=/absolute/path/to/harvester-data
```

Validation rules:

- A configured base directory must be an absolute, non-empty path and must not be a filesystem root.
- The resolver derives separate `production/harvester.db` and `testnet/harvester.db` paths; callers cannot supply one shared environment-specific filename.
- Both environment directories are canonicalized before opening the selected database.
- Directory overlap, database-file symlinks, and hard-linked production/Testnet files are rejected.
- The selected provider/database lifecycle is created independently by each process.
- Runtime database files are ignored by Git.

The regression test starts two actual Node.js processes concurrently. One uses `TRADING_MODE=live` with `NODE_ENV=test`; the other uses `TRADING_MODE=testnet` with `NODE_ENV=production`. Both write the same record ID and then reopen their own database. The test verifies that each file contains only its own environment's record.

An invalid path or failed provider connection disables only this non-authoritative history projection. There is no fallback to another path, file store, or provider.

## 7. Test coverage

The first slice uses the real SQLite provider for repository CRUD and persistence tests:

- unique session creation and identical duplicate retry;
- conflicting identity reuse as an integrity error;
- valid and invalid lifecycle transitions;
- immutable identity preservation;
- reopen/re-read of historical session data;
- transaction rollback;
- closed-database lifecycle failure;
- provider-neutral create/read/transaction error propagation;
- lifecycle event projection and unsuccessful-shutdown handling;
- two-process Production/Testnet isolation.

Mocks are used only to inject a provider failure at the observer/repository boundary. CRUD, uniqueness, transactions, rollback, and reopen behavior are exercised against real SQLite.

## 8. Explicit non-goals and later slices

The following remain separate reviewable migrations after this first slice is merged and verified:

1. Orders: canonical broker/client identity, order state, and lifecycle.
2. Order events: append-only ordering and source identity.
3. Executions/fills: exact decimal quantities, commissions, and idempotency.
4. Account snapshots: balances, open orders, timestamps, and provenance.
5. Historical import/reporting: explicit import, identity reconciliation, counts, and digest verification.
6. Operations: backup, restore, corruption/disk-full procedures, and rollback.
7. Architecture enforcement: tests proving provider independence of Harvester domain/application code.

Financial quantities in later slices must remain exact decimal strings or explicitly scaled integers. SQLite `REAL` and JavaScript floating-point values are prohibited for financial persistence.

### Operational State Store and restart recovery

No Operational State Store adapter or migration is part of this slice. Restart restoration remains disabled. Issue [#654](https://github.com/45s/coinzilla/issues/654) and ADR-0001 remain authoritative for any future recovery decision.

A database-backed Operational State adapter requires a separate gated decision, complete ADR-0001 parity evidence, crash/torn-write and durability tests, backup/restore proof, a rollback plan, and explicit #654 owner approval.
