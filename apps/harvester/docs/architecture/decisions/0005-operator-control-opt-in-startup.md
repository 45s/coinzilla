---
title: Opt-in Telegram operator control
status: accepted
type: architecture
owner: harvester
created: 2026-11-16
---

# ADR-0005: Opt-in Telegram operator control

## Status

**Accepted.** This decision supersedes only the enabled-by-default inbound Telegram configuration introduced by the initial runtime rollout in PR #1067 and referenced by ADR-0003. It does not change the transport-independent application contract in ADR-0002, the process-lifetime pause boundary in ADR-0003, or the ADR-0001 Operational State Store integrity protocol.

## Context

Inbound Telegram operator control is an optional application capability. Outbound Telegram notifications are independently configured under `notifications.telegram`.

The current bootstrap deliberately shares one process-owned Operational State Store between recovery, process/order/fill records and operator-control records:

- `prepareProcessOperationalStateStore` composes the store when either `recovery.enabled` or `operatorControl.telegram.enabled` is true.
- `prepareTelegramOperatorControl` verifies the existing store before it can start the inbound adapter.
- The filesystem store's one-time initializer creates the genesis and manifest records. Normal startup verifies an existing store and must not initialize, repair, overwrite or reinterpret missing history as empty.
- Consequently, enabling inbound control by default makes an optional Telegram interface an unexpected prerequisite for ordinary development startup whenever Telegram credentials are present.

This is not evidence that the ledger verifier should be weakened or that startup should create a replacement ledger. The coupling is caused by the default that activates the optional capability.

## Decision

1. **Inbound Telegram operator control is opt-in.** `OPERATOR_CONTROL_CONFIG.telegram.enabled` defaults to `false` in every application mode. A deployment that needs the Command Center must explicitly set it to `true`.
2. **Explicit enablement remains fail-closed.** Bootstrap still requires a valid private-chat user-ID allowlist, `TELEGRAM_BOT_TOKEN`, an Operational State Store exposing the required verification/append contract, and verification confirming a valid store with durable writes supported. Missing, uninitialized, corrupt or non-durably-writable state prevents operator-control startup before broker connection.
3. **Durable command semantics are unchanged.** Operator commands still require authorization and a confirmed durable append before the in-memory pause/resume is applied. An unavailable or uncertain store must never result in an acknowledged or applied operator command.
4. **Notifications remain independent.** Disabling inbound control does not disable `notifications.telegram`, its outbound notifier, or its best-effort delivery lifecycle.
5. **Recovery remains independent.** This decision does not change `recovery.enabled`, the shared store schema, process-start fencing, or any ADR-0001 recovery requirement.
6. **No automatic development initialization is introduced.** A missing store is not created or repaired by normal startup. The explicit one-time initializer remains the only genesis-creation path.
7. **Pre-broker startup failures are classified accurately.** Errors raised while creating the startup context are marked as occurring before runtime resources can be active. The entry point may release the process lock after such a failure only when Journal shutdown is confirmed. Failures after runtime resources may have been activated retain the existing conservative lock-retention policy.

## Expected startup contract

| Condition | Expected behavior |
| --- | --- |
| Default development configuration | Harvester starts without constructing or verifying the optional operator-control store when recovery is disabled |
| Outbound Telegram notifications configured | Notifications initialize independently of inbound operator control |
| Inbound operator control explicitly enabled with valid configuration and initialized store | Adapter starts after the existing verification and lifecycle gates |
| Inbound operator control explicitly enabled with missing credentials, allowlist or invalid store | Startup fails closed before broker connection |
| Recovery explicitly enabled | Existing recovery/store verification and durability requirements remain mandatory |
| Production with inbound operator control explicitly enabled | The same authorization and durability requirements apply; there is no production bypass |

## Alternatives considered

1. **Automatically initialize a development ledger.** Rejected. It would make startup mutate the durable history, could conceal an existing corrupt or partial store, and would violate ADR-0001's explicit genesis/repair boundary.
2. **Catch verification failure and continue with Telegram control silently disabled.** Rejected. A deployment that explicitly enabled control would appear configured while the operator capability was unavailable; this weakens the fail-closed operator contract.
3. **Create a separate operator-only ledger.** Rejected. The existing architecture has one process-owned Operational State Store and one append ordering for process, order, fill, recovery and operator facts.
4. **Disable operator control only when `NODE_ENV` is development.** Rejected. Mode-dependent feature defaults would make configuration semantics harder to reason about and would not remove the implicit production default.
5. **Keep inbound control enabled by default and require every developer to initialize the store.** Rejected. It makes an optional capability a mandatory startup dependency and imposes a manual administrative operation on ordinary development launches.

## Consequences and migration

- A clean default development launch no longer needs an initialized Operational State Store solely for inbound Telegram control.
- Existing deployments that relied on the previous enabled-by-default setting must explicitly set `operatorControl.telegram.enabled: true` and continue to provide the trusted allowlist, environment-only bot token and already initialized store.
- `TELEGRAM_USER_ID` continues to seed the allowlist but does not enable inbound control by itself.
- `TELEGRAM_BOT_TOKEN` remains environment-only.
- No existing store is migrated, deleted, repaired or reinitialized by this decision.
- Operator pause remains process-lifetime only and is not restored after restart.

## Validation

The implementation is covered by regression tests for default development startup without a store, independent outbound notifications, explicit operator-control enablement with valid and invalid stores, production fail-closed behavior, missing credentials/allowlist, durable-before-apply command behavior, and safe pre-broker cleanup with original-error preservation.
