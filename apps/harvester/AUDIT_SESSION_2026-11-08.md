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
| REST reconciliation fails, times out, or returns contradictory/missing order/fill/account facts | `create-user-data-recovery-handler.test.js` — failed owned-order reconciliation, account-wide open-orders REST failure, account snapshot read failure, durable account/open-orders audit failures, acknowledgement rejection/exception; `conservative-trading-engine.test.js` — incomplete/conflicting fill history, REST/stream disagreement, missing fills, stale history, and unknown submission outcomes; `rpc-client.protocol.test.js` — “RPC client times out and marks a state-changing outcome as unknown”. | **PASS for the enumerated deterministic failure cases.** The broker RPC timeout is tested at the RPC boundary and all recovery failures remain fail-closed. A separate end-to-end Harvester recovery test injecting a timed-out REST request is still desirable. |
| Successful REST reconciliation drains queued events and only then allows readiness | `start-harvester.test.js` — recovery starts only after transport recovery, queued events are drained, and order placement stays blocked without authoritative reconciliation; `create-user-data-recovery-handler.test.js` — stable event-window retries, generation revalidation between account/open-orders durable audits, and broker acknowledgement only after both audits; broker recovery test waits for every subscriber acknowledgement. | **PASS for the application gate and durable audit ordering.** The broker test asserts a `reconciled` transition after all acknowledgements; a dedicated exact-count assertion for one terminal `reconciled` notification per generation remains a useful broker-side test refinement. |
| Repeated reconnect/status callbacks do not duplicate reconciliation, fills, or diagnostics | `create-user-data-status-handler.test.js` — “repeated recovered reminders publish and log once while retrying application recovery”; `create-user-data-recovery-handler.test.js` — “does not mark another recovery request pending while reconciliation is already running” (explicit one-call assertion); engine tests for idempotent duplicate fills and overlapping REST/stream delivery. | **PASS for same-generation single-flight, duplicate-fill idempotency, and generation-scoped diagnostics.** A later reminder after a failed task is intentionally allowed to retry; it is not a concurrent duplicate. |
| Disconnect during reconciliation and a second disconnect during retry | `start-harvester.test.js` — “does not acknowledge a stale recovery after a newer disconnect”; `create-user-data-recovery-handler.test.js` — superseded generation during owned-order reconciliation, account audit, and open-orders audit; `UserDataSession` broker recovery tests. | **PARTIAL.** Stale work is rejected at each tested recovery stage. A dedicated scenario with a second disconnect during a subsequent application retry cycle is not yet modeled end-to-end. |
| No order submit/cancel/replace while recovery is unresolved | Broker recovery test blocks `createOrder`, `cancelOrder`, and `cancelAllOpenOrders` until all subscribers acknowledge; engine tests — “reconciles recovered orders without canceling or replacing any exchange order”, “processes recovery-time user-data cancellation facts without broker cancel or replacement calls”, and “defers a recovered BUY fill evaluation until application recovery is acknowledged”; bootstrap readiness-gate tests. | **PASS offline.** Recovery remains fail-closed; the broker gate and engine recovery mode independently prevent unsafe order mutations/evaluations. |
| Existing startup/restart recovery and broker adapter tests remain green | `start-harvester.test.js` startup/recovery tests; broker reconnect/recovery and RPC lifecycle/protocol tests; exact-head workspace CI below. | **PARTIAL by scope.** Startup recovery and broker adapter tests pass. Process-restart reconciliation is explicitly deferred to [#654](https://github.com/45s/coinzilla/issues/654) and is not claimed as implemented by #626. |

### Acceptance criteria disposition

- **Root cause documented with source-level evidence:** source of the empty TypeError is identified in Node's bundled Undici (§11, PR #681). The underlying network/TLS/HTTP failure remains unknown; broker-side cause preservation is tracked by #680.
- **Recovery state machine and status contract corrected/documented:** transport `recovered` is distinct from application reconciliation and broker `reconciled`; generation-scoped reminders, startup-only pending state, stable durable audit barriers, and fail-closed acknowledgement are covered by PRs #673–#679 and #682–#683.
- **Deterministic regression for the stuck Journal behavior:** repeated `recovered` reminders are tested while application reconciliation remains required, with no duplicate lifecycle/INFO spam and no premature readiness. The exact 254-record Journal sequence is not replayed as a single end-to-end fixture.
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

**Conclusion:** #626 is substantially advanced but must remain open. The remaining acceptance gaps are the second-disconnect-during-retry scenario, direct application-level REST-timeout injection, exact-one terminal broker notification assertion, full Journal-sequence replay, broker-side transport cause preservation (#680), and separate TESTNET acceptance. #654 remains deferred.
