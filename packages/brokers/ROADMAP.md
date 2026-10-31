# Binance Broker Roadmap

> **Agent entry point:** When asked to implement, improve, audit, or maintain `/packages/brokers`, read this file first and follow it as the package-level source of truth. Start with **Current status and next action**, then complete the mandatory pre-work checks before changing code. Do not rely on chat history or assume earlier findings are still current.

**Package:** `@coinzilla/brokers`  
**Repository:** `45s/coinzilla`  
**Long-lived integration branch:** `migration/binance-native-ws`  
**Scope:** broker package, broker tests, required root dependency metadata/lockfile changes, and broker documentation.

This roadmap is intentionally detailed. It contains the architecture, verified decisions, compatibility contract, phased implementation plan, test requirements, branch synchronization policy, and agent working rules for the broker package. Update it whenever implementation evidence changes a decision or phase status.

---

## 1. Mission and definition of done

### Mission

Replace the Binance broker's third-party SDK-backed runtime with a carefully tested native Node.js implementation, while preserving the existing public broker contract and consumer behavior.

The target is **zero third-party runtime dependencies in `@coinzilla/brokers`**. Internal workspace dependencies such as `@coinzilla/entities` and `@coinzilla/utils` may remain when needed; they are not third-party dependencies.

Use WebSockets for supported Binance operations:
- **Binance Spot WebSocket API:** request/response operations, including orders, account information, order/trade history, symbol metadata, and authenticated user-data subscription/events.
- **Binance Spot WebSocket Streams:** public market-data push streams.

Do not build a new REST trading client. Move symbol-filter retrieval from REST to the WebSocket API's `exchangeInfo` method. Existing custom REST broker code is legacy: deprecate it, do not expand it, and remove it only after compatibility and consumer checks prove removal is safe.

### Non-goals and hard scope boundaries

- Do not add trading strategy or bot product features.
- Do not modify `apps/bot-free-roll` or any other bot application code as part of this migration. Bot source may be inspected read-only to verify the consumer contract.
- Do not add another third-party WebSocket package as a shortcut.
- Do not add credentials, Ed25519 keys, or a new authentication setup for the current HMAC signature-subscription flow.
- Do not remove public exports or change consumer-facing method/event/result shapes without an explicit compatibility decision supported by repository-wide consumer checks.
- Do not claim completion based only on code being present or tests starting. Require verified exit criteria and checks on the exact commit.

### Definition of done

The migration is complete only when all of the following are true:

1. The supported broker path has no third-party runtime dependency; manifests, lockfile, source imports, and production dependency audit agree.
2. Existing supported public exports, method signatures, result shapes, normalized decimal strings, and event callback contracts remain compatible, or any deliberate breaking change has an explicit approved migration plan.
3. WebSocket API RPC and public WebSocket Streams are separate, well-defined clients with explicit lifecycle and error behavior.
4. User-data subscription uses the verified compatible API method on the WebSocket API connection.
5. State-changing requests are never blindly replayed after uncertain disconnects.
6. Deterministic unit tests cover transport, RPC, stream lifecycle, broker adaptation, and failure/recovery paths. Opt-in testnet tests provide a separate live-protocol verification layer.
7. Supported Node.js runtime requirements are declared and tested.
8. No bot application files were changed by this migration.
9. All required CI checks pass on the exact final PR head, and the integration branch is synchronized with current `main`.
10. This roadmap and the contract audit describe the implementation that actually shipped.

---

## 2. Current status and next action

### Overall status

- [x] Phase 0 — contract and dependency inventory.
- [x] Phase 1 — characterization tests and reusable deterministic test seams; PR #256 merged into `migration/binance-native-ws`.
- [x] Phase 2 — native WebSocket transport; PR #261 merged into the integration branch (merge commit `8397d6bb494d28b5f357fdaa663358e3a4128002`).
- [x] Phase 3 — WebSocket API RPC client; PR #263 merged into `migration/binance-native-ws` (merge commit `cdc2333fdf43e84d4cba2a0814e905472a558b70`).
- [x] Phase 4 — public WebSocket Streams client; PR #265 merged into `migration/binance-native-ws` (merge commit `b8daae9a5d7df6dd081de8537783ce3976ab7b39`).
- [x] Phase 5 — rebuild the broker on native clients; PR #271 merged into `migration/binance-native-ws` on 2026-10-31 (merge commit `a0ec1e64609c2291342f4470e203b453e0935c51`).
- [ ] Phase 6 — user-data session lifecycle and recovery (Phase 6A merged; Phase 6B in progress).
- [ ] Phase 7 — remove the SDK and retire legacy REST implementation.
- [ ] Phase 8 — operational hardening and completion.

### Next action

1. Phase 5 is merged (PR #271, merge commit `a0ec1e64609c2291342f4470e203b453e0935c51`).
2. Main synchronization PR #279 is merged at `f7566726b3f42b28db6bdc7556cf4a3dcae866fe`.
3. Phase 6A is merged via PR #285 at `244508790402d0044f9e880799db3c0088822448`; its exact PR head `361e0184f1d6059c63e17544e738a1e8fd90faec` passed all five CI workflows.
4. Re-reviewed `main` through `bdb214390a094bdf5dbcb2ef439245199f4e8f48`. Six commits since `46ffd669d064e8e33f6ed59e31cc9d70d93150f5` update the repository PR template and bot-only documentation. No broker/API/consumer-contract/runtime/dependency change requires synchronization. The PR #288 description follows the updated template; do not import unrelated bot-only work into the broker branch.
5. Phase 6B implementation branch: `migration/binance-phase-6b-user-data-reconnect`, based on integration commit `244508790402d0044f9e880799db3c0088822448`.
6. Preserve HMAC `userDataStream.subscribe.signature`; do not introduce Ed25519 credentials or the Ed25519-only `userDataStream.subscribe` flow.
7. Binance permits one subscription per account per WebSocket API connection. Keep one remote subscription and fan out locally; reconnect creates a new connection and subscription ID.
8. A re-established stream does not replay missed events. Keep order placement fail-closed until a consumer explicitly acknowledges reconciliation; successful resubscription is not proof that missed account/order history was reconstructed.


**Do not skip the next-action checklist because a previous chat said a phase was complete. Verify branch state and current files.**

---

## 3. Verified baseline and compatibility contract

The detailed Phase 0 inventory is maintained in [`docs/brokers-websocket-contract.md`](../../docs/brokers-websocket-contract.md). Re-read it and re-check current source/consumers before implementation; this section summarizes the decisions agents must preserve.

### Dependency inventory

- `packages/brokers/package.json` currently declares `@binance/spot` as a third-party runtime dependency (audited version range `^34.0.3`; lockfile version `34.0.3`).
- Internal workspace dependencies `@coinzilla/entities` and `@coinzilla/utils` may remain if still required.
- Removing an import is not enough. Update the package manifest and lockfile, then inspect the production dependency tree and run the repository dependency audit.
- Re-run a repository-wide search for `@binance/spot` before final removal.

### Public package exports to preserve initially

The current `packages/brokers/src/index.js` exports:

| Export | Current source | Initial compatibility decision |
|---|---|---|
| `BinanceSdkBroker` | `binance/broker-sdk/broker.js` | Preserve the exported name while replacing internals. A rename needs a separate consumer migration decision. |
| `BinanceSdkConfig` | `binance/broker-sdk/binance-sdk-config.js` | Preserve the exported name initially; remove SDK-derived constants while keeping equivalent validated configuration. |
| `BinanceBroker` | `binance/broker/broker.js` | Legacy custom REST broker. Deprecate; do not expand; remove only after usage checks. |
| `BinanceStreamClient` | `binance/websocket-stream/stream-client.js` | Existing custom Streams client is incomplete. Its exported methods require a preserve/deprecate decision. |
| `wsEventsMap` | `binance/websocket-stream/adapters/index.js` | Preserve unless consumer search proves it unused and removal is explicitly planned. |
| `CoreBroker` | `broker.core.js` | Preserve shared base-class contract. |

### Current repository consumer

The Phase 0 audit found `apps/bot-free-roll` as the only workspace package declaring `@coinzilla/brokers`. Its source is read-only during this migration.

The audited bot calls:
- `connect()` and `disconnect()`.
- `subscribeForUserData({ onEvent })`.
- `subscribeForPrices({ symbol, onPrice })`.
- `getSymbolFilters({ symbol })`.
- `createOrder(input)`.
- `cancelOrder({ symbol, orderId })`.
- `getMyTrades({ symbol, orderId, limit })`.

Compatibility includes the existing Promise/result behavior, callback payload shape, symbol casing, client order ID mapping, order defaults, normalized order/fill fields, and exact decimal strings for quantity, price, commission, and commission asset. Re-inspect the consumer and broker adapter tests before changing any of these assumptions.

Other SDK broker methods remain compatibility candidates even if the current bot does not call them:
- `getAssets()`
- `getOpenOrders({ symbol? })`
- `getOrder({ symbol, orderId })`
- `getOrderHistory({ symbol, orderId?, limit? })`
- `cancelAllOpenOrders({ symbol })`
- `getPrices({ symbol })`

Do not silently drop public methods because one current consumer does not call them.

### Broker method to Binance operation map

| Broker method | Binance Spot WebSocket API method | Security class |
|---|---|---|
| `getAssets()` | `account.status` | USER_DATA, signed |
| `getOpenOrders({ symbol? })` | `openOrders.status` | USER_DATA, signed |
| `getOrder({ symbol, orderId })` | `order.status` | USER_DATA, signed |
| `getOrderHistory(...)` | `allOrders` | USER_DATA, signed |
| `getMyTrades(...)` | `myTrades` | USER_DATA, signed |
| `createOrder(input)` | `order.place` | TRADE, signed |
| `cancelOrder(...)` | `order.cancel` | TRADE, signed |
| `cancelAllOpenOrders({ symbol })` | `openOrders.cancelAll` | TRADE, signed |
| `getPrices({ symbol })` | `ticker.price` | Public |
| `getSymbolFilters({ symbol })` | `exchangeInfo` | Public |

Verify exact current parameters, response envelopes, signing rules, rate limits, and error codes against official Binance documentation during implementation. This table is a starting map, not permission to guess undocumented behavior.

### Existing public Streams inventory

The old exported `BinanceStreamClient` exposes these stream methods, which need an explicit preserve/deprecate decision:

| Method | Stream name |
|---|---|
| `trade({ tickets })` | `<symbol>@trade` |
| `kline({ tickets, interval })` | `<symbol>@kline_<interval>` |
| `miniTicker({ symbol? })` | `<symbol>@miniTicker` or `!miniTicker@arr` |
| `ticker({ symbol? })` | `<symbol>@ticker` or `!ticker@arr` |
| `rollingWindowTicker({ windowSize, symbol? })` | `<symbol>@ticker_<windowSize>` or `!ticker_<windowSize>@arr` |
| `bookTicker({ symbol })` | `<symbol>@bookTicker` |
| `partialBookDepth({ symbol, levels, speed })` | `<symbol>@depth<levels>@<speed>` |
| `diffBookDepth({ symbol, speed })` | `<symbol>@depth@<speed>` |
| `aggTrade({ tickets })` | `<symbol>@aggTrade` |
| `userData()` | Legacy REST listen-key path; do not confuse with the current SDK broker user-data subscription. |

The audited current bot uses aggregate trade prices through `BinanceSdkBroker.subscribeForPrices()`. The other exported stream methods still require an explicit compatibility decision.

---

## 4. Architecture decisions and non-negotiable protocol rules

### Two distinct WebSocket roles

**A. WebSocket API connection**
- Request/response RPC for order, account, history, metadata, and other API operations.
- Authenticated user-data subscription and push events.
- Request IDs and pending-request correlation.
- API-key authentication and signed request parameters where required.

**B. Public WebSocket Streams connection**
- Public market-data push events such as `<symbol>@aggTrade`.
- Stream subscription/unsubscription messages and raw/combined stream envelopes.
- Independent lifecycle, reconnect policy, and message adaptation.

Do not put user-data subscription on the separate public market-data Streams connection. Binance delivers the selected signature-subscription events on the WebSocket API connection.

### User-data authentication: preserve the HMAC signature method

The current SDK uses `userDataStream.subscribe.signature` on the WebSocket API connection.

- Preserve the existing `apiKey` + `apiSecret` configuration.
- Use HMAC-SHA-256 with the API secret for the signature, following the exact current Binance signing rules.
- This method does not require an Ed25519 key pair or `session.logon`.
- Do not replace it with `userDataStream.subscribe`, which is a separate Ed25519-authenticated-session method.
- Do not revive the old REST listen-key timer for this new broker path.
- Exact payload canonicalization is not considered proven until known signing test vectors and opt-in testnet verification pass.

### Node.js runtime floor

**Updated approved decision (2026-10-31): `@coinzilla/brokers` and every consumer using its native WebSocket implementation require Node.js >=22.23.4, and the runtime guard verifies the bundled Undici version is patched.**

- Use Node's built-in WHATWG `WebSocket` and `node:crypto` where their documented behavior meets the requirements.
- The broker package declares `engines.node: >=22.23.4`; the unit-test workflow runs on exactly Node.js 22.23.4.
- The runtime guard checks `process.versions.undici` against fixed releases (6.29.1, 7.30.1, and 8.12.2), because a Node major version greater than 22 alone does not prove its bundled Undici is patched.
- This floor addresses CVE-2026-109932, which affected Undici automatic WebSocket pong handling under ping floods. Node.js 22.23.4 includes Undici 6.29.1.
- Do not imply unrelated workspace packages independently require this runtime floor.
- Test the exact supported runtime floor in CI and in the relevant integration checks.

### Native WebSocket ping/pong is a hard gate

Binance Spot Streams sends server ping control frames and expects timely pong responses with the required payload behavior. WHATWG WebSocket does not expose the low-level `.ping()` / `.pong()` methods familiar from some third-party libraries.

The old custom `WS.js` assumes EventEmitter-style `.on()` and low-level ping/pong methods, and its `createWebSocket()` is stubbed. It is not a working replacement.

**Do not assume the native WebSocket automatically satisfies Binance's ping/pong requirements. Prove it on the exact supported Node runtime. If it cannot be demonstrated, stop and revisit the architecture decision before proceeding; do not silently add a third-party dependency.**

### Reliability and safety rules

- Never automatically replay order placement, cancellation, or another state-changing RPC after an uncertain disconnect.
- Surface an uncertain outcome to the caller and reconcile using client order ID/order queries or another documented safe mechanism before retrying.
- Correlate concurrent RPC responses by request ID, not arrival order.
- Bound request timeouts and clean pending entries on every success, error, timeout, and disconnect path.
- Make connect, reconnect, and disconnect states explicit and idempotent.
- Clean up timers, sockets, and listeners on every shutdown/failure path.
- Restore desired public stream subscriptions after reconnect without duplicate callbacks.
- Validate stream names, parameters, message envelopes, and API responses at boundaries.
- Keep protocol handling, signing, message validation/adaptation, and broker result mapping in separate testable modules.
- Use pure functions for deterministic parsing, normalization, validation, and mapping where practical.
- Never log API secrets, private keys, signatures, or complete authenticated payloads.
- Do not hide network calls inside unit tests. Live Binance tests must be opt-in and clearly separated from deterministic tests.

---

## 5. Phased implementation plan

Each phase should be a separate, reviewable PR unless a tightly coupled test or documentation change belongs with its implementation. Keep PRs focused, but replace complete affected files when that reduces merge-conflict risk. Never start implementation from a stale branch.

### Phase 0 — Contract and dependency inventory

**Status: Complete.**

- [x] Inventory every `packages/brokers` export, repository consumer, and `@binance/spot` import.
- [x] Map broker methods to Binance WebSocket API/Streams operations, including parameters, response shape, authentication, and error behavior.
- [x] Decide supported Node runtime before choosing native WebSocket. Initial decision: Node.js >=22.4.0; superseded during Phase 2 by the security-reviewed Node.js >=22.23.4 floor and patched-Undici runtime guard.
- [x] Review current official Binance Spot WebSocket API and Streams documentation for the mapped operations and lifecycle constraints.
- [x] Confirm `userDataStream.subscribe.signature` is the intended compatibility method; existing HMAC API key/secret flow is sufficient, subject to exact signing test vectors.
- [x] Record legacy REST implementation gaps and compatibility exports.
- **Evidence:** [Phase 0 contract and audit](../../docs/brokers-websocket-contract.md). No runtime implementation changes were made in this phase.

### Phase 1 — Characterization tests and test seams

**Status: Complete. PR #256 was merged into `migration/binance-native-ws` on 2026-10-31.**

- [x] Characterize the public broker methods and their existing normalized result shapes.
- [x] Add a reusable WHATWG-style fake WebSocket with deterministic lifecycle and message delivery.
- [x] Add a deterministic fake clock for timeout scheduling.
- [x] Pin existing normalization and `toResult` behavior with tests.
- [ ] Add RPC-specific regression cases for concurrent requests, malformed messages, unknown request IDs, duplicate/late responses, and disconnects with pending requests.
  - These cases must run against the native RPC client introduced in Phase 3. The current SDK owns its socket/correlation internals, so do not write misleading tests against a nonexistent native RPC implementation.
- **Exit criteria:** existing broker compatibility behavior and reusable test seams are tested without live credentials or network access. RPC correlation/failure tests remain Phase 3 gates.
- **PR:** [#256 — test(brokers): characterize Binance broker contract](https://github.com/45s/coinzilla/pull/256). Merged into the migration integration branch; no bot application files or runtime dependencies were added.

### Phase 2 — Native WebSocket transport

- [x] Implement a small Node-native WebSocket transport with injectable socket construction.
- [x] Normalize open/message/error/close events, message data, close codes/reasons, and send failures behind one internal interface.
- [x] Implement explicit connect/close state, connection timeout, idempotent shutdown, and listener cleanup.
- [x] Verify the local raw-WebSocket ping/pong integration test on Node >=22.23.4; the server receives a pong with the exact ping payload.
- [x] Add duplicate close/error, constructor-failure, close-during-connect, and listener-cleanup regression cases.
- [x] Exercise the Phase 1 fake socket and fake clock in transport tests; avoid unused testing scaffolding.
- [x] Verify official Binance connection lifetime (24 hours), server-shutdown notification, ping/pong behavior, 5 incoming messages/second, 1024 streams/connection, and 300 connection attempts/5 minutes/IP. Phase 4 must enforce application-level subscription/message limits and rotate/reconnect safely.
- **Exit criteria:** deterministic transport tests and the local ping/pong protocol test pass on Node.js 22.23.4; no third-party WebSocket package is added. CI evidence on PR #261 head `e4c442c61109807ee841485d40f5c0b64db8397e`.

### Phase 3 — WebSocket API RPC client

- [x] Implement request IDs and a pending-request map with deterministic response correlation.
- [x] Implement bounded request timeouts and cleanup on success, API error, malformed response, timeout, send failure, and disconnect.
- [x] Reject pending work on disconnect with actionable errors; mark state-changing request outcomes uncertain.
- [x] Implement HMAC-SHA-256 signing with `node:crypto`, preserving API-key/secret credentials for signed methods.
- [x] Add official Binance ASCII and UTF-8 signing vectors, including exact signature bytes.
- [x] Validate success/error response envelopes and preserve Binance status, error code, and message.
- [x] Handle concurrent requests and out-of-order responses.
- [x] Add deterministic tests for unknown/duplicate/late IDs, malformed payloads, multiple pending requests on disconnect, and timeout cleanup using the Phase 1 fake socket/clock.
- [x] Make reconnect behavior explicit: this client is one-connection/one-lifecycle; it never retries or replays requests.
- [x] Verify all tests on exact PR #263 head `1300fd57651cd5809feb0a5d0fd66541ee1ced6a`; Unit Tests, Utils Unit Tests, JavaScript Syntax, and Dependency Audit passed before merge.
- **Exit criteria:** deterministic tests cover success, API error, timeout, malformed response, concurrency, out-of-order, unknown ID, duplicate/late response, send failure, and disconnect. Signing has known test vectors.
- **PR:** [#263 — feat(brokers): add Binance WebSocket API RPC client](https://github.com/45s/coinzilla/pull/263). Merged into the integration branch with merge commit `cdc2333fdf43e84d4cba2a0814e905472a558b70`.

### Phase 4 — Public WebSocket Streams client

**Status: Complete. PR #265 merged into `migration/binance-native-ws` at merge commit `b8daae9a5d7df6dd081de8537783ce3976ab7b39`.**

- [x] Implemented the native public Streams client on `NativeWebSocketTransport`; the broken legacy `WS.js` class was not extended.
- [x] Kept public market-data Streams separate from WebSocket API RPC and authenticated user-data events.
- [x] Preserved the existing exported `BinanceStreamClient` and its method surface for the later compatibility migration.
- [x] Implemented combined `/stream?streams=...` setup, initial `LIST_SUBSCRIPTIONS` verification, acknowledged SUBSCRIBE/UNSUBSCRIBE operations, and defensive raw-envelope parsing.
- [x] Validated stream names and parameters; rolling-window ticker streams are restricted to Binance-supported 1h and 4h windows.
- [x] Added acknowledgement correlation, API error normalization, timeout/socket-failure handling, duplicate-listener management, 4-message/second control pacing, 1,024-stream limit, batching, reconnect/resubscribe, server-shutdown handling, pre-24-hour rotation, and idempotent cleanup.
- [x] Added a public-only adapter boundary: aggregate trades are adapted, other public market-data events pass through, and authenticated user-data events are rejected.
- [x] Added deterministic tests for the stream protocol, client lifecycle, failure paths, and adapter boundary.
- **Exact-head CI evidence:** PR #265 head `ce9bb384b7e9ea754e9f2b558ca56f7a180d760d` passed Unit Tests, Utils Unit Tests, JavaScript Syntax, and Dependency Audit.

**Legacy method-to-stream compatibility matrix** (the old exported methods remain untouched until Phase 5):

| Legacy method | Required parameters | Native stream mapping |
|---|---|---|
| `trade({ tickets })` | First ticket/symbol | `{symbol}@trade` |
| `kline({ tickets, interval })` | First ticket/symbol, interval | `{symbol}@kline_{interval}` |
| `miniTicker({ symbol? })` | Optional symbol | `{symbol}@miniTicker` or `!miniTicker@arr` |
| `ticker({ symbol? })` | Optional symbol | `{symbol}@ticker` or `!ticker@arr` |
| `rollingWindowTicker({ windowSize, symbol? })` | Window `1h` or `4h`; optional symbol | `{symbol}@ticker_{windowSize}` or `!ticker_{windowSize}@arr` |
| `bookTicker({ symbol })` | Symbol | `{symbol}@bookTicker` |
| `partialBookDepth({ symbol, levels, speed })` | Symbol, levels `5/10/20`, speed `100ms/1000ms` | `{symbol}@depth{levels}@{speed}` |
| `diffBookDepth({ symbol, speed })` | Symbol, speed `100ms/1000ms` | `{symbol}@depth@{speed}` |
| `aggTrade({ tickets })` | First ticket/symbol | `{symbol}@aggTrade` |

`userData()` is intentionally excluded: its old REST listen-key lifecycle is legacy behavior and the replacement belongs to Phase 6 on the authenticated WebSocket API connection.

**Exit criteria:** all Phase 4 implementation and deterministic test criteria were met on the exact CI-verified PR head. No live credentials or network calls are used by default unit tests.

### Phase 5 — Rebuild the broker on native clients

**Status: Implementation and deterministic tests complete. PR #271 is open; all four required CI workflows pass on exact head `88f56339d7f6ede226776574c0fdadce2037f0f9`. Awaiting explicit merge approval.**

- [x] Replace the SDK-backed `BinanceSdkBroker` internals with the native WebSocket API RPC client and native public Streams client; preserve the public broker/config export names.
- [x] Map broker request methods to native RPC methods: `account.status`, `openOrders.status`, `order.status`, `allOrders`, `myTrades`, `order.place`, `order.cancel`, `openOrders.cancelAll`, `ticker.price`, and `exchangeInfo`.
- [x] Move `getSymbolFilters()` from REST `fetch()` to WebSocket API `exchangeInfo`; preserve validated exact `tickSize`/`stepSize` strings.
- [x] Use the native Streams client for aggregate-trade price subscriptions and preserve the adapted price callback payload.
- [x] Route `userDataStream.subscribe.signature` through the WebSocket API connection with HMAC signing, and expose a lifecycle handle that sends `userDataStream.unsubscribe` before removing local observers; reconnect/recovery remains Phase 6.
- [x] Preserve order/fill normalization, client order ID mapping, order defaults, result wrappers, and exact fill decimal strings.
- [x] Mark order placement, cancellation, and cancel-all as state-changing RPC operations so uncertain outcomes are surfaced and never blindly replayed.
- [x] Remove direct `@binance/spot` imports from the broker implementation and config defaults; use explicit official production/testnet WebSocket endpoints.
- [x] Verify failure-safe startup cleanup, partial-shutdown cleanup, idempotent disconnect, and callback/resource cleanup with deterministic tests; exact-head CI remains the verification gate.
- [x] Complete the full broker contract and regression suite on the native client interfaces; Unit Tests, Utils Unit Tests, JavaScript Syntax, and Dependency Audit all pass on the exact PR head.
- [x] Re-audit current consumers read-only against latest `main`; no bot application files were changed.
**Read-only consumer contract audit (main `49c5aba675e71490123181d757641376be35c78a`):**

- `apps/bot-free-roll/src/prepare-broker.js` constructs `BinanceSdkConfig` and `BinanceSdkBroker`, calls `connect()`, and calls `disconnect()` on startup failure. Constructor and lifecycle remain compatible.
- `bot-free-roll.js` expects `subscribeForUserData()` to return a lifecycle handle with `disconnect()`, and each `subscribeForPrices()` result to expose `unsubscribe()`. The native broker returns both expected cleanup methods.
- The bot consumes `getSymbolFilters()` as decimal strings and converts them to numbers itself; exact string outputs are preserved.
- Fill reconciliation expects `getMyTrades()` to return an array of canonical fills. `adaptTrade` remains the normalizer.
- Order execution consumes `createOrder()`/`cancelOrder()` results with IDs, status, and original/executed quantities. `adaptOrder` remains the normalizer.
- No `apps/` changes are included in this PR. User-data remote unsubscribe and reconnect recovery remain Phase 6.

- **Exact-head CI evidence:** PR #271 head `88f56339d7f6ede226776574c0fdadce2037f0f9` passed Unit Tests, Utils Unit Tests, JavaScript Syntax, and Dependency Audit.
- **Exit criteria:** every supported broker method uses native WebSocket clients; the supported broker path performs no REST requests; deterministic broker contract/failure tests and exact-head CI pass; consumer-facing behavior remains compatible.

### Phase 6 — User-data session lifecycle and recovery

- [ ] Implement the documented `userDataStream.subscribe.signature` flow on the WebSocket API connection using existing HMAC `apiKey` + `apiSecret` credentials.
- [ ] Do not require Ed25519 keys or `session.logon`; do not switch to the Ed25519-session `userDataStream.subscribe` method.
- [ ] Do not carry forward the legacy REST listen-key timer.
#### Phase 6A — lifecycle observability and event idempotency (merged PR #285)
- [x] Expose RPC socket-close notifications without changing existing request/event behavior.
- [x] Detect explicit `eventStreamTerminated` events and unexpected API socket closure.
- [x] Add an optional `onStatus` callback that reports `terminated` and `connectionClosed` with `recoveryRequired: true`, plus `rpcError` diagnostics without claiming a recovery gap; keep the existing `onEvent({ event })` contract unchanged.
- [x] Ignore events whose `subscriptionId` does not match the active subscription.
- [x] Deduplicate execution reports using `symbol`, `orderId`, and `executionId`; use a bounded exact-payload cache for event types without a stable unique ID.
- [x] Avoid reporting intentional broker shutdown as an unexpected recovery gap.
- [x] Log unexpected API socket closure even when no optional status callback is supplied.
- [x] Fail closed for new `createOrder()` calls after user-data subscription failure, termination, explicit unsubscribe, or API socket loss; restore order placement only after a new subscription succeeds.
- [x] Document that event timestamps are not a global replay cursor and that recovery requires state reconciliation.
- [x] Phase 6A follow-up: deterministic account-update duplicate tests and callback/error isolation review (covered by Phase 6B.1 regression tests).

#### Phase 6B — reconnect, resubscribe, and reconciliation (split into 6B.1 and 6B.2)

**6B.1 — single-subscription session manager and safe recovery coordinator (PR #288)**
- [x] Maintain one remote signature subscription per account/API connection and fan out to local subscriber handles.
- [x] Coalesce concurrent local subscribe calls; detach a handle locally and remotely unsubscribe only after the last handle is removed.
- [x] Recreate the one-shot RPC client/transport after unexpected close; preserve the injected factory seam and intentional shutdown semantics.
- [x] Use a single-flight reconnect loop with bounded exponential backoff, cancellable on explicit broker shutdown, and a finite retry budget.
- [x] Re-subscribe only after the replacement socket is open; bind events to the new subscription ID and ignore stale events.
- [x] Never replay pending or uncertain state-changing RPC requests during recovery.
- [x] If a subscribe request has an uncertain outcome, query `session.subscriptions` and adopt the single active subscription only when unambiguous.
- [x] Keep trading fail-closed while recovery is underway and after resubscription until every active consumer explicitly acknowledges reconciliation.
- [x] Add deterministic tests for concurrent subscriptions, listener fan-out, handle cleanup, reconnect races, retry exhaustion, resubscribe failures, stale IDs, cross-reconnect duplicate events, late subscribers, repeated interruptions, and shutdown during recovery.
- [x] Isolate callback exceptions and preserve connection-close observability even without active user-data handles.

**6B.2 — reconciliation contract and integration verification (not started)**
- [ ] Complete any remaining account-update / execution-report event-ordering and reconciliation edge-case tests.
- [ ] Document the consumer reconciliation procedure: `account.status` and `openOrders.status` for current snapshots; symbol-scoped `myTrades` / `allOrders` for available trade/order history. These cannot reconstruct every missed intermediate balance delta.
- [ ] Add opt-in Binance testnet coverage for signature subscription, disconnect/reconnect, resubscription, and user-data event receipt.
- [ ] Verify the consumer can reconcile and call the handle's `acknowledgeRecovery()` before new order/cancel operations are re-enabled.
- [ ] Re-audit the read-only bot consumer contract; do not modify bot app code in this migration.
- **Exit criteria:** deterministic recovery tests and opt-in testnet verification pass; callback/resource lifecycle is safe; recovery acknowledgement contract is clear to consumers.
### Phase 7 — Remove the SDK and retire legacy REST implementation

- [ ] Confirm all repository consumers use the supported WebSocket broker contract.
- [ ] Mark old custom REST broker and REST-specific exports deprecated before removal, with a clear migration note.
- [ ] Remove `@binance/spot` from `packages/brokers/package.json`.
- [ ] Regenerate `pnpm-lock.yaml` using the repository's package manager and supported version.
- [ ] Remove dead REST transport/signing/adaptation code only after confirming no supported consumer imports it.
- [ ] Remove or replace obsolete tests/examples while retaining useful compatibility tests.
- [ ] Search the full repository for remaining `@binance/spot` imports and obsolete REST broker references.
- [ ] Inspect production dependency tree and audit results.
- **Exit criteria:** no `@binance/spot` reference remains in runtime manifests/source; lockfile and production dependency audit confirm no third-party runtime dependency is required by `@coinzilla/brokers`; supported imports remain valid.

### Phase 8 — Operational hardening and completion

- [ ] Add opt-in Binance testnet integration coverage for connection, public stream, signed RPC, safe order lifecycle where appropriate, and user-data events.
- [ ] Document supported Node versions, required API permissions, endpoints, reconnect semantics, rate limits, failure modes, uncertain order outcomes, and safe shutdown.
- [ ] Verify broker package tests, full workspace tests, syntax checks, production dependency audit, and repository-required branch-protection checks.
- [ ] Review logs for secret leakage.
- [ ] Verify timers, sockets, pending requests, and listeners are cleaned up on shutdown and failure.
- [ ] Re-audit all consumers and public exports.
- [ ] Confirm no bot application files were changed by this migration.
- **Exit criteria:** all required checks pass on the exact final PR head; opt-in integration results are recorded; integration branch is current with `main`; all definition-of-done items in Section 1 are evidenced.

---

## 6. Test strategy and quality gates

### Test layers

1. **Pure unit tests:** parameter validation, signing payload construction, parsing, adapters, normalization, error mapping. No sockets, credentials, or network.
2. **Deterministic transport/RPC/stream tests:** inject fake socket and fake clock. Exercise lifecycle, correlation, timeouts, malformed messages, duplicates, concurrency, disconnects, cleanup, reconnect.
3. **Broker contract tests:** verify public methods and result/event shapes at the broker boundary.
4. **Opt-in integration tests:** connect to Binance testnet only when explicitly enabled and valid credentials are provided. These are not a substitute for deterministic tests and must not make default unit tests depend on the network.
5. **CI gates:** run package tests, workspace checks, syntax checks, dependency audit, and applicable branch-protection checks. Report results only for the exact commit being reviewed.

### Minimum failure matrix

Cover relevant cases across layers:
- invalid/missing parameters and unsupported stream names;
- socket constructor failure, connection timeout, send failure, close during connect;
- duplicate error/close events and messages after close;
- RPC API error, malformed envelope, missing/unknown ID, duplicate/late response;
- concurrent requests and out-of-order responses;
- timeout and pending-request cleanup;
- disconnect with pending read-only and state-changing requests;
- uncertain state-changing outcome with no automatic replay;
- subscription rejection, duplicate events, malformed event payloads;
- reconnect/resubscribe without duplicate callbacks;
- shutdown during active requests/subscriptions;
- secret/signature redaction from logs.

Do not create tests solely to inflate test count. Every test should protect a concrete contract, failure mode, or safety property.

### Fake infrastructure expectations

The fake WebSocket and fake clock are test tools, not deliverables by themselves. Each helper must be exercised by the implementation tests that need it. Keep their behavior close to the relevant WHATWG WebSocket/timer contract, and add behavior only when a real test requires it. Do not treat a fake socket test as proof that Binance's live protocol behavior is correct.

### Commands

Use the actual package scripts and workspace scripts from current manifests; verify them before assuming command names. At minimum, run:
- broker package deterministic tests;
- relevant workspace tests;
- JavaScript syntax workflow/check;
- production dependency audit;
- opt-in integration tests only when explicitly configured and safe.

Run narrow tests first, then broaden. Fix failures rather than hiding them or using empty commits to restart CI.

---

## 7. Agent operating procedure

When asked to "implement/improve `/packages/brokers`", follow this procedure without requiring the user to restate the roadmap.

### Before every task

1. Read this roadmap completely and read [the broker contract audit](../../docs/brokers-websocket-contract.md).
2. Inspect latest `main`, `migration/binance-native-ws`, open broker-related PRs, and current branch state.
3. Compare `main` with the integration branch since the last recorded sync. Apply Section 10 if a significant contract/runtime/dependency change has landed.
4. Identify the active phase and its unchecked exit criteria. Work on the next incomplete task only; do not jump phases without documenting why.
5. Inspect complete affected files, related tests, package scripts/manifests, and all current consumers of changed exports/methods.
6. Check for other branches/PRs touching the same files. Avoid work that conflicts with active bot-team changes.
7. State the precise task and acceptance criteria before implementation. If the requested task conflicts with this roadmap, stop and ask for a decision rather than silently changing scope.

### During implementation

- Work on a dedicated branch based on the current integration branch; never use `main` as the migration working branch.
- Keep the change within broker scope and the current phase.
- Preserve complete-file context; avoid fragile partial edits when a complete-file replacement is safer.
- Keep functions small, deterministic, and testable; prefer pure helpers for parsing/normalization/mapping.
- Add or update tests for every changed behavior and important failure path.
- Do not add runtime dependencies without explicit justification and a roadmap decision.
- Do not change bot application files.
- Do not use real credentials or live network calls in default tests.
- Never blindly replay a state-changing request.

### Before opening a PR

1. Re-check latest `main` and apply the synchronization policy if needed.
2. Review the full diff, not only the changed lines. Check for accidental unrelated changes, secrets, generated noise, and bot application edits.
3. Run narrow tests, package tests, relevant workspace tests, syntax checks, and dependency audit as applicable.
4. Verify CI on the exact PR head; pending, canceled, or failed checks are not green.
5. Update this roadmap's phase checklist only where evidence meets the stated acceptance criteria.
6. Include in the PR description: purpose, scope, compatibility impact, tests run, exact commit SHA checked, and any remaining limitations.
7. Open the PR against `migration/binance-native-ws`, not `main`, during phased implementation.
8. Never merge automatically. Wait for explicit user instruction.

### Stop and ask the user when

- Official Binance documentation conflicts with this roadmap or leaves a security-critical behavior ambiguous.
- Native Node WebSocket cannot be proven to satisfy Binance's ping/pong or lifecycle requirements.
- A change would alter a public export, consumer contract, runtime floor, credentials, or third-party dependency policy.
- A significant main-branch change cannot be reconciled confidently.
- A test requires live credentials, a real order, or a potentially destructive exchange action.
- Scope would require editing bot application files.
- CI failures appear unrelated or cannot be diagnosed safely.

---

## 8. Documentation and decision records

Keep these files aligned:

- `packages/brokers/ROADMAP.md` — package mission, decisions, phases, agent procedure, status, and acceptance criteria. This is the primary starting point for broker work.
- `docs/brokers-websocket-contract.md` — detailed Phase 0 source inventory, public contract, method mapping, old implementation findings, and official protocol references.
- Root `ROADMAP.md` — project-wide engineering roadmap and links to package-level roadmaps; do not move broker protocol implementation details back into the root file.

When a new discovery changes an implementation decision:
1. Verify it against current source, tests, consumer usage, and official documentation.
2. Update this roadmap and the contract audit where appropriate.
3. Record the date, old decision, new decision, evidence, and affected phases in the decision log below.
4. Only then continue implementation.

### Decision log

| Date | Decision | Reason / evidence | Impact |
|---|---|---|---|
| 2026-10-31 | Raise the native WebSocket runtime floor from Node.js >=22.4.0 to >=22.23.4 and guard the bundled Undici version. | User approval after discovery of CVE-2026-109932; Node.js 22.23.4 bundles fixed Undici 6.29.1. Runtime guard also rejects affected Undici 6.29.0, 7.30.0, and 8.12.1 or older affected releases. | Package `engines`, Phase 2 transport, and CI runtime pin. |
| 2026-10-31 | Use WebSocket API connection for RPC and signature-based user-data subscription/events; use separate public Streams connection for market data. | Phase 0 SDK/source and official Binance protocol audit. | Phases 2–6; do not mix user-data events into public Streams. |
| 2026-10-31 | Preserve `userDataStream.subscribe.signature` with existing HMAC `apiKey` + `apiSecret`; do not require Ed25519 or `session.logon`. | Current SDK behavior and official Binance documentation reviewed in Phase 0. Exact signing payload still requires test vectors. | Phase 3 signing and Phase 6 lifecycle. |
| 2026-10-31 | Never blindly replay state-changing requests after uncertain disconnects. | Order placement/cancellation may have succeeded remotely even if response was lost. | RPC design, broker result contract, recovery tests. |
| 2026-10-31 | Do not edit bot application files during this migration. | Other teams are actively developing bot behavior; avoid conflicts and preserve ownership. | All phases; consumer source is read-only audit evidence. |
| 2026-10-31 | Treat `eventStreamTerminated` as an explicit subscription lifecycle signal, not an order/account event. | Binance Spot User Data Streams documentation defines the event and its termination causes. | Phase 6 lifecycle state machine and tests. |
| 2026-10-31 | Treat a socket interruption as an unrecoverable event-history gap; do not use event timestamps as a global sequence cursor. | Binance user-data event schemas expose event/transaction timestamps and execution IDs, but no universal replay cursor. | Phase 6 status signaling, idempotency, and reconciliation. |
| 2026-10-31 | Reconcile current account/order state from WebSocket API snapshots after recovery; do not claim snapshots reconstruct missed intermediate events. | `account.status`, `openOrders.status`, `myTrades`, and `allOrders` provide current or queryable state, not a replay log for every event. | Phase 6 recovery contract. |

---

## 9. Pull request and phase review policy

- Phase 0 is complete and documented; no runtime code was changed there.
- Complete and review each phase before starting the next phase's implementation, unless the user explicitly changes sequencing.
- Each phase should normally be a separate PR into `migration/binance-native-ws`.
- Keep PRs focused enough to review; replace complete affected files when that reduces merge-conflict risk.
- Do not stack work on a stale base.
- Do not merge PRs automatically. Wait for explicit user approval.
- If Binance documentation, Node runtime behavior, or a consumer contract contradicts this plan, stop and update the roadmap before coding around the discrepancy.
- Update checkboxes only after exit criteria are verified. A PR being opened or CI merely starting does not mean a phase is complete.
- Never merge migration work into `main` during phased implementation. The final delivery to `main` is a separate, user-approved release PR after all phases and synchronization requirements are satisfied.

---

## 10. Mandatory synchronization with `main`

The migration branch is a long-lived integration branch, not a fork. Other teams continue developing bot and broker functionality on `main`; the migration must stay compatible with that work.

### Monitoring and immediate sync triggers

- Before starting **every** migration task or phase, inspect latest `main` and compare it with `migration/binance-native-ws` since the last recorded sync.
- Recheck `main` before opening every migration PR and before declaring a phase complete. For long-running work, recheck before finalizing; do not rely on an old snapshot.
- **Immediately after significant broker/API changes land on `main`, stop migration implementation and synchronize `main` into `migration/binance-native-ws` before continuing.** Do not wait for the next phase or final release.
- Significant changes include broker exports/implementation, Binance/API or WebSocket behavior, broker method signatures or result/event shapes, shared entities/configuration used by brokers, Node/package-manager/runtime requirements, dependency manifests/lockfiles, contract tests/fixtures, and new or changed broker consumers.
- If uncertain whether a main change affects the migration, inspect it and treat it as significant until proven otherwise.
- Record the last synchronized `main` SHA and concise relevant-change summary in this roadmap and the relevant PR. Do not claim continuous background monitoring; the agent must perform these checks at every work session and checkpoint.

### Safe synchronization procedure

1. Fetch latest `main` and integration refs. Compare commits since the last recorded sync; review commit messages and changed-file lists, then inspect complete relevant diffs for broker/API, consumer, runtime, dependency, and test changes.
2. Merge latest `main` into `migration/binance-native-ws`. Preserve a merge commit; do not rebase or force-push the shared integration branch.
3. Resolve conflicts by understanding both sides and reconciling complete affected files. Never blindly choose ours/theirs, discard bot-team changes, or revert unrelated work to make a merge easy.
4. Do not independently edit bot application files, including `apps/bot-free-roll`. Preserve changes already made by other teams and merged through `main`. If those changes reveal a broker contract requirement, adapt broker code/tests without taking ownership of bot feature work.
5. Re-run relevant broker/package tests, workspace tests, syntax checks, and dependency audit. Verify checks on the exact synchronized commit.
6. Re-audit consumer inventory, method/protocol mapping, and assumptions. Update this roadmap if main introduced consumers, changed contracts, or invalidated findings.
7. If conflicts or behavior changes cannot be resolved confidently, stop and report the exact files/contracts rather than guessing.

Use a dedicated synchronization PR from `main` into `migration/binance-native-ws` when direct synchronization is unavailable or review is useful. It must target the integration branch and preserve merge history.

### Required checkpoints

- Before Phase 0 inventory and before each subsequent phase begins.
- Immediately after significant broker/API or consumer-contract changes are detected on `main`.
- Before each phase PR is opened and before phase completion is reported.
- Before the final release PR from `migration/binance-native-ws` to `main`.

### Last recorded main review

- **Main SHA synchronized by PR #279:** `da0d3f434741d3e3b5892666c4906cbc4bcb8a28` (2026-10-31).
- **Latest main SHA re-reviewed before Phase 6:** `9903365e724ffa5887d77aa297abf5d0077d8762` (2026-10-31); 28 commits after the PR #279 sync snapshot.
- The later commits include bot-free-roll event/fill/order-cancellation test coverage, `packages/event-bus` validation/refactoring, and updated root `AGENTS.md` / `ENGINEERING_STANDARDS.md`. The current broker source, package manifest, public API, and read-only bot consumer contract were re-audited. No broker/API/consumer-contract/runtime/dependency change requires synchronization at this checkpoint.
- PR #279 merged at `f7566726b3f42b28db6bdc7556cf4a3dcae866fe`, preserving main and integration as merge parents. The integration branch is identical to this merge commit at Phase 6 kickoff.
- Recheck latest `main` before opening the Phase 6 PR and before declaring Phase 6 complete; sync immediately if a significant broker/API/consumer-contract change lands.

---

## 11. Official protocol and runtime references

Re-check these official sources during implementation because Binance protocol details and limits can change:

- [Binance Spot WebSocket API — Account](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/ws-api/account)
- [Binance Spot WebSocket API — Trade](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/ws-api/trade)
- [Binance Spot WebSocket API — General](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/ws-api/general)
- [Binance Spot WebSocket API — Market](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/ws-api/market)
- [Binance Spot WebSocket API — User Data Stream](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/ws-api/user-data-stream)
- [Binance Spot WebSocket Streams — General](https://developers.binance.com/en/docs/products/spot/web-socket-streams)
- [Node.js v22 Global WebSocket documentation](https://nodejs.org/download/release/v22.23.4/docs/api/globals.html#class-websocket)
- [Node.js v22.23.4 release notes](https://nodejs.org/en/blog/release/v22.23.4) — includes Undici 6.29.1.
- [Binance Spot WebSocket API — protocol, responses, HMAC signing](https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-api.md) — request IDs are echoed, responses use `status` plus `result` or `error`, and HMAC-SHA-256 signs alphabetically sorted UTF-8 `key=value` parameters.

The [Phase 0 broker contract audit](../../docs/brokers-websocket-contract.md) records the sources reviewed and the findings at that audit date. Official docs remain authoritative if they change.
