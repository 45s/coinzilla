# Harvester operator control

This is the entry point for Harvester's operator-control capability.

## Current status

The engine boundary, transport-independent application use cases and offline-testable Telegram `/pause <SYMBOL>` adapter are implemented in [PR #1045](https://github.com/45s/coinzilla/pull/1045); production configuration and lifecycle wiring are delivered by [PR #1067](https://github.com/45s/coinzilla/pull/1067). The initial operator pause is **process-lifetime only**: it is durably appended before in-memory application, but it is not restored after a process restart. Full restart recovery (ADR-0001 / issue #654) is a separate workstream and is not a prerequisite.

Do not use Journal as the control-state store. Do not claim that a pause survives a restart; after restarting Harvester, issue `/pause <SYMBOL>` again if the market must remain paused.

## Enablement

Inbound control is disabled by default. To enable it, set `operatorControl.telegram.enabled` to `true` in `apps/harvester/config.json` and add only trusted Telegram user IDs to `allowedUserIds`. Keep the bot token and durable-store path in the process environment:

- `TELEGRAM_BOT_TOKEN`: Telegram bot token; never put it in JSON or commit it.
- `DURABLE_FACTS_DIRECTORY`: absolute path to an already initialized ADR-0001 durable-facts directory.

Initialize the store once, explicitly, before enabling the adapter. From the repository root, set `DURABLE_FACTS_DIRECTORY` to the intended absolute directory and run `node apps/harvester/scripts/initialize-durable-facts.js --confirm`. Runtime startup only verifies and appends to this store; it never initializes, repairs or resets it. Missing credentials, an invalid path, an uninitialized/corrupt store, or failed Telegram `getMe` verification aborts startup before trading subscriptions are started.

Example configuration:

```json
{
  "operatorControl": {
    "telegram": {
      "enabled": false,
      "allowedUserIds": []
    }
  }
}
```

Keep this inbound control separate from `notifications.telegram`, which is outbound-only. After enabling, restart Harvester intentionally; a pause is not restored on the next process restart.

## Architecture

- [ADR-0002 — Transport-independent operator control](../architecture/decisions/0002-transport-independent-operator-control.md) — accepted DDD ownership, actor contract, pause semantics, authorization, transport and failure decisions.
- [Implementation contract and diagrams](../architecture/OPERATOR_CONTROL_DESIGN.md) — current source layout, request/fact schemas and delivery sequence.
- [ADR-0001 — Application-owned durable facts](../architecture/decisions/0001-application-owned-recovery-facts.md) — authoritative persistence and restart-recovery contract.
- [Harvester roadmap](../../ROADMAP.md) — current implementation status and dependencies.

## First command

The initial Telegram command is `/pause <SYMBOL>`. It suppresses new strategy BUY intents and trailing-BUY repricing for one configured market, while preserving fill accounting and recovery SELL decisions.

Already-open exchange orders are not canceled or modified; a resting BUY may still fill. The command response must make this explicit.

The application-level `resumeMarket` use case exists for a future trusted adapter, but resume is not exposed as a Telegram command in the first milestone.

## Ownership

The operator facade and use cases belong to `apps/harvester`. Do not create a shared `packages/operator` package until another application demonstrates the same transport-independent actor, authorization and request semantics.

## Implementation status

| Slice | Status |
| --- | --- |
| Engine pause/resume boundary and market-scoped behavior | Implemented in PR #1045; regression-tested |
| Actor authorization and durable-before-apply application use cases | Implemented in PR #1045; port-tested |
| Telegram /pause SYMBOL parser, private-chat allowlist and serial polling | Implemented in PR #1045; mocked-transport tested |
| Process-restart restoration of operator pause state | Explicitly out of scope; separate ADR-0001 / #654 workstream |
| Disabled-by-default configuration, ADR-0001 store verification, Telegram startup/shutdown and fail-closed runtime wiring | Implemented in PR #1067; independent of full restart recovery |

PR #1045 is the engine/application/adapter foundation; PR #1067 wires the adapter into the runtime. Inbound control remains disabled until an operator explicitly configures the allowlist, token and initialized durable-facts directory. No TESTNET or LIVE operation is authorized by this engineering work.
