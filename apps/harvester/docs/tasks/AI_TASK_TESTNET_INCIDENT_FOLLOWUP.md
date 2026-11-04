# AI task — Harvester incident follow-up: lifecycle and account reconciliation

> **Prerequisite:** merge the source remediation in PR #513 first. This follow-up branch was created from `develop` before #513 merged; rebase/update it onto the new `develop` after #513 lands and before implementation or merge.
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

- [ ] All lifecycle/interleaving cases above have deterministic regression coverage.
- [ ] Portfolio and RecoveryLedger remain atomic and exactly-once across duplicate, partial, out-of-order, cancel/fill, and REST/stream overlap cases.
- [ ] Base/quote/third-asset commission behavior is explicit, correct, and tested.
- [ ] Fee policy callers and conservative reserve behavior are verified end to end.
- [ ] OPENING/CLOSING lifecycle and balance-audit failure modes are covered.
- [ ] A read-only audit of any available completed historical session is performed where valid opening/closing records exist; otherwise explicitly record that no eligible session exists.
- [ ] Future TESTNET runbook documents prerequisites and hard safety gates without executing them.
- [ ] Harvester focused tests, workspace unit tests, coverage thresholds, syntax/agent policy, workflow lint, and production dependency audit pass on the exact PR head.
- [ ] README, ROADMAP, and `docs/TRADING_FIRST.md` reflect verified outcomes and remaining TESTNET gates.
- [ ] Harvester remains stopped; no TESTNET order or account write operation is performed.

## First actions for the implementing agent

1. Wait for PR #513 to merge, then update this branch onto the resulting `develop`.
2. Inspect the merged PR #513 diff and current Harvester source/docs. Confirm which fixes and tests actually landed.
3. Build a concise evidence map from source functions to existing tests and identify only missing cases.
4. Run the current focused Harvester test suite before edits to establish a baseline.
5. Implement work packages in small, test-first slices. Re-run focused tests after each slice.
6. Update the roadmap with completed, failed, and still-open findings; keep the TESTNET gate closed.
7. Run all required CI on the exact final head and report results with workflow names and conclusions.

## Handoff prompt

Continue the Harvester incident follow-up in private GitHub repository `45s/coinzilla`, application `apps/harvester`, using branch `investigate/harvester-lifecycle-audit` and this task document. PR #513 is the prerequisite source-remediation PR; wait for it to merge, then update this branch onto the resulting `develop`. Do not recreate its fixes. Complete the deterministic lifecycle overlap matrix, end-to-end Portfolio/RecoveryLedger commission invariants, fee-policy caller audit, and OPENING/CLOSING balance-audit verification described above. Update README, ROADMAP, and `docs/TRADING_FIRST.md`, run focused and workspace tests plus all required CI, and provide a precise status of fixed/verified/unknown blockers. Harvester must remain stopped: do not restart it, submit/cancel TESTNET orders, or perform exchange write operations. Do not claim TESTNET readiness from offline CI alone.