# Event Bus Reliability Roadmap

> Status: hardening in progress
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

1. **Incomplete immutability (addressed):** payloads now accept only plain objects, arrays, and primitive values. Mutable built-ins, class instances, accessors, symbol keys, and unsupported object properties are rejected before cloning; accepted object graphs are cloned and frozen. Cycles and shared references remain supported.
2. **Host event-name semantics (addressed):** the explicit registry avoids Node EventEmitter special-name behavior; special-looking names are ordinary application names.
3. **Unbounded pending work (bounded and tested):** a global pending-delivery cap, atomic fan-out rejection, immutable pending/capacity/lifecycle diagnostics, re-entrant overload tests, slow-handler recovery, and bounded stress coverage now exist.
4. **Shutdown can hang (open):** a handler that never settles can block `flush()` indefinitely and can block `close()` indefinitely when no timeout is supplied; `close({ timeoutMs })` now offers a bounded wait without cancelling accepted handlers.
5. **Ordering (documented and tested):** handlers are scheduled asynchronously without per-subscriber serialization; completion order is not guaranteed.
6. **Logging context mismatch (addressed in this change):** the event bus now passes one structured object, matching the repository Logger's single-argument contract.
7. **Subscription lifecycle ambiguity (addressed):** close invalidates subscription handles and clears registries; repeated unsubscribe reports an inactive handle.
8. **Validation gaps (addressed in this change):** constructor options now reject malformed option objects, unknown keys, invalid logger hooks, and invalid error handlers. Event names are validated against a bounded, documented character set and preserved exactly; Node-special names remain ordinary application names.
9. **Coverage gate (addressed):** package-specific line/branch thresholds and negative self-checks are enforced by the Test Coverage workflow.

10. **Malformed public operation inputs (addressed in this change):** `publish`, `subscribe`, `subscribeAll`, and the internal subscription-registration boundary now return the package's standard failure result for null/non-object inputs and property accessors that throw, rather than leaking synchronous exceptions.

These are audit observations to verify against the current implementation before each fix; do not blindly apply stale line numbers or assumptions.

## 5. Roadmap and acceptance criteria

### Phase 0 — Contract and baseline

- [x] Document publish, delivery, ordering, error, unsubscribe, flush, and close semantics in `README.md`; keep this contract synchronized with tests and implementation.
- [x] Decide supported payload types and immutability guarantees: plain objects (including null-prototype objects), arrays, and primitive values only; cycles and shared references are preserved; mutable built-ins and non-data properties are rejected.
- [x] Inspect all in-repository consumers for compatibility constraints.
- [x] Capture baseline test results and package coverage. CI on PR #294: 77 package tests passed; source coverage was 99.54% lines and 98.63% branches (Node.js 22; [Unit Tests run](https://github.com/45s/coinzilla/actions/runs/41194370503), [Test Coverage run](https://github.com/45s/coinzilla/actions/runs/41194370511)).

Acceptance: public behavior is documented and tests encode the intended contract.

### Phase 1 — Correctness

Internal code is organized by responsibility: `event-bus.js` coordinates the public class; `helpers/event-name.js`, `helpers/options.js`, and `helpers/payload.js` own focused validation and payload transformation. Keep `index.js` as the public export boundary. Reserve `utils/` for genuinely shared, reusable primitives rather than one-off helpers.

Event names are preserved exactly when valid. They must be 1–128 ASCII characters, begin with a letter, digit, or underscore, and contain only letters, digits, underscore, period, colon, or hyphen. Names such as `error`, `newListener`, `removeListener`, and `__proto__` remain valid ordinary application names. Constructor options are a plain object with only `logger` and `onError`; `logger` is an object with an optional `error` function, and `onError`, when supplied, must be a function.

- [x] Remove Node EventEmitter special-name behavior from event dispatch.
- [x] Define and enforce truly safe payload immutability (reject mutable built-ins, accessors, symbol keys, and unsupported object shapes; clone and freeze supported data graphs).
- [x] Align structured logging with the repository logger contract (single structured argument).
- [x] Validate constructor options and reject malformed event names without rewriting accepted names.
- [x] Make subscription state consistent after close.
- [x] Add regression tests for corrected payload immutability defects.
- [x] Convert malformed public operation inputs and throwing input accessors into standard failure results; add regression coverage.

Acceptance: all accepted events have consistent envelopes; event names cannot trigger host runtime behavior; payload guarantees are accurate and tested.

### Phase 2 — Bounded async delivery and lifecycle

- [x] Define per-subscriber/global concurrency semantics: deliveries are scheduled asynchronously; there is no per-subscriber serialization; accepted deliveries can overlap; invocation is scheduled in fan-out order, but asynchronous completion order is not guaranteed.
- [x] Add deterministic tests that lock down the documented concurrency contract (multiple subscribers, multiple publishes, and out-of-order completion).
- [ ] Decide whether a future opt-in sequential mode is needed only after a real consumer demonstrates the requirement; do not add it as part of the default contract.
- [x] Add bounded pending work and an explicit overload policy (global pending-delivery cap; reject the whole publish before dispatch when its complete fan-out does not fit).
- [x] Specify the minimal diagnostics surface: pending delivery count, configured capacity, and closed/open lifecycle state; omit subscriber counts because they do not add necessary value to the first diagnostics surface.
- [x] Implement `getDiagnostics()` as a frozen scalar snapshot with no mutable Set/Map references.
- [x] Test diagnostics at idle, after accepted fan-out, after completion, after overload rejection, and after close; verify callers cannot mutate internal state.
- [x] Define backward-compatible `close({ timeoutMs })` semantics: timeout is an integer from 1 through 2,147,483,647 ms and bounds only the wait for drain; timeout returns `{ ok: false, timedOut: true, errors: [Error] }`; pending handlers continue, and a later `close()` may await their completion.
- [x] Define concurrent-close behavior: each caller observes its own timeout (if supplied); subscription cleanup is idempotent; timeout never reports a successful drain.
- [x] Implement bounded shutdown waiting without abandoning pending-promise rejection handling or leaking timers; no-argument behavior still waits for the full drain.
- [x] Test invalid timeout options, a never-settling handler, eventual settlement after timeout, repeated close, and concurrent close callers.
- [ ] Evaluate cooperative cancellation via `AbortSignal` only after timeout semantics are settled; document whether the signal is per close or per delivery and whether handlers are merely notified (not forcibly cancelled).
- [ ] Do not add cancellation to handler arguments unless its lifecycle and compatibility contract are specified and covered by tests.
- [x] Test overload boundaries, atomic fan-out rejection, capacity recovery, and concurrent publish saturation.
- [x] Replace arbitrary sleep-based lifecycle tests with deferred-promise/barrier synchronization.
- [x] Test nested publishes from sync and async handlers; prove `flush()` waits transitively for accepted nested work.
- [x] Test re-entrant publish at capacity and verify overload is atomic (no partial fan-out).
- [x] Test slow and never-settling handlers, including the documented flush/close behavior and later capacity recovery.
- [x] Test publish-vs-close, repeated close, and concurrent close callers; assert nested publishes attempted after close begins are rejected.
- [x] Add a bounded stress test with a fixed workload and explicit upper bounds; assert the pending count returns to zero and no test-owned work is left behind (80 publishes × 3 subscribers).

Acceptance: resource use is bounded or explicitly controlled; shutdown cannot wait forever without a defined timeout result.

### Phase 3 — Observability and test quality

- [x] Use structured error context consistently (message, error, event ID, event name, and source).
- [x] Implement the Phase 2 diagnostics API; expose only stable scalar snapshots and never the internal pending Set, listener Maps, or subscription records.
- [ ] Define counter meanings precisely (accepted/rejected publishes, scheduled/completed/failed deliveries, current pending and high-water mark) before adding any counters beyond the minimal gauges; avoid ambiguous or expensive instrumentation.
- [x] Use deferred promises/barriers rather than wall-clock sleeps for concurrency and lifecycle assertions.
- [x] Cover the documented concurrency model, fan-out admission atomicity, nested publish/flush, reporter failures, publish/close races, and simultaneous close callers.
- [x] Add bounded stress tests with deterministic workload sizes and assert zero pending work after drain.
- [x] Record a real baseline from `pnpm --filter @coinzilla/event-bus test` and `pnpm --filter @coinzilla/event-bus test:coverage`; attach command output/CI run to the implementation PR (77 tests passed; 99.54% lines / 98.63% branches; see Phase 0 CI links).
- [x] Confirm Node's built-in coverage output and the package test script work in CI; the package-specific command runs on Node.js 22 and excludes test files from the measured source set.
- [x] Add package-specific line and branch thresholds (>=90% lines and >=85% branches) to a CI-enforced command; the full suite passes the gate.
- [x] Add a negative CI self-check proving the package coverage command fails when a deliberately insufficient 100% line or branch threshold is configured.
- [x] Ensure the gate runs on every pull request that changes the package; the package-specific command is an explicit step in the Test Coverage workflow.
- [x] Document examples, limitations, and current operational behavior in `README.md` (including in-process scope, no durability, fan-out admission, errors, unsubscribe, flush, and diagnostics and bounded shutdown behavior).

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

- Valid and invalid event names (including whitespace, control characters, unsupported punctuation, and length boundaries), sources, constructor options, and payloads.
- Special-looking names including `error`, `newListener`, `removeListener`, and `__proto__`.
- No-subscriber publish behavior.
- Multiple matching subscribers and subscribe-all delivery.
- Sync throw, async rejection, and error-reporter throw/rejection.
- One consumer failure does not block other consumers.
- Snapshot isolation from caller mutation.
- Immutability of every supported nested payload type; rejection of Date, Map, Set, typed arrays, ArrayBuffer, DataView, class instances, accessors, symbol keys, and functions.
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

The package `test:coverage` script enforces at least 90% line coverage and 85% branch coverage. The Test Coverage workflow runs this command on every pull request and includes negative self-checks proving that deliberately insufficient 100% line and branch thresholds fail.

## 8. Decision log

- Keep the package in-process and dependency-light.
- Prefer pure functions for deterministic decisions and transformations; keep side effects at explicit boundaries.
- Correctness and bug resistance take precedence over feature count and micro-optimizations.
- Do not create GitHub issues as a substitute for this roadmap; track progress here and in focused pull requests.
- Update this file whenever a guarantee, phase, or acceptance criterion changes.


## AI-agent ownership and workflow

This roadmap is owned by `packages/event-bus/`. Read [the local agent instructions](./AGENTS.md) and the repository's mandatory [AI-agent workflow](../../AI_AGENT_WORKFLOW.md) before changing this package.

Use short-lived task branches from `develop`; do not create permanent per-domain branches. Keep event-bus implementation, tests, and roadmap changes within this domain. Route consumer requests and cross-package contract needs through [the cross-domain request process](../../docs/engineering/CROSS_DOMAIN_REQUESTS.md). Mark roadmap items complete only after the focused PR is merged into `develop` and required checks pass.
