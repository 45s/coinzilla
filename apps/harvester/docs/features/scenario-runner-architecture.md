# Harvester Strategy Scenario Runner

**Tracking:** Dashboard Issue #1836 / PR #1837.

The Runner is strategy-neutral application orchestration. Strategy adapters bind declared scenarios to strategy-owned production operations. The Runner core does not contain strategy rules.

## Architecture and isolation

- The host accepts run requests and manages lifecycle/result/history.
- A strategy adapter identifies scenario execution and invokes the production flow.
- Process adapters use a separate Node child process and IPC; the child receives run inputs only and a deliberately minimal environment rather than inherited Harvester credentials/configuration.
- The worker dispatcher must fail closed when no strategy-specific adapter is registered. It must never fallback to live broker, runtime state or production persistence.
- Run inputs/results are structured-cloned at boundaries to avoid cross-run mutation.
- A host-side timeout and cancellation policy bounds worker execution. Process termination uses SIGTERM followed by bounded SIGKILL fallback.
- REST is authoritative; WebSocket is notification-only. The Dashboard must never execute production trading logic.
- Only simulation-specific ports (broker, market/event source, clock and persistence) can be injected into worker composition. Production domain/application operations must be reused, not copied.

## Current implementation checkpoint

RS-004-011 is a provisional PRELIMINARY candidate based on open PR #1823 (still unmerged) and invokes only `calculateRecoverySellerProfitability`; it is not a full strategy lifecycle or authoritative source-registry integration. RS-004-012 is not a source-registry scenario. The deterministic ZROUSDT production SELL dispatch fixture is test-only under `apps/harvester/test/scenarios/recovery-seller/rs-runtime-dispatch-fixture.js`, has its own fixture ID and is not exposed in the public catalogue. The host requires a simulation-only adapter with matching OS-level sandbox attestation; no production launcher supplies one. **No RS scenario is currently executable through the host.** The default LINEA pair also lacks an explicit `thirdAssetFeeQuoteValue`; the SELL planner must not assume zero. Full source-registry integration, durable history, version-pinned replay, report completeness, OS resource/isolation controls and E2E verification remain open.

## Cancellation completion invariant

On the first active-run cancellation request, the runner immediately sends the adapter's AbortSignal and moves the run to `Cancelling`. It remains non-terminal until the adapter's execution promise settles; the runner must not release its concurrency slot or resolve run waiters merely because the abort signal was sent. The adapter owns cooperative stop and bounded worker termination; its `cancel` operation is mandatory so timeout handling can await cleanup before recording `Timed out`. Repeated cancellation requests are idempotent.

## Worker lifecycle regression hardening

The generic runner does not publish `Cancelled` until the strategy adapter's execution promise settles after its worker has stopped. Adapter cancellation is part of the required strategy-adapter contract; timeout handling waits for adapter cleanup before recording its terminal status. Repeated cancellation requests remain idempotent.

When a cancellation request remains active until the execution deadline, the host invokes the adapter's bounded cancellation operation and waits for it before finalizing the run. The terminal result remains `Cancelled`; it must not be mislabeled `Timed out` merely because forced cleanup was needed.

A worker result message is not itself proof that the child process has exited. The process adapter waits for child termination before resolving execution, and termination is shared/idempotent across abort, timeout and result handling so the host cannot release a worker slot while a child is still alive.

The process-adapter regression uses a worker that deliberately remains alive for a short period after sending its result. The adapter must not resolve the run until the child emits `close`; a result IPC message alone is insufficient.

The lifecycle regression tests pin two required contracts: cancellation remains non-terminal until cleanup completes, and a worker result message cannot complete a run before the worker process exits. Both regressions were observed failing in the test-only checkpoint before the implementation changes.
The delayed-exit fixture registers its SIGTERM handler before sending the result IPC message, making the process-shutdown regression deterministic rather than dependent on signal-registration timing.
The delayed-exit regression gives the adapter a 1,000 ms termination grace while the fixture exits after 500 ms, proving graceful cleanup rather than exercising the forced-kill fallback.

RS-004-011 remains a provisional helper-only candidate. The production runtime dispatch integration is exercised by a test-only fixture with a fixture ID; it is not RS-004-012 or a public scenario. It composes the production runtime dispatch, accounting workflow, account-wide authorizer and order submitter, replacing the broker and operational-state store with run-local simulation ports. The fixture does not establish process isolation or public execution readiness.

## RS helper scaffold is not executable

RS-004-011 invokes only `calculateRecoverySellerProfitability` and remains a provisional `PRELIMINARY` candidate while PR #1823 is unmerged. The deterministic ZRO fixture is test-only and invokes the production application/runtime path with simulated infrastructure; it is not a catalogue scenario and has no RS-004-012 identity. The public runner has no registered RS adapter because no launcher provides the required OS-level filesystem/network/process/resource isolation attestation. The test fixture explicitly sets `thirdAssetFeeQuoteValue: "0"`; this is not an instruction to default the configured LINEA pair's missing fee valuation to zero. The adapter must continue to reuse production use cases and must not copy or approximate strategy behavior.
The host-level catalog regression ensures the preliminary helper is marked non-executable and that submissions are blocked before a full production-flow adapter is registered. This is a contract/test correction; it does not change production trading behavior.

## Capacity and bounded-history behavior

A submission rejected because the run queue is full is retained as a terminal `Blocked` run record. Its returned run ID remains queryable through run detail and history, so the API never returns an apparently accepted identity that immediately resolves to 404.

When the bounded history is full and every retained record is still active, the runner rejects the new submission with HTTP `429` / `SCENARIO_RUNNER_CAPACITY_REACHED`. It does not manufacture an unpersisted run record or exceed the configured history bound. The caller can retry after an active execution reaches a terminal state.

## Scenario-level execution gate

The host derives the public `executable` flag from both the strategy-owned scenario mapping and the presence of a matching registered strategy adapter. The runner independently checks that host policy before starting an adapter. Registering an RS adapter alone cannot execute a preliminary, blocked, unknown or unmapped scenario ID. A blocked submission remains a queryable `Blocked` run record. This gate is intentionally separate from OS-level process isolation; it does not certify the worker as a security sandbox.

## Server-owned scenario input validation

The host exposes a scenario as executable only when its source mapping, matching registered strategy adapter and input schema are all valid. The runner invokes the host's schema validator before creating an accepted run or calling an adapter. Invalid JSON-object shape, missing required fields, unknown fields when additional properties are disabled, field types and string patterns are rejected with HTTP `400` / `SCENARIO_RUNNER_INPUT_INVALID`. Dashboard validation is a convenience; the server-owned catalog and validator remain authoritative for direct API callers.

## Worker lifecycle implementation-quality follow-up

The process adapter separates promise settlement, abort-aware cleanup, worker error/message/exit listeners and process orchestration into small single-purpose helpers. The refactor preserves the existing contract: cancellation and result handling await worker termination, a result IPC message alone does not release the worker slot, and the host continues to require a trusted sandbox launcher. Scenario input validation is split into shape, additional-property, required-field and field-value checks; it remains framework-independent and uses exact decimal comparison.

The follow-up strict-lint correction extracts schema-input error collection into independent pure helpers. It preserves the accepted input contract and error messages; no scenario execution or trading behavior changes.

The strict changed-file follow-up also formats multi-field helper arguments explicitly and uses named worker-abort/cleanup functions. These changes are lint-only; validation and cancellation semantics are unchanged.

## Execution capability gate and isolation attestation

The host marks a scenario executable only when its source mapping and schema are valid and its matching adapter declares `executionMode: "simulation-only"` plus `osSandboxVerified: true`. The process adapter reports OS isolation as verified only when its injected launcher supplies an attestation matching the required profile. The current production composition supplies no such launcher; therefore the host registers no executable RS adapter. A Node child process, minimal environment, IPC restrictions or test-double launcher is not evidence of OS-level network/filesystem/process/resource isolation.

## Evidence redaction and cleanup failure behavior

Harvester recursively redacts sensitive object keys and credential material embedded in strings before exposing run inputs, outputs or diagnostics. The raw validated input is kept in a non-enumerable internal field only until execution starts, passed to the adapter, then discarded; snapshots never expose that field. Dashboard debug-package redaction is a second defensive layer. Adapter promise rejections are converted to structured failure results. If cancellation/timeout cleanup is rejected or explicitly unconfirmed, the run remains visibly timed out/failed, its worker slot is retained, and runner shutdown rejects instead of claiming cleanup succeeded. The HTTP API server still closes in a `finally` path.

## Strategy registration boundary — 2026-11-25

The host catalog is built from explicit `strategyRegistrations` entries (`strategyId`, display name and scenario definitions) and matches each entry to exactly one strategy adapter by ID. Catalog validation, schema gating, execution authorization and run submission are strategy-neutral; the host no longer hardcodes Recovery Seller as its only strategy. The default local composition supplies the provisional RS catalogue as one registration. Additional strategy families can be registered without changing host orchestration. Duplicate strategy registrations and multiple adapters for one strategy fail configuration rather than selecting an arbitrary entry.

The current worker dispatcher and RS production adapter remain strategy-specific infrastructure adapters; they are not part of the generic host or runner domain/application core. No new strategy is enabled by this registration capability, and the RS catalog remains preliminary/non-executable until the OS-level isolation and full production-flow gates are satisfied.

## Loopback browser-origin and worker-path hardening — 2026-11-25

The unauthenticated local Scenario Runner API rejects every request carrying an `Origin` header unless it exactly matches the Dashboard's two approved loopback origins (`http://127.0.0.1:4200` or `http://localhost:4200`). Origin-less local non-browser clients remain supported. This is enforced before route dispatch, including preflight and run submission; CORS response headers alone are not treated as CSRF protection.

The process adapter canonicalizes the configured worker path with filesystem realpath resolution and requires it to be a regular file inside the adapter's own worker directory. This rejects traversal, directories, nonexistent paths and symlinks that resolve outside the allowlisted directory. It does not replace the required trusted OS sandbox launcher; the host continues to fail closed while OS isolation is unverified.

The worker-path check also requires the canonical target to be a regular `.js` file; a directory with a `.js` suffix is not accepted.

## API boundary decomposition — 2026-11-25

The Scenario Runner request handler validates browser Origin before any route handling, then delegates route dispatch and request-error conversion to a separate helper. The CSRF boundary is explicit and the request entrypoint remains within the repository's strict complexity/function-size policy without weakening the origin check.

## Registration validation decomposition — 2026-11-25

Strategy and scenario registration validation is split into dedicated shape and uniqueness checks. This preserves fail-closed rejection of malformed/duplicate registry entries while keeping each function within the repository's strict complexity limit. The host snapshot immutability and adapter-capability regressions are separated into focused tests that remain within the strict test-function size limit.

## Adapter-level fail-closed enforcement — 2026-11-25

The process adapter enforces its own OS-attestation gate at the start of `execute`, before spawning a child. The host catalog also checks the attestation, but callers cannot bypass the isolation requirement by invoking the adapter directly. Process-lifecycle unit tests use an explicitly named simulated launcher attestation to exercise IPC and termination contracts; this is a test double only and is not evidence that an actual OS sandbox launcher exists or that production execution is enabled.

## Cooperative cancellation and cleanup confirmation

The parent sends a typed `cancel` IPC message first and waits for the bounded cooperative grace period. The worker message handler aborts the active run's `AbortController`; strategy adapters receive that signal and must honor it. If the worker does not close, the parent escalates to SIGTERM and then SIGKILL, each with a bounded grace period. A failed kill or missing close confirmation rejects cleanup and retains the child registration so the operator can retry; it is never reported as successful cleanup. The adapter itself remains unavailable unless the OS sandbox attestation is verified. Once the caller's AbortSignal has fired, the parent ignores any late worker result and lets the cancellation path own final settlement and cleanup reporting.

## Strict lint boundary correction — 2026-11-25

Worker dispatch and message-handler contracts use one object argument, consistent with the repository's one-parameter function policy. Termination controller orchestration and forced-kill escalation are separate helpers; cleanup behavior and escalation order are unchanged.

## One-argument worker contracts — 2026-11-25

Worker dispatch receives a single request object containing both the run request and AbortSignal. This keeps worker boundaries consistent with the repository's one-parameter function rule while preserving cancellation propagation.

The worker message handler returns a completion promise for each message; the process event listener may ignore it, while deterministic unit tests can await dispatch, cancellation and disconnect settlement.

The worker spawn/profile construction is isolated from the execution lifecycle so the executor remains within the strict function-size policy; the verified attestation gate remains mandatory before this helper is called.

The application-level unconfirmed-cleanup regression uses unique run IDs so its second submission reaches the retained-capacity gate rather than the independent duplicate-run-ID guard.

## Retained execution capacity and cleanup retry — 2026-11-25

A terminal-looking FAILED/TIMED_OUT record does not release capacity while its worker termination is unconfirmed. History pruning skips records whose execution slot remains registered. The operator cancel endpoint can retry cleanup; capacity is released only after the adapter returns an explicit `true`. Shutdown also fails closed while any worker remains unconfirmed.

Cleanup retry is exposed through the existing cancel command for a terminal run whose worker cleanup remains unconfirmed. The API awaits that retry and returns acceptance only after the adapter explicitly confirms termination.

## Explicit cleanup confirmation contract — 2026-11-26

The application runner treats worker cleanup as confirmed only when the adapter's `cancel()` operation returns the literal boolean `true`. A successful cancellation test double must return `true` after simulating termination; an omitted/undefined, false, or rejected result is not proof of cleanup. Unconfirmed cleanup retains the execution slot and run record until an explicit successful retry, and shutdown remains fail-closed.

## Strategy-neutral worker dispatch — 2026-11-26

The worker dispatcher validates the typed execution envelope and resolves a strategy adapter from an explicit registry. It contains no strategy-specific ID branches; the worker composition module owns the current RS registration. Duplicate/malformed registrations, blank run/strategy/scenario identities and unknown strategy IDs fail closed before execution; the active AbortSignal is passed unchanged to the selected adapter. The dispatcher contract has focused registry/validation/cancellation tests; the message-handler cancellation test injects a registered dispatcher rather than depending on a global RS-specific function. Both suites are included in the configured Harvester targeted test suite. This composition change does not make the preliminary RS profitability helper an executable full-flow scenario.
