# Harvester operator control

This is the entry point for Harvester's operator-control capability.

## Current status

The transport-independent engine boundary and application use cases are implemented and covered by offline tests. Inbound Telegram control is **not enabled or available yet** because the production ADR-0001 durable-fact store and startup projection are not implemented.

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
