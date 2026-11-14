# Telegram Command Center operator runbook

## Scope and safety

The Harvester Telegram Command Center is an optional operator interface. Inbound control remains disabled by default and is enabled only through the reviewed `operatorControl.telegram` configuration and a private-chat user-ID allowlist. The bot token remains in `TELEGRAM_BOT_TOKEN`.

The Command Center is not an exchange kill switch. It cannot place, cancel, adopt or modify exchange orders; change strategies or configuration; bypass safety/recovery/volatility blockers; or execute arbitrary commands. A market pause suppresses new strategy BUYs and trailing-BUY replacements for that market only. Existing orders remain open and may still fill; fill accounting and recovery SELLs continue. User-data disconnect/reconnect and reconciliation do not clear an active operator pause. Operator pauses last only for the current process and are not restored after restart.

## Enabling the Command Center

1. Set `operatorControl.telegram.enabled: true` in `config/operator-control.js`.
2. Set `TELEGRAM_USER_ID` in the runtime environment to your numeric Telegram sender user ID. Bootstrap validates it and adds it to `operatorControl.telegram.allowedUserIds`, preserving configured IDs. Invalid values stop startup with a specific error. This variable does not enable operator control by itself.
3. Set `TELEGRAM_BOT_TOKEN` in the runtime environment. Do not put the token in application configuration or commit it.
4. Initialize the ADR-0001 Operational State Store once while Harvester is stopped, following the [Operational State Store setup](../../README.md#operational-state-store-adr-0001-step-8). The default directory is `apps/harvester/recovery-facts/` inside the Harvester application package; the initializer and runtime resolve this same path, so no directory variable is required. For a custom absolute path, set `OPERATIONAL_STATE_DIRECTORY` in both environments. The former `DURABLE_FACTS_DIRECTORY` remains a legacy alias. Existing data in the old `~/.coinzilla/harvester/recovery-facts` location is not moved automatically; set `OPERATIONAL_STATE_DIRECTORY` to that existing absolute path if you need to continue using it.
5. Start only with a verified Operational State Store that contains no prior `PROCESS_STARTED` record. The current ADR-0001 gate blocks every second process start, even after clean shutdown, until Steps 8–9 are accepted. Do not delete or reinitialize an existing ledger to bypass this restriction.

Telegram control can be enabled while `recovery.enabled` remains false. The production entry point still composes the shared Operational State Store for operator-control records; it does not enable restart restoration or create/repair the store.

## Command menu and navigation

Use `/start` or `/help` to display the supported command vocabulary. Telegram's command menu mirrors the text commands. Inline navigation opens read-only status, markets, positions, orders and balances pages. Enabled markets expose a pause request when not operator-paused and a resume request when the operator pause is active; disabled markets expose no inline control. Refresh re-runs the corresponding authorized application query; it does not reuse stale display data or perform a trading action. Return-to-menu controls only change the displayed page.

## Status semantics

`/status` reports the Harvester process lifecycle and readiness. The process remains `RUNNING` while one or more markets are operator-paused; this is not an application-wide `PAUSED` lifecycle state. Use `/markets` to see exactly which configured markets have `Operator pause: ACTIVE`.

When the Harvester process is stopped, its Telegram poller is also stopped, so it cannot answer a live `/status` request. A missing Telegram reply is not proof that Harvester is stopped because Telegram transport failures can also prevent replies.

Text commands remain available:

- `/status`, `/markets`, `/positions`, `/orders`, and `/balances` are read-only.
- `/pause SYMBOL` and `/resume SYMBOL` are explicit text requests and call the existing application use case directly; inline market controls require a separate confirmation.
- `/start` and `/help` show the command center entry point.

## Confirming a control

An inline pause or resume request first displays the exact action and market. No operator use case or operational-state record commit occurs at this stage. Confirm executes the existing application pause/resume use case; cancel dismisses the pending request. Typed `/pause SYMBOL` and `/resume SYMBOL` remain explicit commands and execute the existing application use case directly. Confirmation callbacks are bound to the originating allowlisted private-chat user and message, are one-time and short-lived, and are rejected when stale, replayed, malformed or issued by another user.

A confirmed pause is acknowledged only after the application reports a successful commit-before-memory transition. A confirmed resume can remove only the operator-owned pause; any safety, recovery or volatility blocker remains authoritative. A failed or uncertain durable append is never presented as success.

## Authorization and delivery

Only a non-bot sender in a private chat whose Telegram user ID matches the private chat ID and the configured allowlist may use the Command Center. Application actor authorization remains mandatory. Callback data is not an identity credential.

The adapter processes updates serially and advances the Telegram update offset only after handling an update. The application request ID is stable across retries so the operational-state record boundary can deduplicate repeated control delivery. Menu registration is best-effort; a menu-registration failure is logged and does not grant access or disable text commands. Polling and callback transport failures are retried with bounded backoff. Shutdown aborts long polling and waits for the poller to finish before returning.

## Troubleshooting

- **Not authorized:** verify the sender's numeric Telegram user ID is present in `operatorControl.telegram.allowedUserIds`; do not use usernames or display names.
- **Command menu missing:** use `/help`; Telegram menu registration is best-effort and may be retried on a later adapter startup.
- **Snapshot unavailable:** treat the page as unavailable, not healthy. Check Harvester structured logs and source readiness.
- **Confirmation expired or invalid:** reopen the markets page and start a new inline control request; stale confirmation callbacks never execute.
- **Pause/resume not acknowledged:** inspect the stable operator error code and operational-state diagnostics. Do not assume the state changed.
- **Telegram outage:** text commands and inline controls are unavailable while transport is down. Trading behavior does not depend on Telegram delivery.
- **Shutdown failure:** Harvester must preserve its existing fail-closed shutdown/ownership behavior; do not force process termination to bypass an unconfirmed adapter stop.

## Acceptance evidence

The CC-4 regression matrix is maintained in `telegram-operator-adapter.test.js`. It covers successful and failed command-menu registration, callback update polling, private-chat authorization and identity matching, confirmation-before-control, one-time callback handling, read-only navigation/refresh, enabled/disabled market controls, malformed callback rejection, retry identity and graceful shutdown. Merged in [PR #1088](https://github.com/45s/coinzilla/pull/1088) as `966141fbc1217d38f40e6e5faf84629251894a8c`; exact PR head `afda070a565f42e546bfb0a76096939427451111` passed 1,479/1,479 Harvester tests, all required workspace unit/coverage/syntax/dependency/actionlint checks, and external documentation-link validation. The read-only Binance TESTNET integration was skipped and no exchange operations or live Telegram credentials were used.
