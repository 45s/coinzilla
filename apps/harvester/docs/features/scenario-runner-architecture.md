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

RS-004-011 currently executes `calculateRecoverySellerProfitability` through a dedicated child process with no live broker fallback. The host provides REST catalog/run/status/history/cancel and WebSocket lifecycle hints. Dashboard includes a presentation workspace, renderer-neutral trace graph core and versioned AI Debug JSON scaffold. Only this one scenario is advertised/executable; the worker dispatch fails closed for other scenarios and strategies. Full RS registry coverage, schema-driven config editor beyond the initial JSON schema, durable history, version-pinned replay, report completeness, concurrency/resource controls and E2E verification remain open.

## Cancellation completion invariant

An active run remains in `Cancelling` until its strategy adapter's execution promise settles. The runner must not publish a terminal `Cancelled` state, release its concurrency slot, or resolve run waiters merely because the abort signal was sent. The adapter owns cooperative stop and bounded worker termination; its `cancel` operation is mandatory so timeout handling can await cleanup before recording `Timed out`. Repeated cancellation requests are idempotent.

## Worker lifecycle regression hardening

The generic runner does not publish `Cancelled` until the strategy adapter's execution promise settles after its worker has stopped. Adapter cancellation is part of the required strategy-adapter contract; timeout handling waits for adapter cleanup before recording its terminal status. Repeated cancellation requests remain idempotent.

When a cancellation request remains active until the execution deadline, the host invokes the adapter's bounded cancellation operation and waits for it before finalizing the run. The terminal result remains `Cancelled`; it must not be mislabeled `Timed out` merely because forced cleanup was needed.

A worker result message is not itself proof that the child process has exited. The process adapter waits for child termination before resolving execution, and termination is shared/idempotent across abort, timeout and result handling so the host cannot release a worker slot while a child is still alive.

The process-adapter regression uses a worker that deliberately remains alive for a short period after sending its result. The adapter must not resolve the run until the child emits `close`; a result IPC message alone is insufficient.

The lifecycle regression tests pin two required contracts: cancellation remains non-terminal until cleanup completes, and a worker result message cannot complete a run before the worker process exits. Both regressions were observed failing in the test-only checkpoint before the implementation changes.
The delayed-exit fixture registers its SIGTERM handler before sending the result IPC message, making the process-shutdown regression deterministic rather than dependent on signal-registration timing.
The delayed-exit regression gives the adapter a 1,000 ms termination grace while the fixture exits after 500 ms, proving graceful cleanup rather than exercising the forced-kill fallback.

The RS-004-011 profitability helper is preliminary scaffolding, not a completed executable strategy scenario. Until a strategy adapter invokes the actual production RS use-case flow with simulation-only ports, the host must label the catalog entry non-executable and block run submission. A helper-level unit test is not scenario-runner acceptance evidence.

## RS helper scaffold is not executable

The RS-004-011 adapter currently invokes only `calculateRecoverySellerProfitability`. That is useful helper-level evidence, but it is not the production RS application/use-case lifecycle and must not be represented as an executed strategy scenario. The host catalog therefore marks it `PRELIMINARY` and `executable: false`, and the runner has no RS adapter registered until the complete production-flow simulation boundary exists. A future adapter must reuse production use cases and inject simulation-only ports; it must not copy or approximate strategy behavior.
The host-level catalog regression ensures the preliminary helper is marked non-executable and that submissions are blocked before a full production-flow adapter is registered. This is a contract/test correction; it does not change production trading behavior.
