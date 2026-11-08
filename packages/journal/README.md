# @coinzilla/journal

Durable JSONL event recording with bounded restart reading and deterministic replay.

## Public API and event vocabulary

Journal stores the events it receives; it does not decide what those events mean to the business. Keep these concepts distinct:

- **Domain event:** a business fact named and owned by the domain that produces it (for example, an order being filled). Journal does not infer domain meaning from an event name or payload.
- **EventBus message / source event:** the event delivered to Journal by the injected EventBus subscription. Journal consumes the event object as supplied; it does not reclassify it as a domain or integration event.
- **Persisted Journal record:** the source event's fields retained at the JSONL top level, plus Journal-owned schema and identity metadata under the reserved `__coinzillaJournal` key.
- **Recovered record:** the read/replay representation derived from a persisted line. It separates Journal identity and schema from the event payload and adds the source file and 1-based line position.

A source event is an object with a non-empty string `id`. That stable ID becomes the Journal record identity; Journal does not generate a replacement ID or deduplicate records by business meaning. The reserved `__coinzillaJournal` metadata key cannot be supplied by the source event. A source event must not define an own enumerable callable `toJSON` method: object spread copies that hook onto the persisted record, where JSON serialization could use it to replace the complete Journal envelope. Journal rejects this root-level serialization hook; non-enumerable or inherited methods are not copied into the record.

A current schema-v1 JSONL line preserves all source event fields at the top level and adds `__coinzillaJournal: { schemaVersion: 1, id: event.id }`. Reading returns `{ id, schemaVersion, payload, position }`: `payload` contains the original event fields without the reserved metadata, and `position` contains `{ fileName, lineNumber }` with a 1-based line number.

Legacy JSONL lines written before the metadata field existed remain readable as schema-v1 records: their top-level object is the payload, and its non-empty `id` supplies record identity. Unknown schema versions and malformed identities fail closed.

Replay passes each recovered record to the consumer as `{ record }`, in session/line order, only after the complete snapshot has been validated. The consumer owns interpretation, application restoration, and idempotent handling. Replay is at-least-once; it is not a command dispatcher or an exactly-once side-effect mechanism.

Construct `Journal` with an EventBus, a directory path, and an optional logger. Journal uses only the EventBus operations `subscribeAll({ handler })` and `flush()`; the returned subscription must expose `unsubscribe()`. EventBus owns message delivery. Journal owns its persisted representation and storage lifecycle.

| Method | Observable contract |
| --- | --- |
| `start()` | Creates the directory if needed, acquires exclusive writer ownership, creates a session, and subscribes to EventBus messages. A second active writer for the same directory is rejected. |
| `record({ event })` | Appends one validated source event in queue order. A successful result means the write completed and reports `durable: false`; it does not confirm file-content sync. |
| `flush()` | Flushes EventBus delivery, waits for queued writes, and syncs the active session file. Success reports `durable: true`; failure does not claim durability. |
| `close()` | Unsubscribes, drains queued writes, syncs and closes the session, and releases the lock owned by this instance. A failed close remains a failed durability outcome on repeated calls. |
| `read(options)` | Reads and validates a complete bounded snapshot while this Journal instance is stopped. It does not acquire a cross-process reader lock. |
| `replay(options)` | Validates the complete snapshot, then awaits the handler sequentially for each recovered record. A handler failure stops replay and reports completed progress. |

Methods return the package's result objects; callers should check `ok` and inspect `errors` on failure. Detailed durability, recovery limits, lock handling, and replay guarantees are described below.

## Writing and durability

```js
const journal = new Journal({ eventBus, directory: "./data/journal" })

const started = await journal.start()
if (!started.ok) throw started.errors[0]

eventBus.publish({ name: "order.filled", source: "broker", data: { orderId: "42" } })

// A successful record() means the JSONL write completed, not that the OS
// has confirmed the file contents on durable storage. The session directory
// is single-writer; directory-entry fsync is not part of this acknowledgement.
const flushed = await journal.flush()
if (!flushed.ok) throw flushed.errors[0]
// flushed.durable === true only after the queued writes and file-content sync succeed.

const closed = await journal.close()
if (!closed.ok) throw closed.errors[0]
```

A transient file-content sync failure after queued writes have completed does not poison the active Journal writer: a later `flush()` on the same instance can retry the sync and make those earlier writes durable. If a caller republishes the same logical audit after an unconfirmed flush, Journal stores that publication as a new record; a later successful sync can make both records durable. Journal does not deduplicate records by business meaning. This is at-least-once publication, so consumers must use stable record IDs and idempotent processing rather than deleting, overwriting, or deduplicating historical evidence. A `writeFile()` failure is different: it poisons the active Journal instance, and later writes/flushes continue failing until operator-level recovery or process restart.

New records retain the original event fields at the JSONL top level and add a reserved `__coinzillaJournal` metadata field containing schema version 1 and the stable record ID. This additive shape preserves compatibility with existing consumers that read event fields directly. Existing raw event JSONL records without metadata are supported as legacy schema-v1 records.

## Directory ownership

Every active writer owns its directory through an exclusive `.coinzilla-journal.lock` file. This prevents cooperating Journal instances in separate processes from creating concurrent session writers. The lock is a process-lifecycle guard, not a durability acknowledgement; directory-entry fsync remains outside the Journal durability contract.

## Reading after restart

Create a stopped Journal instance and read before starting its writer:

```js
const journal = new Journal({ eventBus, directory: "./data/journal" })
const result = await journal.read({
  maxRecords: 100_000,
  maxSessions: 10_000,
  maxBytes: 64 * 1024 * 1024,
  maxRecordBytes: 1024 * 1024,
})

if (!result.ok) {
  // Fail closed: malformed, incomplete, duplicate, unsupported, or oversized
  // history is not returned as a successful partial snapshot.
  throw result.errors[0]
}

for (const record of result.records) {
  // record = { id, schemaVersion, payload, position }
  await restoreIdempotently({ record })
}
```

Sessions are ordered by timestamp and then numeric collision suffix (the unsuffixed file first); records retain their line order within each session. Each record includes its source filename and 1-based line number.

The reader rejects invalid UTF-8 and duplicate IDs across all sessions. It accepts legacy raw event records with a non-empty `id` and the current additive metadata format. Unknown schema versions are rejected. A non-empty session must end in a newline; an incomplete final line is reported and preserved unchanged. Journal does not auto-truncate or discard it.

Recovery is bounded by configurable `maxSessions`, `maxRecords`, `maxBytes`, and `maxRecordBytes`. Defaults are 10,000 sessions, 100,000 records, 64 MiB total, and 1 MiB per record. Exceeding a limit fails the entire read; increase limits deliberately when the retained history requires it.

## Sequential replay

```js
const result = await journal.replay({
  handler: async ({ record }) => restoreIdempotently({ record }),
})

if (!result.ok) {
  // result.replayed counts handlers that completed before the failure.
  // A handler can have applied effects before a later handler fails.
  throw result.errors[0]
}
```

The complete journal is validated before the first handler runs. Handlers then execute sequentially in deterministic order. If a handler fails, replay stops and reports `replayed` and `failedRecordId`. Replay is not exactly-once: a process can crash after a handler applies a record but before the caller durably checkpoints that application. Consumers must make replay idempotent using the stable record ID and must reconcile external systems independently.

A Journal writer acquires `.coinzilla-journal.lock` with exclusive file creation before creating a session file. The lock records the owning process ID and acquisition time for diagnostics, and requests owner-only file permissions where the filesystem supports them. A competing writer receives `JOURNAL_DIRECTORY_LOCKED`; it must not remove or overwrite the existing lock. The lock is released only after the active session has been synchronized and its file handle closed. Startup rollback also releases a lock acquired by that attempt.

A process crash can leave a stale lock. Journal never removes an existing lock automatically because it cannot safely distinguish a crashed owner from a live writer. Before manually removing `.coinzilla-journal.lock`, an operator must independently confirm that no process is still writing to the directory. The recorded PID and timestamp are diagnostic hints, not proof that the lock is stale.

Read/replay is available while the Journal instance is stopped (before `start()` or after `close()`); it is rejected while that instance is writing. Read/replay does not acquire a separate lock, so callers must ensure no other process is writing while they read. A concurrent read can observe an incomplete tail and will fail closed rather than return a partial history. The directory must already exist for read/replay: a missing directory returns `JOURNAL_DIRECTORY_NOT_FOUND` instead of being treated as an empty history.


## Harvester startup account preflight records

Harvester emits two durable lifecycle records on every connected startup, whether trading is enabled or not: `account.snapshot_captured` with `data.phase = "PREFLIGHT"` contains all balances with exact decimal free, locked, and total quantities plus exchange source time; `account.open_orders_captured` with the same phase contains account-wide open orders and their broker/client identifiers, symbol, side, type, price, original/executed quantities, and status. Open-order readiness is `READY` only for an empty result; otherwise it is `BLOCKED` with explicit reasons. Each event is followed by a successful `Journal.flush()` before Harvester proceeds to market subscriptions or engine activation. Existing orders remain externally owned; these records are observations, not adoption instructions.


## Development and coverage

Run the deterministic Journal tests and the package-scoped coverage gate from the repository root:

```sh
pnpm --filter @coinzilla/journal test
pnpm --filter @coinzilla/journal test:coverage
```

The coverage command measures only Journal-owned implementation files under `src/` (including `src/helpers/`) and excludes test files and imported workspace dependencies. CI enforces a minimum of 85% line coverage and 80% branch coverage for the Journal package.
