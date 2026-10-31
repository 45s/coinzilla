# Event Bus Reliability Roadmap

> Status: active engineering plan
> Package: `@coinzilla/event-bus`
> Primary objective: make the package bug-resistant, predictable under failure, fully tested, and easy for humans and AI agents to change safely.

This document is the source of truth for event-bus hardening work. Read it before changing this package. Do not treat the roadmap as permission to implement every future feature at once: work in small, reviewable steps and keep this document updated as decisions change.

## 1. Mission and non-goals

The event bus is an in-process application primitive. Its primary responsibility is reliable, understandable event dispatch inside one Node.js process.

Priorities, in order:

1. Correctness and explicit semantics.
2. Failure isolation and bounded resource use.
3. Deterministic behavior and comprehensive regression tests.
4. Clear diagnostics and maintainability.
5. Performance, but only when measured.

The package does **not** promise durability across process crashes, distributed delivery, or exactly-once side effects. Do not imply those guarantees. If an application needs crash-safe delivery, design a durable log/outbox at the application boundary.

Avoid unnecessary dependencies and framework-like abstractions. Prefer small, composable, pure functions.

## 2. Mandatory instructions for AI agents and contributors

Before editing:

- Read this roadmap, the complete implementation, its tests, and package metadata.
- Inspect actual call sites and consumers before changing public behavior.
- Check the current branch and working tree; never overwrite concurrent work.
- Identify the public contract affected by the change.
- Add a failing regression test before fixing an existing bug whenever practical.

While implementing:

- Prefer **pure functions** wherever possible. A pure function has explicit inputs, deterministic outputs, and no hidden I/O or mutation.
- Keep side effects at narrow boundaries: event dispatch, timers, logging, UUID/time generation, and lifecycle coordination.
- Extract validation, event-envelope construction, payload normalization, queue calculations, and policy decisions into small pure helpers when this improves clarity.
- Inject nondeterministic dependencies (clock, ID factory, scheduler) when tests need deterministic control. Do not over-engineer injection where it adds no value.
- Use immutable data and avoid mutating caller-owned objects.
- Preserve existing public API compatibility unless a deliberate breaking change is approved and documented.
- Never silently swallow errors, silently drop critical events, or claim delivery guarantees the implementation cannot provide.
- Bound queues, retries, and waits. Every overload and timeout policy must be explicit.
- Do not add automatic retries without considering duplicate side effects and idempotency.
- Do not add persistence or distributed-messaging features to this package without an explicit architectural decision.
- Keep changes focused. Do not mix unrelated refactors with bug fixes.

Testing requirements:

- Every bug fix must include a regression test that fails before the fix.
- Test observable public behavior, not private implementation details, except where a narrow unit test materially improves confidence.
- Prefer deterministic synchronization (deferred promises/barriers) over arbitrary sleeps.
- Test success, invalid input, thrown errors, rejected promises, re-entrancy, concurrency, shutdown, and boundary conditions.
- Every test-created bus must be closed with `await`; avoid leaked timers, listeners, or pending work.
- Run package tests first, then relevant workspace tests and repository quality checks.
- Do not claim tests passed unless they were actually executed. Report commands and outcomes accurately.
- Maintain package-specific coverage gates. Coverage is a guardrail, not a substitute for meaningful assertions.

Before finishing:

- Review the final diff for API changes, accidental complexity, dead code, and untested branches.
- Update this roadmap when scope, guarantees, or implementation status changes.
- Summarize behavior changes, tests run, known limitations, and follow-up work.

## 3. Engineering standards

### 3.1 Functional core, imperative shell

Use a functional-core/imperative-shell structure:

- Pure core: validation, normalization, envelope construction, routing decisions, queue policy, and state transition calculations.
- Imperative shell: reading the clock, generating IDs, scheduling handler execution, calling handlers, logging, and managing process lifecycle.

Pure functions should not access global state, mutate arguments, perform I/O, or depend on wall-clock time. Pass dependencies explicitly where deterministic testing requires it.

Do not force purity into inherently stateful operations. The dispatcher and lifecycle manager will necessarily own state; keep that state small and transitions explicit.

### 3.2 API and semantics

The public contract must document:

- What a successful `publish()` means (accepted for dispatch vs. all consumers completed).
- Whether publishing with no subscribers is successful.
- Whether delivery is synchronous or asynchronous.
- Ordering guarantees and concurrency behavior.
- Whether handlers receive one shared immutable event snapshot.
- How handler failures are reported.
- What happens when the queue is full.
- What `flush()` waits for, including events published by handlers.
- What `close()` guarantees and how timeouts behave.
- Whether unsubscribe affects already-started deliveries.

Never use ambiguous terms such as "reliable" or "exactly once" without defining the guarantee.

### 3.3 Payload contract and immutability

Define an explicit supported payload type contract. `structuredClone()` support alone does not imply that values are immutable.

Audit at minimum:

- Plain objects, arrays, primitives, cycles, and shared references.
- `Date`, `Map`, and `Set`.
- Typed arrays, `ArrayBuffer`, and `DataView`.
- Class instances, accessors, symbol properties, and functions.
- Prototype-sensitive keys and unusual object prototypes.

Do not claim deep immutability for mutable built-ins unless mutation is actually prevented. Either implement and test safe wrappers/normalization or reject unsupported mutable types with a clear validation error. Preserve cycles only if they are an intentional supported contract.

### 3.4 Failure and resource safety

- One consumer failure must not prevent unrelated consumers from receiving an event.
- Error reporting itself must not create unhandled rejections.
- Pending work must be observable and bounded or governed by an explicit overload policy.
- Shutdown must have documented timeout/cancellation behavior.
- Event names must not trigger host-runtime control behavior.
- No unhandled promise rejections, unhandled EventEmitter error events, or unbounded background work.
- Avoid global process side effects such as changing global listener limits.

### 3.5 Code style

- Follow the repository's JavaScript ESM and Node.js conventions.
- Use descriptive names and small functions with one responsibility.
- Prefer early returns and explicit branches over clever expressions.
- Avoid hidden mutation and broad catch blocks that obscure failure.
- Keep comments focused on non-obvious reasoning and invariants.
- Add JSDoc for non-obvious public contracts and exported types/options.
- Avoid dependencies unless a clear reliability or maintenance benefit is demonstrated.

## 4. Audit summary

The initial static audit found a solid small foundation:

- Structured event envelopes with generated IDs and timestamps.
- Payload cloning before dispatch.
- Asynchronous consumer execution and failure isolation.
- Error reporting hook.
- Unsubscribe handles.
- `flush()` and `close()` lifecycle methods.
- Tests for basic dispatch, cloning, nested freezing, cycles, error handling, and shutdown.

The audit also identified these risks:

1. **Incomplete immutability:** `Object.freeze()` does not make `Date`, `Map`, `Set`, and all typed/binary values immutable. Map/Set instance-method overrides can be bypassed through prototype methods.
2. **Host event-name semantics:** using Node's `EventEmitter` exposes special names such as `newListener` and `removeListener`, which can violate the event-envelope contract.
3. **Unbounded pending work:** every delivery creates a promise and enters an unbounded pending set; no backpressure or overload policy exists.
4. **Shutdown can hang:** a handler that never settles can block `flush()` and `close()` forever.
5. **Ordering is unspecified:** asynchronous handlers may complete out of publish order.
6. **Logging context mismatch (addressed in this change):** the event bus now passes one structured object, matching the repository Logger's single-argument contract.
7. **Subscription lifecycle ambiguity:** close removes listeners without synchronizing subscription-handle state.
8. **Validation gaps:** constructor options and event-name normalization/reserved semantics need an explicit contract.
9. **Coverage gap:** package-level coverage thresholds and several adversarial tests are missing.

These are audit observations to verify against the current implementation before each fix; do not blindly apply stale line numbers or assumptions.

## 5. Roadmap and acceptance criteria

### Phase 0 — Contract and baseline

- [ ] Document publish, delivery, ordering, error, unsubscribe, flush, and close semantics.
- [ ] Decide supported payload types and immutability guarantees.
- [ ] Inspect all in-repository consumers for compatibility constraints.
- [ ] Capture baseline test results and package coverage.

Acceptance: public behavior is documented and tests encode the intended contract.

### Phase 1 — Correctness

- [x] Remove Node EventEmitter special-name behavior from event dispatch.
- [ ] Define and enforce truly safe payload immutability.
- [x] Align structured logging with the repository logger contract (single structured argument).
- [ ] Validate constructor options and normalize/reject malformed event names.
- [x] Make subscription state consistent after close.
- [ ] Add regression tests for every corrected defect.

Acceptance: all accepted events have consistent envelopes; event names cannot trigger host runtime behavior; payload guarantees are accurate and tested.

### Phase 2 — Bounded async delivery and lifecycle

- [ ] Define per-subscriber/global concurrency semantics.
- [ ] Add bounded pending work and an explicit overload policy.
- [ ] Add pending-work diagnostics.
- [ ] Add shutdown timeout and clear timeout result semantics.
- [ ] Consider cooperative cancellation via `AbortSignal`.
- [ ] Test nested publishes, re-entrancy, slow/hung handlers, concurrent close, and overload.

Acceptance: resource use is bounded or explicitly controlled; shutdown cannot wait forever without a defined timeout result.

### Phase 3 — Observability and test quality

- [x] Use structured error context consistently (message, error, event ID, event name, and source).
- [ ] Expose useful counters/gauges without leaking mutable internal state.
- [ ] Add deterministic race/concurrency tests and bounded stress tests.
- [ ] Add package-specific line and branch coverage gates.
- [ ] Document examples, limitations, and operational behavior.

Initial coverage target: at least 90% lines and 85% branches, with all critical error/lifecycle branches tested. Revisit thresholds based on meaningful branch coverage; do not add tests solely to inflate percentages.

Acceptance: CI enforces the package gate and failures are diagnosable.

### Phase 4 — Optional advanced capabilities

Only implement when real consumers require them:

- [ ] Sequential delivery per subscriber or partition.
- [ ] Bounded retry policies with idempotency guidance.
- [ ] Dead-letter handling.
- [ ] Additional performance/memory benchmarks.

Acceptance: each feature has a documented use case, failure semantics, tests, and no accidental weakening of the core contract.

## 6. Required regression matrix

At minimum, maintain tests for:

- Valid and invalid event names, sources, constructor options, and payloads.
- Special-looking names including `error`, `newListener`, `removeListener`, and `__proto__`.
- No-subscriber publish behavior.
- Multiple matching subscribers and subscribe-all delivery.
- Sync throw, async rejection, and error-reporter throw/rejection.
- One consumer failure does not block other consumers.
- Snapshot isolation from caller mutation.
- Immutability of every supported nested payload type.
- Cycles/shared references if supported.
- Unsubscribe before dispatch, during pending delivery, after close, and repeated unsubscribe.
- Nested publish and flush waiting for transitively published events.
- Concurrent publish and deterministic ordering guarantees.
- Slow/hung handlers, queue saturation, overload behavior, and shutdown timeout.
- Concurrent/repeated close and publish/close races.
- Large but bounded workloads and absence of leaked work.

## 7. Commands and CI expectations

Run from the repository root:

```sh
pnpm --filter @coinzilla/event-bus test
pnpm --filter @coinzilla/event-bus test:coverage
pnpm test
pnpm run check:syntax
pnpm run quality
```

The package coverage script is a roadmap item until it exists. Do not report it as available before implementation.

CI should run package tests on every pull request. Coverage thresholds should be package-specific and should fail the workflow when violated.

## 8. Decision log

- Keep the package in-process and dependency-light.
- Prefer pure functions for deterministic decisions and transformations; keep side effects at explicit boundaries.
- Correctness and bug resistance take precedence over feature count and micro-optimizations.
- Do not create GitHub issues as a substitute for this roadmap; track progress here and in focused pull requests.
- Update this file whenever a guarantee, phase, or acceptance criterion changes.
