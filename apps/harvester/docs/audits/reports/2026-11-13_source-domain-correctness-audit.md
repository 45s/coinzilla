# Harvester source and domain-correctness audit — 2026-11-13

**Status:** Implementation complete in [PR #1094](https://github.com/45s/coinzilla/pull/1094); merge pending.

**Target:** `develop`

**Scope:** `apps/harvester/**` and Harvester/project documentation only.

## 1. Baseline and review method

- Audited baseline: `develop` commit `9989fea9f77f9ce4b506d4658f2ff1ddef516d83`.
- Baseline Harvester inventory: 309 JavaScript files (162 production and 147 test files).
- PR inventory: 312 JavaScript files (164 production and 148 test files), including two new pure domain helpers and one focused helper test file.
- Domain inventory at the PR head: 35 production JavaScript files and 30 domain test files.
- Documentation read first: Harvester `AGENTS.md`, root and Harvester roadmaps, Conservative Domain Specification, architecture, accounting invariants, domain test inventory, Journal/durable-facts contracts, configuration and operator documentation, and the repository AI refactoring audit standard.

The review mapped bootstrap/public entry points, engine and order-event consumers, domain entities/policies, durable-facts and reconciliation boundaries, configuration and operational scripts, test suites, package commands, and CI gates. The deepest source review focused on accounting and recovery paths where an incorrect transition can change inventory, cost basis, fee reconciliation, or order ownership. The complete JavaScript inventory was enumerated; this report does not claim that every low-risk file received a line-by-line rewrite.

## 2. Findings and corrections

### H-001 — P1: Third-asset commission baseline was persisted after the fill

**Location:** `src/use-cases/create-portfolio-workflow.js`, commission baseline callback orchestration, and the account snapshot manager's targeted baseline publication.

**Evidence and impact:** The prior callback order appended `EXECUTION_FILL_APPLIED` before `COMMISSION_BASELINE`. Reconciliation needs the targeted fee-asset balance baseline to precede the first fee-bearing fill; reversing the sequence can make a valid fee appear to predate its baseline or leave the audit without a trustworthy starting balance.

**Correction:** Persist every required targeted commission-asset baseline before the durable execution-fill fact, then commit the in-memory Portfolio and RecoveryLedger projections. A baseline persistence failure remains non-blocking for a valid fill, but the later account audit fails closed if required evidence is missing.

**Regression:** `create-portfolio-workflow.durable-fills.test.js` asserts baseline-before-fill ordering and that both durable operations precede the in-memory accounting commit.

### H-002 — P1: Targeted commission-baseline facts accepted invalid snapshots

**Location:** `src/infrastructure/durable-facts/create-file-durable-facts-store.js`, `COMMISSION_BASELINE` fact validation.

**Evidence and impact:** The store accepted empty or multi-asset baseline snapshots and did not require the targeted audit to be complete. That weakens the durable accounting evidence needed to reconcile a third-asset commission.

**Correction:** Require a complete audit and exactly one fee-asset balance for a targeted commission baseline.

**Regression:** `account-reconciliation-facts.test.js` covers empty, multiple, and incomplete baseline evidence as well as the valid single-asset case.

### H-003 — P1: Recovery completion did not require canonical terminal SELL evidence

**Location:** `src/use-cases/create-portfolio-workflow.js`, `src/use-cases/record-recovery-cycle-completed.js`, `src/use-cases/record-recovery-cycle-not-completed.js`, and the new pure `src/domain/orders/assert-terminal-recovery-sell-order.js`.

**Evidence and impact:** Completion could be evaluated without a canonical terminal SELL when no durable recorder was configured. A profitability result or dust disposition alone is insufficient evidence that sell-through actually completed.

**Correction:** Require the exact `CanonicalOrder` for the same market, with SELL side, FILLED status, a non-empty broker order ID, and executed quantity exactly equal to original quantity. The same pure guard is used by the in-memory workflow and both durable recovery outcome recorders.

**Regression:** Recovery workflow and durable-cycle tests require the terminal SELL and retain its client/broker identity.

### H-004 — P1: Normal user-data SELL-fill path omitted the terminal order

**Location:** `src/use-cases/order-event-workflow.js`, terminal SELL completion call.

**Evidence and impact:** The normal execution-report path invoked recovery completion without forwarding its reconciled order. The cancellation/reconciliation and dust paths had their own completion calls, so the omission was specific to the ordinary SELL-fill path.

**Correction:** Forward the exact canonical terminal SELL order from the user-data transition. All three completion entry paths now preserve the same evidence contract.

**Regression:** `order-event-workflow.test.js` asserts the exact order is passed after terminal fill reconciliation; the start-harvester end-to-end scenario exposed the missing evidence before the fix.

### H-005 — P1: Fill accounting and recovery completion could race

**Location:** `src/use-cases/create-portfolio-workflow.js`, state-owning accounting transition queue.

**Evidence and impact:** Durable fill accounting and recovery completion used separate serialization boundaries. A completion could otherwise evaluate against an older Portfolio/RecoveryLedger projection while an earlier fill append was still pending.

**Correction:** Route both operations through the same queue. Completion waits for prior accepted fill transitions, stages both immutable projections, persists the cycle outcome, and only then commits the paired in-memory reset.

**Regression:** `create-portfolio-workflow.test.js` holds a durable fill callback open while requesting completion and verifies completion observes the updated accounting state.

### H-006 — P1: Exchange-constrained dust evidence was not fully validated

**Location:** `src/domain/strategies/conservative/recovery-completion.js`.

**Evidence and impact:** Negative evaluation values and invalid exchange-filter thresholds could be interpreted as exchange-constrained dust. That could authorize a retained-inventory allocation using invalid evidence.

**Correction:** Require positive exchange filter thresholds and reason-specific, non-negative evaluated quantity/notional evidence. Preserve the valid zero evaluated quantity case for `MIN_QUANTITY` when exchange-step rounding produces zero; rejecting that legitimate case would break existing strategy behavior.

**Regression:** `recovery-completion.dust.test.js` covers malformed negative evidence and valid zero-rounded quantity. The test-first run also caught and corrected an overly strict intermediate check that rejected valid zero evaluations.

### H-007 — P2: Timestamp boundaries accepted negative zero inconsistently

**Location:** `src/domain/market-price.js`, `src/domain/account/account-snapshot.js`, `src/domain/market/volatility-candle.js`, `src/domain/account/reconcile-account-snapshot-deltas.js`, `src/use-cases/confirm-market-history-coverage.js`, `src/use-cases/record-market-history-coverage.js`, and `src/use-cases/record-account-reconciliation-facts.js`.

**Evidence and impact:** JavaScript treats `-0` as a safe integer equal to zero. Several timestamp validators therefore accepted a non-canonical representation even though durable-fact serialization rejects negative zero.

**Correction:** Add the pure `isCanonicalNonNegativeSafeInteger` helper and use it at the domain and use-case boundaries. Zero remains valid; negative zero, negative, fractional, unsafe, and non-number timestamps are rejected before reconciliation or persistence.

**Regression:** The helper has direct unit tests. MarketPrice, AccountSnapshot, VolatilityCandle, account reconciliation, market-history coverage, and account-fact tests exercise the boundary behavior.

### H-008 — P2: Symbol configuration required an unused order mode

**Location:** `scripts/config-symbol/binance-client.js` and `scripts/config-symbol/configuration.js`.

**Evidence and impact:** Metadata parsing required both `LIMIT` and `LIMIT_MAKER` even though the selected commission policy uses only one: zero maker assumption requires `LIMIT_MAKER`; non-zero maker assumption uses `LIMIT`. This rejected symbols that support the configured mode but not an unused mode.

**Correction:** Preserve Binance's advertised order types during metadata retrieval and validate only the order mode selected by the pair's commission policy. The same file's nested scope ternary was replaced with a named pure scope resolver, and a missing control-flow block was corrected without changing behavior.

**Regression:** Configuration tests cover LIMIT-only metadata with non-zero maker assumption and rejection when zero maker assumption requires unavailable LIMIT_MAKER.

### H-009 — P2: Invalid configured environment silently fell back to TESTNET

**Location:** `scripts/config-symbol.js`.

**Evidence and impact:** Any explicit `TRADING_MODE` other than `live` was treated as TESTNET, including invalid values. That could generate exchange metadata-derived settings for a different environment than the operator intended.

**Correction:** Keep the documented TESTNET default when `TRADING_MODE` is unset; reject explicitly configured values other than `testnet` or `live` before making a metadata request.

**Regression:** A test sets `TRADING_MODE=paper` and asserts failure occurs before the metadata fetcher is called.

### H-010 — P2: Small exact quantities failed numeric config conversion

**Location:** `scripts/config-symbol/configuration.js`.

**Evidence and impact:** `String(Number(value))` can use exponent notation for small values (for example, `0.0000001` becomes `1e-7`). The decimal comparator did not accept that representation, so valid exchange-aligned retained quantities could be rejected.

**Correction:** Expand exponent notation to a plain decimal string before exact comparison. Precision-loss inputs still fail; valid small quantities remain numeric values in the existing app-config contract.

**Regression:** A pair-configuration test covers a (10^{-7}) retained quantity and the corresponding seven-digit exchange quantity precision.

### H-011 — P2: Market-history and account-baseline use-case branches lacked failure-path coverage

**Location:** `calculate-account-snapshot-baselines.test.js`, `confirm-market-history-coverage.test.js`, `read-market-history-coverage.test.js`, and `record-market-history-coverage.test.js`.

**Evidence and impact:** Several malformed-port, invalid-input, reconciliation mismatch, regressing-evidence, append, and readback branches lacked direct tests.

**Correction:** Add table-driven and focused tests for those failure paths without changing the established use-case behavior.

## 3. TDD evidence

Test-only commits were pushed before the corresponding production fixes. Confirmed RED runs included:

- `c27204d5730ed8e1f10c92274f996b4a99b2b77d`: targeted commission-baseline schema regressions failed against the prior store validator.
- `a807f33640e3a877a5894352464555d89cf962cb`: recovery completion and dust-evidence regressions exposed missing terminal SELL proof and invalid evidence handling.
- `33a59edf17c41bd0a0a4d35269060645ff02ddd6`: negative-zero timestamp regressions failed across the domain and recording boundaries before the shared guard was implemented.
- The start-harvester integration regression failed with a recovery-completion evidence error while terminal-order forwarding was incomplete; the final end-to-end scenario passes with the canonical order forwarded.

Some intermediate test-only workflow attempts were canceled by later branch pushes before producing a completed RED report; those are not represented as confirmed RED evidence. The final suite and required checks are verified on the final PR head.

## 4. Documentation updated

- Conservative Domain Specification: terminal SELL evidence and serialized completion contract.
- Architecture: the three recovery completion entry paths, shared accounting queue, durable baseline ordering, and shared canonical timestamp helper.
- Accounting invariants and domain test inventory: baseline shape/order, terminal SELL identity, timestamp canonicality, and new regression coverage.
- Harvester README: symbol-generator environment selection and commission-selected order mode.
- Harvester roadmap: source inventory, findings, tests, scope, and remaining style-only work.

## 5. Verification and safety

- Harvester unit suite: **1,511 passed, 0 failed**.
- Harvester coverage and workspace coverage workflows passed. The Harvester package does not currently enforce a package-specific percentage threshold; no coverage threshold was weakened or changed.
- Changed-file JavaScript lint/syntax and documentation-link checks passed on the verified PR head.
- All six required `develop` checks passed: Run package tests, Workspace test coverage, Check JavaScript syntax, packages/utils tests, Audit production dependencies, and actionlint.
- The optional read-only Binance TESTNET integration workflow was skipped.
- No Binance TESTNET/LIVE connection, account query, order placement, cancellation, or account mutation was performed.

## 6. Deferred work and limitations

- The repository's pre-existing style-only ESLint baseline is not mass-autofixed in this correctness PR. The earlier Harvester baseline is tracked in [issue #1092](https://github.com/45s/coinzilla/issues/1092); later workspace lint-rule changes mean that historical count should not be treated as a fresh current count.
- This PR does not claim every one of the 312 JavaScript files was rewritten. The full inventory was enumerated; high-risk accounting, recovery, market-data, durable-facts, configuration, and operational-script boundaries received the deep review. Remaining style-only cleanup should be handled in small, behavior-preserving changes with tests where behavior is touched.
- No strategy economics, trading configuration, shared package, other application, or exchange behavior was changed.
