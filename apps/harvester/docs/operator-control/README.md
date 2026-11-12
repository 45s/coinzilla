# Harvester operator control

This is the entry point for Harvester's operator-control capability.

## Current status

The engine/application foundation is implemented in [PR #1045](https://github.com/45s/coinzilla/pull/1045). Disabled-by-default runtime configuration, Telegram adapter startup/shutdown, and fail-closed bootstrap validation are implemented in [PR #1067](https://github.com/45s/coinzilla/pull/1067).

The initial Telegram vocabulary is only `/pause <SYMBOL>`. The operator pause is **process-lifetime only**: the fact is durably appended before the in-memory pause is applied, but the pause is not restored into a later process. ADR-0003 explicitly keeps this capability independent from full ADR-0001 restart recovery. The separate #654 startup fence currently blocks every second process start until recovery Steps 8–9 are accepted.

Do not use Journal as the control-state store. Do not claim that a pause survives a process restart. Existing exchange orders are not canceled or modified; a resting BUY may still fill.

## Architecture

- [ADR-0002 — Transport-independent operator control](../architecture/decisions/0002-transport-independent-operator-control.md) — accepted DDD ownership, actor contract, pause semantics, authorization, transport and failure decisions.
- [ADR-0003 — Process-lifetime operator pause](../architecture/decisions/0003-process-lifetime-operator-pause.md) — accepted initial rollout boundary.
- [Implementation contract and diagrams](../architecture/OPERATOR_CONTROL_DESIGN.md) — current source layout, request/fact schemas and delivery sequence.
- [ADR-0001 — Application-owned durable facts](../architecture/decisions/0001-application-owned-recovery-facts.md) — authoritative persistence and restart-recovery contract.
- [Harvester roadmap](../../ROADMAP.md) — current implementation status and dependencies.

## First command

`/pause <SYMBOL>` suppresses new strategy BUY intents and trailing-BUY repricing for one configured market, while preserving fill accounting and recovery SELL decisions.

Already-open exchange orders are not canceled or modified; a resting BUY may still fill. The command response must make this explicit. The application-level `resumeMarket` use case exists for a future trusted adapter, but resume is not exposed as a Telegram command.

## Ownership

The operator facade and use cases belong to `apps/harvester`. Do not create a shared `packages/operator` package until another application demonstrates the same transport-independent actor, authorization and request semantics.

## Runtime and persistence

- Runtime configuration belongs under `operatorControl.telegram`, independent from `notifications.telegram`.
- Inbound control defaults disabled. Enabling it requires a non-empty allowlist of Telegram user IDs and `TELEGRAM_BOT_TOKEN`.
- The poller starts only after the Harvester engine is constructed and stops before broker shutdown.
- Operator pause facts use the exact same process-owned ADR-0001 durable-facts store as process, order, cancellation, fill and recovery-cycle facts. Do not create a second writer or an operator-specific ledger.
- A successful durable append precedes the in-memory pause. If the append fails or is uncertain, the pause is not applied and success is not acknowledged.
- Operator pause facts are not replayed at startup. After a process restart the operator must reissue `/pause <SYMBOL>` if required; full trading-state restart recovery remains separately gated.

## Implementation status

| Slice | Status |
| --- | --- |
| Engine pause/resume boundary and market-scoped behavior | Implemented in PR #1045; regression-tested |
| Actor authorization and durable-before-apply application use cases | Implemented in PR #1045; port-tested |
| Telegram parser, private-chat allowlist and serial polling | Implemented in PR #1045; mocked-transport tested |
| Disabled-by-default runtime configuration and lifecycle wiring | Implemented in PR #1067; regression-tested |
| Process-restart restoration of operator pause state | Explicitly out of scope under ADR-0003; separate ADR-0001 / #654 workstream |
