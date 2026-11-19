# ADR-0006: Market Pause cancels current-process-owned BUY orders

- **Status:** Accepted
- **Date:** 2026-11-18
- **Owners:** Harvester
- **Supersedes:** The public market-command side-effect decisions in [ADR-0002](./0002-transport-independent-operator-control.md) and [ADR-0005](./0005-emergency-buy-pause.md)
- **Related:** [ADR-0001](./0001-application-owned-recovery-facts.md), [ADR-0003](./0003-process-lifetime-operator-pause.md), [ADR-0004](./0004-startup-open-orders-are-external.md), [operator-control design](../OPERATOR_CONTROL_DESIGN.md), [issue #1435](https://github.com/45s/coinzilla/issues/1435), [PR #1436](https://github.com/45s/coinzilla/pull/1436)

## Context

Operators reasonably expect the normal market Pause command and Command Center Pause button to stop new BUY exposure and remove already-resting Harvester BUY orders. The previous contract did only the first part: `/pause SYMBOL` blocked future strategy BUY decisions but left active BUY orders on the exchange. A separate `/pausebuys SYMBOL` command performed the cancellation workflow. This split made the most visible Pause action weaker than operators expected.

The Conservative engine already implements a separate market-scoped BUY gate and a tested owned-BUY cancellation/reconciliation workflow. It blocks BUY decisions, replacements/repricing and final submissions; cancellation races are reconciled; recovery SELLs continue. The missing part is routing the normal Command Center market Pause/Resume entry points through that existing workflow.

## Decision

### 1. One market-scoped Pause contract

The public application facade keeps its stable method names:

- `pauseMarket({ actor, requestId, symbol })`
- `resumeMarket({ actor, requestId, symbol })`

These methods delegate to the same use cases as `pauseBuys({ symbol })` and `resumeBuys({ symbol })`. The aliases are one capability, not separate pause states.

Telegram `/pause SYMBOL`, `/resume SYMBOL`, and the confirmed keyboard Pause/Resume actions all invoke these facade methods. The Command Center market selector uses the `operatorBuysPaused` snapshot field. The commands `/pausebuys SYMBOL` and `/resumebuys SYMBOL` remain compatibility aliases. Global `/pauseallbuys` and `/resumeallbuys` remain separate global-scope controls.

### 2. Pause ordering and cancellation

For a configured market, Pause must:

1. Authorize the actor and validate the request through the existing application facade.
2. Commit the optional ADR-0001 Operational State Store fact before applying the in-memory BUY gate.
3. Activate the market BUY gate inside the serialized Conservative engine transition.
4. Cancel all active BUY orders owned by the current Harvester process for that market through the existing cancellation workflow.
5. Reconcile and account any fills that race cancellation.
6. Return success only after no current-process-owned active BUY remains in the requested market scope.

The market BUY gate blocks new BUY decisions, trailing-BUY replacement/repricing and final BUY submissions. A successful reply reports the confirmed cancellation and reconciled-fill counts.

If cancellation is unconfirmed or an owned active BUY remains unresolved, the BUY gate stays active and the operation returns `OPERATOR_BUY_CANCELLATION_INCOMPLETE`. The operator reply must state that new BUY submissions remain blocked while cancellation is unresolved. It must not claim the market is clear.

### 3. Preserve order ownership and recovery safety

The cancellation workflow remains strictly limited to current-process-owned BUY orders in the OrderRegistry.

- Startup-snapshot, manual, external and prior-process orders remain untouched under ADR-0004. This command is not an account-wide exchange kill switch.
- Recovery SELL decisions and submissions continue.
- Market-data intake, user-data processing, fill accounting and reconciliation continue.
- No safety, recovery-managed, volatility or startup-readiness gate is cleared by Resume.
- Resuming the market scope clears only that market BUY gate. A global BUY gate or any other safety gate continues to block BUYs.
- The pause remains process-local and is not restored after restart under ADR-0003.

### 4. Durable facts

When an Operational State Store is supplied, the public market Pause/Resume facade writes the existing market BUY fact types:

- `OPERATOR_MARKET_BUYS_PAUSED`
- `OPERATOR_MARKET_BUYS_RESUMED`

Global facts remain `OPERATOR_ALL_BUYS_PAUSED` and `OPERATOR_ALL_BUYS_RESUMED`. All facts use the existing ADR-0001 store and durable-before-apply boundary. No new store, replay mechanism or restart-restoration behavior is introduced.

The earlier `OPERATOR_MARKET_PAUSED` / `OPERATOR_MARKET_RESUMED` vocabulary is historical for the previous public market-pause behavior; it is not emitted by the current Command Center market Pause/Resume path.

## Consequences

- The normal Pause button and `/pause SYMBOL` now do what operators expect: stop new BUYs and cancel current-process-owned active BUYs.
- The normal Resume button and `/resume SYMBOL` clear the same market BUY gate.
- There is one market BUY-pause state and one cancellation/reconciliation workflow, avoiding divergent command semantics.
- Global pause remains independently composable with market pause.
- Recovery SELLs and accounting remain available while BUYs are paused.
- Manual, external, startup-snapshot and prior-process orders are never canceled by this command.
- The Command Center must report cancellation counts and unresolved cancellation honestly.
- Automated verification remains offline; live Telegram and exchange checks are operator-controlled and are not implied by CI.
