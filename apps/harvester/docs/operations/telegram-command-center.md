# Telegram Command Center

## Scope and configuration

The Telegram Command Center is a thin inbound adapter over Harvester's operator-control application facade. It authenticates the operator, invokes an application query or command, and returns the actual result. It does not own trading rules, decide whether a command is safe, call the broker directly, or implement persistence or recovery.

Inbound control is enabled by default when configured. The bot token remains environment-only in `TELEGRAM_BOT_TOKEN`; `TELEGRAM_USER_ID` seeds the private-chat allowlist. Startup fails closed when the token or a valid allowlisted user is missing. Set `operatorControl.telegram.enabled: false` only when inbound control should be disabled. This configuration is independent from `notifications.telegram`.

## Authorization and safety

Every inbound interaction must be from a non-bot sender in a private chat, with `message.from.id` matching the private chat ID and present in the configured allowlist. Display names, chat titles, message text, and caller-supplied roles never authorize an interaction.

Pause and resume remain market-scoped application use cases:

- Inline Pause/Resume buttons show eligible markets, then a confirmation page. Only the confirmation callback invokes the application use case.
- Explicit `/pause SYMBOL` and `/resume SYMBOL` commands remain available to an authorized operator.
- Pause suppresses new strategy BUY intents and trailing-BUY repricing for that market. It does not cancel or modify existing exchange orders; a resting BUY may still fill.
- Emergency BUY pause is separate: `/pauseallbuys` blocks new BUYs across configured markets; `/pausebuys SYMBOL` blocks BUYs for one market. Both cancel active BUY orders owned by the current Harvester process through the existing cancellation/reconciliation workflow.
- Emergency BUY pause never cancels startup-snapshot/manual/external orders. If a BUY cancellation is unconfirmed, the BUY remains UNKNOWN and the application reports the incomplete outcome. Global and per-market pause scopes are independent; resuming one does not clear the other. Orders from a previous Harvester process are external to the current process and are not canceled by a repeated pause command.
- If any owned BUY cancellation is unconfirmed, the BUY gate remains active and the command reports `OPERATOR_BUY_CANCELLATION_INCOMPLETE`; inspect `/orders` and Harvester diagnostics before assuming the market is clear.
- Both the legacy market pause and emergency BUY pause are process-lifetime only and are not restored after restart. Reissue `/pause SYMBOL` or the relevant emergency BUY command after restart when required.

## Supported commands and buttons

| Surface | Action | Application behavior |
| --- | --- | --- |
| `/start` | Start | Displays the persistent six-button keyboard |
| `/menu` | Menu | Restores the persistent keyboard |
| `/help` | Help | Displays the supported command vocabulary and safety semantics |
| Keyboard: Status | Status | Calls the read-only `getStatus` query |
| Keyboard: Markets | Markets | Calls the read-only `getMarkets` query |
| Keyboard: Portfolio | Portfolio | Calls the read-only `getPositions` query |
| Keyboard: Open Orders | Open Orders | Calls the read-only `getOrders` query |
| Inline navigation: Balances; `/balances` | Balances | Calls the read-only `getBalances` query |
| `/status` | Status | Calls `getStatus` |
| `/markets` | Markets | Calls `getMarkets` |
| `/positions` | Positions | Calls `getPositions` |
| `/orders` | Orders | Calls `getOrders` |
| `/pause SYMBOL` | Pause | Invokes the existing market-scoped `pauseMarket` use case |
| `/resume SYMBOL` | Resume | Invokes the existing market-scoped `resumeMarket` use case |
| `/pauseallbuys` | Emergency global BUY pause | Blocks new BUYs and cancels active current-process-owned BUY orders across configured markets |
| `/resumeallbuys` | Resume global BUY pause | Removes only the global emergency BUY gate; market-specific gates remain |
| `/pausebuys SYMBOL` | Emergency market BUY pause | Blocks new BUYs and cancels active current-process-owned BUYs for one market |
| `/resumebuys SYMBOL` | Resume market BUY pause | Removes only that market emergency BUY gate; a global gate may still block BUYs |
| Keyboard: Pause | Pause selection | Shows enabled, currently unpaused markets; selection opens confirmation |
| Keyboard: Resume | Resume selection | Shows enabled, currently paused markets; selection opens confirmation |
| Inline Refresh | Refresh | Re-runs the current read-only page or market selection |
| Inline Cancel/Main menu | Navigation | Cancels the pending confirmation or returns to the menu |

The persistent keyboard has exactly six buttons: Pause, Resume, Status, Markets, Portfolio, and Open Orders. Balances remains available through inline navigation and `/balances`.

Emergency BUY controls are explicit text commands and are not replacements for the existing confirmation-gated market Pause/Resume buttons. They execute immediately after the existing private-chat authorization checks; there is no additional confirmation step for these emergency commands. Telegram command names are lowercase; application methods are `pauseAllBuys`, `resumeAllBuys`, `pauseBuys({ symbol })`, and `resumeBuys({ symbol })`.

## Interaction diagnostics

Every update receives a correlation ID in the form `telegram:<update_id>`. The same ID is retained when Telegram redelivers an update. Search the terminal/log stream by that value to reconstruct one interaction.

The interaction lifecycle is emitted at INFO and is therefore visible in the terminal; the structured DEBUG log retains the complete diagnostic record and exception details.

The structured lifecycle includes:

- `Telegram update RECEIVED`
- `Telegram interaction AUTHORIZED` or `Telegram interaction REJECTED`
- `Telegram command STARTED`
- `Telegram query STARTED` and `Telegram query COMPLETED`
- `Telegram callback ACKNOWLEDGED`
- `Telegram application operation STARTED` and `Telegram application operation COMPLETED`
- `Telegram response SENT`
- `Telegram interaction FAILED`

Entries carry the interaction type, action, market symbol when relevant, application query/use-case name, stage, correlation ID, and duration where applicable. Application-operation diagnostics distinguish `applicationOperationInvoked`, `applicationOperationCompleted`, and `stateChanged`. Failures include a classification and, for real exceptions, the original error name/code/message/stack plus nested cause details.

Do not log complete Telegram updates, callback payloads, bot tokens, allowlist IDs, API credentials, or full broker/account/order payloads. Only safe identifiers and the minimum fields needed to diagnose the interaction are logged. See [Harvester logging](../LOGGING.md) for the shared logging contract.

## Interpreting failures

| Last completed stage / flags | Meaning | Operator response |
| --- | --- | --- |
| Query failed; `applicationOperationInvoked=false` | A read-only query failed. No pause/resume use case was invoked. | Inspect the original query error and retry the read after the underlying issue is understood |
| `CALLBACK_ACKNOWLEDGEMENT`; `applicationOperationInvoked=false` | Telegram did not acknowledge the callback. The update offset is not advanced; the same update is retried. | Do not manually repeat the callback while the poller is retrying |
| Application operation invoked but not completed | The use case was called but did not confirm completion. The state outcome may need inspection. | Check current market state before repeating the command |
| `applicationOperationCompleted=true`, `stateChanged=true`, then response delivery failed | The application state change completed; only the Telegram response failed. | Verify state with `/markets` before considering any repeat operation |
| `OPERATOR_BUY_CANCELLATION_INCOMPLETE` | The BUY gate is active, but one or more owned BUY cancellations remain unresolved. | Do not assume all BUYs are gone; inspect `/orders` and Harvester diagnostics. |
| Response delivered after a market selection | Only the selection/confirmation page was displayed. | This is not evidence that the market was paused or resumed |

The `/orders` command requires an account-wide open-order snapshot. Bootstrap intentionally supplies `getOpenOrders: () => resources.broker.getOpenOrders()` without a symbol filter. The Harvester Binance adapter must accept an omitted options object and forward `{}` to the broker; destructuring `symbol` without a default throws before any exchange request. Regression coverage in [PR #1261](https://github.com/45s/coinzilla/pull/1261) protects this contract. The query remains read-only and must never adopt, cancel, or modify returned external orders.\n\nThe historical message `Telegram operator read query returned a failure` came from the generic read-only query result-failure branch. When a query threw, the old `readPage` catch first emitted a separate `Telegram operator read query failed` entry with the original error, converted the result to `{ok:false}`, and then emitted the generic second failure entry. The captured generic line alone does not include the earlier exception details; without that preceding entry (or the structured `operation` field), the exact failing query and exception cannot be identified retrospectively. It is not proof that a pause operation ran.

Likewise, the historical `LINKUSDT` pause state cannot be determined from that message. No live pause/resume was performed as part of this diagnostic work. To establish current state, inspect the live `/markets` result in the running Harvester process; do not infer state or repeat a state-changing command from the old generic error.

## Verification status

Automated tests use mocked Telegram transport and application ports. They cover the read-only command inventory, menu restoration, pause/resume selection and confirmation, callback acknowledgement failure/retry, authorization rejection, stale callbacks, query/use-case failures, Telegram API failures, and safe error diagnostics.

A live Telegram smoke test and live `LINKUSDT` state inspection remain operator-controlled and have not been performed by this change. Runtime verification must not be marked complete until an authorized operator performs those checks.
