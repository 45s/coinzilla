# Bitunix Spot production-readiness gap matrix

**Baseline:** `develop` as inspected on 2026-11-19
**Tracking:** [Issue #1185](https://github.com/45s/coinzilla/issues/1185)
**Scope:** `@coinzilla/brokers` implementation and the separately owned Harvester admission boundary.

This is an evidence-oriented snapshot, not a declaration of production readiness. “Implemented” means the repository contains the behavior and deterministic tests; it does not mean live exchange connectivity or exchange-side guarantees have been verified.

## Gap matrix

## Ordered implementation plan

1. **Close remaining protocol evidence gaps:** obtain authoritative Bitunix answers for batch/WebSocket volume units, client order identity, matching-order quantity and completeness, private Spot events, timestamps, and rate limits. The single-order REST volume units are implemented from the current official REST contract.
2. **Complete market constraints:** map only documented precision/filter fields to canonical trading constraints; retain unknown fields as unknown.
3. **Complete account and order read reconciliation:** source timestamps, pagination, identity and account-wide enumeration where officially supported.
4. **Complete canonical executions:** stable execution identity, exact quantity denomination, fee provenance and complete partial-fill history.
5. **Complete mutations:** direct single-order REST placement/cancellation exists with conservative unknown outcomes; add canonical identity, reliable unknown-outcome recovery, exchange acceptance tests, and account-wide order enumeration only where officially supported.
6. **Implement continuous stream lifecycle:** only if Bitunix documents or confirms subscriptions; include reconnect and missed-event reconciliation before mutation gates can open.
7. **Complete broker admission and Harvester integration:** implement the full existing adapter/provider contract, account-specific instances and independent routing. No observer or fallback.
8. **Run local diagnostics and full CI:** separate mocked contract tests, testnet (if Bitunix provides one), and production connectivity diagnostics. Never use live mutations in automated tests.

## Non-negotiable safety boundary

- Do not infer `tickSize`, `stepSize`, maximum quantity, notional, or quantity denomination from precision counts or example values.
- Do not treat request/response WebSocket RPC as a subscription stream.
- Do not fabricate account timestamps, positions, fills, execution IDs or client order IDs.
- Never automatically retry an unknown order/cancel outcome; require manual or authoritative reconciliation.
- Keep `allowLiveOrderMutations` false by default; do not enable live mutations until an explicit authorization and safe acceptance plan exist.
- Do not admit Bitunix to Harvester until canonical order identity, complete fills and recovery guarantees are implemented.
- Do not register Bitunix in Harvester until the complete broker adapter contract is satisfied.
- Do not claim live REST/WS connectivity from mocked tests or source inspection.

## Verification status of this snapshot

This matrix began as a source audit before PR #1464. The current branch adds deterministic offline tests for direct single-order REST placement and cancellation; GitHub CI is the verification source for those tests. No credentialed live REST calls, WebSocket sessions, or production mutations have been executed. Live exchange acceptance remains unverified.
