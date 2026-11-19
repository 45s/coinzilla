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
| Order submission | Common broker methods exist and fail explicitly without sending requests. | Confirmed placement with stable client identity, exact quantity denomination and recoverable unknown outcomes. | **Blocked.** REST single-order and batch/WebSocket quantity descriptions conflict; no documented client-order identity was established. | Written Bitunix clarification and authoritative reference implementation; then deterministic request/response and reconciliation tests. |
| Order cancellation | Common method exists and returns explicit `NOT_SENT`. | Confirmed cancellation or reconciled unknown outcome, including fill/cancel races. | **Blocked.** No verified mutation reconciliation lifecycle. | Establish identity and authoritative post-cancel reconciliation before sending cancellation requests. |
| Order queries / history | Symbol-scoped pending orders, order detail, paginated history with validated filters. | Reliable identity, complete pagination and account-wide reconciliation where required. | **Partial.** No client-order-ID lookup; open/history calls require symbol; no verified account-wide enumeration. | Confirm documented pagination/filters and identity behavior; test boundary pages and races. |
| Fills / executions | Matching-order endpoint is mapped only as raw/legacy detail where safe; canonical fills remain unsupported. | One canonical record per execution, exact base/quote quantity, fee asset, stable unique ID and complete history. | **Blocked.** Quantity denomination, multi-execution completeness and stable execution identity are not established. | Obtain official schema clarification and compare with a maintained reference client before canonical fill support. |
| Public WebSocket | Authenticated request/response RPC client with correlated pending requests, timeouts and disconnect rejection. | Continuous market subscriptions, acknowledgements, heartbeat, reconnect and gap recovery. | **Partial.** RPC is not a stream; documented Spot methods do not establish continuous subscriptions. | Do not advertise streaming capability until official subscription contract and recovery semantics are verified. |
| Private WebSocket | Authenticated request/response RPC reads. | Continuous private order/execution events and account reconciliation. | **Blocked.** No documented continuous private Spot order/execution event stream established. | Written exchange confirmation or official protocol docs plus event fixtures and recovery contract. |
| Reconnection / recovery | RPC pending requests fail on disconnect; no replay is claimed. | Reconnect, re-authenticate, re-subscribe, reconcile missed state, fence stale events and gate mutations until recovered. | **Missing for a continuous Spot stream.** | Implement only after a real subscription/event and reconciliation source exists. |
| Error handling | Structured REST and WebSocket errors; exchange codes and unknown mutation outcomes are preserved at transport boundary. | Stable operation-level classification including permission, validation, rate limit and confirmed/unknown mutation outcomes. | **Partial.** Endpoint-specific classifications and live error mapping need verification. | Add official error fixtures and diagnostic checks; never retry unknown mutations automatically. |
| Rate limits | Request timeout and protocol error handling exist. | Documented per-endpoint limits, backoff and retry behavior without duplicate mutations. | **Unverified.** | Obtain current official limits; add deterministic 429/limit-window tests. |
| Broker adapter | `BitunixSpotBroker` extends existing `CoreBroker` and exposes the shared Broker API with explicit unsupported results. | Full account/order/fill/market-data lifecycle and truthful capabilities. | **Partial.** Mutations, canonical fills, account snapshot and continuous subscriptions remain unsupported. | Complete broker-owned guarantees first; keep unsupported methods explicit until then. |
| Harvester integration | No temporary Bitunix observer or partial provider registration remains. | Production adapter, account-specific instances, provider lifecycle and independent routing. | **Not admitted.** The complete broker contract is not yet met. | Revisit only after broker admission criteria in #1185 pass; preserve Binance behavior. |
| Diagnostics | Existing Bitunix diagnostic tooling is present in the repository. | Independently verify REST auth, private/public REST, metadata, WS RPC auth, acknowledgements, heartbeat/reconnect, rate limits and shutdown without mutations. | **Needs audit and live run.** This review did not execute local diagnostics or credentialed connectivity. | Inspect and run the existing script locally; no live order submission/cancellation. |

## Ordered implementation plan

1. **Close protocol evidence gaps first:** obtain authoritative Bitunix answers for single-order/batch/WebSocket volume units, client order identity, matching-order quantity and completeness, private Spot events, timestamps, and rate limits.
2. **Complete market constraints:** map only documented precision/filter fields to canonical trading constraints; retain unknown fields as unknown.
3. **Complete account and order read reconciliation:** source timestamps, pagination, identity and account-wide enumeration where officially supported.
4. **Complete canonical executions:** stable execution identity, exact quantity denomination, fee provenance and complete partial-fill history.
5. **Implement mutations:** placement/cancellation only after identity, quantity and unknown-outcome reconciliation are proven; add race/partial-fill/rejection tests.
6. **Implement continuous stream lifecycle:** only if Bitunix documents or confirms subscriptions; include reconnect and missed-event reconciliation before mutation gates can open.
7. **Complete broker admission and Harvester integration:** implement the full existing adapter/provider contract, account-specific instances and independent routing. No observer or fallback.
8. **Run local diagnostics and full CI:** separate mocked contract tests, testnet (if Bitunix provides one), and production connectivity diagnostics. Never use live mutations in automated tests.

## Non-negotiable safety boundary

- Do not infer `tickSize`, `stepSize`, maximum quantity, notional, or quantity denomination from precision counts or example values.
- Do not treat request/response WebSocket RPC as a subscription stream.
- Do not fabricate account timestamps, positions, fills, execution IDs or client order IDs.
- Do not send an order/cancel request when the result cannot be reconciled safely.
- Do not register Bitunix in Harvester until the complete broker adapter contract is satisfied.
- Do not claim live REST/WS connectivity from mocked tests or source inspection.

## Verification status of this snapshot

This document was prepared from repository source, tests and existing Bitunix contract/roadmap documentation. No local package tests, live REST calls, WebSocket sessions, credentialed diagnostics or production mutations were executed as part of preparing this snapshot. Those remain explicitly unverified.
