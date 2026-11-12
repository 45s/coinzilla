# Harvester operator control

This is the entry point for Harvester's operator-control capability.

## Current status

The engine/application foundation is implemented in [PR #1045](https://github.com/45s/coinzilla/pull/1045). Disabled-by-default runtime configuration, Telegram adapter startup/shutdown, and fail-closed bootstrap validation are implemented in [PR #1067](https://github.com/45s/coinzilla/pull/1067).

The Telegram Command Center exposes `/start`, `/help`, `/status`, `/markets`, `/positions`, `/orders`, `/balances`, `/pause <SYMBOL>`, and `/resume <SYMBOL>`. CC-1 is merged in PRs #1079 and #1081. CC-2 adds authorized read-only trading visibility queries: canonical Portfolio positions keep active and retained inventory separate; open orders label Harvester registry orders versus unmatched exchange orders as external; balances report the exchange snapshot source timestamp and age. CC-2 is merged in PR #1086; all seven exact-head GitHub Actions workflows passed. CC-3 proactive alerts are merged in PR #1087. CC-4 usability and hardening is in progress on issue #1077; see the [Telegram operator runbook](../operations/telegram-command-center.md) for command-menu, inline-navigation and confirmation behavior.

The operator pause is **process-lifetime only**: the fact is durably appended before the in-memory pause is applied, but the pause is not restored into a later process. ADR-0003 explicitly keeps this capability independent from full ADR-0001 restart recovery. The separate #654 startup fence currently blocks every second process start until recovery Steps 8–9 are accepted.

Do not use Journal as the control-state store. Do not claim that a pause survives a process restart. Existing exchange orders are not canceled or modified; a resting BUY may still fill.

## Architecture

- [ADR-0002 — Transport-independent operator control](../architecture/decisions/0002-transport-independent-operator-control.md) — accepted DDD ownership, actor contract, pause semantics, authorization, transport and failure decisions.
- [ADR-0003 — Process-lifetime operator pause](../architecture/decisions/0003-process-lifetime-operator-pause.md) — accepted initial rollout boundary.
- [Implementation contract and diagrams](../architecture/OPERATOR_CONTROL_DESIGN.md) — current source layout, request/fact schemas and delivery sequence.
- [ADR-0001 — Application-owned durable facts](../architecture/decisions/0001-application-owned-recovery-facts.md) — authoritative persistence and restart-recovery contract.
- [Harvester roadmap](../../ROADMAP.md) — current implementation status and dependencies.

## Command Center commands

- `/start` and `/help` — show the available command vocabulary and safety semantics.
- `/status` — read-only runtime lifecycle, trading mode, user-data readiness, blocker and freshness summary.
- `/markets` — read-only configured-market state, latest price/source timestamp/freshness, pause ownership and volatility-protection blockers.
- `/positions` — canonical Portfolio active/free/total inventory, invested quote and recovery-ledger context.
- `/orders` — active Harvester registry orders plus unmatched account-wide exchange orders explicitly labelled `EXTERNAL`; external orders are never adopted.
- `/balances` — latest canonical exchange free/locked/total balances with source timestamp and age; these are account balances, not strategy-owned inventory.
- `/pause <SYMBOL>` — suppress new strategy BUY intents and trailing-BUY repricing for one configured market.
- `/resume <SYMBOL>` — remove only the operator-owned pause when the engine confirms no safety/recovery/volatility blocker is active.

Already-open exchange orders are not canceled or modified by pause; a resting BUY may still fill. Fill accounting and risk-reducing recovery SELL decisions continue. The status and market queries use process/engine snapshots without broker calls. The trading-visibility queries are also read-only: /orders performs an account-wide open-orders read, /balances reads the latest captured AccountSnapshot, and none of the queries changes trading state or adopts/modifies exchange orders.

## Proactive alerts — CC-3

CC-3 is implemented in [PR #1087](https://github.com/45s/coinzilla/pull/1087), with all eight exact-head workflows passing. It reports confirmed readiness after startup PREFLIGHT account/open-order snapshots (before market-price subscription) and every subsequent user-data readiness loss/restoration, warns when the WebSocket transport reconnects before authoritative application reconciliation completes, alerts on failed recovery and blocked recovery-cycle outcomes, and exposes structured Telegram delivery diagnostics. Readiness restoration is non-disableable in every profile, including `minimal` and `custom`; event overrides cannot hide it. Alerts reuse the existing best-effort notifier; Telegram I/O never participates in trading transitions, and no automatic retry or durable outbox is introduced.

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
| Telegram `/start`, `/help`, `/pause`, and safe `/resume` | Implemented in PR #1079; merged |
| Read-only `/status` and `/markets` application queries and Telegram formatting | Implemented in PR #1081; regression-tested |
| Read-only `/positions`, `/orders`, and `/balances` application queries and Telegram formatting | Merged in PR #1086; offline contract tests and all seven exact-head workflows passed |
| Proactive readiness, recovery-blocker and Telegram delivery-health alerts | Implemented in PR #1087; all eight exact-head workflows passed |
| Process-restart restoration of operator pause state | Explicitly out of scope under ADR-0003; separate ADR-0001 / #654 workstream |
