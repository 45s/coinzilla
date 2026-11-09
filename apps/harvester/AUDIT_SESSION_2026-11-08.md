# Harvester incident audit — 2026-11-08 reconnect failure

**Status:** Source-level defect reproduced and fixed in PR [#673](https://github.com/45s/coinzilla/pull/673). All PR workflows passed on implementation/test head `aa9196fb8b9121a95d0a566fbc2fc7585408bd3c`; TESTNET acceptance remains NOT CLAIMED.

**Owning issue:** [#626 — user-data stream recovery stuck with recoveryRequired=true](https://github.com/45s/coinzilla/issues/626)

**Audit method:** [Incident Audit Playbook](./docs/INCIDENT_AUDIT_PLAYBOOK.md)

## Executive conclusion

A short user-data transport outage was followed by a successful transport reconnect. Application-level reconciliation did not complete. During that unresolved recovery window, queued execution reports were processed through the normal order-event path. Filled BUY events therefore initiated recovery-SELL cancel/recalculate operations while the broker still considered the user-data stream unavailable. Both cancellation attempts failed and left the owned orders UNKNOWN. The failures closed the global accounting/readiness gate, and application recovery then aborted with `User-data accounting failed during recovery`.

The broker continued emitting `recovered` reminders, but the application never acknowledged a completed recovery generation. Trading remained blocked until the operator stopped the process. Shutdown correctly reported an incomplete CLOSING audit and retained the trading process lock.

**Confirmed root cause:** bootstrap omitted the engine's `recoveryMode` option when processing queued user-data events during recovery. The engine already had recovery-mode behavior that suppresses normal cancellation/replacement side effects. A second lifecycle gap meant terminal events processed in recovery mode could return `reevaluate: true` while the bootstrap correctly deferred evaluation; the affected symbol was not retained in `deferredEvaluations`, so the post-recovery evaluation could be lost. PR #673 addresses both.

**Source-level cause of the empty-message `TypeError`: identified.** The November 8 stacks match Node.js v24.22.2's bundled Undici WebSocket close/handshake paths. At 03:20:30.119Z the stack shows an established TLS socket closing without a WebSocket close frame (1006). At 03:20:35.148Z and later retries, `failHandshake` / `processResponse` prove a separate opening-handshake failure path. In Node v24.22.2, Undici drops the handshake `reason` and `cause` when it calls `handler.onSocketClose()` without arguments; the parser has no close-frame information, so `#onSocketClose()` constructs `new TypeError("")`. The actual underlying network/TLS/non-101 cause remains **UNKNOWN** because it was discarded before reaching the broker. Exact local `process.version` was not recorded; the surrounding Node source line numbers match v24.22.2. Cross-domain follow-up: [#680](https://github.com/45s/coinzilla/issues/680); upstream [Undici #4625](https://github.com/nodejs/undici/issues/4625) and [PR #4996](https://github.com/nodejs/undici/pull/4996).

## 1. Evidence inventory and integrity

All four supplied files were parsed. No malformed JSONL/JSON log lines were found.

| Original attachment | Size | Parse result / coverage | SHA-256 |
|---|---:|---|---|
| `.harvester-trading.lock` | 118 bytes | Valid JSON; PID/host/start time extracted; token redacted below | `215dfa43f30d752ad0947285d155e53ae8919dc8c0641d2430a5812b165da6b6` |
| `2026-11-08_02-46-17.jsonl` | 235,761 bytes | 399/399 Journal events parsed; 2026-11-08 02:46:17.674Z–03:45:24.142Z | `39e6d692a172998e774581ea1ae551feb22b9f120e0ac006e7969678dc7d8801` |
| `harvester(1).log` | 34,649,294 bytes | 9,703/9,703 JSON lines valid; 2026-11-05 19:57:20.788Z–2026-11-08 03:45:24.149Z; DEBUG 8,054 / INFO 1,594 / ERROR 55 | `468822398cc10ea8787a18f22aec71d016d3af5eaaae38680d41af3e0ffede9b` |
| `harvester-trace(1).log` | 34,954,413 bytes | 11,498/11,498 JSON lines valid; same time range; DEBUG 8,054 / TRACE 1,795 / INFO 1,594 / ERROR 55 | `06afb96aceb7e3b3a613707f111e6beb2e8e6bc63dd091d8004a1cccc71b0977` |

The two diagnostic logs contain earlier sessions beginning on 2026-11-05. They were not treated as part of the 2026-11-08 process except where explicitly used as historical context. The Journal and lock metadata establish the target session.

Sanitized lock metadata (original SHA above; token intentionally not committed):

```json
{
  "pid": 16932,
  "hostname": "lpv1",
  "startedAt": "2026-11-08T02:46:17.652Z",
  "token": "[REDACTED]"
}
```

The lock token is process-ownership material and is not needed to explain the incident. The raw logs are too large to duplicate in Git; their exact hashes, complete parse counts, relevant line ranges, and decision-relevant parsed records are preserved here.

## 2. Session configuration and PREFLIGHT

- Process: PID 16932 on host `lpv1`; lock start time 02:46:17.652Z.
- Journal window: 02:46:17.674Z–03:45:24.142Z.
- Broker: Binance; trading enabled; Conservative TESTNET mode.
- Enabled markets: DOGEUSDT and ZROUSDT.
- Journal event #21 records `harvester.started` at 02:46:27.667Z with `tradingEnabled: true`.

Journal event #6 (02:46:21.501Z) durably records the configured-asset PREFLIGHT snapshot:

| Asset | Free | Locked | Total |
|---|---:|---:|---:|
| DOGE | 19,527.2 | 1,196 | 20,723.2 |
| FDUSD | 9,990.865 | 0 | 9,990.865 |
| SOL | 4 | 0 | 4 |
| USDT | 8,831.56953556 | 0 | 8,831.56953556 |
| ZRO | 250.255 | 0 | 250.255 |

The snapshot contains 5 source/configured assets and 5 persisted assets, consistent with the configured-asset contract corrected by PR #670.

Journal event #7 (02:46:21.808Z) records one pre-existing external/unowned DOGEUSDT SELL:

- Broker order ID: `1317237`
- Client order ID: `h-9861b2fcc16b4609add7ee-24`
- Price: `0.07206000`
- Quantity: `1196.00000000`
- Executed quantity: `0`
- Status: `NEW`
- Open-order audit readiness: `BLOCKED`, reason `UNOWNED_OPEN_ORDERS:1`

**Policy disposition:** the user explicitly confirmed in issue #667 that pre-existing external orders are allowed at startup, remain external/unowned, and must not be adopted or canceled. The account audit's `BLOCKED` value describes incomplete ownership attribution; it is not, by itself, a global trading-startup rejection under the current owner-approved policy. This is not classified as a defect. The runbook is updated in this PR to remove the contradictory blanket startup rejection while retaining durable audit, free-balance, and fail-closed requirements.

The external order is distinct from the two later Harvester-owned unresolved SELL orders.

## 3. Activity before the outage

Journal event inventory (399 total records):

| Event | Count |
|---|---:|
| `execution.duplicate_fill` | 93 |
| `broker.status_changed` | 66 |
| `broker.execution_report` | 55 |
| `order.updated` | 51 |
| `order.submission_requested` | 29 |
| `order.submitted` | 29 |
| `strategy.decision` | 17 |
| `execution.fill_applied` | 16 |
| `order.cancel_requested` | 13 |
| `order.cancelled` | 11 |
| `broker.subscription_established` | 3 |
| `market.trading_rules_captured` | 2 |
| `account.snapshot_captured` | 2 |
| `recovery.cycle_completed` | 2 |
| `order.cancel_failed` | 2 |
| `strategy.paused` | 2 |
| `config.validated`, `broker.connected`, `account.open_orders_captured`, `harvester.started`, `broker.disconnected`, `harvester.stopped` | 1 each |

There were 29 submitted orders (17 BUY, 12 SELL), 16 distinct applied fills, 11 confirmed cancellations, and 2 unconfirmed cancellations. The 93 duplicate-fill notifications refer to 16 unique trade identities; they are replay/duplicate observations, not 93 additional fills. The accounting records classify repeats as duplicates and the account balances reconcile exactly below.

Two Conservative recovery cycles completed before the outage:

- ZROUSDT, Journal event #104 at 03:01:39.359Z: realized net profit `0.01585488 USDT`; free quantity `0.025 ZRO`; `0.015 ZRO` exchange-constrained dust, reason `MIN_NOTIONAL`.
- DOGEUSDT, Journal event #109 at 03:03:09.167Z: realized net profit `0.01734984 USDT`; free quantity `2.2 DOGE`; `1.2 DOGE` exchange-constrained dust, reason `MIN_NOTIONAL`.

The dust records include the relevant minimum quantity/notional and evaluated amount. These two cycles are completed lifecycle facts, not evidence of the later reconnect recovery succeeding.

## 4. Complete applied-fill ledger

All 16 applied fills have `commissionStatus: COMPLETE`. Values below are exact exchange trade facts from Journal `execution.fill_applied` records.

| Market | Side | Trade ID | Broker order ID | Price | Quantity | Quote quantity | Commission |
|---|---|---:|---:|---:|---:|---:|---|
| DOGEUSDT | BUY | 231095 | 1322741 | 0.07094 | 400 | 28.376 | 0.4 DOGE |
| DOGEUSDT | BUY | 231106 | 1322765 | 0.07090 | 400 | 28.360 | 0.4 DOGE |
| DOGEUSDT | BUY | 231185 | 1323251 | 0.07135 | 400 | 28.540 | 0.4 DOGE |
| DOGEUSDT | BUY | 231195 | 1323308 | 0.07131 | 400 | 28.524 | 0.4 DOGE |
| DOGEUSDT | BUY | 231208 | 1323351 | 0.07127 | 400 | 28.508 | 0.4 DOGE |
| DOGEUSDT | SELL | 231151 | 1322828 | 0.07128 | 797 | 56.81016 | 0.05681016 USDT |
| ZROUSDT | BUY | 12362 | 749168 | 1.616 | 5 | 8.080 | 0.005 ZRO |
| ZROUSDT | BUY | 12363 | 749170 | 1.615 | 5 | 8.075 | 0.005 ZRO |
| ZROUSDT | BUY | 12365 | 749174 | 1.614 | 5 | 8.070 | 0.005 ZRO |
| ZROUSDT | SELL | 12366 | 749180 | 1.622 | 14.96 | 24.26512 | 0.02426512 USDT |
| ZROUSDT | BUY | 12368 | 749298 | 1.623 | 5 | 8.115 | 0.005 ZRO |
| ZROUSDT | BUY | 12369 | 749305 | 1.622 | 5 | 8.110 | 0.005 ZRO |
| ZROUSDT | BUY | 12371 | 749310 | 1.621 | 5 | 8.105 | 0.005 ZRO |
| ZROUSDT | BUY | 12372 | 749334 | 1.620 | 5 | 8.100 | 0.005 ZRO |
| ZROUSDT | BUY | 12373 | 749338 | 1.619 | 5 | 8.095 | 0.005 ZRO |
| ZROUSDT | BUY | 12374 | 749344 | 1.618 | 5 | 8.090 | 0.005 ZRO |

### Exact totals

**DOGE**
- BUY gross: 2,000 DOGE; BUY quote cost: 142.308 USDT; base commission: 2 DOGE.
- SELL gross: 797 DOGE; quote proceeds: 56.81016 USDT; quote commission: 0.05681016 USDT.
- Net DOGE change: `2,000 - 2 - 797 = +1,201 DOGE`.
- Net DOGE quote cash flow: `56.81016 - 0.05681016 - 142.308 = -85.55465016 USDT`.

**ZRO**
- BUY gross: 45 ZRO; BUY quote cost: 72.840 USDT; base commission: 0.045 ZRO.
- SELL gross: 14.96 ZRO; quote proceeds: 24.26512 USDT; quote commission: 0.02426512 USDT.
- Net ZRO change: `45 - 0.045 - 14.96 = +29.995 ZRO`.
- Net ZRO quote cash flow: `24.26512 - 0.02426512 - 72.840 = -48.59914512 USDT`.

**USDT account delta**
- Total BUY quote cost: `142.308 + 72.840 = 215.148 USDT`.
- Total SELL gross proceeds: `56.81016 + 24.26512 = 81.07528 USDT`.
- Total USDT commissions: `0.05681016 + 0.02426512 = 0.08107528 USDT`.
- Net: `81.07528 - 215.148 - 0.08107528 = -134.15379528 USDT`.

## 5. Transport outage and failed application recovery

Journal broker-status counts:

| Status | Count |
|---|---:|
| `rpcError` | 5 |
| `connectionClosed` | 5 |
| `recovering` | 9 |
| `recovered` | 47 |

The first transport error is at 03:20:30.119Z. Two Undici paths are present: (A) the first stack ends at `TLSSocket.onSocketClose` / `TCP.done` and is consistent with an established socket being lost without a close frame; (B) stacks at 03:20:35.148Z, 03:20:40.162Z, 03:20:50.177Z, and 03:21:10.199Z include `failWebsocketConnection → failHandshake → processResponse`, identifying failed opening handshakes. Both produce an empty-message `TypeError`; the five RPC-error/connection-close cycles precede the first `recovered` status at 03:21:42.433Z. The exact cause of the transport failures is still unknown. The operator's internet-outage report is consistent but not proven.

The broker contract documented in #626 says `recovered` means transport/subscription readiness while `recoveryRequired` and `reconciliationRequired` remain true. The broker intentionally repeats this reminder while subscriber acknowledgement is outstanding, on an exponential timer capped at 30 seconds. The 47 reminders are therefore not 47 successful recoveries and are not, by themselves, a broker defect.

The failure sequence:

1. **03:21:42.433Z:** transport reports `recovered`; application reconciliation is still required.
2. **03:21:48.331Z:** DOGE BUY trade `231208`, broker order `1323351`, 400 DOGE at `0.07127`, is applied once (Journal #266).
3. **03:21:48.937Z:** the execution is observed again during recovery reconciliation. This is a duplicate observation, not a second accounting application.
4. **03:21:48.937Z:** Harvester requests cancellation of its existing DOGE recovery SELL `1323350` (`h-932a1bcc2b7646df8f4166-28`), quantity 797 at `0.07169`, reason `BUY_FILLED_RECALCULATE_RECOVERY_SELL`.
5. **03:21:48.943Z:** cancellation fails with `Cannot change Binance orders while the user-data stream is unavailable`. Journal #269 marks the order `UNKNOWN/UNCONFIRMED`; Journal #270 pauses DOGE with `RECOVERY_SELL_CANCELLATION_UNCONFIRMED`.
6. **03:22:24.725Z:** ZRO BUY trade `12374`, broker order `749344`, 5 ZRO at `1.618`, is applied once (Journal #285).
7. **03:22:24.726Z:** recovery attempts to cancel ZRO recovery SELL `749343` (`h-932a1bcc2b7646df8f4166-23`), quantity 24.94 at `1.627`.
8. **03:22:24.732Z:** cancellation fails with the same user-data-unavailable error. Journal #288 marks it `UNKNOWN/UNCONFIRMED`; Journal #289 pauses ZRO. The account-integrity safety-halt log also reports it could not fully reconcile owned orders before BUY cancellation.
9. **03:23:00.631Z:** application recovery fails with `User-data accounting failed during recovery`; trading remains blocked.
10. Repeated `recovered` reminders continue through 03:43:47.893Z. No application recovery acknowledgement / `reconciled` readiness transition is recorded.

### The two unresolved owned orders

| Market | Client order ID | Broker order ID | Side | Price | Quantity | Cancellation result |
|---|---|---:|---|---:|---:|---|
| DOGEUSDT | `h-932a1bcc2b7646df8f4166-28` | 1323350 | SELL | 0.07169 | 797 | UNKNOWN / UNCONFIRMED |
| ZROUSDT | `h-932a1bcc2b7646df8f4166-23` | 749343 | SELL | 1.627 | 24.94 | UNKNOWN / UNCONFIRMED |

These are Harvester-owned recovery SELLs. They are not the pre-existing external DOGE order `1317237`.

## 6. Account-level reconciliation

Journal event #397 records the CLOSING snapshot at 03:45:19.125Z (durable confirmation at 03:45:19.132Z):

| Asset | PREFLIGHT total | CLOSING total | Delta | Fill-derived delta |
|---|---:|---:|---:|---:|
| DOGE | 20,723.2 | 21,924.2 | +1,201 | +1,201 |
| FDUSD | 9,990.865 | 9,990.865 | 0 | 0 |
| SOL | 4 | 4 | 0 | 0 |
| USDT | 8,831.56953556 | 8,697.41574028 | -134.15379528 | -134.15379528 |
| ZRO | 250.255 | 280.25 | +29.995 | +29.995 |

All five asset deltas match the unique applied fill ledger exactly.

CLOSING locked quantities were DOGE `1993` and ZRO `24.94`. DOGE locked `1993` is arithmetically consistent with the pre-existing external order's 1196 DOGE plus the unresolved owned DOGE SELL's 797 DOGE. ZRO locked 24.94 matches the unresolved owned ZRO SELL. This is a balance-level consistency check, **not** an authoritative closing open-order snapshot; the CLOSING audit itself is incomplete and the final order states remain unconfirmed.

The exchange-reported `sourceTime` in the CLOSING snapshot is `1794108107962` (03:21:47.962Z), while local capture occurred at 03:45:19.125Z. PREFLIGHT `sourceTime` is also earlier than local capture. The report preserves these values but does not label them stale: the broker contract's exact `sourceTime` semantics are not established by these files, and source time must not be conflated with local capture time.

**Verdict:** the supplied accounting records reconcile exactly. This does not mean order lifecycle recovery succeeded.

## 7. Shutdown and process lock

- Journal #397 / DEBUG line 9699: CLOSING snapshot is `INCOMPLETE`.
- Exact audit reasons: `UNRESOLVED_OWNED_ORDERS:2` and `USER_DATA_OR_ACCOUNTING_RECONCILIATION_INCOMPLETE`.
- 03:45:24.141Z: Binance native WebSocket clients disconnect.
- Journal #399 and DEBUG line 9701: `harvester.stopped` reason `SIGINT`, outcome `failed`, `AggregateError: Harvester shutdown was incomplete`.
- DEBUG line 9703: observability shutdown is incomplete; trading process lock is retained because runtime shutdown was not confirmed.

The retained lock is intentional fail-closed behavior. Do not remove it based only on file presence. Verify the original PID/process state through the normal operator procedure before any lock cleanup. No such cleanup was performed during this audit.

## 8. Source-level root cause and PR #673 fix

### Defect 1 — recovery events were processed in normal mode

The bootstrap user-data event queue called `tradingEngine.processUserDataEvent({ event })` without passing the engine's existing `recoveryMode` option. Therefore an execution report arriving while `userDataRequiresReconciliation` was true still followed normal order lifecycle behavior. A FILLED BUY attempted `cancelAndReconcileRecoverySells`, which is forbidden while the broker stream is unavailable.

**Fix:** compute recovery mode from the application reconciliation gate and active recovery task, pass it to the engine for every queued order event, and expose it to the existing observer callback for diagnostics. The broker's acknowledgement remains the only way to clear the application recovery gate.

### Defect 2 — recovery-time evaluation could be lost

A terminal order event processed with `recoveryMode: true` can return `reevaluate: true`. Bootstrap intentionally does not evaluate while authoritative reconciliation is pending. The engine did not always add that market to `state.deferredEvaluations`, so the required evaluation could be lost when the event was consumed during recovery.

**Fix:** retain the affected symbol in `deferredEvaluations` for recovery-mode terminal events. The existing post-acknowledgement `resumeDeferredEvaluations` path then evaluates it after readiness returns.

### Safety preserved

- Transport reconnect does not reopen trading.
- Durable order/fill/account/open-order reconciliation and Journal flush remain required.
- No cancel/replace/submit is allowed while application recovery is unresolved.
- Stale recovery generations and accounting failures remain fail-closed.
- No process-restart Journal replay was introduced; that remains the separate deferred workstream in #654.
- External/unowned orders remain untouched.

## 9. Regression and verification record

The two tests were added first on the PR branch and run against the unmodified implementation.

**RED observed on PR #673 test-only head `4368c5d65651b55dd5c34bea619ca6b99160264d`:**
- Bootstrap regression failed: actual `undefined`, expected `true` for recovery-mode classification.
- Engine regression failed: actual deferred evaluation list `[]`, expected `["DOGEUSDT"]`.
- Harvester Targeted Tests, Unit Tests, and Test Coverage failed on that test-only head as expected. Utils Unit Tests, JavaScript Syntax, and Dependency Audit passed.

**GREEN verification on implementation/test head `aa9196fb8b9121a95d0a566fbc2fc7585408bd3c`:**
- Harvester Targeted Tests: PASS; the changed `start-harvester.test.js` file reports 54/54 passing tests, and the configured targeted run plus actionlint succeeds.
- Full Harvester package Unit Tests: 672/672 PASS, including the engine deferred-evaluation regression.
- Harvester package coverage: PASS (73.97% lines, 78.22% branches, 72.64% functions); workspace coverage workflow PASS.
- Workspace Unit Tests, JavaScript Syntax, Utils Unit Tests, and Dependency Audit: PASS.
- Read-only Binance TESTNET integration: SKIPPED. No exchange action was performed.

The subsequent PR commits are documentation/formatting follow-ups; the final PR-head workflows are rerun before merge. **TESTNET acceptance:** NOT CLAIMED. No exchange writes, restarts, or account changes were performed as part of this audit or implementation.

## 10. Key diagnostic source locations

- Journal: events #6, #7, #21, #104, #109, #266, #269–270, #285, #288–289, #397, #399.
- `harvester(1).log`: line 9307 (first RPC error); 9351 (first recovered status); 9362 (DOGE pause); 9398–9400 (ZRO pause and account-integrity halt); 9470 (application recovery failure); 9699–9703 (CLOSING and shutdown).
- `harvester-trace(1).log`: lines 9739 and 9787 (PREFLIGHT and startup); 10942–10943 (transport error); 11005–11006 (first recovered status); 11024–11026 (DOGE failure); 11080–11084 (ZRO failure); 11186–11187 (recovery failure); 11489–11498 (CLOSING, disconnect, failed shutdown, retained lock).



## 11. Empty WebSocket TypeError — Node/Undici source-level finding

The uploaded November 8 trace contains two distinct abnormal WebSocket close paths. The distinction matters: close code 1006 is a symptom of an abnormal close without a received close frame, not a diagnosis of the underlying network failure.

### Path B — established socket closes without a WebSocket close frame

At **03:20:30.119Z**, the stack is:

```text
#onSocketClose
TLSSocket.onSocketClose
TLSSocket.emit (node:events:526:24)
node:net:362:12
TCP.done (node:internal/tls/wrap:779:7)
```

The corresponding status reports close code `1006` and an empty reason. This is consistent with an established TLS socket closing without a WebSocket close frame. The supplied stack does not reveal whether the lower-level cause was a reset, timeout, TLS failure, or another transport condition.

### Path A — opening-handshake failure loses the underlying cause

At **03:20:35.148Z**, repeated at **03:20:40.162Z**, **03:20:50.177Z**, and **03:21:10.199Z**, the stack additionally contains:

```text
failWebsocketConnection
failHandshake
Object.processResponse
```

This identifies the opening-handshake failure path. The exact source line mapping of the surrounding Node frames (`events.js:526`, `net.js:362`, `internal/tls/wrap.js:779`) matches Node.js **v24.22.2**. The Harvester runtime did not record `process.version`, so this is a strong source-line identification rather than a directly logged version value.

In the matching Node v24.22.2 bundled Undici source:

1. [`connection.js`](https://github.com/nodejs/node/blob/v24.22.2/deps/undici/src/lib/web/websocket/connection.js#L306-L329) passes the failure `reason` and `cause` into `failWebsocketConnection()`, but the still-CONNECTING branch calls `handler.onSocketClose()` without forwarding either value.
2. [`websocket.js`](https://github.com/nodejs/node/blob/v24.22.2/deps/undici/src/lib/web/websocket/websocket.js#L575-L609) initializes `reason` to an empty string. During a failed opening handshake the parser has not been initialized with close-frame information, so the reason remains empty and Undici emits `new TypeError(reason)`.
3. The original handshake/network cause is therefore lost before the broker receives the WebSocket error.

This is consistent with upstream [nodejs/undici#4625](https://github.com/nodejs/undici/issues/4625). Upstream [PR #4996](https://github.com/nodejs/undici/pull/4996) proposes forwarding the cause into the TypeError, but was still open when this audit was updated; it does not by itself guarantee a non-empty message.

### Disposition

- **Confirmed:** the empty TypeError is produced by Node's bundled Undici WebSocket close/handshake handling, not by Harvester recovery logic.
- **Confirmed:** the handshake path discards an available cause in the Node v24.22.2 source.
- **Unknown:** the actual network/TLS/HTTP handshake failure that triggered each attempt; the original cause is not present in the supplied Harvester records.
- **Not inferred:** close code 1006 does not prove an internet outage or a particular socket error.
- **Ownership:** broker transport diagnostics are owned by `packages/brokers`; Harvester must not patch that implementation privately.
- **Cross-domain request:** [45s/coinzilla#680](https://github.com/45s/coinzilla/issues/680) asks the Brokers domain to characterize both paths and preserve/correlate underlying transport errors where the runtime exposes them.

No broker implementation, runtime version, retry policy, WebSocket transport, or exchange behavior was changed during this investigation.


## 12. Issue #626 acceptance traceability — 2026-11-08

This matrix maps the original #626 requirements to current source, deterministic regressions, failure behavior, and the exact PR heads whose required offline CI completed successfully. A passing offline test is not TESTNET acceptance.

| #626 requirement | Source and deterministic regression | Failure behavior / disposition |
|---|---|---|
| WebSocket close 1006 / transient loss followed by reconnect | `packages/brokers/src/application/user-data-session.js`; `packages/brokers/src/binance/broker-websocket/methods/user-data-session.recovery.test.js` — “reconnects with a new client and subscription, then waits for every consumer to acknowledge reconciliation”; `apps/harvester/src/bootstrap/start-harvester.test.js` — “starts application reconciliation on transport recovery and acknowledges only after durable audits”. | **PASS offline.** Transport recovery is separate from application readiness. The broker test also proves order placement/cancel/cancel-all remain blocked until every subscriber acknowledges. The read-only integration test exists but was skipped in CI; no live acceptance is claimed. |
| Empty-message TypeError; preserve useful cause/stack | `apps/harvester/src/bootstrap/start-harvester.test.js` — “logs stack and cause details when a user-data RPC error has an empty message”; Node v24.22.2 source paths documented in §11. | **PARTIAL.** Harvester preserves stack/cause when supplied. Node's bundled Undici drops the opening-handshake cause before the broker receives it. The actual underlying network/TLS/HTTP cause remains unknown. Broker follow-up is [#680](https://github.com/45s/coinzilla/issues/680). |
| REST reconciliation fails, times out, or returns contradictory/missing order/fill/account facts | `create-user-data-recovery-handler.test.js` — failed owned-order reconciliation, account-wide open-orders REST failure, account snapshot read failure, durable account/open-orders audit failures, acknowledgement rejection/exception; `conservative-trading-engine.test.js` — incomplete/conflicting fill history, REST/stream disagreement, missing fills, stale history, and unknown submission outcomes; `rpc-client.protocol.test.js` — “RPC client times out and marks a state-changing outcome as unknown”. | **PASS offline for the tested timeout paths.** PR #700 covers owned-order fill-history timeout → no partial fill application → later retry → exactly-once fill application. PR #701 covers account snapshot timeout at manager and application recovery boundaries → no premature audit/ack → task-slot release → later same-generation retry. Malformed REST-envelope cases remain a test gap (F-017); original broker error cause/stack preservation remains open (F-016); transient Journal sync retry remains untested (F-018). |
| Successful REST reconciliation drains queued events and only then allows readiness | `start-harvester.test.js` — recovery starts only after transport recovery, queued events are drained, and order placement stays blocked without authoritative reconciliation; PR #739 adds an integration path that holds owned-order canonical history pending, queues a BUY fill, and delivers 254 recovered reminders; `create-user-data-recovery-handler.test.js` — stable event-window retries, generation revalidation between account/open-orders durable audits, and broker acknowledgement only after both audits; broker recovery test waits for every subscriber acknowledgement. | **PASS for the single-subscriber application gate and durable audit ordering.** The broker emits one terminal `reconciled` transition after all subscriber acknowledgements. Exact-count terminal-notification coverage and the multi-subscriber acknowledgement-result ambiguity remain broker-side follow-ups; see cross-domain request #702. |
| Repeated reconnect/status callbacks do not duplicate reconciliation, fills, or diagnostics | `create-user-data-status-handler.test.js` — “repeated recovered reminders publish and log once while retrying application recovery”; `create-user-data-recovery-handler.test.js` — “does not mark another recovery request pending while reconciliation is already running” (explicit one-call assertion); engine tests for idempotent duplicate fills and overlapping REST/stream delivery; PR #739 adds a 254-reminder bootstrap regression with one owned-order reconciliation and one applied fill. | **PASS for same-generation single-flight, duplicate-fill idempotency, and generation-scoped diagnostics.** PR #739 now verifies the combined 254-reminder pending-generation scenario, including queued fill drain and durable audit barriers before one acknowledgement. A later reminder after a failed task is intentionally allowed to retry; it is not a concurrent duplicate. |
| Disconnect during reconciliation and a second disconnect during retry | `start-harvester.test.js` — “does not acknowledge a stale recovery after a newer disconnect”; `create-user-data-recovery-handler.test.js` — superseded generation during owned-order reconciliation, account audit, and open-orders audit; `UserDataSession` broker recovery tests. | **PARTIAL.** Stale work is rejected at each tested recovery stage, including immediately after owned-order reconciliation before canonical ownership is certified (PR #685). A dedicated scenario with a second disconnect during a subsequent application retry cycle is not yet modeled end-to-end. |
| No order submit/cancel/replace while recovery is unresolved | Broker recovery test blocks `createOrder`, `cancelOrder`, and `cancelAllOpenOrders` until all subscribers acknowledge; engine tests — “reconciles recovered orders without canceling or replacing any exchange order”, “processes recovery-time user-data cancellation facts without broker cancel or replacement calls”, and “defers a recovered BUY fill evaluation until application recovery is acknowledged”; bootstrap readiness-gate tests. | **PASS offline.** Recovery remains fail-closed; the broker gate and engine recovery mode independently prevent unsafe order mutations/evaluations. |
| Existing startup/restart recovery and broker adapter tests remain green | `start-harvester.test.js` startup/recovery tests; broker reconnect/recovery and RPC lifecycle/protocol tests; exact-head workspace CI below. | **PARTIAL by scope.** Startup recovery and broker adapter tests pass. Process-restart reconciliation is explicitly deferred to [#654](https://github.com/45s/coinzilla/issues/654) and is not claimed as implemented by #626. |

### Acceptance criteria disposition

- **Root cause documented with source-level evidence:** source of the empty TypeError is identified in Node's bundled Undici (§11, PR #681). The underlying network/TLS/HTTP failure remains unknown; broker-side cause preservation is tracked by #680.
- **Recovery state machine and status contract corrected/documented:** transport `recovered` is distinct from application reconciliation and broker `reconciled`; generation-scoped reminders, startup-only pending state, stable durable audit barriers, fail-closed acknowledgement, and post-owned-order generation/accounting validation are covered by PRs #673–#679 and #682–#683 and #685.
- **Deterministic regression for the stuck Journal behavior:** PR #739 adds an offline integration regression that holds an owned-order canonical-history read pending, emits 254 `recovered` reminders for one generation, and queues a matching BUY fill. It proves single-flight owned-order reconciliation, one-time stream/REST fill accounting, recovery-mode queue drain, durable RECOVERY account and account-wide open-orders audits before acknowledgement, exactly one successful broker acknowledgement and terminal `reconciled` status, and readiness reopening only after completion. This reconstructs the 254-reminder incident condition; it is not a byte-for-byte replay of the complete Journal file.
- **Required offline tests and repository CI:** all PR heads listed below have successful required offline checks. TESTNET integration was skipped.
- **TESTNET acceptance:** NOT PERFORMED. No production/TESTNET order operation or Harvester restart was performed.
- **Process restart:** remains deferred to #654.

### Exact-head CI record

The following are the exact PR head commits, not merge commits. For each listed head, the repository reported success for Unit Tests, Test Coverage, Harvester Targeted Tests, JavaScript Syntax, Dependency Audit, and Utils Unit Tests. The read-only Binance TESTNET integration step was skipped.

| PR | Scope | Exact tested head |
|---|---|---|
| [#673](https://github.com/45s/coinzilla/pull/673) | Recovery-mode event processing and deferred evaluation fixes | `24c2b9fdc67cf7ce64fc586141ea0dd60fe9c83d` |
| [#674](https://github.com/45s/coinzilla/pull/674) | Generation-scoped recovered reminder diagnostics | `5f928dd8150c70e7e4198882db3b097555962b9d` |
| [#675](https://github.com/45s/coinzilla/pull/675) | Broker acknowledgement rejection/exception regressions | `d41e4ed34df21d735afb79f7d62fd067fd096ce9` |
| [#676](https://github.com/45s/coinzilla/pull/676) | Startup-only pending-recovery state | `f1303774bb544721ffe217abe90d7bfd6d2b225f` |
| [#677](https://github.com/45s/coinzilla/pull/677) | Owned-order and account-wide REST failure regressions | `416622089bc80842d95e8fa1b8bb7057950024d3` |
| [#678](https://github.com/45s/coinzilla/pull/678) | Account snapshot read and durable open-orders audit failures | `fdcb865cf11681bf45b80c13473301251172ea0d` |
| [#679](https://github.com/45s/coinzilla/pull/679) | Generation/event-sequence barrier between durable audits | `594a5a51a551fc7e5c8ea3bd41b924b01c8c55f6` |
| [#681](https://github.com/45s/coinzilla/pull/681) | Undici source-level incident documentation | `6fd6a071ac42ee31b546c21936666b6a0ccac0a7` |
| [#682](https://github.com/45s/coinzilla/pull/682) | Generation guard after open-orders audit | `3c9b31dedc669ca4f8135407b9df2562089d5c4d` |
| [#683](https://github.com/45s/coinzilla/pull/683) | Explicit single-flight reconciliation call count | `a1a8eb75c808e5c06c4c3db53a679f6b6ea2a914` |
| [#685](https://github.com/45s/coinzilla/pull/685) | Revalidate generation/accounting before certifying canonical ownership | `dad9472df9e1cca47e90e479d3b3f4b5ee5c93cb` |
| [#700](https://github.com/45s/coinzilla/pull/700) | Owned-order REST fill-history timeout, fail-closed retry, exactly-once fill application | `e2c80515fa9624a13163d7fd47ecddaa4695bfc1` (merged as `3c0c5b81d7c70f1c86aeed5b0b3836e00045bc69`) |
| [#701](https://github.com/45s/coinzilla/pull/701) | Account snapshot timeout at manager and application recovery boundaries | `a137f33f872776791e4bc02b5ce314067ed6c6f2` (merged as `2e04a77c19357cec89111892fd910276ae8b1619`) |

**Latest follow-up:** [PR #685](https://github.com/45s/coinzilla/pull/685) adds the post-owned-order reconciliation generation/accounting guard and regression coverage. Harvester tests passed 741/741 on exact head `dad9472df9e1cca47e90e479d3b3f4b5ee5c93cb`; all required offline CI workflows passed and TESTNET integration was skipped.

**Conclusion:** #626 is substantially advanced but must remain open. The direct application-level REST-timeout gap is now covered by PRs #700 and #701. Remaining gaps are malformed REST-envelope regressions, Harvester broker-error cause/stack preservation (F-016), transient Journal sync-failure retry characterization and duplicate-audit semantics (F-018), exact-one terminal notification and multi-subscriber acknowledgement contract (#702), a second-disconnect-during-retry end-to-end scenario, full Journal-sequence replay, broker-side transport cause preservation (#680), and separate TESTNET acceptance. #654 remains deferred.


## 13. Recovery REST timeout, Journal, and acknowledgement follow-up — 2026-11-08

### Merged timeout regressions

- **PR #700** exact tested head `e2c80515fa9624a13163d7fd47ecddaa4695bfc1`, merged as `3c0c5b81d7c70f1c86aeed5b0b3836e00045bc69`: owned-order fill-history timeout fails closed without partial fill application; later retry applies the canonical fill exactly once.
- **PR #701** exact tested head `a137f33f872776791e4bc02b5ce314067ed6c6f2`, merged as `2e04a77c19357cec89111892fd910276ae8b1619`: account snapshot timeout is covered at the manager and application recovery handler; the failed attempt publishes no dependent audit or acknowledgement, releases the task slot, and a later same-generation reminder completes both durable audits before one acknowledgement.
- All six required offline CI contexts passed on both exact heads. TESTNET integration was skipped. No TESTNET acceptance is claimed.

### Failure-path conclusions

- **Retry scheduling:** broker acknowledgement reminders provide capped exponential retry while recovery is pending. Harvester forwards reminders, suppresses duplicate recovered-status diagnostics, and permits a later retry after the prior task releases its slot. No second Harvester retry timer is needed.
- **Malformed REST envelopes:** source-level guards are present for account snapshots, open orders, canonical order history, and fills. Direct malformed-envelope tests remain incomplete; no accepted-invalid-data defect was confirmed.
- **Error context:** Harvester wraps several failed broker REST results without preserving the original Error as `cause`; the recovery logger records only wrapper fields. See F-016. A separate cause-preserving diagnostic fix remains justified and unimplemented.
- **Journal failure:** no premature broker acknowledgement was found; recovery remains blocked until both audits report `durable: true`. A transient sync failure followed by a successful retry can leave both the uncertain first record and the retry durable. A write failure poisons the Journal instance, so retries cannot recover in place. See F-018; no Journal evidence is deleted or deduplicated.
- **Terminal acknowledgement:** single-subscriber flow is guarded. In a multi-subscriber session, the first subscriber can be marked acknowledged while `acknowledgeRecovery()` returns false because global completion is pending; Harvester currently interprets false as rejection. This is a conditional liveness risk tracked by Brokers issue #702. The current Harvester subscriber count is unverified; `start-harvester.js` was not inspected during its active refactor. No broker API or Harvester contract was changed.
- **PR #688:** the repository documents six required contexts (`actionlint`, `Run package tests`, `Workspace test coverage`, `Check JavaScript syntax`, `packages/utils tests`, `Audit production dependencies`) and strict up-to-date protection. At current develop `2e04a77c19357cec89111892fd910276ae8b1619`, its branch is 4 ahead / 11 behind. The old-head green checks cannot satisfy the current merge commit; use the normal Update branch action and rerun checks. No bypass or rule change is appropriate.

**Current develop checkpoint:** `2e04a77c19357cec89111892fd910276ae8b1619`. Production behavior remains unchanged by PRs #700 and #701. Process-restart reconciliation remains deferred to #654.


## 14. F-017 malformed REST-envelope regression follow-up — 2026-11-08

Added eight deterministic offline cases to `src/use-cases/conservative-trading-engine.test.js`:

- `getOpenOrders()`: non-array data and an array containing a non-`Order` record.
- `getCanonicalOrderHistory()`: zero records, multiple records, and a non-`CanonicalOrder` record.
- `getFills()`: non-array data, a non-`Fill` record, and a page larger than the supported 1,000-record limit.

Every case asserts a failed reconciliation result, the stage-specific error, a retained market pause, unchanged UNKNOWN order state and zero executed quantity, no applied fills, no cancel/replace or new order, and no reads beyond the malformed stage.

**Production source is unchanged.** PR [#708](https://github.com/45s/coinzilla/pull/708) exact head `b3f5ed25d11ab093836dc50d563b8c590b09439f` passed Harvester unit tests (753/753), configured Harvester targeted tests (3/3), and all six required offline CI contexts. The Harvester coverage job passed, but the Harvester threshold-enforcement step is not configured. The read-only TESTNET integration was skipped; no TESTNET acceptance is claimed. PR #708 merged into `develop` as `982ddc8c4366658ce75a9cfac9432b4f3e81381e`. No TESTNET operation or process restart was performed.


The fixture helper was kept asynchronous and all newly added assertions carry scenario-specific failure messages. This follow-up changes no production behavior.


## 15. F-017 merge confirmation — 2026-11-08

PR [#708](https://github.com/45s/coinzilla/pull/708) is merged. Exact tested head: `b3f5ed25d11ab093836dc50d563b8c590b09439f`. Merge commit and current `develop` checkpoint at this update: `982ddc8c4366658ce75a9cfac9432b4f3e81381e`.

- Harvester package unit tests: 753/753 passed, including all eight malformed-envelope regressions.
- Configured Harvester targeted tests: 3/3 files passed.
- All six required offline CI contexts passed.
- Workspace coverage passed; Harvester coverage execution passed, but Harvester-specific threshold enforcement is not configured.
- Read-only TESTNET integration was skipped. No TESTNET acceptance is claimed.

F-017 is closed. Continue with the next Harvester roadmap item; do not change production source under F-017.


## 16. PR #688 branch rescue — 2026-11-08

PR [#688](https://github.com/45s/coinzilla/pull/688) contains a unique application recovery regression for an account-wide open-orders RPC timeout. This scenario is distinct from PR #701's account snapshot timeout: the first `getOpenOrders()` result fails with a typed timeout; the recovery gate stays closed; no account/open-order audit or broker acknowledgement occurs; the task slot is released; and a later reminder retries and completes the same generation.

The old PR branch was 4 commits ahead / 38 behind `develop`. It has been synchronized by a normal two-parent merge commit with current `develop` at `718a313837cd43ace2a9c2daeb17729898fd5867`. The PR's unique test is retained and appended to the current recovery-handler test file; existing current-develop changes, including PR #701 coverage, are preserved. No force-push or branch-protection bypass was used.

The same merge commit updates this roadmap and F-016 evidence. Exact head `52e1002eac6c2a429821b26c866ff96d17db3b49` passed Harvester package tests (754/754), configured targeted tests (3/3), and all six required offline CI contexts. The coverage workflow passed, but Harvester threshold enforcement is not configured. Read-only TESTNET integration was skipped. The new test confirms contextual timeout-message retention and retry behavior but does not close native Error-cause preservation. PR #688 merged into `develop` as `a66e5f9114395fbc1ab776ccdffc55bdcb2a8f5a`.


## 17. PR #688 merge confirmation — 2026-11-08

PR [#688](https://github.com/45s/coinzilla/pull/688) is merged into `develop`. Exact tested head: `d52dad2347e8f9a76aa17b1f3def309e4d45f230`. Merge commit and current `develop` checkpoint at this update: `a66e5f9114395fbc1ab776ccdffc55bdcb2a8f5a`.

- Harvester package unit tests: 754/754 passed, including the account-wide open-orders timeout/retry regression.
- Configured Harvester targeted tests: 3/3 files passed.
- All six required offline CI contexts passed.
- Workspace coverage passed; Harvester coverage execution passed, but Harvester-specific threshold enforcement is not configured.
- Read-only TESTNET integration was skipped. No TESTNET acceptance is claimed.

The regression closes the distinct account-wide open-orders timeout/retry proof gap. F-016's native Error-cause/stack preservation remains a separate unimplemented production diagnostic fix.


## 18. F-016 native broker Error-cause preservation — test-first regressions

Branch: `fix/harvester/preserve-rest-error-causes`, based on `develop` at `554ac983504f8947570e20ba33218158b08d989d`.

Added test-first assertions for the original broker Error to survive as native `cause` through:
- account snapshot REST failure;
- account-wide open-orders snapshot REST failure;
- owned-order open-orders REST failure;
- canonical order-history REST failure;
- REST fill-history failure;
- application recovery structured error logging.

Existing contextual messages, retry behavior, readiness gates, and acknowledgement ordering are asserted unchanged. The shared `@coinzilla/utils` logger already serializes nested Error causes; no utility/logger implementation change is required.

**Production source was unchanged in the test-first commit.** Expected RED was confirmed: 758 Harvester tests, 752 passed, 6 failed exactly on missing native causes / missing structured Error field. The subsequent implementation commit preserved native causes and added the Error object to structured recovery logs without changing messages or recovery behavior. PR #711 exact head `e68da711eb44bc64bfeb5b1e8027f1f0a19f58dc` passed Harvester unit tests (758/758), configured targeted tests (3/3), and all six required offline CI contexts. Workspace coverage passed; Harvester package threshold enforcement is not configured. TESTNET integration was skipped. PR #711 merged into `develop` as `2a57a8e291bb54a2474df525a4cd20e8d51747e8`.


## 19. F-016 cause-preservation implementation — 2026-11-08

The test-only commit `918a3a6644c92cbe089919874177cba7b8193249` produced the expected RED result in the Harvester package suite: 758 tests, 752 passed, 6 failed. The six failures were exactly the new assertions for missing native broker Error causes and the missing Error object in structured recovery logs. No fixture or syntax failure was observed.

The implementation now preserves the first native Error from each broker result as the contextual wrapper's `cause` in:
- `createAccountSnapshotManager.refreshAccountSnapshot()`;
- `createAccountSnapshotManager.publishOpenOrdersSnapshot()`;
- owned-order `getOpenOrders()`;
- owned-order `getCanonicalOrderHistory()`;
- owned-order `getFills()`;
- application recovery's account-wide `getOpenOrders()`.

The application recovery failure log now includes the Error object in addition to the existing flattened `errorName`, `errorMessage`, and `errorStack` fields. The shared logger's existing serializer preserves the nested cause and stack; no shared utility or logging implementation was changed.

No retry timing, recovery gate, acknowledgement, trading policy, Journal durability, broker protocol, or exchange behavior was changed. Exact-head GREEN verification is pending.


## 20. F-016 merge confirmation — 2026-11-08

PR [#711](https://github.com/45s/coinzilla/pull/711) is merged. Exact tested head: `661046e2c7142c879b9a8c5327e46f804f4e048a`. Merge commit and current `develop` checkpoint: `2a57a8e291bb54a2474df525a4cd20e8d51747e8`.

The test-first RED/GREEN evidence is recorded in the roadmap and F-016 finding. All six required offline CI contexts passed on the final head. Harvester coverage execution passed; package threshold enforcement remains unconfigured. TESTNET integration was skipped.


## 21. F-018 transient Journal sync failure and Harvester retry — test-first characterization

Journal-side behavior is merged in [PR #714](https://github.com/45s/coinzilla/pull/714): the Journal package test forces the first file sync to fail after a completed write, then verifies a later flush on the same instance succeeds and both distinct event IDs remain in append order. The Journal package suite passed 43/43.

The Harvester-side tests on branch `test/harvester/retry-after-transient-journal-flush` cover:
- the account snapshot manager retaining the first published audit after a failed flush, then publishing a distinct second audit on retry;
- the recovery handler keeping readiness/reconciliation blocked and withholding acknowledgement after the failed account audit flush;
- release of the single-flight task slot, followed by a later reminder retrying the same generation, publishing the second account audit, completing the open-orders audit, and acknowledging once.

No Journal or Harvester production source changed for F-018. No audit record is deleted, overwritten, rotated, or deduplicated. Journal PR #714 and Harvester PR #716 are merged; exact-head verification passed.


## 22. F-018 merge confirmation — 2026-11-08

The Journal-side characterization merged in [PR #714](https://github.com/45s/coinzilla/pull/714), exact head `a52630cf4b2db0b5b317db4dd0e103789b64ed90`, merge commit `0638c8bbc51607805bd95299fc8b4e69363c774e`. The Harvester-side recovery proof merged in [PR #716](https://github.com/45s/coinzilla/pull/716), exact head `ae021f8f9fac071ebf3844069d5321ed11f8d0a3`, merge commit/current `develop` checkpoint `32a478d39a952206423fd6e552eea86e27d51f80`.

- Journal package tests: 43/43 passed.
- Harvester package tests: 760/760 passed; configured targeted regression files 3/3 passed.
- All six required offline CI contexts passed on both PR heads.
- Workspace coverage passed; Journal and Harvester package threshold enforcement is not configured.
- TESTNET integration was skipped. No TESTNET acceptance is claimed.

F-018 is complete as a test/documentation characterization. The known permanent Journal `writeFile()` failure poisoning behavior remains documented and is not changed by this work.


## 23. Second-disconnect end-to-end Harvester lifecycle proof — 2026-11-08

Added a new offline composition test on branch `test/harvester/second-disconnect-status-recovery-lifecycle`. It wires `createUserDataStatusHandler` to `createUserDataRecoveryHandler` without inspecting or changing `start-harvester.js`.

The test holds generation one in owned-order reconciliation, sends a second `connectionClosed` and `recovered` status, verifies the stale task publishes no account/open-orders audits and never acknowledges, then sends a later reminder and verifies only generation two reconciles, publishes both audits, acknowledges once, receives one terminal `reconciled` status, and restores readiness.

This is Harvester consumer coverage only. The broker-owned exact terminal-notification count and multi-subscriber acknowledgement contract remain open under cross-domain request #702. PR #718 merged into `develop` as `6236f49dca53a2938b016b52802f907c90611b44`; exact-head Harvester tests 761/761, targeted 3/3, and all six required offline contexts passed. No production source or broker contract changed.

## 24. Second-disconnect lifecycle proof merge confirmation — 2026-11-08

PR [#718](https://github.com/45s/coinzilla/pull/718) is merged. Exact tested head: `a28bd72585a8b9d7c50b883b980a185b99711f49`. Merge commit and current `develop` checkpoint at the time of merge: `6236f49dca53a2938b016b52802f907c90611b44`.

- Harvester package tests: 761/761 passed.
- Configured Harvester targeted regression files: 3/3 passed.
- All six required offline CI contexts passed.
- Workspace coverage passed; Harvester coverage execution passed, but package threshold enforcement is not configured.
- TESTNET integration was skipped.

The Harvester consumer proof is complete. F-019 remains open only for the Brokers-owned per-subscriber acknowledgement contract and exact terminal `reconciled` notification count in issue #702. No `start-harvester.js` inspection or broker contract change was made.


## 25. F-015 broker handshake diagnostic follow-up — 2026-11-08

Brokers PR [#721](https://github.com/45s/coinzilla/pull/721) merged into `develop` as `07cb9d3caef5232cfaa9c51954de91b3bc1ccd59`. Exact tested head: `ad48ae4bb71d81d0318a031f101f582a67cca083`.

- The native transport preserves a sanitized underlying handshake Error as `cause`, safe HTTP upgrade status when the runtime exposes it, and close code/reason/clean-close state as structured diagnostics.
- Deterministic offline transport regressions cover an Undici-style blank-message `TypeError`, optional HTTP status metadata, close metadata, underlying cause, and credential/URL redaction.
- Node.js v24.22.2 and bundled Undici 7.30.1 were verified. The credential-free Spot TESTNET API upgrade returned HTTP 451 with Binance's restricted-location eligibility response; the Streams upgrade returned HTTP 101 with a valid accept hash.
- Brokers tests passed 414/414; Brokers coverage was 98.72% statements, 93.39% branches, and 94.98% functions. All six required offline CI workflows passed on the exact PR head.
- The manual read-only TESTNET account/recovery integration was skipped. No authenticated account request, order operation, or TESTNET acceptance is claimed.

The separate established-socket 1006 path remains open under cross-domain request [#680](https://github.com/45s/coinzilla/issues/680). Do not infer an underlying network cause from code 1006 alone; deterministic post-connect error/close correlation and any runtime limitation still require Brokers-owner verification. No Harvester workaround or broker contract change was made.


## 26. F-015 established-socket 1006 diagnostic limitation — 2026-11-08

[Brokers PR #725](https://github.com/45s/coinzilla/pull/725) merged into `develop` as `bf9e51e298535cf14f113343a5216f4b8a1ec80f`. Exact tested head: `b50d453d8846e82a2918b5d4752dfc8d81412ceb`.

- Added an offline loopback test using Node 24.x native WebSocket. The server completes the upgrade and then resets the established connection without sending a WebSocket close frame.
- The client closes with code 1006. Undici's `websocket:open` and `websocket:close` diagnostic channels identify the WebSocket instance, but `websocket:socket_error` emits no event for this reset.
- Undici documents the socket-error channel payload as an Error only, without a WebSocket identity. A process-wide listener therefore cannot safely attribute such an error to the Binance API or Streams client when both are active.
- The first exact-head attempt expected one socket-error event and observed zero (414/415 Brokers tests passed). The test was corrected to assert the actual runtime behavior; the final exact head passed Brokers tests 415/415, Brokers coverage, and all six required offline CI workflows.
- No production diagnostics subscriber, socket monkey-patch, timing heuristic, dependency, transport change, public broker contract change, or Harvester workaround was introduced. No TESTNET or exchange operation was performed.

The established-socket path is now characterized as a Node/Undici runtime observability limitation for the reproduced 1006 peer reset. Do not infer a specific network/TLS cause from 1006. Cross-domain issue [#680](https://github.com/45s/coinzilla/issues/680) can be closed as investigated/documented; a future Node/Undici runtime change may make stronger correlation possible.


## 27. F-019 broker multi-subscriber terminal notification proof — 2026-11-08

[Brokers PR #729](https://github.com/45s/coinzilla/pull/729) merged into `develop` as `ba0992116a34b91ac907218203562880475c9dfd`. Exact tested head: `fc7467a260f7813e27fe1a7506317e18fe044e53`.

- The existing two-subscriber recovery regression now asserts that the first acknowledgement remains locally recorded while global recovery is pending (legacy boolean `false`), and the final acknowledgement completes recovery.
- Each still-active subscriber receives exactly one terminal `reconciled` status for the generation.
- A repeated acknowledgement cannot publish a duplicate terminal status, and the acknowledgement reminder is cleared on completion.
- A second regression proves that when the first subscriber has acknowledged and the second disconnects, only the remaining active subscriber receives `reconciled`; the removed subscriber receives none.
- The existing state-changing RPC gate remains closed until global recovery completion and opens only after the final acknowledgement.
- Brokers tests passed 416/416. All six required offline CI contexts and workspace coverage passed. Read-only TESTNET integration was skipped; no TESTNET acceptance is claimed.
- This was test/documentation only. No broker production source, public acknowledgement return semantics, Harvester consumer, or bootstrap code changed.

The broker-owned exact terminal-notification-count proof is complete. F-019/#702 remains open only for agreement on the additive per-subscriber acknowledgement result and the corresponding consumer compatibility behavior. Do not reinterpret the legacy boolean or add a Harvester workaround before owner coordination.


## 28. Current disposition superseding earlier acceptance-matrix notes — 2026-11-08

This addendum is the current tracker view. Sections 12–13 and 27 preserve the state at the time they were written; statements there describing later-closed gaps are historical, not current blockers.

### Resolved offline engineering gaps

- **F-017 malformed REST envelopes:** closed by [PR #708](https://github.com/45s/coinzilla/pull/708); eight deterministic malformed-envelope cases merged, exact-head offline CI passed.
- **F-016 native broker Error causes:** closed by [PR #711](https://github.com/45s/coinzilla/pull/711); native causes survive broker-result wrappers and structured recovery logs.
- **F-018 transient Journal sync retry:** characterized by [PR #714](https://github.com/45s/coinzilla/pull/714) and [PR #716](https://github.com/45s/coinzilla/pull/716); uncertain first and distinct retry records remain durable in append order, and Harvester withholds acknowledgement after a failed required audit flush. Permanent writeFile poisoning remains documented and unchanged.
- **Second disconnect during in-flight recovery:** covered end-to-end by [PR #718](https://github.com/45s/coinzilla/pull/718); stale generation work publishes no audits and never acknowledges.
- **Broker handshake / established-socket diagnostics:** characterized by [PR #721](https://github.com/45s/coinzilla/pull/721) and [PR #725](https://github.com/45s/coinzilla/pull/725). A later credential-free Spot API upgrade returned HTTP 451 for regional eligibility; the Streams upgrade returned HTTP 101. A reproduced post-upgrade reset closes with 1006, while current Undici diagnostics cannot safely correlate that socket error to one of multiple WebSockets. Do not infer that the later 451 proves the original incident's cause.
- **Broker multi-subscriber terminal notification count:** proven by [PR #729](https://github.com/45s/coinzilla/pull/729); active subscribers receive one terminal reconciled status, removed subscribers receive none, reminders clear, and state-changing RPCs remain blocked until global completion.
- **Broker acknowledgement result API:** merged in [PR #732](https://github.com/45s/coinzilla/pull/732). The additive acknowledgeRecoveryResult() distinguishes accepted/pending, accepted/completed, stale/inactive, and no-recovery-pending while preserving the legacy boolean API. Its exact final head passed all six required offline CI workflows.

### Current cross-domain integration

- **[PR #735](https://github.com/45s/coinzilla/pull/735) — MERGED:** Harvester consumes acknowledgeRecoveryResult() without treating accepted/pending as rejection. It records local acceptance but keeps the application readiness gate closed until a global reconciled status matches both the current recovery generation and active subscription ID. It does not modify start-harvester.js. Test-first RED was confirmed; the synchronized exact head passed all six required offline CI workflows.
- **Issue #702:** closed after PRs #732 and #735 merged; the Broker API and Harvester consumer contract are complete.
- **Issue #626:** remains open for final recovery closeout and TESTNET acceptance disposition. Offline deterministic engineering continues independently of TESTNET.
- **Issue #654:** process-restart reconciliation remains explicitly deferred; no Journal replay/restart behavior is claimed.

### TESTNET external limitation

The hosted Spot API runner returned HTTP 451 for regional eligibility. This is documented as PAUSED/UNVERIFIED in the Harvester roadmap and TESTNET runbook by merged [PR #731](https://github.com/45s/coinzilla/pull/731). The operator cannot change location; do not ask them to do so or retry the same blocked path. The read-only integration workflow remains skipped. No TESTNET acceptance, authenticated account validation, order submission/cancellation, or live operation is claimed.

### Tracker cleanup

- [#650](https://github.com/45s/coinzilla/issues/650) closed against PR #652; evidence matrix, allowlisted executionReport facts, lifecycle evidence, trading-rule snapshots, and durability boundary are implemented.
- [#646](https://github.com/45s/coinzilla/issues/646) and [#656](https://github.com/45s/coinzilla/issues/656) closed against PR #653.
- [#667](https://github.com/45s/coinzilla/issues/667) closed after incident source fixes and regressions merged.
- [#680](https://github.com/45s/coinzilla/issues/680) closed as investigated/documented; stronger established-socket correlation depends on future Node/Undici observability.

**Current work selection:** #702 is complete. Continue #626's offline acceptance traceability while TESTNET remains PAUSED/UNVERIFIED; keep #654 deferred. No live process or exchange action is authorized by this audit update.


## 29. #626 repeated recovered reminder integration regression — 2026-11-08

[Harvester PR #739](https://github.com/45s/coinzilla/pull/739) adds the missing deterministic offline integration proof to `start-harvester.test.js`.

- The test creates one owned Conservative BUY, starts application recovery, and holds its canonical owned-order history read unresolved.
- It sends exactly 254 repeated `recovered` reminders during that same recovery generation.
- It queues the matching BUY fill while reconciliation is still pending, then releases the held REST read.
- It proves one owned-order canonical-history reconciliation and one symbol-scoped open-order reconciliation; the application performs one fresh RECOVERY account snapshot and one account-wide RECOVERY open-orders audit.
- The queued fill is drained once in recovery mode. The matching stream and REST fill evidence results in exactly one `execution.fill_applied` event and one BUY quantity in Portfolio.
- The broker acknowledgement callback observes the queued fill already processed, the fill applied exactly once, and both RECOVERY account audits durably flushed.
- The test asserts one successful acknowledgement result, one terminal `reconciled` status, one application recovery completion diagnostic, and readiness reopening only after those barriers. A follow-up assertion records the exact readiness sequence `[true, false, true]`, proving one close and one reopen for the recovery generation.
- Existing failure coverage (fresh account snapshot failure) and second-disconnect stale-generation coverage remain unchanged. The separate retry-cycle second-disconnect scenario noted in the acceptance matrix remains a distinct partial item.
- The regression reproduces the 254-reminder pattern, but does not replay the complete raw incident Journal byte-for-byte. It uses only a deterministic fake broker; no TESTNET or live exchange operation occurs.

The configured Harvester Targeted Tests workflow passed on test head `1355ae1b76aea67ba4b9c2db9592627ccdfc6dff`: all 3 configured files passed (63/63 tests total; `start-harvester.test.js` 54/54). A subsequent test-only commit adds the explicit `[true, false, true]` readiness-transition assertion; final exact PR-head tests, workspace CI, and coverage are rerun after this follow-up.


---

## Additional same-day runtime session — 2026-11-08 16:33:33–22:42:05 UTC

A second, distinct Harvester runtime session from later on November 8 was supplied after this earlier reconnect/recovery incident report. It has its own Journal, process start, startup audit, and successful shutdown. Do not merge its events or balances into the earlier 03:20–03:45 UTC failure timeline.

The complete separate audit is [AUDIT_SESSION_2026-11-08_16-33-33.md](./AUDIT_SESSION_2026-11-08_16-33-33.md). It includes all three artifact hashes and parse counts, per-symbol market event cadence, unique-fill accounting, exact balance reconciliation, shutdown observations, and missing closing-order evidence.

Key distinctions:
- The afternoon process was not globally frozen in the supplied evidence; DOGE market events and trading lifecycle processing continued, and shutdown completed successfully.
- ZRO had a 54m 2.118s maximum inter-event gap with no corresponding afternoon market-stream error. This remains unresolved rather than a confirmed outage and is tracked separately in [#760](https://github.com/45s/coinzilla/issues/760).
- The 48 unique fills reconcile exactly to the closing asset balances. Repeated duplicate-fill observations did not change accounting.
- The CLOSING balance audit is complete, but no CLOSING open-orders payload was recorded; exact final order states remain unverified.


## 31. F-023 failure-classification TDD — 2026-11-09

Test-only regressions now distinguish matched order-transition failure from
ownership/accounting-integrity failure. They also cover terminal fill-history
REST timeout classification, a retryable queued-event failure that must block
broker acknowledgement until a later authoritative retry, a permanent
accounting-integrity mismatch that remains terminal, and the exact
`recovered → executionPending` status interleaving with both broker recovery
flags false before a queued owned BUY event.

The expected RED behavior is that the current event handler sets the sticky
`accountingFailed` latch for every failed engine result and the recovery
coordinator does not inspect failure categories or queued retryable failure
markers. No production source or exchange behavior changes are included in
this test-first commit.


## 32. F-023 failure classification and retry implementation — 2026-11-09

PR #788 carries the test-first regressions into the implementation. Engine
results now expose explicit failure categories and stages. Ownership and
accounting-integrity failures remain terminal; downstream order-transition,
REST reconciliation, and Journal durability failures remain retryable only
through a new single-flight attempt that repeats authoritative reconciliation.

A generation-scoped retryable failure marker prevents a recovery attempt from
acknowledging the broker after a queued event failed. A later reminder clears
that marker only when a new attempt begins. The application still requires
canonical order/fill reconciliation, queued-event draining, fresh account and
open-order snapshots, both durable RECOVERY audit flushes, and generation
revalidation before acknowledgement. Unknown failure metadata defaults to
terminal fail-closed behavior.

The exact-head CI run is pending at this documentation checkpoint. No live or
TESTNET order operation was performed; TESTNET acceptance remains paused.


## 33. Empty TypeError cause preservation — 2026-11-09

The recovery and event-handler diagnostics now retain wrapper error name,
message, stack, original cause name/message, and cause stack. An empty wrapper
`TypeError` falls back to the useful cause message without discarding either
stack. The REST snapshot error wrapper preserves a non-Error thrown value as
the original `cause`. Deterministic tests cover both event-processing and
application-recovery diagnostics.


## 34. PR #788 exact-head verification — 2026-11-09

The failure-classification implementation, cause-preservation changes, offline
regressions, recovery contract, architecture diagram, and operational
documentation are committed on the PR branch. Full GitHub Actions validation
is pending on the resulting branch head. TESTNET acceptance remains paused;
no live or TESTNET order operation was performed.


## 35. Diagnostic compatibility correction — 2026-11-09

The first full CI pass found one existing startup integration assertion tied
to the stable log message for an unowned order. The typed failure categories
and new cause/stack diagnostics were correct; the category-specific message
was restored to the existing stable wording without weakening or removing the
regression. All other tests in the initial unit/coverage/targeted runs passed.


## 31. F-023 failure-classification TDD — 2026-11-09

Test-only regressions now distinguish matched order-transition failure from
ownership/accounting-integrity failure. They also cover terminal fill-history
REST timeout classification, a retryable queued-event failure that must block
broker acknowledgement until a later authoritative retry, a permanent
accounting-integrity mismatch that remains terminal, and the exact
`recovered → executionPending` status interleaving with both broker recovery
flags false before a queued owned BUY event.

The expected RED behavior is that the current event handler sets the sticky
`accountingFailed` latch for every failed engine result and the recovery
coordinator does not inspect failure categories or queued retryable failure
markers. No production source or exchange behavior changes are included in
this test-first commit.


## 36. Additional F-023 classification boundaries — 2026-11-09

Additional RED regressions distinguish a malformed successful REST payload from a broker-declared transient REST read failure. They also prove that missing failure metadata and retryable metadata with an empty stage cannot authorize automatic recovery retries. These tests are test-only; production behavior remains unchanged at this checkpoint.
