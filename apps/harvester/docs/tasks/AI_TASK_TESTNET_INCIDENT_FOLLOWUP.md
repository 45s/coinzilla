# AI task — Harvester incident follow-up: lifecycle and account reconciliation

> **Branch state (2026-11-04):** PR #513 has been merged into `develop`. This follow-up branch has already been synchronized with that merge and is based on the resulting `develop` head. Do not repeat the prerequisite branch-update step unless `develop` advances again; before each push/merge, verify the branch is not behind `develop`.
>
> **Safety:** Harvester must remain stopped. Do not restart the process, submit/cancel TESTNET orders, change account settings, or perform any exchange write operation. This task is offline source investigation, deterministic tests, and read-only reconciliation only. A future TESTNET run requires a separate explicit operator authorization after all acceptance gates pass.

## Objective

Finish the verification work deliberately split out of PR #513. Do not reimplement fixes already delivered there. First inspect the merged source and docs, then close remaining lifecycle, accounting, fee, and account-audit gaps with evidence-backed tests and documentation.

## Known findings already resolved in PR #513

- The apparent `0.20730 USDT` difference was a scope mismatch: previous four recovery cycles total `+0.20730`; all five cycles total `+0.57065 USDT`. The `+0.36335` value was only the final cycle.
- Twelve DOGEUSDT BUYs were distinct exchange orders, not duplicate IDs. Journal ordering showed all twelve FILLED acknowledgements before the first corresponding execution fill was applied. The immediate-FILLED acknowledgement path now retrieves, validates, and applies complete canonical fill history before releasing the serialized strategy transition.
- Post-cycle residual active inventory alone no longer creates a recovery SELL after the RecoveryLedger is reset. Invalid strategy order validation pauses the pair.
- Recovery SELL fee reservation uses the greater of configured maker/taker rates.
- Durable OPENING/CLOSING all-account snapshots, fail-closed Journal readiness/flush, and read-only per-session `journal:balance-audit` tooling are implemented.
- Historical exchange fills reported zero commission. The later account-level 0.1% maker/taker setting is not retroactive.

Treat these as established context, but verify current merged implementation rather than trusting this summary blindly.

## Work packages

### 1. Complete deterministic lifecycle/interleaving matrix

Inspect the current engine, event queue, order registry, broker adapter, and reconciliation code. Add focused deterministic tests for:

- Streamed non-terminal acknowledgement followed by partial TRADE updates and terminal FILLED.
- Multiple partial fills with exact cumulative quantity and quote-quantity reconciliation.
- Duplicate identical fill delivery (idempotent, exactly once).
- Conflicting duplicate fill IDs (fail closed, no partial accounting).
- Out-of-order order updates and stale cumulative quantities.
- Cancel/fill overlap, including a fill arriving while cancellation is in flight and after cancellation acknowledgement.
- Concurrent market-price events while BUY/SELL acknowledgement or fill reconciliation is pending.
- REST/stream overlap where fills arrive during REST history retrieval.
- REST history behind stream state, missing previously processed fill IDs, incomplete history, and conflicting order identity.
- Shutdown while reconciliation or an order outcome is pending; ensure closing audit is incomplete and shutdown does not falsely claim safety.

For every test assert Portfolio, RecoveryLedger, order registry, pause state, published events, and broker calls—not merely the returned result. Use deferred promises/barriers, not sleeps or timing-dependent tests.

### 2. Verify complete accounting invariants

Trace actual fill application end to end through normalized Fill, Portfolio, RecoveryLedger, Journal DTOs, and cycle completion.

- Quote-asset commission: exact BUY cost / SELL proceeds and recovery obligation adjustment, exactly once.
- Base-asset commission: exact net received BUY quantity and SELL inventory consumption.
- Unsupported third-asset commission: reject atomically and pause safely; never partially update projections.
- Missing, malformed, or unknown commission status: fail closed where net accounting cannot be established.
- Duplicate and replayed executions: no double counting in Portfolio, RecoveryLedger, or Journal.
- Per-fill deltas sum exactly to per-cycle values; per-cycle values sum to session totals.
- Recovery cycle reset, `keepQuantity` allocation, residual active quantity, and next legitimate BUY reference remain consistent.
- Compare gross exchange cash flow, actual commissions, Portfolio signed quote cash flow, RecoveryLedger cost/proceeds, and realized profit using exact decimal arithmetic.

Do not assume historical commissions that were not recorded. Keep the historical zero-commission evidence separate from the later 0.1% account setting.

### 3. Audit fee policy end to end

- Enumerate every caller of the SELL fee calculator and verify makerPercent/takerPercent are passed from the validated pair configuration.
- Confirm the conservative worst-case rate is used before execution when maker/taker role is not guaranteed.
- Verify fee coverage for quote/base commission assets and unsupported third-asset behavior.
- Add exact boundary tests for price/quantity tick rounding, minimum notional, minimum quantity, and net-profit guarantee under both maker and taker rates.
- Verify no stale maker-only test or docs claim remains.
- Do not change the configured 0.1% rate based on assumption; only actual exchange execution commission is authoritative.

### 4. Verify account-level OPENING/CLOSING audit

- Inspect startup ordering: user-data subscription/barrier, OPENING snapshot capture and durable flush, engine activation, then market subscriptions.
- Inspect shutdown ordering: stop intake, drain accepted user-data work, reconcile owned orders, capture/flush CLOSING while broker REST is connected, then disconnect.
- Verify INCOMPLETE reasons for unresolved orders, failed reconciliation, event intake failures, and accounting uncertainty.
- Verify per-session pairing, duplicate/missing OPENING/CLOSING detection, exact free/locked/total deltas, appearing/disappearing assets, deterministic asset ordering, and read-only CLI exit codes.
- Do not treat account-wide wallet balances as Harvester-owned Portfolio state.
- The historical incident Journal predates OPENING/CLOSING snapshots; it cannot supply the missing opening baseline.

### 5. Future controlled TESTNET acceptance plan — documentation only

Do not execute this package in this PR. Prepare a safe runbook for a separately authorized future session:

- Verify the account-level 0.1% maker/taker setting is effective and record when verified.
- Capture a durable OPENING snapshot.
- Establish a clean ownership boundary for Harvester orders/trades versus pre-existing account assets and external activity.
- Run only the explicitly approved controlled scenario.
- Capture a durable CLOSING snapshot and run `journal:balance-audit`.
- Reconcile every trade ID, order ID, gross quote quantity, actual commission amount/asset, and external transfer/deposit/withdrawal.
- Verify balance deltas, Portfolio, RecoveryLedger, cycle profit, and Journal totals agree.
- No automatic restart, order submission, or cancellation from this task.

## Required engineering approach

- Work only in this follow-up branch and PR; do not modify PR #513 after it merges.
- Preserve established strategy behavior. Treat source differences from the documented strategy contract as implementation gaps unless a concrete ambiguity materially changes financial exposure.
- All functions use one object input and one object output.
- Return results through `@coinzilla/utils` `toResult`.
- Prefer pure helpers, exact decimal arithmetic, dependency-light modules, explicit public APIs, and tests adjacent to pure modules.
- Validate all external broker responses at the boundary.
- Do not add dependencies where native Node.js is sufficient.
- Do not log raw exchange payloads, credentials, signed requests, or secrets.
- Keep README, ROADMAP, and `docs/TRADING_FIRST.md` aligned with verified implementation only.
- Do not mark a test or investigation complete without running it and inspecting its result.
- Keep the PR focused; if an independent issue emerges, record it with evidence and split it rather than expanding scope without limit.

## Acceptance criteria

- [x] All lifecycle/interleaving cases above have deterministic regression coverage, including immediate FILLED, streamed partials, duplicate/conflicting/out-of-order events, cancel/fill races, REST/stream overlap, pending acknowledgements/cancellations, and shutdown reconciliation.
- [x] Portfolio and RecoveryLedger remain atomic and exactly-once across duplicate, partial, out-of-order, cancel/fill, and REST/stream overlap cases; multi-fill, cycle-profit, and per-session reconciliation tests pass.
- [x] Base/quote commission behavior and unsupported third-asset commission rejection are explicit and tested, including combined base/quote fees and replay atomicity.
- [x] Fee policy callers and conservative reserve behavior are verified end to end; maker/taker percentages are validated in [0,100), USDT pairs reflect 0.1%/0.1%, and FDUSD pairs retain the configured zero-maker policy with 0.1% taker.
- [x] OPENING/CLOSING lifecycle and balance-audit failure modes are covered, including duplicate/malformed endpoints, reconciliation failure, and OPENING/CLOSING durability failure.
- [x] Historical-session eligibility was reviewed: the incident Journal predates OPENING snapshots, so no eligible historical session exists for an actual opening/closing delta audit.
- [x] TESTNET runbook prerequisites and hard safety gates are documented without executing them.
- [x] Exact final head passed Harvester 387/387, workspace tests/coverage, Utilities tests, JavaScript syntax, workflow lint/actionlint, and production dependency audit after the latest documentation-only update.
- [x] README, ROADMAP, and `docs/TRADING_FIRST.md` reflect verified outcomes and remaining TESTNET gates.
- [x] Harvester remains stopped; no TESTNET order or account write operation has been performed.

## First actions for the implementing agent

1. Verify PR #513 remains merged and this branch includes the current `develop` head; synchronize only if `develop` has advanced.
2. Inspect the merged PR #513 diff and current Harvester source/docs. Confirm which fixes and tests actually landed.
3. Build a concise evidence map from source functions to existing tests and identify only missing cases.
4. Run the focused Harvester test suite before edits to establish a baseline. If local execution is unavailable, state that limitation and use a pushed, isolated CI run as the verification gate for each small commit.
5. Implement work packages in small, test-first slices. Re-run focused tests after each slice; do not mark a slice complete until its exact commit's CI has passed.
6. Update the roadmap with completed, failed, and still-open findings; keep the TESTNET gate closed.
7. Run all required CI on the exact final head and report results with workflow names and conclusions.

## Handoff prompt

Continue the Harvester follow-up in private GitHub repository `45s/coinzilla`, application `apps/harvester`, branch `investigate/harvester-lifecycle-audit`, PR #515. PR #513 is merged. The offline lifecycle, Portfolio/RecoveryLedger, fee-policy, and OPENING/CLOSING audit acceptance work is implemented and covered by tests; do not redo completed work. First verify the latest exact-head CI after the documentation updates. Then synchronize this branch with the current `develop` head before merge; intervening develop commits are broker-package and coverage-workflow changes, not Harvester changes. The available GitHub connector cannot perform the branch update, so use GitHub's PR **Update branch** operation if necessary. Keep PR #515 draft until synchronized and exact-head CI is green. Harvester must remain stopped: do not restart it, submit/cancel TESTNET orders, change account settings, or perform exchange writes. After the offline PR is merged, stop and coordinate a separate controlled TESTNET session with the user; offline CI is not TESTNET readiness.

## Verified implementation status — 2026-11-04

- Latest fully green code head: `test(harvester): reject late partial fill after cancel` (Harvester 387/387; all required workflows passed).
- The latest documentation-only update has passed exact-head CI.
- PR #515 remains draft. `develop` has advanced with unrelated broker-package and coverage-workflow changes; the follow-up branch must be updated before merge.
- No TESTNET writes were performed. Harvester remains stopped. Controlled TESTNET validation is explicitly reserved for the user and assistant together.

## Final offline verification — 2026-11-04

- Final exact-head Harvester suite: 387/387 passed, 0 failed.
- Workspace test coverage: passed, including all package coverage enforcement steps.
- Utilities unit tests: passed.
- JavaScript syntax: passed.
- Workflow lint/actionlint: passed.
- Production dependency audit: passed.
- No Harvester process was started and no TESTNET writes were performed.
- Remaining work is operational only: update the PR branch onto the latest `develop`, merge the offline follow-up when synchronized, then conduct the separate controlled TESTNET session together.
