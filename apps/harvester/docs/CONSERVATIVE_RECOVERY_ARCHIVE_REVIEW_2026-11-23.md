# Conservative Recovery — Immutable Archive Re-review (2026-11-23)

**Tracking:** [Issue #1362](https://github.com/45s/coinzilla/issues/1362)
**Implementation PR:** [PR #1761](https://github.com/45s/coinzilla/pull/1761)
**Branch:** `fix/harvester/1362-archive-reconstruction-preflight-20261123`
**Archive source:** `45s/coinzilla-archive@f283c90db9143c74683ae5bf9c7bb52e09590d56`
**Archive path:** `archives/2026-11-22T17-35-17Z_77213df6/`

## 1. Why this review exists

The sanitized fixture and PR implementation already preserve substantial lifecycle evidence. This re-review checks the original immutable archive independently, records what the source actually proves, and identifies remaining proof/CI gaps. It is an evidence checkpoint, not a claim that #1362 is complete or that trading is safe to resume.

No archive source was changed. No database dump was inspected. No Binance, TESTNET, or LIVE API call, order placement/cancellation, account mutation, or restart-restoration change was performed.

## 2. Source integrity and coverage

| Evidence | Observed | Verification |
|---|---:|---|
| Recovery fact records | 49 | Sequence 0–48; all previous-fact-digest links consistent; terminal fact digest `154720ef4b575e5a189fc6aa78fd9575917537d02e808403593ab4c09c8dd4b8` |
| Manifest records | 49 | Sequence 0–48; all previous-manifest-digest links consistent; terminal manifest digest `d4d5c84fa9857cf721f10955f17a816845900538779454e02d2dd6f80db65bef` |
| Manifest commits | 49 | Each `lastCommittedDigest` matches the corresponding fact digest; all cumulative record counts match sequence + 1 |
| Cumulative terminal log | 429 lines | Selected evidence is present in the source |
| Order-history projection errors | 28 | Each selected occurrence reports `HARVESTER_ORDER_HISTORY_RECORD_INVALID` |

Fact types: 13 execution fills; 10 cancellation intents and 10 cancellation outcomes; 3 recovery-cycle-not-completed facts; 4 market-pause facts; 2 safety-blocker facts; 2 account snapshots; 2 open-order snapshots; and the ledger/configuration/process baseline facts.

**Coverage limitation:** the archive labels its log evidence as selected-log evidence. It is not a complete raw-log export. The large cumulative Harvester/trace files have not yet been fully inspected. The database dump is present but remains uninspected. Do not claim complete log coverage or use the missing database/log evidence to infer a cause.

## 3. Confirmed runtime observations

### 3.1 Order-history projection failures

The terminal log contains 28 occurrences of:

- `Order history projection failed`
- `HARVESTER_ORDER_HISTORY_RECORD_INVALID`
- `OrderHistoryValidationError`

The log does not expose the invalid field or validation stage, so the offending historical field and root cause remain unknown. At the time of the initial review, `OrderHistoryValidationError` retained `context.field` but `createFailureDiagnostic()` omitted it. This forward-looking diagnostics gap is now fixed in commit `8a84565`: the observer emits a bounded safe dotted identifier from `error.context.field`, and `order-history-observer.test.js` verifies the mapping diagnostic. `createOrderHistoryRecord()` validates provider/account/client-order identity, market identity/assets, side/type/status, execution quantities, optional timestamps, and source-event identity/timestamp. These remain candidate historical validation boundaries only; the new test's `providerInstanceId` case is synthetic and does not identify the field in the 28 archived failures. The historical field and root cause remain unknown.

#### Bounded timestamp-to-fact correlation

The terminal timestamps are local UTC+2; fact timestamps are UTC. The 14 early errors at 04:17:59, 04:18:08, 04:20:25, 04:21:13, 04:33:00, 04:33:07, 04:33:10, 04:33:13, 04:45:43, 05:03:33, 05:14:53, 07:18:52, 07:19:14, and 07:39:46 (terminal lines 9–148) precede the first archived fact at 10:52:02 local by several hours. The 49-record fact chain cannot attribute those earlier occurrences.

The later 14 errors (terminal lines 208–412) cluster around these facts:

| Terminal error time | Terminal line | Nearest fact | Fact time (local) | Recorded fact |
|---|---:|---|---|---|
| 10:52:26 | 208 | seq 5 | 10:52:26.590 | ZROUSDT BUY trade 15735; +590 ms |
| 10:52:28 | 216 | seq 5 | 10:52:26.590 | ZROUSDT BUY trade 15735; +1.410 s |
| 10:52:34 | 226 | seq 6 | 10:52:34.832 | ZROUSDT BUY trade 15736; +832 ms |
| 10:52:44 | 237 | seq 9 | 10:52:44.692 | DOGEUSDT BUY trade 303728; +692 ms |
| 10:52:51 | 245 | seq 10 | 10:52:51.326 | ZROUSDT BUY trade 15737; +326 ms |
| 10:53:01 | 256 | seq 13 | 10:53:01.121 | DOGEUSDT BUY trade 303729; +121 ms |
| 10:56:38 | 267 | seq 16 | 10:56:38.590 | ZROUSDT BUY trade 15738; +590 ms |
| 11:03:56 | 278 | seq 19 | 11:03:56.236 | ZROUSDT SELL trade 15740; +236 ms |
| 11:10:02 | 284 | seq 22 | 11:10:02.900 | DOGEUSDT BUY trade 303737; +900 ms |
| 11:15:10 | 318 | seq 25 | 11:15:11.010 | DOGEUSDT BUY trade 303738; error precedes fact by ~1.01 s |
| 11:21:57 | 331 | seq 30 | 11:21:57.642 | DOGEUSDT SELL trade 303742; +642 ms |
| 11:31:08 | 388 | seq 35 | 11:31:08.324 | ADAUSDT BUY trade 145912; +324 ms |
| 11:44:28 | 396 | seq 36 | 11:44:28.883 | ZROUSDT BUY trade 15742; +883 ms |
| 11:53:33 | 412 | seq 45 and 46 | 11:53:33.xxx | ADAUSDT strategy pause and SELL trade 145942 occur in the same second; terminal precision cannot establish ordering |

This is strong temporal correlation between the later error cluster and order/fill activity across ZRO, DOGE and ADA. It is not proof that the nearest fact caused a particular projection error: the terminal records omit event identity, invalid field and validation stage. The 10:52:26 and 10:52:28 errors both align with the same ZRO fill; the 11:53:33 error aligns with both a pause and SELL fact. Keep the finding at correlation level and do not infer a historical root cause.

### 3.2 Recovery outcomes and safety pauses

The durable facts contain three `RECOVERY_CYCLE_NOT_COMPLETED` records and four `STRATEGY_MARKET_PAUSED` records:

- ZROUSDT — `RECOVERY_CYCLE_COMPLETION_FAILED`
- DOGEUSDT — `RECOVERY_CYCLE_COMPLETION_FAILED`
- LINKUSDT — `UNKNOWN_OR_EXTERNAL_ORDER_EVENT`
- ADAUSDT — `REST_STREAM_RECONCILIATION_FAILED`

The ZRO/DOGE recorded recovery results are sell-through outcomes with residual inventory above keep quantity. They are not historical successful completions. The sanitized fixture/runtime replay separately tests current code with explicitly synthetic current-filter snapshots; those results must not be relabeled as historical exchange-filter evidence.

The archive also records 14 unowned open orders in the PREFLIGHT snapshot and 17 in the later snapshot. Both snapshots carry an `UNOWNED_OPEN_ORDERS:14` block reason. Do not adopt these orders as owned.

### 3.3 User-data recovery

The terminal log records repeated WebSocket failures and four failed user-data recovery attempts. It then records:

- transport reconnect at 11:28:26;
- application recovery start;
- a RECOVERY account snapshot with complete audit at 11:28:49;
- subscription restoration; and
- application recovery completion with broker acknowledgement accepted.

This proves that this reconnect/recovery sequence eventually completed. It does not prove every earlier stream gap was reconciled without loss; that requires the corresponding order/execution-history evidence.

### 3.4 Startup, account-integrity halt, and shutdown

The archive records a ZRO startup exchange-history synchronization failure. Later, the ADA account-integrity halt could not fully reconcile owned orders before BUY cancellation. The terminal log shows shutdown safety starting, but it does not show a durable CLOSING snapshot or a `PROCESS_STOPPED` fact. Both observed shutdown attempts end with observability/startup errors.

Therefore historical clean shutdown is **not proven**. The deterministic offline shutdown regression in PR #1761 is evidence about current code, not proof that the archived process shut down cleanly.

## 4. Current PR and CI checkpoint

At the time of this review:

- PR #1761 is open and draft. The following values are the historical checkpoint recorded before the branch synchronization.
- Historical PR head: `01d6a21d1474a7a9befc72d08ea9d1166e12db48`.
- Historical PR base/merge base: `ee5aeb24899c0ae058b822edc36bb6957e23baf7`.
- Historical `develop`: `d44bdcff2bec920da2c35c99a874991baa87e97f`.
- Historical comparison: 39 commits ahead / 23 behind. This divergence was subsequently resolved by internal sync PR #1777; see the continuation update below.

Exact-head run set for the pre-documentation head:

| Check | Result |
|---|---|
| Harvester targeted tests | Passed |
| Workspace unit tests | Passed |
| Test coverage | Passed |
| Dependency audit | Passed |
| External documentation links | Passed |
| Workspace JavaScript quality | Passed |
| Strict changed-file ESLint | Passed |
| actionlint | Passed |
| Task Preflight unit tests | Passed |
| Task Preflight validation | Failed |
| Aggregate syntax gate | Failed because Task Preflight failed |

The exact Task Preflight log reports seven documentation paths missing from the PR's declared documentation-impact list: `ROADMAP.md`, `apps/harvester/ROADMAP.md`, `apps/harvester/docs/CONSERVATIVE_RECOVERY_LIFECYCLE_AUDIT.md`, `apps/harvester/docs/README.md`, `apps/harvester/docs/architecture.md`, `apps/harvester/docs/domain/ACCOUNTING_INVARIANTS.md`, and `apps/harvester/docs/domain/DOMAIN_TEST_INVENTORY.md`. It also reports stale current-base hashes for `AI_AGENT_WORKFLOW.md` and `docs/engineering/AI_TASK_COMPLIANCE_STANDARD.md`.

An earlier investigation compared the eight recorded instruction blob hashes with the exact task-start commit `a623b2c0d767adcceadcb31e673772d2191b178d` and found all eight matched. The first implementation commit followed 24 seconds later. The two canonical instruction files changed on `develop` afterward. Preserve the original report as historical evidence. Task Preflight CI enforcement has since been retired on current `develop`; the historical validation failure is not a current gate and requires no further implementation work.

## 5. Confirmed follow-up gaps already identified

These were identified in the prior investigation checkpoint and still require implementation/proof:

1. **Exact quote quantity — implemented in test commit `be7f171`:** runtime replay reads the archived fixture's exact `quoteQuantity`, passes it to the existing full-execution report helper, and asserts the emitted report preserves it.
2. **Digest naming and chain proof — implemented in commits `42fcd7c` and `9205fc8` (lint cleanup `c5cb058`):** fixture now has distinct fact/manifest terminal digests and all 49 records' digest-link metadata; the audit test checks every previous link, manifest-to-fact reference and record count.
3. **Test inventory accuracy — corrected in `998e5a4`:** 26 inventory paths were checked. Two stale references were corrected: the separate BUY-VWAP test was consolidated into `create-recovery-seller-accounting-workflow.test.js`; the obsolete bootstrap STOP-runtime test path was removed and current STOP workflow/startup coverage is linked. `src/use-cases/update-trading-accounting.test.js` exists and already contains a real immutable Portfolio/RecoveryLedger atomicity regression; the earlier claim that this path was nonexistent was incorrect.
4. **Late SELL composition proof — implemented in commits `98ed727` and `dac37bf`:** `create-user-data-event-safety-halt.test.js` now seeds an archived ADA BUY and applies the late SELL through real `Fill`, `Portfolio`, `RecoveryLedger`, and production `updateTradingAccounting`. It asserts exact retained base `0.05`, BUY basis `7.2`, net SELL proceeds `7.25318955`, realized profit `0.05318955`, duplicate no-op/object identity, latched reconciliation state, and no BUY resumption. `conservative-strategy-safety-pause.integration.test.js` remains stubbed and is explicitly secondary pause-gate evidence, not accounting proof. The real-composition test still requires exact-head CI.
5. **Historical projection failure root cause — unresolved:** the 28 terminal-log errors do not identify field or stage. The prospective diagnostic gap is fixed in commit `8a84565`: `createFailureDiagnostic()` now emits a bounded safe dotted identifier from `OrderHistoryValidationError.context.field`, covered by a RED/GREEN observer regression. This does not identify the field in the historical events. The database dump remains uninspected; obtain explicit authorization before inspection.

## 6. Prioritized continuation plan

1. **Branch synchronization — complete:** internal PRs #1777 and #1778 merged current `develop` into the task branch. Latest sync commit is `7ef954e73d4ea8c71b043728878eb1b71ab8bc44`, bringing in develop `b90f1536720edf077d80fecaecfbfcebf4a9ebff`; current PR head is `842b502422ac01b4926d662cb81683f4151715a3`, 69 ahead / 0 behind. The only overlapping paths were root `ROADMAP.md` in #1777 and `apps/harvester/docs/domain/DOMAIN_TEST_INVENTORY.md` in #1778; both diffs were reviewed.
2. **Exact quote replay — implemented:** pass archived `quoteQuantity` through runtime replay and assert report fidelity.
3. **Archive digest proof — implemented:** distinct terminal digests and 49-record chain-link/reference assertions are in place; current-head CI still needs to pass.
4. **Test inventory — corrected:** two stale RS test paths replaced with current evidence; the real atomic accounting test is confirmed present.
5. **Late SELL accounting — implemented;** retain the real Portfolio/RecoveryLedger scenario as required evidence and keep the separate stubbed pause-gate test accurately classified.
6. **Order-history errors — continue only if new evidence is available:** field-level observer diagnostics are implemented and covered prospectively. The 28 historical errors are timestamp-correlated where the fact stream exists, but the invalid field/root cause remain unknown. Do not claim a historical root cause without raw event evidence or authorized database inspection.
7. **Historical CI — passed on exact head `842b502422ac01b4926d662cb81683f4151715a3`:** Harvester Targeted Tests, Unit Tests, Test Coverage, Repository Quality, Dependency Audit and External Documentation Links all passed. This does not certify later commits. Exact-head CI on `0370feb2ef7083366ccec607b918770acfcd7313` failed Repository Quality on Markdown formatting; all other five workflows passed. CI for current head `07c0b5f329bde96e883b06f6aad51f903e0a6ebe` is pending. The read-only Binance TESTNET integration job remains skipped.
8. **Keep PR #1761 draft and unmerged** pending user review. No TESTNET/LIVE validation is authorized by this task.

## 8. 2026-11-23 continuation — implementation and evidence checkpoint

### Branch synchronization
That paragraph records a historical checkpoint only. The current task branch was synchronized with `develop@c1c715dc1b9b821d87d0a25e903c88c61e91ed3a` by merge commit `d963dfc2e0eb3fc02cbd9c25b08ae5b92ce61df9`, then documentation status/Markdown was corrected in `07c0b5f329bde96e883b06f6aad51f903e0a6ebe`. PR #1761 remains draft. Task Preflight is retired and is not a gate.

### Replay and archive integrity

- Runtime replay now sources each fill's exact `quoteQuantity` from the immutable fixture and asserts the execution report retains it.
- The fixture now distinguishes fact terminal digest `154720ef4b575e5a189fc6aa78fd9575917537d02e808403593ab4c09c8dd4b8` from manifest terminal digest `d4d5c84fa9857cf721f10955f17a816845900538779454e02d2dd6f80db65bef`.
- All 49 fact and 49 manifest digest metadata records are retained. Automated assertions verify sequences, previous-digest links, manifest-to-fact references and record counts.

### Test inventory and accounting
A path audit checked 26 inventory references. The old standalone BUY-VWAP test path is consolidated into `src/use-cases/create-recovery-seller-accounting-workflow.test.js`; the old bootstrap STOP-runtime test path no longer exists. Current STOP workflow tests are in `src/use-cases/create-recovery-seller-stop-workflow.test.js`; startup integration is in `src/bootstrap/start-harvester.test.js`. The exact former claim about configured RS routes failing closed without the STOP store is not currently proven by a matching test and remains a gap.

The path `src/use-cases/update-trading-accounting.test.js` exists and proves immutable Portfolio/RecoveryLedger failure atomicity for a wrong-market fill. The user-data safety-halt test `src/bootstrap/user-data/create-user-data-event-safety-halt.test.js` now applies the late SELL through real Portfolio/RecoveryLedger accounting and asserts exact state; only the separate `conservative-strategy-safety-pause.integration.test.js` remains stubbed pause-gate evidence.

### Order-history failure investigation
The selected 429-line terminal log contains 28 `HARVESTER_ORDER_HISTORY_RECORD_INVALID` occurrences. The historical invalid field and stage remain unknown. Current source now includes a bounded safe `OrderHistoryValidationError.context.field` in `createFailureDiagnostic()`, covered by `order-history-observer.test.js`; this prospective fix does not identify the historical field. The only compressed session directory is the startup-retry session `2026-11-22_11-10-47-403b10b2-17aa-4760-a6e9-c36453cd73e2`: its logs identify clean pre-fix source `develop@3c78fcd0` (PR #1732), startup failure on missing intent `h-dff68008c72c47a59368ad-2` (`mapExecutionFillFact`, `project-harvester.js:295`), followed by process-lock retention because runtime shutdown was not confirmed. This is the separate #1743 startup-projection issue, predating the callback fix in merged PR #1750; no successful broker connection/order write occurred in that retry session. Cumulative `harvester.log` and `trace.log` fetches returned no text, while the compressed session logs were readable. The database dump remains uninspected.

### CI status at this checkpoint
The exact-head CI run for digest assertion commit `9205fc81e5d640cca19e775ebb59ea1e42b4c5a4` exposed ESLint function-line and callback-parameter limits; commit `c5cb058` corrected them. The exact-head run on `842b502422ac01b4926d662cb81683f4151715a3` passed all six applicable workflows at that historical checkpoint. Later head `0370feb2ef7083366ccec607b918770acfcd7313` failed Repository Quality on Markdown formatting; the new docs correction is in `07c0b5f329bde96e883b06f6aad51f903e0a6ebe` and requires fresh CI.

## 9. Continuation prompt

Continue issue #1362 and PR #1761 from this branch. Read root and nested AGENTS.md files, AI_AGENT_WORKFLOW.md, the task-compliance standard, Harvester roadmap, lifecycle audit, accounting invariants, domain test inventory, and #1763 scenario-test guidance before changing source. Re-open this archive review and the immutable archive at the exact source commit above.

Replay quoteQuantity fidelity, digest-chain integrity, corrected inventory paths, real late-SELL Portfolio/RecoveryLedger composition, and prospective order-history field diagnostics are implemented. The 842b502 all-green CI result is historical and is superseded by the #1776 synchronization and later documentation commit; exact-head CI on `07c0b5f329bde96e883b06f6aad51f903e0a6ebe` is pending. The 28 historical order-history errors remain unattributed. Preserve the original archive and unknowns; do not invent the field or inspect the database dump without explicit authorization. Keep historical facts distinct from synthetic runtime fixtures. Keep PR #1761 draft/unmerged; no TESTNET/LIVE writes or account mutations. Report evidence, unknowns, commit message, tests, CI, and the next single action at every checkpoint.
}

## 2026-11-23 — continuation handoff

- Issue #1362 / PR #1761 remain active; PR #1761 remains draft.
- Internal sync PR #1784 merged the latest `develop@99caf7d9026e47908b54799a618bbe2f2f699c05` into the task branch using merge commit `5eaf4612673d4b8d3d15290788f103119e90fb39`. The branch was 76 ahead / 4 behind before the merge; re-check the exact comparison after the merge.
- The merge brought two overlapping-path changes: `apps/harvester/docs/domain/DOMAIN_TEST_INVENTORY.md` and `apps/harvester/src/use-cases/reconcile-terminal-order-fills.test.js`. Review the merged regression and inventory update before continuing.
- The prior all-green exact-head CI checkpoint was `842b502`; it does not certify later commits. Run all applicable CI on the current task head.
- Historical root cause for the 28 order-history failures remains unknown. Do not inspect the database dump without explicit authorization.
- Keep PR #1761 draft; update issue and PR after every implementation commit.


## 2026-11-23 continuation — latest develop sync and exact-head CI

- Current task branch head: `07c0b5f329bde96e883b06f6aad51f903e0a6ebe`.
- Merge commit `d963dfc2e0eb3fc02cbd9c25b08ae5b92ce61df9` has parents `0370feb2ef7083366ccec607b918770acfcd7313` and `c1c715dc1b9b821d87d0a25e903c88c61e91ed3a` (current develop at synchronization). It incorporates the #1776 exact-decimal bootstrap/replay changes while preserving #1362 archive evidence.
- The 0370feb2 exact-head CI run passed Harvester Targeted Tests, Unit Tests, Coverage, Dependency Audit and External Documentation Links; Repository Quality failed only on maintained Markdown formatting in `error-vocabulary.md` and Harvester `ROADMAP.md`. The latter defects were corrected in `07c0b5f`.
- Exact-head CI for `07c0b5f` is pending; no final green claim is made.
- The 28 historical `HARVESTER_ORDER_HISTORY_RECORD_INVALID` events remain unattributed. The selected terminal log does not include field/stage. The 96 MB cumulative Harvester and 97 MB trace files are present in the archive, but the repository connector cannot return their contents because of file-size limits; no database dump was inspected. Continue with bounded non-database evidence if another accessible source becomes available.
- No TESTNET/LIVE writes, account mutations, archive rewrites, or restart-restoration changes.
