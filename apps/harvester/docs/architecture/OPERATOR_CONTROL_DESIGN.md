# Harvester operator control

> **Status: ACCEPTED IMPLEMENTATION CONTRACT.** Architectural decisions are recorded in [ADR-0002](./decisions/0002-transport-independent-operator-control.md). This document explains the current application boundary and delivery contract. It is not evidence that inbound Telegram control or restart recovery is enabled.

## Goal

Provide one Harvester-owned application capability that authorized operators can invoke through different transports. Telegram is the first inbound adapter. A future web/HTTP adapter must reuse the same application use cases; it must not implement a second trading-control workflow.

**Core rule: transports translate identity and syntax; the Harvester application owns authorization and behavior.**

## Current implementation baseline

- Outbound Telegram notifications remain in `notifications.telegram` and `@coinzilla/notifiers`.
- The Conservative engine now exposes a serialized operator-pause boundary separate from safety pause state.
- `src/application/operator/create-harvester-operator.js` composes explicit pause/resume use cases.
- The application use cases require the ADR-0001 durable-facts append port and pass its commit callback into the engine transition.
- There is not yet a production ADR-0001 durable-fact store/projection, inbound Telegram receiver, operator-control runtime configuration or HTTP server. Do not enable or advertise an inbound command as available until the store and startup projection are implemented.

## DDD ownership and source layout

`HarvesterOperator` is an application facade over explicit use cases. It is not a Domain Entity, aggregate, strategy, broker adapter, or generic command bus.

```text
apps/harvester/src/
  application/
    operator/
      authorize-operator-actor.js
      create-harvester-operator.js
    ports/
      durable-facts.port.js
  use-cases/
    operator-control/
      pause-market.js
      resume-market.js
  infrastructure/
    telegram/
      telegram-operator-adapter.js       # next transport slice
  bootstrap/
    operator-control/
      start-telegram-operator.js         # runtime lifecycle composition
```

The engine remains under `src/use-cases/conservative-trading-engine.js` because it coordinates existing application workflows and serialized broker/market transitions. Domain strategy policies remain transport- and persistence-independent.

Do not create `packages/operator`, `packages/operators` or `packages/commands` now. Extract a shared package only after a second real application proves that actor, authorization, request/result and idempotency semantics are genuinely shared without Harvester trading dependencies.

## Application contracts

### Actor and request

Adapters resolve an authenticated external principal to a trusted application actor. The application requires the `trading-operator` role.

```js
const actor = {
  id: "telegram-user:12345",
  roles: ["trading-operator"],
}

await operator.pauseMarket({
  actor,
  requestId: "telegram:1001",
  symbol: "LINKUSDT",
})
```

The actor contains no Telegram chat object, HTTP request, session cookie or transport-specific method. The request ID is stable across retries and bounded to 256 characters.

### Durable fact contract

The application writes through the ADR-0001 durable-facts port. It does not use Journal, EventBus or notifier delivery as control-state persistence.

```js
{
  factId: "operator-control:telegram:1001",
  factType: "OPERATOR_MARKET_PAUSED",
  data: {
    requestId: "telegram:1001",
    actorId: "telegram-user:12345",
    symbol: "LINKUSDT"
  }
}
```

The durable-facts adapter must return `durable: true` only after the record and committed head satisfy ADR-0001. Exact duplicate fact identity/payload is idempotent; reuse of a fact identity with different data is an integrity failure.

The engine executes the append callback inside its serialized transition. Only a successful durable commit is followed by the in-memory operator state change. The current production runtime does not yet provide this adapter; therefore the application facade is not wired to an inbound transport.

## Pause semantics

An operator pause is market-scoped and separate from safety/recovery pause ownership.

- Block new strategy BUY intents for the selected market.
- Suppress trailing-BUY replacement/repricing for that market.
- Allow Conservative recovery SELL decisions.
- Continue market prices, broker/user-data intake, fill accounting and reconciliation.
- Leave all existing exchange orders untouched. A resting BUY may still fill after the pause; its fill is accounted and recovery SELL behavior remains available.
- Do not cancel, adopt or modify orders, and do not mutate broker or OrderRegistry state outside the existing engine workflows.
- Do not affect unrelated markets.

This is not an exchange kill switch. The initial Telegram response must explicitly state that already-open orders remain open and may still fill.

### Resume safety

The application-level `resumeMarket` use case is available for a future trusted adapter, but the initial Telegram command set exposes only `/pause <SYMBOL>`.

Resume removes only the operator-owned pause. The engine refuses to invoke the durable resume callback if a safety/recovery blocker, durable safety pause, unresolved replacement/trailing intent or pending recovery-managed cancellation remains. It never clears a safety blocker or opens the global startup readiness gate.

## First transport: Telegram

The first adapter will use Telegram Bot API Long Polling and be optional.

- Configuration belongs under `operatorControl.telegram`, independent from `notifications.telegram`.
- Inbound control defaults disabled. Enabling it requires a non-empty list of allowed Telegram user IDs.
- Accept private chats only; do not accept group commands.
- Resolve `message.from.id` through the allowlist to a trusted `trading-operator` actor. Never authorize based on a display name, message text, chat title or caller-supplied role.
- Use Telegram `update_id` as the stable request identity and the durable fact ID as the final idempotency boundary.
- Process updates serially. Retry transport failures without advancing the update offset; duplicate delivery after a crash must be harmless.
- Start and stop the poller with the Harvester runtime. If the feature is enabled without a valid durable-fact store and restored operator state, fail closed before strategy evaluation.
- Reuse the existing `TELEGRAM_BOT_TOKEN` environment secret. Never commit credentials.
- Keep outbound notification delivery independent and best-effort.

The first and only Telegram command in this milestone is:

```text
/pause <SYMBOL>
```

No status, resume, start/stop, order-cancel, configuration-edit or arbitrary command execution is included. No HTTP server is part of this work.

## Failure behavior

| Condition | Behavior |
| --- | --- |
| Unauthorized actor | Reject before engine/store access. |
| Missing/invalid request ID or symbol | Return a stable application error; do not append a fact. |
| Unknown configured market | Engine rejects before applying state. |
| Durable fact write failed or uncertain | No state transition and no successful acknowledgement. |
| Crash after fact commit | Startup projection restores operator pause before strategy evaluation. |
| Existing BUY fills after pause | Apply the fill normally; continue risk-reducing recovery SELL behavior; suppress new BUY intents. |
| Resume while safety/recovery blocker exists | Reject before writing a resume fact; preserve the blocker. |
| Telegram transport failure | Log actionable diagnostics; never mutate trading state outside the application use case. |

## TDD and delivery sequence

1. **Engine semantics — implemented:** RED/GREEN tests cover market isolation, BUY suppression, recovery SELL continuity, no cancellation/repricing of existing orders, durable-before-apply, initial-state restoration, idempotent pause and safety-blocked resume.
2. **Application capability — implemented:** tests cover actor-role authorization, stable fact identity/payload, durable append ordering, failed persistence and transport-neutral facade.
3. **ADR-0001 durable facts — prerequisite:** implement the accepted single append-only stream, committed head, integrity checks, explicit initialization and projection. Follow the numbered recovery roadmap; do not create an operator-specific store.
4. **Startup integration — pending:** restore operator pause facts and all required safety/recovery facts behind the closed readiness gate before the engine receives market events. Keep restart recovery disabled until ADR-0001 acceptance gates pass.
5. **Telegram adapter — pending:** parser, private-chat allowlist, serial polling, update idempotency, replies, retry/backoff and graceful stop, all with mocked transport tests.
6. **Configuration/bootstrap — pending:** disabled-by-default config validation, fail-closed enablement, runtime lifecycle tests and no interaction with outbound notification settings.
7. **Verification — pending:** focused tests, full workspace tests, coverage, syntax, dependency audit, documentation links and exact-head CI. No Binance/TESTNET/LIVE operations.

## References

- [ADR-0002 — Transport-independent operator control](./decisions/0002-transport-independent-operator-control.md)
- [ADR-0001 — Application-owned durable facts](./decisions/0001-application-owned-recovery-facts.md)
- [Harvester roadmap](../../ROADMAP.md)
- [Harvester architecture](../architecture.md)
- [Harvester documentation index](../README.md)
- [Trading First](../TRADING_FIRST.md)
