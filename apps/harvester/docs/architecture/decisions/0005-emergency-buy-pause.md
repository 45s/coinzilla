# ADR-0005: Emergency BUY pause is separate from the market operator pause

- **Status:** Accepted; market-scoped command entry point superseded by [ADR-0006](./0006-market-pause-cancels-owned-buys.md)
- **Date:** 2026-11-16
- **Owners:** Harvester
- **Related:** [ADR-0002](./0002-transport-independent-operator-control.md), [ADR-0003](./0003-process-lifetime-operator-pause.md), [ADR-0004](./0004-startup-open-orders-are-external.md), [operator-control design](../OPERATOR_CONTROL_DESIGN.md), [issue #1267](https://github.com/45s/coinzilla/issues/1267)

## Context

At the time this ADR was accepted, the market-scoped `pauseMarket` / Telegram `/pause SYMBOL` control suppressed future strategy BUY intents while leaving existing exchange orders untouched. It was not an emergency order-cancellation control. [ADR-0006](./0006-market-pause-cancels-owned-buys.md) later superseded that public command split and routes the normal market Pause through the BUY cancellation workflow described here. Operators also need a way to stop new BUY exposure globally or for one market during a sharp market correction, while retaining the ability to reduce existing inventory through recovery SELLs.

Reusing `pauseMarket` would silently change its established contract and conflate strategy pause ownership with a separate order-cancellation action. Cancelling account-wide open orders would also violate ADR-0004, which treats every unmatched startup-snapshot order as external to the current process.

## Decision

Add a distinct, BUY-only emergency operator capability at the Harvester application and Conservative engine boundaries:

- `pauseAllBuys()` and `resumeAllBuys()` control the global BUY gate.
- `pauseBuys({ symbol })` and `resumeBuys({ symbol })` control one configured market's BUY gate.
- Telegram exposes the lowercase commands `/pauseallbuys`, `/resumeallbuys`, `/pausebuys SYMBOL`, and `/resumebuys SYMBOL`. Telegram's command names are lowercase; application method names retain camelCase.
- Emergency BUY slash commands execute immediately after the existing private-chat authorization checks; they do not use the inline market-button confirmation flow.
- Existing `pauseMarket` / `resumeMarket`, `/pause SYMBOL`, and `/resume SYMBOL` semantics remain unchanged.

Activating an emergency BUY pause first commits its optional Operational State Store fact (when a store is supplied) and applies the BUY gate inside the serialized engine transition. After the gate is active, the engine invokes its existing owned-BUY cancellation workflow for the selected market or all markets. That workflow owns cancellation intent durability, broker cancellation, authoritative terminal-state validation, cancellation-racing fill reconciliation and accounting. A successful response is allowed only when no current-process-owned active BUY remains in the requested scope.

The cancellation scope is strictly the current process's OrderRegistry-owned BUY orders. Orders found only in a startup account-wide open-order snapshot remain external under ADR-0004 and are never canceled, adopted or modified. Recovery SELL orders are not cancellation candidates.

The emergency BUY gate suppresses initial BUY decisions, BUY replacements/repricing and final BUY submissions. It does not stop market-price intake, user-data intake, recovery SELL evaluation, SELL submission, fill accounting or reconciliation. The emergency cancellation workflow does not create a broad strategy pause on an ordinary unconfirmed cancellation; the affected BUY remains UNKNOWN and existing order-integrity blockers may still defer conflicting same-market activity until reconciliation. The effective BUY restriction is the union of the global gate and the market-specific set. Resuming either scope clears only that scope; another active scope continues to block BUYs.

If any owned BUY cancellation is unconfirmed or an active owned BUY remains unresolved, the BUY gate stays active and the operation returns `OPERATOR_BUY_CANCELLATION_INCOMPLETE`. The operator response must state that new BUY submissions remain blocked but cancellation is unresolved. It must never imply that all resting BUYs are gone.

The controls are process-lifetime only. They are not replayed or restored after restart. Orders from a previous process are not current-process-owned under ADR-0004; this emergency command will not cancel them after restart. The operator must reconcile those orders explicitly through the exchange/operator recovery procedure rather than assuming a repeated pause command will cancel them. When an Operational State Store is supplied, pause/resume facts use the same process-owned ADR-0001 store and durable-before-apply contract; no separate ledger or restart-restoration mechanism is introduced.

## Consequences

- Emergency BUY pause is explicit and separate from the non-canceling market pause.
- Recovery SELL protection remains available during the emergency BUY halt.
- Cancellation races reuse the existing order lifecycle and fill-accounting implementation instead of adding a Telegram-specific broker workflow.
- Startup-snapshot and manual/external orders remain outside Harvester ownership.
- Global and per-market restrictions compose without one resume command accidentally overriding another.
- The operator must reissue the required pause after process restart.
- Automated tests must cover overlapping scopes, recovery SELL continuity, cancellation-racing fills, unresolved cancellation and external-order isolation. Live Telegram and exchange verification remain operator-controlled and are not implied by offline CI.

## 2026-11-18 command-contract update — superseded in part by ADR-0006

The emergency BUY gate and its owned-order cancellation/reconciliation workflow remain the accepted implementation. The separation of public command names is superseded: `/pause SYMBOL`, `/resume SYMBOL`, and the confirmed market Pause/Resume buttons now use this same market-scoped BUY workflow. `/pausebuys SYMBOL` and `/resumebuys SYMBOL` remain compatibility aliases. The global commands remain unchanged. The market facade methods `pauseMarket` / `resumeMarket` delegate to `pauseBuys({ symbol })` / `resumeBuys({ symbol })`. See [ADR-0006](./0006-market-pause-cancels-owned-buys.md).
