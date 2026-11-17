# Harvester operator control

This is the entry point for Harvester's operator-control capability.

## Current status

The engine/application foundation is implemented in [PR #1045](https://github.com/45s/coinzilla/pull/1045). Runtime configuration, Telegram adapter lifecycle and bootstrap validation were implemented in [PR #1067](https://github.com/45s/coinzilla/pull/1067). Telegram control is enabled by default and requires the configured private-chat allowlist and bot token. The Command Center is an inbound interface: it authenticates an operator, invokes an application query or command, and reports the returned result. It does not implement trading policy, persistence, startup policy or recovery.

The Telegram Command Center exposes `/start`, `/menu`, `/help`, `/status`, `/markets`, `/positions`, `/orders`, `/balances`, `/pause <SYMBOL>`, `/resume <SYMBOL>`, `/pauseallbuys`, `/resumeallbuys`, `/pausebuys <SYMBOL>`, and `/resumebuys <SYMBOL>`. The read-only query set and first commands shipped in PRs #1079, #1081 and #1086. Inline navigation, refresh and confirmation shipped in PR #1088. The persistent six-button keyboard shipped in PR #1194. Global and per-market emergency BUY commands shipped in merged [PR #1267](https://github.com/45s/coinzilla/pull/1267). Correlated interaction diagnostics, callback acknowledgement handling and the `/orders` account-wide query fix shipped in merged [PR #1215](https://github.com/45s/coinzilla/pull/1215). The Command Center feature roadmap is complete; exact command behavior is listed below. See the [Telegram operator runbook](../operations/telegram-command-center.md) for the interaction flow and troubleshooting.

Pause state is process-lifetime only. Do not promise that a pause survives a process restart. The Command Center does not decide whether a command is safe or permitted: it sends the authorized request to the Harvester application and displays the actual result. Existing exchange orders are not canceled by the ordinary `/pause` command; a resting BUY may still fill.

## Architecture

- [ADR-0002 — Transport-independent operator control](../architecture/decisions/0002-transport-independent-operator-control.md) — accepted DDD ownership, actor contract, pause semantics, authorization, transport and failure decisions.
- [ADR-0003 — Process-lifetime operator pause](../architecture/decisions/0003-process-lifetime-operator-pause.md) — accepted initial rollout boundary.
- [ADR-0005 — Emergency BUY pause](../architecture/decisions/0005-emergency-buy-pause.md) — global/market BUY gate and owned-BUY cancellation contract.
- [Implementation contract and diagrams](../architecture/OPERATOR_CONTROL_DESIGN.md) — current source layout, request/record schemas and delivery sequence.
- [Harvester roadmap](../../ROADMAP.md) — current implementation status and dependencies.

## Command Center commands

- `/start` — show the Command Center and persistent six-button keyboard.
- `/menu` — restore the persistent keyboard when it has been hidden.
- `/help` — show the available command vocabulary and safety semantics.
- `/status` — read-only runtime lifecycle, trading mode, user-data readiness, blocker and freshness summary.
- `/markets` — read-only configured-market state, latest price/source timestamp/freshness, pause ownership and volatility-protection blockers.
- `/positions` — read-only Portfolio inventory and invested-quote summary.
- `/orders` — active Harvester registry orders plus unmatched account-wide exchange orders explicitly labelled `EXTERNAL`; external orders are never adopted.
- `/balances` — latest canonical exchange free/locked/total balances with source timestamp and age; these are account balances, not strategy-owned inventory.
- `/pause <SYMBOL>` — suppress new strategy BUY intents and trailing-BUY repricing for one configured market.
- `/resume <SYMBOL>` — submit a request to remove the operator-owned pause; the application returns the actual outcome.
- `/pauseallbuys` — block all new BUYs and cancel active current-process-owned BUY orders across configured markets.
- `/resumeallbuys` — remove only the global emergency BUY pause.
- `/pausebuys <SYMBOL>` — block new BUYs and cancel active current-process-owned BUYs for one configured market.
- Emergency BUY slash commands execute immediately after the existing private-chat authorization checks; they do not use the inline market-button confirmation flow.
- `/resumebuys <SYMBOL>` — remove only that market emergency BUY pause.

The existing `/pause SYMBOL` blocks new BUY decisions for one market but does not cancel already-open orders. Emergency BUY pause is separate: it blocks new BUYs first, then cancels only active BUY orders owned by the current Harvester process. Startup-snapshot/manual/external orders are not canceled. If cancellation is unresolved, the BUY gate remains active and the command reports the incomplete outcome; the Command Center does not attempt its own retry or reconciliation. Global and per-market scopes are independent. The application owns all state transitions and safety decisions. `/status` and `/markets` use application snapshots; `/orders` performs the account-wide open-orders read; `/balances` reads the latest captured account snapshot. These queries are read-only and do not adopt or modify exchange orders.

## Separate capability: outbound Telegram notifications

Outbound event notifications are not part of the Command Center. They use the independent `notifications.telegram` policy and `@coinzilla/notifiers` delivery boundary. See [Harvester notification architecture](../architecture.md#operational-notifications) and [Notifiers documentation](../../../../packages/notifiers/README.md).

## CC-4 usability and hardening — merged

Implemented in [PR #1088](https://github.com/45s/coinzilla/pull/1088). The adapter registers Telegram's command menu on startup (best-effort), accepts inline callback updates, and provides authorized status/markets/positions/orders/balances navigation with per-page refresh. Enabled markets expose inline pause/resume requests; each request first shows a one-time confirmation bound to the allowlisted private-chat user and originating message. Confirmations expire after five minutes, are consumed once, and call only the existing application pause/resume use cases. Text `/pause` and `/resume` remain available as explicit commands. The exact PR head passed 1,479/1,479 Harvester tests and all required CI checks plus external documentation-link validation. See the [operator runbook](../operations/telegram-command-center.md) for operation and troubleshooting.

## Interaction diagnostics — merged PR #1215

The Telegram adapter assigns `telegram:<update_id>` to each inbound interaction and carries it through authorization, query/application execution, callback acknowledgement and response delivery. Structured entries include the action, interaction type, market symbol when applicable, operation, stage, duration and application-operation state flags. Original thrown errors and nested causes are retained; non-exception failures use a classification rather than a synthetic Error.

Callback acknowledgement failure does not advance the polling offset. The same update is retried, and the application operation is not invoked until the confirmation interaction is acknowledged. A failed Telegram response after a completed application operation is distinguishable from a failed application operation through the completion/state-change flags.

Implementation and mocked regression coverage are merged in PR #1215. A live Telegram smoke test remains an operator-controlled verification step; no live pause/resume command is issued by CI. See [Harvester logging](../LOGGING.md) and the [operator runbook](../operations/telegram-command-center.md).

## Ownership

The operator facade and use cases belong to `apps/harvester`. Do not create a shared `packages/operator` package until another application demonstrates the same transport-independent actor, authorization and request semantics.

## Runtime boundary

- Runtime configuration belongs under `operatorControl.telegram`, independent from outbound `notifications.telegram`.
- Inbound control defaults enabled in `config/operator-control.js`; set `operatorControl.telegram.enabled: false` to disable it intentionally. `TELEGRAM_USER_ID` seeds the private-chat allowlist; bootstrap validates it and fails closed if the allowlist is empty/invalid or `TELEGRAM_BOT_TOKEN` is missing. The bot token remains environment-only.
- The Telegram poller starts after the Harvester application is composed and stops during application shutdown. It does not own trading state, persistence, or process lifecycle decisions.
- Operator pauses are process-lifetime only. The application returns the authoritative result of each command; operators must use `/markets` to verify the current state.

## Implementation status

| Capability | Status |
| --- | --- |
| Authorized Telegram adapter, private-chat allowlist and serial polling | Merged in PRs #1045 and #1067 |
| `/start`, `/menu`, `/help`, `/pause`, `/resume`, `/status`, `/markets` | Merged in PRs #1079 and #1081 |
| Read-only `/positions`, `/orders`, `/balances` queries | Merged in PR #1086 |
| Inline navigation, refresh and confirmation-gated Pause/Resume | Merged in PR #1088 |
| Persistent six-button keyboard | Merged in PR #1194 |
| Emergency global/per-market BUY commands | Merged in PR #1267 |
| Correlated interaction diagnostics and callback acknowledgement handling | Merged in PR #1215 |

**Command Center roadmap: COMPLETE.** No separate CC recovery, trading-policy, persistence, or notification-delivery work is owned by the Telegram adapter. Future commands should be added only as thin mappings to an existing or explicitly approved Harvester application capability.
