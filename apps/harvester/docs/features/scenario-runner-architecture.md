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
