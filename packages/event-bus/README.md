# @coinzilla/event-bus

An in-process, asynchronous event dispatcher for code running in one Node.js process.

## Basic usage

```js
import { EventBus } from "@coinzilla/event-bus"

const bus = new EventBus()

const subscription = bus.subscribe({
  name: "order.filled",
  handler: async (event) => {
    console.log(event.data.orderId)
  },
})

const result = bus.publish({
  name: "order.filled",
  source: "exchange-adapter",
  data: { orderId: "order-123" },
})

if (!result.ok) {
  // The event was not accepted. Inspect result.errors.
}

await bus.flush()
subscription.subscription.unsubscribe()
await bus.close()
```

## Public contract

### Event names and inputs

- Event names are preserved exactly and must be 1–128 ASCII characters.
- A name starts with a letter, digit, or underscore; subsequent characters may also include `.`, `:`, or `-`.
- `source` must be a non-empty string (whitespace-only strings are rejected).
- `data` defaults to an empty object and must be a non-array object.
- Constructor options are `logger`, `onError`, and `maxPending`. Unknown options are rejected. `maxPending` is a positive safe integer and defaults to 1,000.

### Payload snapshot

Accepted payload graphs contain only primitives, arrays, and plain objects (including null-prototype objects). Cycles and repeated/shared references are preserved. The bus clones the graph before dispatch and freezes the cloned objects, arrays, and event envelope. The caller's original objects are not frozen or retained.

Mutable built-ins (including `Date`, `Map`, `Set`, typed arrays, `ArrayBuffer`, and `DataView`), class instances, functions, accessors, symbol-keyed properties, and unsupported object shapes are rejected. The bus does not claim to make those values immutable.

### Publish and delivery

- `publish()` performs input validation, payload snapshotting, capacity admission, event-envelope creation, and delivery scheduling synchronously.
- A successful result means the complete fan-out was accepted and scheduled; it does **not** mean handlers have completed.
- Publishing an event with no matching subscribers succeeds and returns its event envelope.
- Matching named subscribers and `subscribeAll` subscribers each receive the same frozen event object.
- Handler calls are scheduled asynchronously. All accepted deliveries may run concurrently; there is no per-subscriber serialization or completion-order guarantee. A handler's asynchronous work may finish before or after another handler's work, including work for a later publish.
- The current implementation does not promise durable delivery, cross-process delivery, retries, or exactly-once side effects.

### Capacity and overload

`maxPending` limits the total number of pending handler deliveries across the whole bus, not the number of published events. Before scheduling any handler for a publish, the bus checks whether the entire fan-out fits. If it does not fit, `publish()` returns a failure and no subscriber receives that event. Capacity is released as deliveries settle. A publish with zero matching subscribers consumes no pending capacity.

### Handler errors

A synchronous throw or rejected handler promise is isolated from other handlers. The bus reports the failure through the configured asynchronous or synchronous `onError(context)` callback when supplied; otherwise it calls `logger.error(entry)` when available. The context includes the original event, its name, and the error; the default structured log also includes event ID and source. A failure in the error reporter is converted to a process warning and does not become an unhandled rejection. Handler failures do not retroactively change the result returned by `publish()`.

### Unsubscribe

Calling a subscription's `unsubscribe()` prevents that subscription from being selected for future publishes. It does not cancel a delivery that was already accepted and scheduled. The first successful call reports `unsubscribed: true`; subsequent calls report `false`.

### Flush and close

- `flush()` waits until all currently pending deliveries settle, including additional events published by those handlers. It resolves with a success result when the pending set becomes empty.
- A handler that never settles can keep `flush()` pending indefinitely.
- `close()` marks the bus closed synchronously, so subsequent publishes and subscriptions are rejected. It waits for already accepted deliveries to settle and clears subscription registries. Unlike `flush()`, it does not accept nested publishes attempted by handlers after shutdown begins.
- `close({ timeoutMs })` can bound the wait for pending work. `timeoutMs` must be an integer from 1 through 2,147,483,647 milliseconds. If it expires, the result has `ok: false`, `timedOut: true`, and a timeout error. The bus remains closed, subscriptions are invalidated, and already accepted handlers continue running; a later `close()` call can wait for them to drain. The timeout does not forcibly cancel handler work.
- Repeated and concurrent close calls are supported; each caller waits for the pending work to drain (or for its own configured timeout).

### Diagnostics

`getDiagnostics()` returns a frozen snapshot containing `pendingCount`, `maxPending`, and `closed`. The snapshot is detached from internal state; changing it cannot affect the bus.

## Operational limitations

This is an in-memory, single-process dispatcher. It is not a durable queue or a distributed message broker. A process crash can lose accepted but unfinished work. Applications that need crash-safe processing should persist events or use an outbox at the application boundary. Consumers that perform externally visible side effects should implement their own idempotency strategy.

## Tests

From the repository root:

```sh
pnpm --filter @coinzilla/event-bus test
pnpm --filter @coinzilla/event-bus test:coverage
```

The coverage command enforces package-specific minimums of 90% line coverage and 85% branch coverage using Node's built-in test runner. It requires Node.js 22.8 or newer (the repository CI runs Node.js 22). The package runtime itself remains compatible with Node.js 20 and newer.
