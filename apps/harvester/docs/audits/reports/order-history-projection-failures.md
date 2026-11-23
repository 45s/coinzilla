---
title: Harvester order-history projection failure investigation
status: active
type: investigation
owner: harvester
created: 2026-11-23
---

# Harvester order-history projection failure investigation

**Tracking issue:** [#1789 — historical order-history projection failures](https://github.com/45s/coinzilla/issues/1789)  
**Code baseline reviewed:** `45s/coinzilla@44ed6ce4dd32437e5343c2b1c43171f290f4836e` (`develop`)  
**Immutable archive:** `45s/coinzilla-archive@f283c90db9143c74683ae5bf9c7bb52e09590d56`  
**Archive directory:** `archives/2026-11-22T17-35-17Z_77213df6/`  
**Archive creation:** `2026-11-22T17:35:17.954Z`

## Executive result

The archive proves **28 visible terminal error groups** with code `HARVESTER_ORDER_HISTORY_RECORD_INVALID`. Each group is individually indexed below. The terminal's consecutive-identical-entry suppression reports another 30 matching logger writes, so the 28 visible groups represent **58 console logger calls**. This is not evidence of 58 distinct malformed orders: the console fingerprint omits the event ID, client-order ID and validation field.

The current source narrows this error code to **order-history record mapping/validation**, not a database upsert failure: `OrderHistoryValidationError` is thrown by `createOrderHistoryRecord()`, and `createOrderHistoryObserver()` records that failure at stage `mapping`. The archive does not identify the historical runtime source SHA, so this is a current-source attribution, not an exact historical build attestation.

A prospective diagnostics defect is confirmed: the observer now supplies a safe `field` and order context, but the compact terminal presentation does not display `field` or `clientOrderId`, and its duplicate fingerprint consequently treats different validation fields/orders as identical when the remaining summary fields match. This task adds a regression test for that presentation contract before implementing the smallest fix.

**Historical root cause remains unresolved.** The selected terminal log has no raw event, invalid field, source event ID or client-order ID. The two full cumulative logs are present in the archive but are too large for the available GitHub file reader to return, including line-range requests. The database dump remains uninspected; no authorization to inspect it is inferred.

## Scope and safety

Read-only inspection of the immutable archive's manifest, fact stream, selected terminal log, current Harvester source, tests and documentation. No archive mutation, database-dump inspection, Binance API call, TESTNET/LIVE order operation, account mutation, or process control was performed.

## Evidence provenance and integrity

The archive manifest declares `snapshotType: selected-log-evidence`, with cumulative logs selected as the final 5% of each file and only the newest compressed session directory included. It is not a complete raw-log export.

| Artifact | Size | SHA-256 from archive manifest | Git blob SHA |
|---|---:|---|---|
| `manifest.json` | 3,072 bytes | — | `ac7fd40b1decc100738962584ebad5097c3d903d` |
| `recovery-facts/facts.jsonl` | 48,401 bytes | `1b923c1a090904df601463d14681090165b7f8d50a3806e96655699d90a97295` | `a57acc6f4291972b8ecdb578cdef39101745fda8` |
| `recovery-facts/manifest.jsonl` | 16,089 bytes | `3063f9ce829cce8a66a471672abee6b77ff52b6647b0b786381adc1db5f264bc` | — |
| `logs/cumulative/terminal.log` | 41,214 bytes | `6ec912690afbfeb1d9c87c674647a34e11d855b2d59337c34ac58d54d2a93d33` | `336aadc4ff5b18a9c6628f1b63fbf78f7202a76f` |
| `logs/cumulative/harvester.log` | 96,308,862 bytes | `60017db6d228c5589a21c80223e4288488d5c5dee14468d07e7eb9e24003fc00` | `2c2b3fc8b4c43b7716ac834e5b717a8d696ca67f` |
| `logs/cumulative/trace.log` | 97,056,981 bytes | `8a24cdb0e575d853bdcb795bde697d6e735260e94b1f227b813745e9a5dabb16` | `b71b0d8200285f9179d4554402b357e85deb3830` |

The 49 durable facts cover sequence 0–48. The existing archive review verified the fact and manifest digest chains and their one-to-one commit references. The first fact was recorded at `2026-11-22T08:52:02.005Z` (10:52:02 local UTC+2).

The terminal log is 429 lines according to the archive review. Direct retrieval returned the complete selected terminal content and all 28 matching error lines. For both large cumulative files, `fetch_file` returned empty content for requested line ranges (including lines 1–20); the Git blob fetch was rejected because its decoded response exceeded the connector's 67,108,864-byte limit. The files are **present**, not absent; their contents remain inaccessible through this reader.

The archive also contains `data/testnet/database-dump.json` (2,645,901 bytes, SHA-256 `cc024ea0842bed65f53081263b5dbc668099c09beac14a8d2835660d357e744a`). It was not opened or queried.

## All 28 visible terminal groups

Times below are terminal-local UTC+2. The repeat column counts additional consecutive console writes suppressed after the visible error line. Each visible error line itself contains only the message, error code and error name.

| # | Time | Terminal line | Additional identical writes |
|---:|---|---:|---:|
| 1 | 04:17:59 | 9 | 1 |
| 2 | 04:18:08 | 20 | 1 |
| 3 | 04:20:25 | 31 | 1 |
| 4 | 04:21:13 | 42 | 1 |
| 5 | 04:33:00 | 53 | 1 |
| 6 | 04:33:07 | 64 | 1 |
| 7 | 04:33:10 | 75 | 1 |
| 8 | 04:33:13 | 84 | 3 |
| 9 | 04:45:43 | 95 | 1 |
| 10 | 05:03:33 | 106 | 1 |
| 11 | 05:14:53 | 117 | 1 |
| 12 | 07:18:52 | 128 | 1 |
| 13 | 07:19:14 | 137 | 1 |
| 14 | 07:39:46 | 148 | 1 |
| 15 | 10:52:26 | 208 | 1 |
| 16 | 10:52:28 | 216 | 1 |
| 17 | 10:52:34 | 226 | 1 |
| 18 | 10:52:44 | 237 | 1 |
| 19 | 10:52:51 | 245 | 1 |
| 20 | 10:53:01 | 256 | 1 |
| 21 | 10:56:38 | 267 | 1 |
| 22 | 11:03:56 | 278 | 1 |
| 23 | 11:10:02 | 284 | 1 |
| 24 | 11:15:10 | 318 | 1 |
| 25 | 11:21:57 | 331 | 1 |
| 26 | 11:31:08 | 388 | 1 |
| 27 | 11:44:28 | 396 | 1 |
| 28 | 11:53:33 | 412 | 1 |

The 27 groups with one additional write plus the group at line 84 with three additional writes total 30 suppressed writes: 28 visible + 30 suppressed = 58 console logger calls represented. The console fingerprint is a compact summary, not a full-record identity.

## Timestamp and Journal correlation

### Early group: no durable fact correlation

Occurrences 1–14 (04:17:59 through 07:39:46 local) precede the first durable fact at 10:52:02 local by several hours. The 49-record fact stream cannot attribute these failures to an order, market, or fill.

Adjacent terminal lines sometimes show accepted orders and Portfolio summaries, but the error lines themselves contain no order identity. Adjacent lines are not sufficient to assign an invalid event to a specific order.

### Later group: fill-time correlation only

The later 14 groups cluster around ZRO, DOGE and ADA fill activity. The nearest fact references below are temporal comparisons, not causal attribution.

| Terminal line/time | Nearest fact | Recorded execution identity | Time relationship |
|---|---|---|---|
| 208 / 10:52:26 | seq 5 | ZRO BUY trade 15735, broker order 1001129 | fact at 10:52:26.590, +590 ms |
| 216 / 10:52:28 | seq 5 is the nearest prior fact | seq 5 is ZRO trade 15735/order 1001129; adjacent terminal line shows accepted ZRO order 1001131 | no exact error-to-order link |
| 226 / 10:52:34 | seq 6 | ZRO BUY trade 15736, broker order 1001131 | fact at 10:52:34.832, +832 ms |
| 237 / 10:52:44 | seq 9 | DOGE BUY trade 303728, broker order 1931359 | fact at 10:52:44.692, +692 ms |
| 245 / 10:52:51 | seq 10 | ZRO BUY trade 15737, broker order 1001134 | fact at 10:52:51.326, +326 ms |
| 256 / 10:53:01 | seq 13 | DOGE BUY trade 303729, broker order 1931369 | fact at 10:53:01.121, +121 ms |
| 267 / 10:56:38 | seq 16 | ZRO BUY trade 15738, broker order 1001139 | fact at 10:56:38.590, +590 ms |
| 278 / 11:03:56 | seq 19 | ZRO SELL trade 15740, broker order 1001163 | fact at 11:03:56.236, +236 ms |
| 284 / 11:10:02 | seq 22 | DOGE BUY trade 303737, broker order 1931380 | fact at 11:10:02.900, +900 ms |
| 318 / 11:15:10 | seq 25 | DOGE BUY trade 303738, broker order 1931687 | fact at 11:15:11.010, error precedes fact by ~1.01 s |
| 331 / 11:21:57 | seq 30 | DOGE SELL trade 303742, broker order 1931754 | fact at 11:21:57.642, +642 ms |
| 388 / 11:31:08 | seq 35 | ADA BUY trade 145912, broker order 806225 | fact at 11:31:08.324, +324 ms |
| 396 / 11:44:28 | seq 36 | ZRO BUY trade 15742, broker order 1001164 | fact at 11:44:28.883, +883 ms |
| 412 / 11:53:33 | seq 45 and seq 46 | ADA pause and ADA SELL trade 145942, broker order 806319 | same local second; ordering is not established |

These alignments establish temporal proximity only. In particular, the 10:52:28 error's nearest prior fact is a different ZRO order from the adjacent accepted order. The 11:53:33 error shares a second with both an ADA pause and a SELL fill. Neither case supports a causal claim.

## Source and test findings

### Mapping stage in current source

At the reviewed `develop` baseline:

- `OrderHistoryValidationError` is constructed by `apps/harvester/src/domain/order-history/order-history-record.js` when a record invariant fails.
- `createOrderHistoryObserver()` calls `createOrderHistoryRecord()` inside its mapping try/catch and records caught validation errors with `stage: "mapping"`.
- The error context carries a safe dotted `field` plus available provider/account/client-order identity.
- Validation boundaries include provider/account/client identity; market and asset identity; side/type/status; exact execution quantities and their consistency; optional price, ownership, quote quantity and timestamps; and source-event identity/name/source/timestamp.

Therefore this error code is a domain record-mapping validation failure in the current implementation, not a repository `upsert` failure. The archive manifest does not identify the exact Harvester runtime commit, so this attribution must not be promoted to an exact historical source-version claim.

### Why the terminal hid the field

`createFailureDiagnostic()` now includes `field`, `symbol` and `clientOrderId` (the field-level diagnostic change was delivered under #1362). However, `createConsoleRecordPresentation()` currently selects only a subset of fields for terminal output and excludes both `field` and `clientOrderId`. Its fingerprint is built from that reduced summary. Thus two consecutive failures with the same message/code/name/symbol but different invalid fields or order identities can be rendered as one repeated-entry group.

The current persistence composition can also create both a legacy order-history observer and a relational order-history observer on the same EventBus. This is a plausible source of duplicate identical log calls if both were active in the archived runtime, but the archive's selected terminal output does not prove which observer emitted each call. Do not infer 29 distinct invalid events or attribute the 58 calls to the two observers without structured logs.

### Existing tests

- `order-history-record.test.js` covers valid record mapping, exact decimal preservation, collision-safe composite identity, skipping zero-execution orders, and rejecting incomplete provider identity.
- `order-history-observer.test.js` covers valid lifecycle projection, queue overflow, repository failure, close/drain behavior, and field-level diagnostics for `providerInstanceId` and `market.baseAsset.code`.
- `configure-harvester-logging.test.js` covers compact output and duplicate suppression, but did not prove that different order-history validation fields and client-order identities remain visible and distinct.
- The order-history observer regression from #1362 proves the field reaches the logger; it does not prove the compact console renders it.

### Test-first result and focused correction

The regression was first committed without the production change on `39c4e5eb3730ac3ce7abd3a823492bd401b44f0e`. GitHub Actions' Harvester Targeted Tests failed for the expected reason: the test expected two distinct console lines but received one. The remaining selected tests passed.

The GREEN implementation in [PR #1796](https://github.com/45s/coinzilla/pull/1796) now gives order-history validation failures a dedicated bounded console summary containing safe `field`, `symbol`, `clientOrderId` and `errorCode`. Those values are included in the summary fingerprint. The regression now uses three events to prove both independent invariants: changing only the field keeps two records distinct; changing only the client-order ID also keeps two records distinct. It also checks the stable error code and 200-character bound.

This improves future diagnosis and prevents distinct validation failures from being hidden by console summary deduplication. It does **not** identify or repair the invalid historical input. Exact-head GREEN and full CI remain pending until the new commit completes.

## Remaining root-cause evidence

Keep #1789 open until the following is resolved:

1. Retrieve the archived cumulative `harvester.log` and `trace.log` in bounded chunks (or through another read-only path) and extract each matching structured record with event ID, clientOrderId, field, observer/stage and source context. The files are present and their hashes are recorded above; the current connector rejects their size.
2. Identify the exact Harvester runtime source SHA for the archived session, then verify the historical mapper and observer code against that SHA.
3. Reconcile each structured failure with the raw `order.updated`/source event, nearby broker execution report, canonical order and Journal fill facts. Do not associate a fill merely because timestamps are close.
4. Determine whether each failure affected one or both history projections and whether any expected row was absent. Keep this separate from Portfolio/RecoveryLedger and authoritative order-registry accounting unless evidence proves a link.
5. Inspect the archived database dump only after explicit owner authorization. No database contents have been inspected in this investigation.

## Disposition

- Confirmed: 28 visible terminal groups, 58 console logger calls represented by repeat counters, and a current-source order-history record-mapping validation path.
- Confirmed prospective gap: compact terminal output omitted validation field and client-order identity and could merge distinct failures.
- Implemented in draft PR #1796: bounded order-history failure summary and field/order-aware deduplication fingerprint; exact-head GREEN/CI pending.
- Unresolved: historical invalid field(s), exact input shape(s), number of distinct invalid source events, exact historical source stage/build, observer attribution, and operational impact.
- No source-ledger or database backfill; no archive rewrite; no TESTNET/LIVE activity.
