# Harvester operator control

This is the entry point for Harvester's operator-control capability.

## Current status

The engine/application foundation is implemented in [PR #1045](https://github.com/45s/coinzilla/pull/1045). Initial runtime configuration, Telegram adapter startup/shutdown, and fail-closed bootstrap validation were implemented in [PR #1067](https://github.com/45s/coinzilla/pull/1067). Telegram control is enabled by default; startup requires the configured private-chat allowlist and bot token. The Operational State Store is required only when restart recovery is enabled or a store is explicitly supplied; Telegram-only control does not create or require it.

The Telegram Command Center exposes `/start`, `/menu`, `/help`, `/status`, `/markets`, `/positions`, `/orders`, `/balances`, `/pause <SYMBOL>`, and `/resume <SYMBOL>`. CC-1 is merged in PRs #1079 and #1081. CC-2 adds authorized read-only trading visibility queries: canonical Portfolio positions keep active and retained inventory separate; open orders label Harvester registry orders versus unmatched exchange orders as external; balances report the exchange snapshot source timestamp and age. CC-2 is merged in PR #1086; all seven exact-head GitHub Actions workflows passed. CC-3 proactive alerts are merged in PR #1087. CC-4 usability and hardening is merged in [PR #1088](https://github.com/45s/coinzilla/pull/1088) as `966141fbc1217d38f40e6e5faf84629251894a8c`; exact-head CI and external documentation-link validation passed. The persistent reply keyboard adds Pause, Resume, Status, Markets, Portfolio and Open Orders. Pause/Resume open filtered market choices and still require the existing inline confirmation; Portfolio reuses the positions query and Open Orders reuses the orders query. `/start` displays the keyboard and `/menu` restores it. See the [Telegram operator runbook](../operations/telegram-command-center.md) for command-menu, keyboard, inline-navigation and confirmation behavior.

The operator pause is **process-lifetime only** and is never restored into a later process. When an Operational State Store is supplied, the application commits the operator-control record before applying the in-memory pause. In the default Telegram-only setup with `recovery.enabled` false, bootstrap does not create or require that store; pause/resume changes are process-local and are lost on restart. ADR-0003 still excludes pause replay. Restart recovery and Telegram-only control are separate capabilities.

Do not use Journal as the control-state store. Do not claim that a pause survives a process restart. Existing exchange orders are not canceled or modified; a resting BUY may still fill.

## Architecture

- [ADR-0002 — Transport-independent operator control](../architecture/decisions/0002-transport-independent-operator-control.md) — accepted DDD ownership, actor contract, pause semantics, authorization, transport and failure decisions.
- [ADR-0003 — Process-lifetime operator pause](../architecture/decisions/0003-process-lifetime-operator-pause.md) — accepted initial rollout boundary.
- [Implementation contract and diagrams](../architecture/OPERATOR_CONTROL_DESIGN.md) — current source layout, request/record schemas and delivery sequence.
- [ADR-0001 — Process-restart recovery record contract](../architecture/decisions/0001-application-owned-recovery-facts.md) — authoritative persistence and restart-recovery contract.
- [Harvester roadmap](../../ROADMAP.md) — current implementation status and dependencies.

## Command Center commands

- `/start` — show the Command Center and persistent six-button keyboard.
- `/menu` — restore the persistent keyboard when it has been hidden.
- `/help` — show the available command vocabulary and safety semantics.
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

## CC-4 usability and hardening — merged

Implemented in [PR #1088](https://github.com/45s/coinzilla/pull/1088). The adapter registers Telegram's command menu on startup (best-effort), accepts inline callback updates, and provides authorized status/markets/positions/orders/balances navigation with per-page refresh. Enabled markets expose inline pause/resume requests; each request first shows a one-time confirmation bound to the allowlisted private-chat user and originating message. Confirmations expire after five minutes, are consumed once, and call only the existing application pause/resume use cases. Text `/pause` and `/resume` remain available as explicit commands. The exact PR head passed 1,479/1,479 Harvester tests and all required CI checks plus external documentation-link validation. See the [operator runbook](../operations/telegram-command-center.md) for operation and troubleshooting.

## Ownership

The operator facade and use cases belong to `apps/harvester`. Do not create a shared `packages/operator` package until another application demonstrates the same transport-independent actor, authorization and request semantics.

## Runtime and persistence

- Runtime configuration belongs under `operatorControl.telegram`, independent from `notifications.telegram`.
- Inbound control defaults enabled in `config/operator-control.js`; set `operatorControl.telegram.enabled: false` only to disable it intentionally. `TELEGRAM_USER_ID` seeds `allowedUserIds` from the runtime environment when the config module loads. Bootstrap validates the numeric value and merges it with configured IDs; startup fails closed if the allowlist is empty or invalid, or if `TELEGRAM_BOT_TOKEN` is missing. The Operational State Store is verified when restart recovery is enabled or an explicit store is supplied; Telegram-only control does not require one. The bot token remains environment-only.
- **Operational State Store** is the application-facing name for the ADR-0001 append-only ledger. Its default directory is `apps/harvester/recovery-facts/`, resolved relative to the Harvester package and ignored by Git because it contains private runtime data.
- Harvester bootstrap composes the Operational State Store for restart recovery when `recovery.enabled` is true. Telegram-only control does not create or require the store; an explicitly supplied store remains supported. Enabling Telegram alone does not enable restart recovery. `OPERATIONAL_STATE_DIRECTORY` is the only supported optional absolute-path override. Runtime, the one-time initializer and the offline confirmation CLI use the same package-anchored directory resolver. There is no home-directory fallback or legacy directory-variable alias. This path cleanup does not migrate, delete, initialize, overwrite or repair existing runtime data.
- The ledger must already be initialized when restart recovery is enabled; normal startup never creates or repairs it. Telegram-only control with recovery disabled has no ledger initialization prerequisite. See the [Operational State Store setup](../../README.md#operational-state-store-adr-0001-step-8).
- The poller starts only after the Harvester engine is constructed and stops before broker shutdown.
- When an Operational State Store is supplied, operator pause records use that same process-owned ADR-0001 append-only ledger as process, order, cancellation, fill and recovery-cycle records. Without a supplied store, the engine keeps operator pause state in memory only. Do not create a second writer or an operator-specific ledger.
- A successful durable append precedes the in-memory pause when a store is supplied. If that append fails or is uncertain, the pause is not applied and success is not acknowledged. Without a store, the process-local transition is not durable.
- User-data transport disconnect/reconnect and successful reconciliation do not clear the in-memory operator pause.
- Operator pause records are not replayed at startup. While `recovery.enabled` is false, bootstrap reads process-boundary facts only; if a prior `PROCESS_STARTED` exists, it keeps trading disabled but starts the Command Center. If restart restoration is eventually enabled, the operator must reissue `/pause <SYMBOL>` when required; operator pauses are not restored automatically.

## Implementation status

| Slice | Status |
| --- | --- |
| Engine pause/resume boundary and market-scoped behavior | Implemented in PR #1045; regression-tested |
| Actor authorization and optional durable-before-apply application use cases | Implemented in PR #1045; port-tested; Telegram-only default is process-local without a supplied store |
| Telegram parser, private-chat allowlist and serial polling | Implemented in PR #1045; mocked-transport tested |
| Enabled-by-default runtime configuration and recovery-off startup behavior | Updated in PR #1197; regression-tested |
| Telegram `/start`, `/help`, `/pause`, and safe `/resume` | Implemented in PR #1079; merged |
| Read-only `/status` and `/markets` application queries and Telegram formatting | Implemented in PR #1081; regression-tested |
| Read-only `/positions`, `/orders`, and `/balances` application queries and Telegram formatting | Merged in PR #1086; offline contract tests and all seven exact-head workflows passed |
| Proactive readiness, recovery-blocker and Telegram delivery-health alerts | Implemented in PR #1087; all eight exact-head workflows passed |
| Telegram command menu, inline read-only navigation/refresh and confirmed inline pause/resume controls | Merged in PR #1088; 1,479 Harvester tests and exact-head CI passed |
| Persistent six-button reply keyboard, `/menu` restore command and filtered Pause/Resume market selection | Merged in PR #1194; 1,657 Harvester tests passed and all seven Actions workflows passed on exact head |
| Telegram-only startup without an Operational State Store; process-local pause fallback | Implemented in PR #1211; restart recovery still requires its verified store |
| Process-restart restoration of operator pause state | Explicitly out of scope under ADR-0003; separate ADR-0001 / #654 workstream |
