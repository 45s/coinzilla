# Harvester operator control

This is the entry point for Harvester's operator-control capability.

## Current status

The engine boundary, transport-independent application use cases and offline-testable Telegram `/pause <SYMBOL>` adapter are implemented in [PR #1045](https://github.com/45s/coinzilla/pull/1045). The ADR-0001 file store exists, but operator-fact projection, recovery Steps 7–9, startup readiness integration and runtime wiring remain pending. Inbound Telegram control is **not enabled or available yet**.

Do not enable a process-local or Journal-backed substitute. A pause must be committed to the authoritative durable-fact stream and restored before strategy evaluation.

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
| ADR-0001 operator-fact projection and startup restoration | Pending |
| Recovery Steps 7–9 and closed readiness gate | Pending |
| Disabled-by-default runtime configuration and lifecycle wiring | Pending |

The code in this PR is not a production inbound-control release. The Telegram adapter is not instantiated or started by the Harvester runtime, and no environment variable or config flag enables it yet. Merge of this foundation does not authorize a TESTNET or LIVE session.
