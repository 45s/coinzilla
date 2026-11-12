# Harvester operator control

This is the entry point for Harvester's operator-control capability.

## Current status

The engine boundary, transport-independent application use cases and offline-testable Telegram `/pause <SYMBOL>` adapter are implemented in [PR #1045](https://github.com/45s/coinzilla/pull/1045). Runtime configuration and lifecycle wiring remain pending. The initial operator pause is **process-lifetime only**: it is durably appended before in-memory application, but it is not restored after a process restart. Full restart recovery (ADR-0001 / issue #654) is a separate workstream and is not a prerequisite for this capability.

Do not use Journal as the control-state store. Do not claim that a pause survives a restart; after restarting Harvester, issue `/pause <SYMBOL>` again if the market must remain paused.

## Architecture

- [ADR-0002 — Transport-independent operator control](../architecture/decisions/0002-transport-independent-operator-control.md) — accepted DDD ownership, actor contract, pause semantics, authorization, transport and failure decisions.
- [Implementation contract and diagrams](../architecture/OPERATOR_CONTROL_DESIGN.md) — current source layout, request/fact schemas and delivery sequence.
- [ADR-0001 — Application-owned durable facts](../architecture/decisions/0001-application-owned-recovery-facts.md) — authoritative persistence and restart-recovery contract.
- [Harvester roadmap](../../ROADMAP.md) — current implementation status and dependencies.

## First command

The initial Telegram command is `/pause <SYMBOL>`. It suppresses new strategy BUY intents and trailing-BUY repricing for one configured market, while preserving fill accounting and recovery SELL decisions.

Already-open exchange orders are not canceled or modified; a resting BUY may still fill. The command response must make this explicit.

The application-level `resumeMarket` use case exists for a future trusted adapter, but resume is not exposed as a Telegram command in the first milestone.

## Ownership

The operator facade and use cases belong to `apps/harvester`. Do not create a shared `packages/operator` package until another application demonstrates the same transport-independent actor, authorization and request semantics.

## Implementation status

| Slice | Status |
| --- | --- |
| Engine pause/resume boundary and market-scoped behavior | Implemented in PR #1045; regression-tested |
| Actor authorization and durable-before-apply application use cases | Implemented in PR #1045; port-tested |
| Telegram /pause SYMBOL parser, private-chat allowlist and serial polling | Implemented in PR #1045; mocked-transport tested |
| Process-restart restoration of operator pause state | Explicitly out of scope; separate ADR-0001 / #654 workstream |
| Disabled-by-default runtime configuration and lifecycle wiring | Pending; independent of full restart recovery |

The code in this PR is not a production inbound-control release. The Telegram adapter is not instantiated or started by the Harvester runtime, and no environment variable or config flag enables it yet. Merge of this foundation does not authorize a TESTNET or LIVE session.
