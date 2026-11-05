# Harvester Incident — User-Data Stream Reconnected but Recovery Stayed Required

**Date:** 2026-11-05  
**Application:** `apps/harvester`  
**Environment:** Binance Spot TESTNET  
**Evidence:** operator-provided `2026-11-05_13-20-18.jsonl`  
**Tracking task:** [#626 — Diagnose and fix user-data stream recovery stuck with recoveryRequired=true](https://github.com/45s/coinzilla/issues/626)

## Executive summary

The Journal records a user-data WebSocket interruption followed by repeated `recovered` status events. However, every one of those events retains `recoveryRequired: true`. The transport appears to have reconnected, but the supplied Journal does not demonstrate completion of application-level recovery or REST reconciliation.

Treat this as an unresolved trading-safety incident. A WebSocket reconnect is not evidence that missed order and execution events have been reconciled. Do not clear the recovery gate based on the transport status alone.

## Observed timeline

The file contains 323 JSONL records, spanning **13:20:18.877Z–16:37:41.539Z**.

| Time (UTC) | Journal evidence |
|---|---|
| 13:20:18–13:20:27 | Harvester validates configuration, connects to Binance, establishes user-data and market subscriptions, captures PREFLIGHT account/open-order state, and starts the Conservative strategy for DOGEUSDT and ZROUSDT. |
| 13:20:27–13:35:17 | Normal trading events are recorded, including DOGE and ZRO fills and one ZRO recovery cycle completion. |
| 14:30:51.154 | User-data stream emits `rpcError`: `TypeError`, empty message. It then emits `connectionClosed`, close code `1006`, `recoveryRequired: true`. |
| 14:30:51–14:31:31 | Five `rpcError` events and five `connectionClosed` events are recorded. Recovery attempt numbers reach 4. Each visible error is an empty-message `TypeError`. |
| 14:32:04.346 | First `status: recovered` event appears, but it still has `recoveryRequired: true`. |
| 14:32:04–16:37:41 | **254** `recovered` status events are recorded. Every event retains `recoveryRequired: true`; events continue at roughly 30-second intervals through the end of the file. |
| 14:38:01.046 | One additional non-status event appears after the disconnect: ZROUSDT BUY fill `binance:ZROUSDT:11536`, order `711228`, quantity 5 at 1.723 USDT. |

The Journal contains **no later** `account.snapshot_captured` or `account.open_orders_captured` event and no explicit recovery-completed or recovery-failed event after the disconnect.

## What is established — and what is not

### Established by this Journal

- The user-data stream experienced an abnormal closure with code `1006`.
- The broker emitted five `rpcError` records whose error name is `TypeError` and whose message is empty.
- Reconnection/status reporting subsequently emitted `recovered` 254 times while `recoveryRequired` remained true.
- The Journal does not contain evidence of a completed post-disconnect account/order snapshot or an explicit terminal recovery outcome.
- A ZROUSDT BUY fill was applied after the disconnect.

### Not established by this Journal

- The root cause of the `TypeError` or the WebSocket closure.
- Whether REST order/fill reconciliation was started, partially completed, failed, or never invoked.
- Whether all missed user-data events were recovered from Binance.
- Whether the application ever considered broker or trading readiness restored. This Journal excerpt does not include a definitive readiness transition event.
- Whether the post-disconnect ZRO fill arrived through the reconnected stream or another reconciliation path.

The operator reported a short internet outage. That is consistent with the disconnect timing, but it does not explain the empty `TypeError` or the persistent recovery requirement.

## Safety interpretation

`recovered` must not be interpreted as “safe to trade” unless the broker contract explicitly guarantees that all application reconciliation has completed. Transport connectivity and application recovery are separate facts.

At the time of the incident, the observed state was **recovery unresolved**. The engine must remain fail-closed and must not submit, cancel, or replace orders while canonical order/fill/account reconciliation is incomplete or ambiguous.

Do not force `recoveryRequired` to false, bypass account/order/fill parity checks, or use the repeated `recovered` status as a readiness signal.

## Source-confirmed root cause and implementation

Source review confirmed a circular dependency between the broker and Harvester:

- In `packages/brokers/src/application/user-data-session.js`, `#notifyRecoveryReady()` emits `recovered` while keeping `recoveryRequired: true`.
- The broker's `#acknowledgeRecovery()` / `#completeRecoveryIfAcknowledged()` path emits `reconciled` only after the subscriber calls `acknowledgeRecovery()`.
- In `apps/harvester/src/bootstrap/start-harvester.js`, the old orchestration started `tradingEngine.reconcileOwnedOrders()` only after receiving `reconciled`.

Harvester therefore waited for the broker's acknowledgement before starting the work required to issue that acknowledgement. The broker's `#scheduleAcknowledgementReminder()` repeats `recovered` while waiting, explaining the 254 reminders without demonstrating successful reconciliation.

PR #627 corrects the ordering:

1. Harvester starts application recovery on `recovered`, not `reconciled`.
2. It reconciles Harvester-owned orders and fills, then drains queued user-data events.
3. It fetches a fresh account snapshot and durably journals only assets belonging to enabled configured markets.
4. It fetches and durably journals the account-wide open-orders snapshot, checking it against the live in-memory order registry after canonical reconciliation. If user-data events arrive during either REST read or durable audit flush, it drains them and repeats both snapshots until the event sequence is stable.
5. It calls `acknowledgeRecovery()` only after every required step succeeds. The broker's `reconciled` event then opens the readiness gate.
6. Disconnect/recovering/error events advance a recovery generation. An older in-flight task cannot acknowledge a newer connection. Repeated reminders for an already acknowledged generation are ignored.
7. Any reconciliation, snapshot, Journal flush, or acknowledgement failure leaves trading blocked; a later broker recovery reminder can retry the application work.

The account audit event DTOs now accept the explicit `RECOVERY` phase. Regression tests cover successful recovery and durable snapshots, failed account-snapshot recovery, stale completion after a newer disconnect, and duplicate reminders after acknowledgement.

### Remaining uncertainty

The Journal's empty-message `TypeError` records do not establish the underlying SDK or network exception cause. The operator-reported internet outage is consistent with the WebSocket interruption, but it does not prove the TypeError's cause. Harvester now logs the error name, an explicit empty-message marker, stack, and Error cause details when supplied, so a future occurrence has actionable diagnostics. This improves observability; it does not prove the original TypeError source or independently validate TESTNET behavior.

## Remaining engineering follow-up

Issue [#626](https://github.com/45s/coinzilla/issues/626) remains the tracking record. Exact-head GitHub Actions results are required before this change can be considered verified. Controlled TESTNET acceptance is separate and has not been performed.

## Evidence inventory

| Journal record | Count |
|---|---:|
| `broker.status_changed` with `status: rpcError` | 5 |
| `broker.status_changed` with `status: connectionClosed` | 5 |
| `broker.status_changed` with `status: recovering` | 9 |
| `broker.status_changed` with `status: recovered` and `recoveryRequired: true` | 254 |
| Total Journal records | 323 |

This report separates the original Journal evidence from the source-confirmed circular dependency and its PR implementation. It does not claim that the empty TypeError cause or TESTNET recovery acceptance has been established.
