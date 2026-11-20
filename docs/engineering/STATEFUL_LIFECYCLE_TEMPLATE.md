---
title: Stateful lifecycle component template
status: active
type: engineering-guide
owner: repository engineering
created: 2026-11-21
---

# Stateful lifecycle component template

Use this optional pattern when a component owns a resource or process lifecycle across multiple calls. The component owns its state transitions; callers interact through operations and read-only state, not by mutating internal flags.

## When to use it

Use a stateful lifecycle component when behavior depends on prior operations, for example:

- connecting, starting, stopping, closing or recovering a resource;
- coordinating concurrent callers for one in-flight operation;
- tracking active work that must finish before shutdown; or
- preventing new work after a component begins closing.

Do not introduce a class or state machine for a stateless calculation. Keep the state machine with the domain/application owner that owns the lifecycle; an infrastructure adapter should implement the port, not own the consuming application's workflow.

## Define the lifecycle before implementation

Write down the valid states, transitions, failure outcomes and idempotency rules before coding. A transition table should answer:

| Current state | Operation/event | Next state | Required behavior |
|---|---|---|---|
| Initial | Start/connect | Starting/connecting | Coalesce concurrent starts where one resource must be created |
| Starting/connecting | Success | Ready/connected | Publish readiness only after the resource is actually ready |
| Starting/connecting | Failure | Initial/disconnected or explicit failed state | Preserve the cause; define whether retry is safe |
| Ready/connected | Stop/close | Stopping/closing | Reject new work and drain already accepted work |
| Stopping/closing | Cleanup succeeds | Stopped/closed | Make repeated stop/close idempotent |
| Stopping/closing | Cleanup fails | Explicit retryable/failed state | Do not claim the resource is closed; define a safe retry |
| Stopped/closed | Start/connect | Rejected or new generation | Follow the documented restart contract; never infer it |

This is a design worksheet, not a universal state vocabulary. Use names that describe the owning domain's actual lifecycle. Add states only when they distinguish observable behavior or safety.

## Implementation boundaries

- Keep mutable lifecycle state private; expose a read-only state or snapshot.
- Inject external resource operations through a narrow port. Do not construct concrete sockets, databases, timers or clients inside domain policy.
- Make concurrency ownership explicit: coalesce duplicate starts, serialize or reject conflicting transitions, and define what shutdown does with active work.
- Define failure and retry semantics for every transition. A failed close must not be reported as closed; a failed start must not leave a false ready state.
- Keep resource cleanup and listener/timer removal in the owner that created them.
- Do not expose internal maps, promises, timers or mutable state collections to callers.

## State-transition test matrix

Use a deterministic fake port and deferred promises to control completion order. Avoid real sleeps and network dependencies.

| Behavior | Evidence the test should assert |
|---|---|
| Initial state | The component starts in the documented initial state |
| Successful start | The state changes only after the port reports success |
| Failed start | The error propagates and state matches the documented retry contract |
| Concurrent start | One external start occurs; all callers observe the same settled result |
| Invalid operation | Work is rejected before readiness or after shutdown begins |
| Active work during stop | Stop waits for accepted work before closing the resource |
| Repeated stop | Cleanup is invoked once and callers share the in-flight result |
| Failed cleanup | The component remains in its documented retryable/failed state |
| Restart | A stopped component either rejects restart or creates a new explicit generation |

Test public behavior and port calls, not private fields or helper invocation counts without a contract reason. Use named-field assertions and detailed messages. Include cleanup in `finally` for tests that open resources.

## Repository example

The Database package's [`createDatabaseEntity`](../../packages/db/src/domain/entities/database.js) owns the provider-neutral connection lifecycle. Its state is private, provider operations are injected, concurrent connection/close calls are coalesced, transactions are tracked, and shutdown drains active transactions before closing the provider.

The [lifecycle tests](../../packages/db/src/application/use-cases/create-database.test.js) exercise the observable contract: connecting/connected/closing/closed states, failed-connect retry, idempotent close, concurrent calls, active-transaction draining, rejection of new work during close, and retry after a failed close. The direct [entity tests](../../packages/db/src/domain/entities/database.test.js) cover provider construction requirements.

This is a resource-lifecycle example, not a requirement that every domain entity use a mutable class. Immutable value objects and pure transition functions may be better for other domains.

## Before adding a stateful component

- Confirm that state across calls is a real domain/application requirement.
- Identify the single lifecycle owner and the port through which external effects occur.
- Document valid states, transition rules, idempotency, concurrency and failure recovery.
- Add transition tests before changing behavior; use controlled promises/fake timers for race cases.
- Update the owning domain's instructions, roadmap and operational docs when its lifecycle contract changes.
- Follow the [Modularity Standard](MODULARITY_STANDARD.md), [Testing Standard](TESTING_STANDARD.md), and the owning domain's instructions.
