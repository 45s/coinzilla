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
| Recovery fact records | 49 | Sequence 0–48; all previous-fact-digest links consistent |
| Manifest records | 49 | Sequence 0–48; all previous-manifest-digest links consistent |
| Manifest commits | 49 | Each `lastCommittedDigest` matches the corresponding fact digest |
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

The log does not expose enough validation-field/context to attribute the invalid record. The source archive confirms recurrence, not the offending field or root cause. This is an investigation item, not a proven fix candidate yet.

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

- PR #1761 is open and draft.
- PR head before this documentation checkpoint: `01d6a21d1474a7a9befc72d08ea9d1166e12db48`.
- PR base: `ee5aeb24899c0ae058b822edc36bb6957e23baf7`.
- Current `develop`: `d44bdcff2bec920da2c35c99a874991baa87e97f`.
- Comparison against current `develop`: 39 commits ahead, 23 behind. The branch must be synchronized before further implementation/CI conclusions.

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

An earlier investigation compared the eight recorded instruction blob hashes with the exact task-start commit `a623b2c0d767adcceadcb31e673772d2191b178d` and found all eight matched. The first implementation commit followed 24 seconds later. The two canonical instruction files changed on `develop` afterward. Preserve the original report as historical evidence; do not rewrite it or weaken the validator. Resolve the validator's intended task-start-vs-current-base contract with a supplemental current-base attestation or a separately reviewed validator correction. Separately update the PR documentation-impact declaration to include all changed documentation paths.

## 5. Confirmed follow-up gaps already identified

These were identified in the prior investigation checkpoint and still require implementation/proof:

1. **Exact quote quantity:** runtime replay currently derives quote quantity from price × quantity instead of consuming the exact exchange-reported archived `quoteQuantity`. Pass the recorded field through the replay and assert it.
2. **Digest naming and fixture metadata:** fixture `lastDigest` conflates fact-chain and manifest-chain digests. Preserve distinct fact-chain and manifest-chain terminal digests and include redacted 49-record chain metadata so tests can verify all links and committed-digest correspondence.
3. **Test inventory accuracy:** domain inventory contains stale test paths, including a nonexistent `update-trading-accounting.test.js` reference. Reconcile every listed path with the actual tree and add the missing focused atomic-accounting regression.
4. **Late SELL composition proof:** the current late recovery SELL-after-pause integration test uses a stub accounting callback. Add a production-composition proof using real Portfolio and RecoveryLedger projections; coordinate the overlapping scenario-test requirements in #1763.
5. **Projection failure root cause:** inspect the remaining accessible cumulative log ranges and identify what validation context can be recovered. Do not infer the historical invalid field if source evidence is absent. If the database dump is required, request explicit authorization before inspecting it.

## 6. Prioritized continuation plan

1. **Synchronize PR branch with latest develop** (`d44bdcff2bec920da2c35c99a874991baa87e97f`); reconcile conflicts deliberately, especially roadmap, lifecycle audit, domain test inventory, and scenario-test docs. Re-run the comparison before editing.
2. **Restore Task Preflight compliance without falsifying history:** declare all changed documentation paths in the PR metadata; inspect validator semantics and task-start evidence; use a separately recorded supplemental current-base instruction attestation or a focused validator issue/PR. Do not edit the original task-start report.
3. **Fix replay fidelity:** pass exact archived `quoteQuantity` and commission amount/asset into production runtime replay; assert exact archived economics.
4. **Fix archive integrity metadata:** distinguish fact and manifest digest fields; verify all 49 fact/manifest records and chain links in automated tests.
5. **Close accounting proof gaps:** reconcile test inventory paths; add atomic Portfolio/RecoveryLedger regression; add real-composition late-SELL-after-pause proof; update #1763 with the overlap disposition.
6. **Investigate projection failures from source logs:** retrieve cumulative log ranges in bounded chunks, correlate timestamps with the 28 terminal failures and durable facts, and report what remains unknown.
7. **Re-run required gates on the final synchronized head:** focused Harvester integration tests, full workspace tests/coverage, strict changed-file ESLint, JavaScript quality/syntax, Task Preflight, actionlint, dependency audit, documentation links, and exact-head Actions verification.
8. **Keep PR #1761 draft and unmerged** until all acceptance criteria and exact-head required checks pass. No TESTNET/LIVE validation is authorized by this task.

## 7. Continuation prompt

Continue issue #1362 and PR #1761 from this branch. Read root and nested AGENTS.md files, AI_AGENT_WORKFLOW.md, the task-compliance standard, Harvester roadmap, lifecycle audit, accounting invariants, domain test inventory, and #1763 scenario-test guidance before changing source. Re-open this archive review and the immutable archive at the exact source commit above.

First synchronize with current develop and resolve the 23-commit divergence without dropping either side's documentation. Then fix the seven missing PR documentation-impact paths and resolve Task Preflight correctly: preserve the original task-start report, verify its hashes against the recorded task-start commit, and do not weaken or bypass policy. Implement the five follow-up gaps in section 5 test-first, one focused increment at a time, with source, integration tests, and living docs in the same commit. Investigate the 28 order-history projection failures from available archived log ranges; never invent the invalid field or inspect the database dump without explicit authorization. Keep historical facts distinct from synthetic runtime fixtures. Re-run all required exact-head checks after each meaningful increment and on the final head. Keep the PR draft/unmerged; no TESTNET/LIVE writes or account mutations. Report evidence, unknowns, commit message, tests, CI, and the next single action at every checkpoint.
