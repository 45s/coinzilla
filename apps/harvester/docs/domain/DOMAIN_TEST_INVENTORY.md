---
title: Harvester domain logic test inventory
status: active
type: testing
owner: harvester
created: 2026-11-10
last_verified: 2026-11-10
---

# Harvester domain logic test inventory

## Purpose and scope

This is the source-driven inventory for deterministic tests under `apps/harvester/src/domain/`. It maps business responsibilities to existing tests, records test-quality risks, and sequences follow-up work. It does not define trading behavior; the [Conservative Domain Specification](CONSERVATIVE_DOMAIN_SPECIFICATION.md) remains authoritative.

Reviewed baseline: `develop` at `dcb0b64ece84ea2f3a41f5a110e559a01797ac6d` (2026-11-10, after PR #968). The domain tree contains 29 production JavaScript files and 27 domain test files. PR #917 is the first Harvester domain-source change after the PR #909 baseline; it corrected Conservative BUY gating after RED regressions.

All test improvements in this initiative must remain deterministic and offline. Issue [#626](https://github.com/45s/coinzilla/issues/626) and its user-data recovery implementation remain paused and outside this initiative.

## Existing behavior-to-test inventory

| Area | Existing test files | Behaviors already protected |
| --- | --- | --- |
| Account | `account/account-snapshot.test.js`, `account/calculate-account-snapshot-baselines.test.js`, `account/reconcile-account-snapshot-deltas.test.js` | Canonical balance snapshots, duplicate/missing/negative balances, quote cash-flow and total Portfolio base (active plus retained free)/BUY/SELL commitment baselines, shared-asset aggregation, unpriceable active BUY fail-closed behavior, market-asset coverage, exact per-asset delta reconciliation and invalid snapshot ordering |
| Fill identity and fees | `fills/fill-fingerprint.test.js`, `portfolio/portfolio.test.js`, `strategies/conservative/recovery-ledger.test.js` | Stable fingerprints across commission ordering; Portfolio rejects same-ID changed commission amounts; RecoveryLedger rejects same-ID changed commission assets; both preserve the complete accepted projection; complete fee data, fee assets, quote valuation and aggregate commission bounds |
| Market | `market-price.test.js`, `market/is-market-data-fresh.test.js`, `market/validate-market-trading-readiness.test.js` | Positive exact-decimal prices, symbol/timestamp validation, inclusive freshness boundaries, required exchange rules, order-type support, configured quantity and investment constraints |
| Orders | `orders/allocate-order-commitments.test.js`, `orders/create-pending-canonical-order.test.js`, `orders/order-registry.test.js`, `orders/validate-cancellation-eligibility.test.js`, `orders/validate-order-against-trading-rules.test.js` | Sequential BUY allocation, aggregate SELL limits, shared base/quote commitments, PENDING construction, broker/client identity, duplicate and stale reports, partial/terminal/UNKNOWN transitions, cancellation eligibility and exchange filters |
| Portfolio | `portfolio/portfolio.test.js`, `portfolio/position.test.js` | Immutable fill application, BUY/SELL accounting, base/quote/third-asset commissions, free inventory isolation, duplicate/conflicting fill identity, market isolation and recovery-basis reset |
| Conservative policy | `strategies/conservative/helpers.test.js`, `initial-buy-price.test.js`, `recovery-completion.test.js`, `recovery-completion.dust.test.js`, `recovery-fill-accounting.test.js`, `recovery-ledger.test.js`, `recovery-sell-plan.test.js`, `recovery-sell-plan-accounting.test.js`, `sell-fee-rate.test.js`, `strategy.test.js`, `trailing-buy-repricing.test.js` | BUY/SELL intents, duplicate suppression, recovery economics, fee reserves, exact tick/step rounding, actual fill accounting, dust/completion, residual sell-through and trailing price thresholds |
| Aggressive policy | `strategies/aggressive-strategy.test.js` | Current contract is explicitly non-executable: NO_ACTION blockers, active-position gating and exclusion of retained free inventory |
| Configuration | `trading-config.test.js` | Strategy/pair configuration validation and explicit TESTNET/LIVE mode selection |

The domain suite is supplemented by application-level engine and use-case tests for serialized lifecycle ordering, multi-market composition, cancellation/fill races and broker interaction. Those tests are not substitutes for pure domain-policy tests, but they provide distinct integration protection.

## Application-level orchestration coverage (supplemental; not included in the 26 domain test files)

`src/use-cases/conservative-trading-engine.test.js` contains **163 deterministic test declarations** at the reviewed baseline. The suite covers:

- Trailing BUY activation/repricing, active-Position suppression, retained free-inventory exclusion and cancellation/fill races.
- Partial BUY/SELL execution, duplicate and out-of-order execution reports, broker identity mismatches and REST/stream fact conflicts.
- Stale market-price handling, serialized concurrent updates and deferred evaluation while cancellation or acknowledgement is pending.
- Retryable versus terminal fill-history and pending-order lookup failures, unknown order states, and fail-closed integrity outcomes.
- Recovery SELL completion, residual/dust handling, commitment preservation and shutdown behavior.

### Generation isolation — no current contract

A source and test search found no generation identifier, generation-scoped state or generation transition guard in Harvester. Current asynchronous ordering is based on the serialized transition queue, market-price event identity/sequence, canonical order/fill identities and explicit stale/terminal checks. Therefore generation isolation is **not a currently defined behavior contract** and cannot be meaningfully tested without inventing new product semantics. Do not add generation architecture under this test-quality initiative; revisit only if an explicit generation model is introduced.

## Quality findings and priorities

### High — blocked recovery SELL must not be bypassed by a new BUY

Two decision-path defects are confirmed in `strategies/conservative/strategy.js`: (1) after recording `PRICE_FILTER_BLOCKED` for a required recovery SELL, the function continued into standing-BUY planning; and (2) an active recovery SELL in `PENDING` or `UNKNOWN` state suppressed duplicate SELL intent but still permitted a new BUY. The canonical specification permits the next standing BUY alongside an acknowledged OPEN/PARTIALLY_FILLED recovery SELL, not an unacknowledged or unresolved SELL.

RED evidence: PR #917 head `59003fc8ae6fafe6dc5f7528f3356adf03372cdc` ran the full Harvester suite with 870 passed / 2 failed (872 total). The MAX_PRICE failure showed an unexpected `NEXT_STANDING_BUY` at `0.099` for quantity `100`; the PENDING failure showed the same unexpected BUY. The PENDING/UNKNOWN regression is table-driven; its first PENDING assertion fails before the UNKNOWN row executes. The implementation on PR #917 now suppresses BUY intents for both unsafe states and for a `PRICE_FILTER_BLOCKED` required recovery SELL. The OPEN/PARTIALLY_FILLED matrix explicitly protects the approved coexistence behavior.

GREEN evidence on PR head `ffb611507b14efc87338f64521766fbdff9434b3`: the full Harvester suite passed 872/872; Harvester coverage passed at 75.80% lines, 79.05% branches and 74.86% functions; configured Harvester targeted tests passed. All six required checks passed: package unit tests, workspace coverage, JavaScript syntax/Markdown enforcement, Utils tests, production dependency audit and actionlint. The advisory external documentation link check also passed. The TESTNET integration probe was skipped; no exchange activity occurred. The coverage workflow measures Harvester coverage but skips a package-specific threshold enforcement step; no threshold was changed.

### High — assertion diagnostics are inconsistent

Many existing domain tests omit the detailed assertion messages required by `ENGINEERING_STANDARDS.md`. New tests and every materially edited test case must include messages that explain the business invariant and scenario. Existing tests will be improved incrementally with their owning test-quality changes; this initiative will not perform a broad mechanical rewrite.

### Medium — projection-level commission identity conflicts now protected

The Portfolio and RecoveryLedger regressions now prove that a reused Fill ID with changed commission amount or asset is rejected and that the complete original projection remains unchanged. The underlying fingerprint and projection guards were already correct; this closes a test-quality gap without production changes.

### Medium — expected arithmetic must remain independent

The Conservative residual-fill fixture and MAX_NOTIONAL assertion previously reused production `multiplyDecimal` for both setup and expected values. [PR #937](https://github.com/45s/coinzilla/pull/937) replaces those coupled expectations with independent exact values (98 × 0.11 = 10.78; 98.95 × 0.11 = 10.8845; 0.1 × 0.6 = 0.06). Exact final PR head `47d5a65bf40027f0a69cf8cfac006d0b17131211` passed 877/877 Harvester tests; coverage was 75.90% lines, 79.11% branches and 74.95% functions. All required workflows passed; the TESTNET probe was skipped. No production behavior changed. [PR #944](https://github.com/45s/coinzilla/pull/944) extends independent expectations to recovery SELL fee reserves, canonical SELL fill facts and exchange-constrained dust; it merged into `develop` at `865e078f60ed432bf068b33f281556e79146c5b7` after the synchronized head passed all required checks.

### Medium — capital-limit boundary assertions

The strategy regression uses a table-driven decision matrix: exact equality at 19.900 quote units (10.00 outstanding recovery + 9.90 next BUY notional) permits both the recovery SELL and next BUY; a limit of 19.899 blocks only the BUY; a materially lower limit of 15.00 also blocks only the BUY. The test compares the complete ordered action list and resulting `PLACE_ORDERS` decision, so the capital guard cannot accidentally suppress the recovery SELL. Added in [PR #922](https://github.com/45s/coinzilla/pull/922), merged to `develop` at `0d7112c92478cb3b3e1eca309a663b28d9687c7f`. Exact PR head `8e234e2c18cb98b4b8562c62ef05d9f20f852102` passed 872/872 Harvester tests, configured targeted tests, workspace unit tests and coverage, JavaScript syntax/agent policy/Markdown, actionlint, Utils tests, dependency audit, and advisory external-link checks. Harvester coverage was 75.94% lines, 79.26% branches, and 74.88% functions. The Harvester-specific threshold-enforcement step is not configured and was skipped; no threshold was changed.

### Medium — Portfolio multi-market isolation assertions are incomplete

The original Portfolio test reused the same broker trade ID for ETHUSDT and SOLUSDT but asserted only that two Positions existed. PR #924 now asserts market-scoped Fill IDs and exact independent Position quantity, quote cost basis and quote cash flow for both markets. It also proves a conflicting replay with changed execution facts is rejected without changing the existing Position accounting or applied fill IDs. Existing application-level tests already cover multi-fill Portfolio/RecoveryLedger atomicity and engine multi-market order isolation; those scenarios are not duplicated here. The exact final PR head `e3b61d0a0798f9a461ddbfc187f8753418c124dc` passed 874/874 Harvester tests (75.11% lines, 78.77% branches, 74.88% functions), workspace tests and coverage, targeted tests, Utils tests, syntax/agent policy/Markdown, actionlint, dependency audit and external documentation links. TESTNET probe skipped; no exchange activity occurred. PR #924 merged into `develop`; the final PR head passed all required checks.

### Medium — market trading-readiness boundaries are incomplete

The readiness policy checks configured quantity after rounding down to the exchange quantity increment and checks investment against MIN_NOTIONAL. Existing tests covered values below/above limits and a rounding-down example, but did not explicitly prove inclusive exact MIN_QUANTITY, MAX_QUANTITY and MIN_NOTIONAL boundaries. PR #930 adds deterministic equality/immediately-outside cases: exact MIN_QUANTITY and MAX_QUANTITY are accepted, below/above values are rejected after step rounding, exact MIN_NOTIONAL is accepted and 4.999 is rejected against a 5 minimum. Exact final PR head `984c555a80848bbcdc3e03872d9eb3bcad6bc83b` passed 878/878 Harvester tests (76.00% lines, 79.38% branches, 74.95% functions), workspace tests and coverage, targeted tests, Utils tests, syntax/agent policy/Markdown, actionlint, dependency audit and external documentation links. TESTNET probe skipped; no exchange activity occurred. PR #930 merged into `develop` after its updated head passed all required checks.

### Medium — exchange filter equality boundaries

[PR #932](https://github.com/45s/coinzilla/pull/932) adds exact inclusive MIN/MAX price, quantity and notional equality cases while retaining the existing immediately-outside rejection tests. Its final head `322225279c2b46af12cf317d71e0fa2cb5bcdd32` passed 878/878 Harvester tests (75.99% lines, 79.23% branches, 74.95% functions) and all required checks before merge.

### Medium — exchange filter equality boundaries need independent proof

[PR #932](https://github.com/45s/coinzilla/pull/932) adds exact inclusive equality for MIN/MAX price, quantity and notional while retaining the existing immediately-outside rejection matrix. [PR #929](https://github.com/45s/coinzilla/pull/929) adds independent numeric combinations so each filter equality is isolated from the other notional boundaries, and strengthens readiness assertions for exact MIN_NOTIONAL, quantity rounded down to MAX_QUANTITY, canonical Market binding and immutable supported-order metadata. The synchronized PR #929 head passed all six required checks and merged into `develop`.

### High — multiple UNKNOWN orders without broker IDs can collide during identity lookup

The audit in [issue #954, finding F-001](https://github.com/45s/coinzilla/issues/954) identified that `OrderRegistry.applyUpdate()` searches the registry for `brokerOrderId === undefined`. When two locally UNKNOWN submissions have no broker ID, the lookup can select the first order before checking the incoming client ID, producing a false cross-identity conflict for the second order. The single-order path is already supported by existing tests; the multi-order collision is not. [Issue #956](https://github.com/45s/coinzilla/issues/956) tracks the regression and minimal correction. RED was confirmed on PR #958 test-first head `16e45f09e4e973cbce43205de7bc5bac2c0d21bb`: Harvester unit tests reported 890 passed / 1 failed, and the failure was exactly `Order update brokerOrderId and clientOrderId identify different registered orders` at the new two-UNKNOWN regression. The production correction skips broker-ID lookup when the incoming broker ID is absent and resolves by the required client ID. The existing cross-identity mismatch test remains in place to ensure supplied conflicting IDs are still rejected. [PR #958](https://github.com/45s/coinzilla/pull/958) merged into `develop`; exact final head passed 891/891 Harvester tests, 76.04% lines, 79.43% branches and 75.02% functions, all six required checks, configured targeted tests and advisory external documentation links. No exchange activity occurred.

### Resolved — snapshot-relative account balances and active-order commitments (issue #955; PR #968)

At the audited baseline, [issue #954, finding F-002](https://github.com/45s/coinzilla/issues/954) confirmed that the allocator subtracted every active BUY/SELL commitment from exchange free balances even when those commitments were already reflected in the snapshot's locked/free split, and added current Portfolio base inventory even when it was already reflected in snapshot free base. This could double-reserve quote funds and hide a zero-free-base wallet shortfall. The defect is resolved by the snapshot-relative implementation merged in PR #968.

[Issue #955](https://github.com/45s/coinzilla/issues/955) defines the required snapshot-relative model: apply only post-snapshot quote cash-flow, total-Portfolio-base and order-commitment deltas to exchange free balances. Keep pair investment and pair-owned active-inventory limits independent. RED was confirmed on the first test-only head: the existing allocator subtracts the full 100-unit BUY commitment from 900 snapshot-free quote despite a 100-unit snapshot commitment baseline; it also allows a SELL when snapshot free base is zero because it adds the already-snapshotted Portfolio quantity. The production correction now captures Portfolio quote cash-flow, total Portfolio base quantity (active plus retained free), and active BUY/SELL commitment baselines by shared asset ID at the account snapshot boundary. The allocator adjusts exchange free balances only by the current-minus-baseline deltas. Retained-free allocation does not change total Portfolio base and therefore cannot change account-wide free base; the pair-level active inventory cap still excludes keepQuantity from strategy SELLs. A market BUY with no canonical limit price fails snapshot-baseline capture closed. The initial RED was 891 passed / 7 failed (898 total), with all seven failures matching missing snapshot-baseline behavior. A second RED then exposed that using active-only base quantity as the account baseline incorrectly treats `keepQuantity` allocation as a reduction in wallet holdings: 904 passed / 2 failed (906 total). The corrected contract uses `Position.totalBaseQuantity` (active plus retained free) for account-wide reconciliation while the separate pair active-inventory cap continues to exclude retained free quantity. The expanded matrix now covers pre/post-snapshot BUY and SELL commitments, partial BUY/SELL fills, shared quote and base assets, wallet shortfall, unpriced active MARKET BUY fail-closed behavior, terminal-order exclusion, and recovery event-sequence recapture. GREEN: the replacement PR #968 final head `d0d52dddb8f3c8d9e73f9f6dc484c6b3987e22f2` passed 914/914 Harvester tests; Harvester coverage was 75.80% lines, 79.23% branches and 75.19% functions. All seven configured workflows passed, including all workspace unit tests, all package coverage jobs, Harvester targeted tests, JavaScript syntax/actionlint, dependency audit and external documentation links. Read-only Binance TESTNET integration was skipped. No coverage threshold changed. All tests remain offline; no account queries or exchange operations were permitted. Issue #955 was closed after merge as `dcb0b64ece84ea2f3a41f5a110e559a01797ac6d`.

### Medium — lifecycle tests need complete-state assertions

The OrderRegistry suite already covered UNKNOWN, stale events, identity mismatch and late FILLED reports, but principal assertions were status-only or checked only remaining quantity. [PR #928](https://github.com/45s/coinzilla/pull/928) strengthens accepted partial-fill and late CANCELED/EXPIRED-to-FILLED transitions with exact original/executed/remaining quantities, broker/client identity, timestamps and active/terminal classification. It also proves earlier immutable snapshots remain unchanged and stale, duplicate or rejected conflicting updates preserve accepted state and commitment. PR #928 final head `96941960eb08349f043b2378c946fff980067ae6` passed 878/878 Harvester tests (75.96% lines, 79.38% branches, 74.95% functions) and all required checks before merge. [PR #927](https://github.com/45s/coinzilla/pull/927) adds explicit no-mutation assertions after decreasing-execution and stale-timestamp reports; its final head `84634d986bba3e1dc2cc72f1371d07dc0547db81` passed 879/879 Harvester tests (75.87% lines, 79.10% branches, 75.03% functions) and all required checks. PR #933 final head `e71aa2b5f0e8ff77f99d6fcffd9d9b904529795f` passed 879/879 Harvester tests (75.63% lines, 79.21% branches, 74.95% functions) and all required checks before merge.

### Medium — account snapshot reconciliation failures need precise diagnostics and immutability assertions

[PR #931](https://github.com/45s/coinzilla/pull/931) replaces production-derived fixture totals with exact literals and asserts precise errors, no partial result data, and unchanged opening/closing snapshots for invalid out-of-order, inconsistent, negative and duplicate-asset cases. Exact final PR head `137e56a44d134096d094c8aad6850a7ccc9d9876` passed 878/878 Harvester tests (75.96% lines, 79.28% branches, 74.95% functions) and all required checks. PR #931 merged; no production code changed.

### Explicitly deferred — Aggressive grid behavior

Aggressive is deliberately blocked by unresolved product rules. Its current NO_ACTION contract and inventory gate are tested. Do not invent grid depth, pricing, SELL thresholds, reservations or risk fallback as part of this testing initiative.

### Medium — engine-level multi-market fill identity is not tested with reused trade IDs

The multi-market engine suite tested separate symbols and duplicate replay, but its accounting stub deduplicated on raw `fill.tradeId` rather than canonical market-scoped `fill.id`. RED was confirmed on PR #933 test head `09fa07923b38eb757449d8347e4c6d5b77ef7f99`: the new same-trade-ID DOGEUSDT/SOLUSDT regression failed because only DOGEUSDT reached accounting; the second market's distinct Fill ID was suppressed by the fixture. The harness now deduplicates on `fill.id`, matching the production accounting contract. No production code changed; the synchronized PR #933 head passed all six required checks and merged into `develop`.

## Execution order

1. **Strategy decisions:** blocked-recovery-SELL gating, exact investment-cap boundaries and independent strategy fixture arithmetic are merged in PRs #917, #922 and #937.
2. **Portfolio and accounting:** PRs #924, #943, #944, #947, #948 and #949 are merged. Coverage includes exact multi-market accounting, Position conservation/failure immutability, independent recovery SELL expectations, multi-entry commission aggregation, multi-BUY RecoveryLedger cost mirrors and third-asset valuation boundaries.
3. **Order lifecycle:** PRs #927 and #928 merged complete-state, stale-report and immutable-snapshot assertions.
4. **Market and configuration:** PRs #929, #930 and #932 merged isolated equality values, readiness metadata immutability and exchange-filter boundaries.
5. **Domain failure handling:** PR #931 is merged. The 162-case Conservative engine suite covers retryable/terminal failures, integrity conflicts and stale/out-of-order asynchronous results. No generation identity exists in current source; see the explicit generation-isolation boundary above. Do not resume #626 or add runtime recovery behavior.

After each logical area, record exact test/CI evidence and remaining gaps here and in the Harvester roadmap. Mark work complete only after it is merged into `develop` and required checks pass.

## Verification baseline

The latest merged Harvester verification in this initiative is PR [#949](https://github.com/45s/coinzilla/pull/949), exact synchronized head `9300eaa114aed0ab805b7e2e44ff8b542aada58a`: all six required workflows passed, including workspace package tests, coverage, JavaScript syntax, actionlint, Utils tests and dependency audit. The read-only TESTNET integration probe was skipped; no exchange activity occurred. Earlier PR #917, #922 and #937 coverage figures above remain historical evidence.

The active `develop` ruleset requires six contexts: Run package tests, Workspace test coverage, Check JavaScript syntax, packages/utils tests, Audit production dependencies and actionlint. The Harvester coverage workflow measures coverage but does not enforce a Harvester-specific percentage threshold. Preserve all existing checks and thresholds; do not add a threshold without a measured baseline and meaningful enforcement design.
