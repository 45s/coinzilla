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

RS-004-011 executes only the `calculateRecoverySellerProfitability` helper in adapter-level tests; it remains PRELIMINARY/non-executable. RS-004-012 now exercises the production runtime dispatch, accounting workflow, account-wide action authorizer and order-submission use case with a deterministic ZROUSDT fixture and simulated broker. It remains PRELIMINARY/non-executable: the deterministic ZROUSDT fixture does not yet prove readiness for the configured LINEAUSDT market and its required fee valuation, and the process worker has no verified OS-level filesystem/network/process/resource isolation. The host therefore registers no executable RS adapter. **No RS scenario is currently executable through the host.** The default LINEA pair also lacks an explicit `thirdAssetFeeQuoteValue`; the SELL planner must not assume zero. Full source-registry integration, durable history, version-pinned replay, report completeness, OS resource/isolation controls and E2E verification remain open.

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

RS-004-011 remains preliminary helper scaffolding. RS-004-012 is the first tested production-flow adapter slice: it composes the production runtime dispatch, accounting workflow, account-wide authorizer and order submitter, replacing the broker and operational-state store with run-local simulation ports. The scenario is still non-executable through the host because no verified OS-level sandbox launcher is available. A successful in-process test does not establish process isolation or public execution readiness.

## RS helper scaffold is not executable

RS-004-011 invokes only `calculateRecoverySellerProfitability`. RS-004-012 invokes the production application/runtime path with a deterministic fixture and simulated infrastructure. Both remain `PRELIMINARY` and `executable: false`; the runner has no registered RS adapter because the worker lacks OS-level filesystem/network/process/resource isolation. The deterministic ZRO fixture explicitly sets `thirdAssetFeeQuoteValue: "0"`; this is not an instruction to default the configured LINEA pair's missing fee valuation to zero. The adapter must continue to reuse production use cases and must not copy or approximate strategy behavior.
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
