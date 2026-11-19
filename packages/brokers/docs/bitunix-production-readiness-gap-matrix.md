# Bitunix Spot production-readiness gap matrix

**Baseline:** `develop` as inspected on 2026-11-19
**Tracking:** [Issue #1185](https://github.com/45s/coinzilla/issues/1185)
**Scope:** `@coinzilla/brokers` implementation and the separately owned Harvester admission boundary.

This is an evidence-oriented snapshot, not a declaration of production readiness. “Implemented” means the repository contains the behavior and deterministic tests; it does not mean live exchange connectivity or exchange-side guarantees have been verified.

## Gap matrix

| Area | Current implementation | Required production behavior | Remaining gap / classification | Evidence and next verification |
|---|---|---|---|---|
| Authentication | REST request signing and authenticated WebSocket RPC signing exist. | Match official signing inputs, nonce/timestamp rules, and permission failures. | **Implemented; live verification outstanding.** | REST and WebSocket contract tests; run credentialed local diagnostics without exposing secrets. |
| REST client | Signed/public GET and POST, timeout, response validation, structured errors, lossless numeric parsing for selected financial endpoints. | Complete request semantics, safe outcome classification, bounded retry policy and rate-limit behavior. | **Implemented but acceptance incomplete.** No verified general retry/rate-limit policy established by this audit. | Expand endpoint fixtures from official docs; test 429/5xx and ambiguous mutation outcomes before enabling mutations. |
| Market metadata | Public pair catalog, canonical `Market`, raw symbol-filter metadata and validation. | Exchange-accurate tick/step/min/max/notional constraints. | **Partial.** Precision counts/lists are preserved, not converted into tick/step sizes; undocumented maxima are not inferred. | Obtain authoritative field semantics; add exact decimal filter mapping and boundary tests only from confirmed rules. |
| Account / balances | Spot account balances normalized with exact free/locked decimal strings. | Fresh, timestamped account snapshot with documented consistency semantics. | **Partial.** Account endpoint supplies no source timestamp; canonical snapshot is explicitly unsupported. | Exchange clarification or documented timestamped alternative and freshness contract. |
| Positions | Spot account balance model. | Correct position model for supported product. | **Product-dependent.** Spot has no derivatives position concept; do not fabricate positions from wallet balances. | Define product scope before implementing positions; Futures requires a distinct verified product contract. |
| Order submission | Direct `createOrder()` uses signed single-order REST only. LIMIT base quantity is converted to quote volume exactly; MARKET sends base quantity. The returned order ID is verified through order detail. | Confirmed placement with stable client identity and recoverable unknown outcomes. | **Partially implemented.** The single-order REST units are documented and used; batch REST/WebSocket units differ and are not used. No caller-supplied client ID exists, so transport failures remain `OUTCOME_UNKNOWN` and require manual reconciliation. Canonical placement is unsupported. | PR #1464 merged as `daf151cc71615a3d09a0446fae4c1e560b8ae4dc`; exact-head workspace CI and Brokers tests/coverage passed. Live acceptance remains unverified. |
| Order cancellation | Signed single-order cancel followed by order-detail verification; `cancelAllOpenOrders({ symbol })` processes each symbol-scoped pending order independently. | Confirmed cancellation or reconciled unknown outcome, including fill/cancel races. | **Partially implemented.** Terminal canceled states are confirmed; fill/cancel races and lost acknowledgements remain unknown. Account-wide cancel-all is unsupported. | PR #1464 merged as `daf151cc71615a3d09a0446fae4c1e560b8ae4dc`; exact-head workspace CI and Brokers tests/coverage passed. Live acceptance remains unverified. |
| Order queries / history | Symbol-scoped pending orders, order detail, paginated history with validated filters. | Reliable identity, complete pagination and account-wide reconciliation where required. | **Partial.** No client-order-ID lookup; open/history calls require symbol; no verified account-wide enumeration. | Confirm documented pagination/filters and identity behavior; test boundary pages and races. |
| Fills / executions | Matching-order endpoint is mapped only as raw/legacy detail where safe; canonical fills remain unsupported. | One canonical record per execution, exact base/quote quantity, fee asset, stable unique ID and complete history. | **Blocked.** Quantity denomination, multi-execution completeness and stable execution identity are not established. | Obtain official schema clarification and compare with a maintained reference client before canonical fill support. |
| Public WebSocket | Authenticated request/response RPC client with correlated pending requests, timeouts and disconnect rejection. | Continuous market subscriptions, acknowledgements, heartbeat, reconnect and gap recovery. | **Partial.** RPC is not a stream; documented Spot methods do not establish continuous subscriptions. | Do not advertise streaming capability until official subscription contract and recovery semantics are verified. |
| Private WebSocket | Authenticated request/response RPC reads. | Continuous private order/execution events and account reconciliation. | **Blocked.** No documented continuous private Spot order/execution event stream established. | Written exchange confirmation or official protocol docs plus event fixtures and recovery contract. |
| Reconnection / recovery | RPC pending requests fail on disconnect; no replay is claimed. | Reconnect, re-authenticate, re-subscribe, reconcile missed state, fence stale events and gate mutations until recovered. | **Missing for a continuous Spot stream.** | Implement only after a real subscription/event and reconciliation source exists. |
| Error handling | Structured REST and WebSocket errors; exchange codes and unknown mutation outcomes are preserved at transport boundary. | Stable operation-level classification including permission, validation, rate limit and confirmed/unknown mutation outcomes. | **Partial.** Endpoint-specific classifications and live error mapping need verification. | Add official error fixtures and diagnostic checks; never retry unknown mutations automatically. |
| Rate limits | Request timeout and protocol error handling exist. | Documented per-endpoint limits, backoff and retry behavior without duplicate mutations. | **Unverified.** | Obtain current official limits; add deterministic 429/limit-window tests. |
| Broker adapter | `BitunixSpotBroker` extends existing `CoreBroker`; direct legacy REST `createOrder`, `cancelOrder`, and symbol-scoped `cancelAllOpenOrders` are implemented with explicit mutation outcomes. | Full account/order/fill/market-data lifecycle and truthful capabilities. | **Partial.** Canonical placement, canonical fills, timestamped account snapshot and continuous subscriptions remain unsupported. | Complete canonical execution/reconciliation guarantees before provider admission. |
| Harvester integration | No temporary Bitunix observer or partial provider registration remains. | Production adapter, account-specific instances, provider lifecycle and independent routing. | **Not admitted.** The complete broker contract is not yet met. | Revisit only after broker admission criteria in #1185 pass; preserve Binance behavior. |
| Diagnostics | Existing Bitunix diagnostic tooling is present in the repository. | Independently verify REST auth, private/public REST, metadata, WS RPC auth, acknowledgements, heartbeat/reconnect, rate limits and shutdown without mutations. | **Needs audit and live run.** This review did not execute local diagnostics or credentialed connectivity. | Inspect and run the existing script locally; no live order submission/cancellation. |

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
- Do not admit Bitunix to Harvester until canonical order identity, complete fills and recovery guarantees are implemented.
- Do not register Bitunix in Harvester until the complete broker adapter contract is satisfied.
- Do not claim live REST/WS connectivity from mocked tests or source inspection.

## Verification status of this snapshot

This matrix began as a source audit before PR #1464. The current branch adds deterministic offline tests for direct single-order REST placement and cancellation; GitHub CI is the verification source for those tests. No credentialed live REST calls, WebSocket sessions, or production mutations have been executed. Live exchange acceptance remains unverified.
