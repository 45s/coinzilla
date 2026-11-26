---
title: Harvester runtime error investigation — 2026-11-26
status: archived
type: investigation
owner: harvester
created: 2026-11-26
source_commit: ef5f5e25b0994f244eb6b29b62f5d48235df4544
---

# Harvester runtime error investigation — 2026-11-26

**Tracking:** [Harvester ownership/shutdown incident #1856](https://github.com/45s/coinzilla/issues/1856) · [relational trading-history failure #1854](https://github.com/45s/coinzilla/issues/1854) · [implementation PR #1858](https://github.com/45s/coinzilla/pull/1858)

## Evidence provenance

This report extracts the relevant runtime evidence from the operator-provided conversation uploads:

- `harvester(3).log` (6,807,121 bytes)
- `trace(3).log`
- `Pasted text(3).txt` (terminal capture)

The raw uploads remain the original conversation artifacts; this committed report is a curated, sanitized extraction, not a replacement or a byte-for-byte copy of those files. Credentials and environment secrets are not reproduced.

Runtime identity recorded in structured logs:

- Branch: `develop`
- Commit: `ef5f5e25b0994f244eb6b29b62f5d48235df4544`
- Working tree: `dirty`
- Runtime session: `c3bb7fec-65ed-4fbe-9009-9ad849f48b95`
- Harvester: `1.0.001`; Node: `v26.13.0`
- Mode: Binance TESTNET
- Symbols: `ADAUSDT`, `DOGEUSDT`, `LINEAUSDT`, `LINKUSDT`, `ZROUSDT`

Structured timestamps below are UTC. The terminal capture's clock timestamps have no explicit timezone and are kept as displayed.

## Findings

### 1. CG recovery SELL durable-intent rejection — confirmed, fixed on PR #1858

At `2026-11-26T05:02:30.216Z`, and repeatedly later, CG market evaluation fails with:

```text
TypeError: Recovery Seller submission ownership must match the Recovery Seller strategy and purpose
  at normalizeRecoverySellerOwnership
  at validateRecoverySellerSubmissionOwnership
  at validateSubmissionIntent
  at recordOrderSubmissionIntent
  at Object.onDurableSubmissionIntent
  at persistDurableSubmissionIntent
  at preparePendingSubmission
  at executePendingOrders
  at executeStrategyDecision
  at submitExecutableDecision
```

The structured result identifies `strategyId: CG_coinGrabber`, while the rejected decision is a recovery SELL. The submission result is `ok: false`, with `submittedOrders: []` and `activeOrdersAfter: []`. Therefore the console's `SUBMITTED #pending` lifecycle line is not proof that these rejected SELLs reached Binance. The rejection happens while validating/persisting the durable intent, before broker placement.

This is distinct from the RS market-price bug below. PR #1858 already contains CG/RS-aware submission ownership validation and regression tests in:

- `apps/harvester/src/domain/orders/recovery-seller-submission-ownership.js`
- `apps/harvester/src/domain/orders/recovery-seller-submission-ownership.test.js`
- `apps/harvester/src/use-cases/record-order-submission-intent.test.js`

### 2. RS LINEAUSDT BUY incorrectly entered CG trailing-BUY logic — confirmed, fixed on PR #1858

At `2026-11-26T05:34:14.336Z`, structured context identifies `strategyId: RS_recoverySeller`, `symbol: LINEAUSDT`, with:

```text
TypeError: Cannot read properties of undefined (reading 'priceStepPercent')
  at evaluateTrailingBuyTrigger (conservative-trading-engine.js:4157:41)
  at getTrailingBuyReplacementCandidate (conservative-trading-engine.js:4368:19)
  at maybeReplaceTrailingBuyTransition (conservative-trading-engine.js:4397:27)
  at context.maybeReplaceTrailingBuy (conservative-trading-engine.js:2525:55)
  at dispatchAcceptedMarketPriceTransition (create-market-price-transition-handler.js:321:12)
```

Root cause: the shared market-price dispatcher routed any active BUY to the CG-specific trailing-BUY workflow without checking canonical order ownership. That workflow reads the CG pair configuration at `context.pairs[symbol]`; LINEAUSDT is configured for RS but absent from the CG pair map, so `pairConfig` was undefined.

This is an ownership-routing bug, not a missing RS configuration property. Adding CG's `priceStepPercent` to RS configuration would conceal the defect.

**Fix committed to the existing PR branch:** `f138982434a575e5b998820406799cf592285452`.

The dispatcher now reads canonical OrderRegistry ownership and invokes CG trailing-BUY repricing only when the active BUY belongs to `StrategyId.COIN_GRABBER`. RS-owned and unowned BUYs proceed through the shared latest-transition evaluator. A regression test was added to `create-market-price-transition-handler.test.js`; the RS runtime flow map and roadmap were updated in the same commit.

This commit is on [PR #1858](https://github.com/45s/coinzilla/pull/1858). Test execution and a post-fix runtime replay have not been claimed.

### 3. Relational trading-history migration v5 mismatch — confirmed failure class; exact stored identity still needed

At `2026-11-26T04:58:08.559Z`:

```text
Error: Migration history mismatch at version 5
  at findPendingMigrations (packages/db/src/domain/services/migration-history.js:20:13)
  at migration-runner.js:91:31
  at prepare-order-history-persistence.js:296:18
  at prepare-order-history-persistence.js:364:30
```

The migration-history guard throws this message when the applied version is not registered or the stored migration name differs from the registered name. A checksum mismatch has a different error message; this is **not evidence of checksum mismatch**.

The committed `develop` source and final PR #1849 source both register v5 as:

```text
version: 5
name: use_market_scoped_exchange_order_identity
```

The runtime reported a dirty worktree. An uncommitted edit to the local migration definition is a plausible cause; an applied v5 row with a different name in the selected SQLite database is another. Neither is proven without the local diff and read-only database metadata.

Confirmed consequences:

- Relational order-history persistence is unavailable.
- Legacy order history remains active.
- Exchange-history synchronization is skipped.
- Relational history projection writes fail with `HARVESTER_ORDER_HISTORY_PERSISTENCE_FAILED`.
- The trading-history API does not start because its relational database dependency is absent.

This evidence is cross-tracked in [issue #1854](https://github.com/45s/coinzilla/issues/1854). PR #1855 preserves the original migration error/cause in failure diagnostics.

**Safe next diagnostic:** compare the local diff for `apps/harvester/src/infrastructure/persistence/relational-migrations.js` with the committed source, and read only:

```sql
SELECT version, name, checksum FROM schema_migrations ORDER BY version;
```

Do not reset/delete the database, rewrite `schema_migrations`, rename migration v5, or add a compatibility alias until the actual stored name and origin are known.

### 4. Operational State Store verification failure — observed, cause unavailable

The terminal capture shows a first startup attempt failing at displayed time `06:57:49` with:

```text
PROCESS_OPERATIONAL_STATE_VERIFICATION_FAILED
ProcessOperationalStateStartupError
Harvester requires an existing verified ...
```

The error message is visibly truncated in the supplied terminal capture. The later startup attempt proceeds and durably journals its account PREFLIGHT snapshot. The structured trace supplied here does not contain the first attempt's nested verification cause.

Source behavior confirms startup fails closed when `verify()` does not confirm a valid, durably writable ADR-0001 ledger. The precise failure could be a verification error, but the supplied files do not establish which record/file/integrity condition failed. Do not infer corruption or auto-repair the ledger.

### 5. Fourteen unowned open orders — confirmed external-order safety gate

The terminal capture reports an account-wide open-order snapshot with `orderCount: 14` and `readiness: BLOCKED`. The log explicitly says the unowned orders remain external and untouched.

Subsequent user-data events include `UNKNOWN_OR_EXTERNAL_ORDER_EVENT` pauses and rejected unowned order updates for LINKUSDT, ADAUSDT and LINEAUSDT. These pauses preserve the accepted ownership boundary. Do not adopt, cancel, or assign these orders to CG/RS without authoritative ownership evidence and the approved reconciliation flow.

### 6. Binance bookTicker validation error — confirmed invalid payload; no transport failure established

At `2026-11-26T06:53:15.133Z`:

```text
RangeError: Binance bookTicker best bid price must be positive
  at adaptBookTickerMessage (adapt-book-ticker.js:30)
  at broker.js:1072
  at BinanceStreamsClient.#dispatchToStream (streams-client.js:661)
```

The stream dispatcher catches listener exceptions and reports them. This proves a bookTicker update was rejected by price validation; it does not prove that the WebSocket disconnected or the stream stopped. The raw payload and symbol are absent from the supplied error, so the origin of the zero bid is not established. Keep non-positive prices invalid; do not pass them into trading decisions.

### 7. Shutdown safety phase — started; completion not evidenced in the supplied terminal excerpt

Structured trace records:

- `07:24:31.696Z`: `SHUTDOWN_REQUESTED` completed.
- `07:24:31.697Z`: `STOP_STATE_ESTABLISHED` completed.
- `07:24:31.702Z`: `STRATEGY_SHUTDOWN_SAFETY` started.

The terminal capture ends at the same strategy-safety start. The supplied evidence does not establish completion of that phase, durable `PROCESS_STOPPED`, process exit, or process-lock release. PR #1858 contains bounded, single-flight shutdown coordination and phase-deadline changes; post-fix shutdown still requires runtime evidence.

### 8. “next strategy evaluation failed” — same CG ownership failure as finding 1

The structured error at `2026-11-26T05:02:30.216Z` has the same `Recovery Seller submission ownership must match...` stack as finding 1. It is not a separate root cause.

## Fix / status matrix

| Finding | Disposition |
|---|---|
| CG recovery SELL rejected by RS-only ownership validation | Fix present on PR #1858 with regression tests |
| RS LINEAUSDT BUY sent into CG trailing-BUY path | Fixed on PR #1858 commit `f1389824`, regression added; not yet runtime-verified |
| SQLite v5 version/name mismatch | Failure class confirmed; exact DB row/local diff still required; no destructive repair |
| Operational State Store verification failure | Cause unavailable in supplied files; preserve fail-closed behavior |
| 14 unowned open orders | Correctly blocked as external; do not mutate |
| Non-positive bookTicker best bid | Correctly rejected; no transport failure proven |
| Shutdown safety phase | Start recorded; completion not established |

## Evidence and safety limits

- The logs are from Binance TESTNET. No LIVE exchange action is implied by this report.
- A local `SUBMITTED #pending` lifecycle line is not a broker acknowledgement.
- Structured failed-submission results with empty `submittedOrders` prove those particular decisions did not reach the broker-placement success path.
- No SQLite database file, Operational State Store ledger, raw bookTicker payload, or local dirty-worktree diff was supplied.
- No order adoption/cancellation, database reset, ledger repair, or exchange mutation was performed during this investigation.
- The CG ownership fix and RS routing fix are source changes on PR #1858; neither has been verified by a rerun of the operator's runtime session.

## Follow-up

- [#1856](https://github.com/45s/coinzilla/issues/1856): ownership routing, CG/RS submission ownership and shutdown safety.
- [#1854](https://github.com/45s/coinzilla/issues/1854): relational history migration failure and exact operator DB cause.
- [#1858](https://github.com/45s/coinzilla/pull/1858): implementation branch with the above Harvester fixes.
