---
title: Process-lifetime operator pause
status: accepted
type: architecture
owner: harvester
created: 2026-11-12
---

# ADR-0003: Process-lifetime operator pause

## Status

**Accepted.** This decision narrows the initial operator-control rollout defined by [ADR-0002](./0002-transport-independent-operator-control.md). It supersedes only the requirement that full ADR-0001 restart recovery must be complete before the initial operator-pause capability can be enabled.

> **Terminology note (2026-11-14):** This accepted ADR retains the original durable-fact vocabulary as historical architectural terminology. The current application-facing name for the shared persistence component is **Operational State Store**; see the current [operator-control documentation](../../operator-control/README.md) for supported configuration and commands.

## Context

The operator-pause capability and process-restart trading recovery solve different problems.

An operator pause is a direct, market-scoped instruction to suppress future strategy BUY intents while leaving existing exchange orders and risk-reducing recovery SELL behavior untouched. Full process-restart recovery reconstructs trading state, reconciles orders and fills, and restores safety state after an unexpected process exit.

Requiring the entire recovery project (#654, ADR-0001) before delivering the operator-pause capability couples two independently useful workstreams and delays the pause operation for unrelated recovery gaps.

## Decision

The initial operator-pause capability is **process-lifetime only**.

- While Harvester is running, the operator fact must be durably appended before the engine applies the in-memory pause. If the append fails or its outcome is uncertain, the pause is not applied and success is not acknowledged.
- The fact is written to the existing ADR-0001 durable-facts stream. Do not create an operator-specific store or use Journal as the control-state authority.
- The initial runtime does not project or replay operator pause facts during startup.
- After a process restart, the operator pause is **not restored**. Harvester starts without the previous operator-owned pause; the operator must issue `/pause <SYMBOL>` again if the market should remain paused.
- Existing exchange orders remain untouched by pause. They may still fill; fill accounting and risk-reducing recovery SELL behavior continue. Other markets remain unaffected.
- Disabled-by-default configuration, actor authorization, durable append wiring and adapter lifecycle must still be validated before inbound runtime control is enabled. These requirements do not depend on completing recovery Steps 7–9.
- Full restart restoration and trading-state reconciliation remain a separate workstream under [ADR-0001](./0001-application-owned-recovery-facts.md) and [issue #654](https://github.com/45s/coinzilla/issues/654).

## Consequences

- The operator pause can be delivered independently of full trading-state restart recovery.
- A pause is not a persistent halt across process restarts. Operators must reissue it after restart when required.
- A durable pause fact may exist without being replayed into the new process. The append provides durable acknowledgement and identity, not restart restoration in this scope.
- Runtime documentation and operator responses must not imply that the pause survives restart.
- No exchange order is automatically canceled, adopted or modified by this decision.

## Alternatives considered

1. **Block operator control until all recovery Steps 7–9 are complete.** Rejected for the initial rollout because it couples a narrow operator instruction to the broader trading-state recovery project.
2. **Use a process-local set without a durable append.** Rejected because a pause must not be acknowledged when its state-changing operation has no confirmed durable record.
3. **Restore only operator facts while the rest of trading state is unreconciled.** Rejected for this scope because partial restart restoration could create misleading readiness and imply a broader recovery guarantee that does not exist.

## References

- [ADR-0002 — Transport-independent operator control](./0002-transport-independent-operator-control.md)
- [ADR-0001 — Application-owned durable facts](./0001-application-owned-recovery-facts.md)
- [Operator-control implementation contract](../OPERATOR_CONTROL_DESIGN.md)
- [Operator-control roadmap](../../../ROADMAP.md#operator-control--initial-telegram-pause)
- [Process-restart recovery issue #654](https://github.com/45s/coinzilla/issues/654)
