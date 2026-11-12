---
title: Transport-independent operator control
status: accepted
type: architecture
owner: harvester
created: 2026-11-11
---

# ADR-0002: Transport-independent operator control

## Status

**Accepted — application and trading-engine contract.** The original design/prototype is preserved in [PR #1011](https://github.com/45s/coinzilla/pull/1011); the synchronized implementation continuation is [PR #1045](https://github.com/45s/coinzilla/pull/1045). The engine boundary, transport-independent application use cases and offline-testable Telegram adapter are implemented. The ADR-0001 file store exists, but operator-fact projection, closed-gate startup restoration, configuration and runtime wiring remain disabled.

**Owner:** Harvester

**Related decisions and work:**

- [ADR-0001 — Application-owned durable facts](./0001-application-owned-recovery-facts.md)
- [Harvester operator-control implementation contract](../OPERATOR_CONTROL_DESIGN.md)
- [Harvester roadmap](../../../ROADMAP.md)
- [Process-restart recovery issue #654](https://github.com/45s/coinzilla/issues/654)

## Context

Harvester currently has outbound Telegram notifications, but no inbound command receiver. The Conservative trading engine owns serialized market transitions and several distinct safety/recovery pause mechanisms. A transport must not become a second trading workflow, and an operator pause must not reuse or clear those safety mechanisms.

A future web application may need the same capabilities. That does not justify a generic command bus or a shared package before another application demonstrates the same requirements.

The accepted [ADR-0001](./0001-application-owned-recovery-facts.md) defines one application-owned append-only durable-fact stream as the only local authority for restart-critical facts. The Journal remains an operational observer.

## Decision

### 1. Ownership and DDD classification

- Operator control is a **Harvester application capability**, composed from explicit application use cases.
- `HarvesterOperator` is an application facade, not a Domain Entity, aggregate, strategy, broker adapter, or command framework.
- The initial application boundary lives in `apps/harvester/src/application/operator/`; use cases live in `apps/harvester/src/use-cases/operator-control/`.
- The Conservative engine owns serialized application-side market transitions and enforces the operator pause at the point where strategy actions are evaluated/submitted.
- Telegram, HTTP and any future CLI are inbound adapters. They authenticate/resolve an actor, parse their own transport syntax, call the same application use case, and render the same structured result.
- Domain entities and policies do not import operator, Telegram, HTTP, bot-update, configuration, filesystem or Journal types.

Do not create `packages/operator`, `packages/operators`, `packages/commands`, a generic dispatcher, or an inheritance-based operator hierarchy now. Consider extracting a shared package only after at least two real applications use the same actor, authorization, request/result and idempotency semantics without importing Harvester trading concepts.

### 2. Application contract

The application facade exposes explicit methods:

- `pauseMarket({ actor, requestId, symbol })`
- `resumeMarket({ actor, requestId, symbol })`

The first Telegram adapter exposes only `/pause <SYMBOL>`. The application-level resume use case is retained for a future trusted adapter; it is not part of the initial Telegram command vocabulary.

The transport-neutral actor is a trusted application identity:

```js
{
  id: "telegram-user:12345",
  roles: ["trading-operator"]
}
```

The application use case enforces the `trading-operator` role. A transport adapter may assign that role only after authenticating the external principal and applying its configured allowlist/authentication policy. A caller-supplied chat ID or role string is never accepted as proof of identity by an untrusted network boundary.

Every state-changing request has a stable, bounded `requestId`. Telegram uses its update identity as the request ID. The application creates a stable fact identity `operator-control:<requestId>`. The durable-facts port must make append idempotent: the same fact identity and identical payload returns the existing committed fact; reuse with a different payload is an integrity error.

### 3. Operator pause semantics

An operator pause is a separate state set from safety, recovery-managed and durable safety pauses.

For a configured market, an operator pause:

- Prevents new strategy BUY intents for that market.
- Prevents trailing-BUY replacement/repricing for that market.
- Continues market-data intake, broker/user-data processing, fill accounting, order reconciliation, recovery accounting and shutdown safety work.
- Allows the existing Conservative policy to submit risk-reducing recovery SELLs.
- Does not cancel, modify, adopt or rewrite existing exchange orders. Existing BUY orders may still fill after the pause request; those fills are processed normally, and any resulting recovery SELL remains eligible.
- Does not affect other configured markets.
- Does not add to, clear or overwrite the engine's safety pause state.

This is intentionally a **strategy-entry pause**, not an exchange-wide kill switch. The initial Telegram acknowledgement must say that existing orders remain open and may still fill.

### 4. Resume and safety ownership

The application-level `resumeMarket` operation may remove only the operator-owned pause. The engine refuses resume before invoking the durable-fact callback whenever any safety/recovery blocker remains, including an active safety pause, durable safety pause, recovery-managed pause, unresolved replacement/trailing intent, pending recovery-managed cancellation, or an active high-volatility protection state.

A resume request never clears a safety blocker, reconciles an order by guessing, cancels an exchange order, or opens the global startup readiness gate. Safety resolution remains owned by the existing reconciliation/recovery workflow and its explicit durable resolution facts.

### 5. Durable facts and acknowledgement

Operator pause/resume facts are appended to the **same ADR-0001 durable-fact stream**. They are not written to a second operator-specific file, Journal session, EventBus, notification queue or process-local cache as the source of truth.

- Pause fact type: `OPERATOR_MARKET_PAUSED`.
- Resume fact type: `OPERATOR_MARKET_RESUMED`.
- Fact data includes `requestId`, `actorId` and configured `symbol`.
- The application calls the durable-fact port from the engine's serialized transition callback. The engine applies the in-memory operator state only after the callback reports `{ ok: true, data: { durable: true } }`.
- Missing, failed or uncertain persistence means no state transition and no successful acknowledgement.
- Startup must validate and project the committed fact stream, including operator pause facts, before the first strategy evaluation. The resulting `operatorPausedMarkets` projection is supplied to the engine as initial state.
- Missing or corrupt durable history, an unclean process boundary, unresolved safety facts or incomplete reconciliation must keep the readiness gate closed under ADR-0001.

The ADR-0001 file durable-facts store and integrity checks are implemented. The operator application accepts that existing append port, but production runtime composition does not yet connect the store to the operator use cases or project operator pause facts into startup state. The command must remain unavailable until operator-fact projection, full recovery reconciliation and the closed startup-readiness gate are implemented and verified. Do not create an operator-specific store or substitute Journal.

### 6. Authorization and first Telegram adapter

The first adapter is optional Telegram Long Polling:

- Configuration namespace: `operatorControl.telegram`, separate from `notifications.telegram`.
- Inbound control is disabled by default. Enabling it requires a non-empty allowlist of Telegram user IDs.
- Only private-chat messages from allowlisted, non-bot senders are eligible. Group chats are not accepted.
- The bot token remains in `TELEGRAM_BOT_TOKEN`; no credential is committed to configuration or source.
- The adapter maps the allowlisted sender to a trusted actor with the `trading-operator` role, then calls `operator.pauseMarket`.
- The adapter uses Telegram `update_id` for request idempotency, processes updates serially, and advances its polling offset only after handling the update. Durable fact deduplication protects a retry after a process crash.
- The adapter starts and stops with the Harvester runtime. If enabled without a valid durable-facts/recovery capability, startup fails closed before strategy evaluation.
- Outbound notification delivery remains an independent best-effort subscriber. Inbound command failures must not be disguised as notification delivery failures.

No HTTP server, webhook, web session, generic command framework or extra Telegram command is part of this milestone.

### 7. Failure behavior

| Failure | Required behavior |
| --- | --- |
| Actor is missing or lacks `trading-operator` | Reject before engine or durable-store access. |
| Request ID or symbol is invalid | Return a stable application error; do not write a fact. |
| Symbol is not configured | Engine rejects before applying operator state. |
| Durable fact append fails or is uncertain | Do not apply pause/resume and do not acknowledge success. |
| Process crashes after durable pause commit but before in-memory apply | Startup projection restores the pause before strategy evaluation. |
| Existing BUY fills after pause | Process and account the fill normally; suppress new BUY intents and allow recovery SELL policy. |
| Safety/recovery blocker exists during resume | Reject resume before appending a resume fact; preserve every blocker. |
| Telegram polling or reply delivery fails | Log actionable transport diagnostics; never change trading state except through the committed application use case. |

## Consequences

- Harvester retains ownership of trading semantics; transports remain thin.
- The first engine slice can be tested offline without Telegram or Binance.
- Existing exchange orders are deliberately not canceled by `pause`; operators must understand that an already-resting BUY may still fill.
- A usable inbound command depends on the unfinished ADR-0001 durable-fact store and startup projection. The current engine/application foundations do not make restart recovery complete.
- The first Telegram release is deliberately small: one `/pause <SYMBOL>` command, private-chat allowlist, and no HTTP server.
- A future shared operator package remains an evidence-based extraction, not a prerequisite.

## Alternatives considered

1. **Put the operator in a shared package now.** Rejected: there is one application and the trading-control semantics are Harvester-specific.
2. **Make Telegram commands call the engine or broker directly.** Rejected: that creates a transport-specific trading workflow and bypasses application authorization/idempotency.
3. **Reuse the engine safety `pause()` state.** Rejected: operator intent and safety/recovery blockers have different owners and clearing rules.
4. **Cancel existing orders automatically on pause.** Rejected for the first release: it adds exchange side effects, cancellation races and fill reconciliation to a command intended to suppress future strategy entry. Existing orders remain visible and may fill.
5. **Use Journal notifications as durable pause state.** Rejected by ADR-0001; Journal is an operational observer, not the restart authority.
6. **Build a generic command bus or command framework.** Rejected until the actual command set proves it necessary.

## Implementation status

- [x] Separate engine operator-pause state and serialized durable-before-apply boundary.
- [x] Suppress new BUY intents and trailing-BUY replacement while operator-paused.
- [x] Preserve recovery SELL evaluation and existing order/fill processing.
- [x] Add resume guard that cannot clear safety/recovery blockers.
- [x] Add transport-independent application facade, actor-role authorization and durable-fact append contract.
- [x] Reuse the ADR-0001 file durable-facts store through the application append port.
- [ ] Project `OPERATOR_MARKET_PAUSED` and `OPERATOR_MARKET_RESUMED` facts into the candidate startup state.
- [ ] Wire restored operator state into Harvester startup before strategy evaluation.
- [x] Implement the offline-testable Telegram `/pause <SYMBOL>` parser, private-chat allowlist, serial Long Polling, stable update identity, retry and stop lifecycle.
- [ ] Add disabled-by-default `operatorControl.telegram` configuration validation and fail-closed bootstrap lifecycle.
- [ ] Restore operator pause state before the first market evaluation behind ADR-0001's closed readiness gate.
- [ ] Complete recovery Steps 7–9 before enabling inbound runtime control.
- [ ] Run exact-head required CI and review the complete diff.
