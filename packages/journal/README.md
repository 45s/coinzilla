# @coinzilla/journal

Durable JSONL event recording with bounded restart reading and deterministic replay.

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

New records use a versioned envelope with schema version 1 and a stable record ID. Existing raw event JSONL records are supported as legacy schema-v1 records.

## Reading after restart

Create a stopped Journal instance and read before starting its writer:

```js
const journal = new Journal({ eventBus, directory: "./data/journal" })
const result = await journal.read({
  maxRecords: 100_000,
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

Sessions are ordered lexicographically by their timestamped filenames; records retain their line order within each session. Each record includes its source filename and 1-based line number.

The reader rejects duplicate IDs across all sessions. It accepts legacy raw event records with a non-empty `id` and the current versioned envelope. Unknown schema versions are rejected. A non-empty session must end in a newline; an incomplete final line is reported and preserved unchanged. Journal does not auto-truncate or discard it.

Recovery is bounded by configurable `maxRecords`, `maxBytes`, and `maxRecordBytes`. Defaults are 100,000 records, 64 MiB total, and 1 MiB per record. Exceeding a limit fails the entire read; increase limits deliberately when the retained history requires it.

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

Only one writer may own a journal directory at a time. Read/replay is available while the Journal instance is stopped (before `start()` or after `close()`); it is rejected while that instance is writing.
