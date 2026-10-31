# Binance Broker Roadmap

> **Agent entry point:** When asked to implement, improve, audit, or maintain `/packages/brokers`, read this file first and follow it as the package-level source of truth. Start with **Current status and next action**, then complete the mandatory pre-work checks before changing code. Do not rely on chat history or assume earlier findings are still current.

**Package:** `@coinzilla/brokers`  
**Repository:** `45s/coinzilla`  
**Shared integration branch:** `develop` (use short-lived broker task branches; see the repository-root `AI_AGENT_WORKFLOW.md`)  
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
9. All required CI checks pass on the exact final PR head, and the shared `develop` branch remains the integration source of truth for ongoing work.
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
- [~] Phase 6 — user-data session lifecycle and recovery; reconnect retry liveness and repeated reconciliation acknowledgement are being hardened after the WebSocket-only migration.
- [x] Phase 7 — remove the SDK and retire legacy REST implementation; completed by PR #333 on 2026-10-31.
- [ ] Phase 8 — operational hardening and completion; opt-in TESTNET verification and long-running recovery/soak validation remain.

### Next action

1. The source of truth is `develop`, currently at merge commit `674a3b10ed34fb444a9f2ef2179fc073c90b7827` (PR #365).
2. PR #333 (`refactor: make Binance broker WebSocket-only`) is merged. It removes `@binance/spot`, the legacy REST broker and listen-key transport, and makes `BinanceWebSocketBroker` the active implementation while retaining the `BinanceSdkBroker` compatibility alias.
3. PR #333's exact head `c777956cb23b25768f4fbcde866eb22069cfbfb8` passed Unit Tests, Test Coverage, JavaScript Syntax, Dependency Audit, and Utils Unit Tests. The merge commit's post-merge Unit Tests workflow also passed.
4. PR #342 makes both Binance TESTNET integration suites require an explicit `BINANCE_TESTNET_INTEGRATION=1` flag as well as non-placeholder credentials. The default test suite verifies that both remain offline when credentials are present but the flag is absent.
5. Keep state-changing order requests blocked while user data is unavailable or any consumer has not acknowledged reconciliation. A successful socket connection or subscription is never proof that missed events have been reconciled.
6. Phase 6 remains in progress until reconnect/reconciliation liveness tests and opt-in Binance TESTNET verification are complete. PR #343 removed fixed microtask-count polling from recovery race tests; the fake scheduler awaits async timer callbacks and tests use explicit recovery synchronization. Do not claim the broker can replay events missed during a disconnect.
7. Phase 7 is complete through PR #333. Do not reintroduce the removed REST transport, legacy listen-key session, or third-party Binance SDK.
8. PR #347 is merged: RPC connection-startup rejection now detaches all registered RPC transport listeners. PR #350 is merged: native transport listener registration failures now roll back partial setup and close the socket. PR #351 is merged: Streams startup exceptions now detach listeners and close the transport. PR #353 made user-data listener registration transactional, PR #354 made listener detachment exhaustive and idempotent, PR #355 detaches listeners immediately on RPC close, PR #357 verifies uncertain final-subscriber unsubscribe outcomes, PR #359 cleans up failed reconnect attempts, PR #361 applies verified unsubscribe handling to stale subscription responses, PR #362 rejects malformed subscription lookup state, and PR #365 makes RPC listener removal exhaustive. The current native transport audit found that if `removeEventListener` throws during close finalization, later socket handlers remain attached, close observers are skipped, and the close promise may never resolve; this task makes finalization continue through every removal failure and report them through the error channel.
9. Bot strategy implementation remains owned by `apps/bot-free-roll`; broker changes must preserve the callback/recovery acknowledgement contract and must not edit bot runtime code without an explicit cross-domain task.


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

**6B.2 — reconciliation contract and integration verification (in progress)**
- [x] Complete deterministic account-update / execution-report duplicate and recovery-acknowledgement coverage in Phase 6B.1.
- [x] Document the consumer reconciliation procedure: `account.status` and `openOrders.status` for current snapshots; symbol-scoped `myTrades` / `allOrders` for available trade/order history. These cannot reconstruct every missed intermediate balance delta.
- [x] Add opt-in Binance TESTNET coverage for signature subscription, forced API socket disconnect, reconnect/resubscription, read-only account/order/trade reconciliation queries, and explicit recovery acknowledgement.
- [x] Add an additional opt-in event-receipt test gated by `BINANCE_TESTNET_EXPECT_USER_DATA_EVENT=1`; it requires external testnet activity while the test runs and never places an order.
- [ ] Run the opt-in integration suite with real, read-only-capable Binance TESTNET credentials and record the result. Default CI remains offline and skips these tests without credentials.
- [x] Complete bot consumer adoption tracked in [issue #304](https://github.com/45s/coinzilla/issues/304) via [PR #314](https://github.com/45s/coinzilla/pull/314); [PR #315](https://github.com/45s/coinzilla/pull/315) adds repeated-interruption and shutdown hardening. This is bot-domain work; no bot files are changed by the Brokers domain.
- [x] Re-audit the read-only bot consumer contract; broker changes do not modify bot application files.
- **Exit criteria:** deterministic recovery tests and opt-in testnet verification pass; callback/resource lifecycle is safe; consumer reconciliation is implemented by its owning domain; recovery acknowledgement contract is clear and adopted.
### Phase 7 — Remove the SDK and retire legacy REST implementation

- [x] Confirm repository consumers use the supported WebSocket broker contract.
- [x] Remove `@binance/spot` from `packages/brokers/package.json` and regenerate `pnpm-lock.yaml`.
- [x] Remove the legacy custom REST broker, REST signing/query helpers, listen-key transport, and obsolete REST-only examples/tests.
- [x] Reorganize the active implementation under `broker-websocket/` and retain the `BinanceSdkBroker` compatibility alias while exposing the WebSocket-native name.
- [x] Search the full repository for remaining `@binance/spot` imports and obsolete REST broker references.
- [x] Verify the production dependency audit and exact-head CI for PR #333.
- **Exit criteria:** met by PR #333; the active broker uses native WebSocket API/Streams clients and has no third-party runtime dependency.

### Phase 8 — Operational hardening and completion

- [~] Add opt-in Binance testnet integration coverage for connection, public stream, signed RPC, safe order lifecycle where appropriate, and user-data events.

  Offline safety regression: the native broker integration suite now creates its broker only inside the credential-gated setup hook, so missing credentials produce a clean skip instead of a module-load exception. The suite asserts both configured WebSocket endpoints are Binance TESTNET before connecting. A deterministic unit test launches both integration suites with dummy non-placeholder credentials but no opt-in flag and verifies that they exit successfully as skipped.
- [x] Require the explicit `BINANCE_TESTNET_INTEGRATION=1` opt-in in both native broker and user-data integration suites, in addition to non-placeholder credentials. The default unit suite proves both suites skip without network access even when dummy non-placeholder credentials are present.
  The opt-in flag is documented in `.env.example` and defaults to `0`. Live TESTNET protocol/order verification remains outstanding.
- [x] Remove fixed microtask-count polling from user-data recovery unit tests. The fake scheduler now awaits asynchronous timer callbacks, and race tests await the session's recovery promise instead of relying on twelve `Promise.resolve()` turns.
- [x] Document supported Node versions, required API permissions, endpoints, reconnect semantics, rate-limit handling, failure modes, uncertain order outcomes, and safe shutdown in `packages/brokers/README.md` (PR #345).
- [ ] Verify broker package tests, full workspace tests, syntax checks, production dependency audit, and repository-required branch-protection checks.
- [ ] Run opt-in TESTNET verification with explicitly configured credentials and record the exact runtime/environment/results; do not treat default CI as live protocol verification.
- [ ] Review logs for secret leakage.
- [~] Audit lifecycle cleanup. PR #347 fixed RPC client listener cleanup after transport connection rejection. PR #350 fixed partial native socket-listener registration. PR #351 fixed Streams listener cleanup for synchronous startup failures and unexpected close. PR #353 made user-data listener registration transactional. PR #354 made user-data listener detachment exhaustive and idempotent. PR #355 detaches session listeners immediately on RPC close. PR #357 reconciles uncertain final-subscriber unsubscribe outcomes. PR #359 cleans up listeners after failed replacement-client connections. PR #361 verifies stale subscription cleanup. PR #362 rejects malformed subscription lookup entries. This task makes RPC transport listener removal exhaustive even when a remover throws, preserving the original connect/disconnect result and reporting cleanup failures. Continue auditing stop/reconnect races before marking the lifecycle item complete.
- [ ] Verify timers, sockets, pending requests, and listeners are cleaned up on shutdown and failure.
- [ ] Re-audit all consumers and public exports.
- [ ] Confirm no bot application files were changed by this migration.
- **Exit criteria:** all required checks pass on the exact final PR head; opt-in integration results are recorded against the supported TESTNET environment; `develop` contains the verified implementation; all definition-of-done items in Section 1 are evidenced.

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

Follow the repository-root `AGENTS.md`, `ENGINEERING_STANDARDS.md`, and `AI_AGENT_WORKFLOW.md`. This package roadmap supplies broker-specific scope and technical constraints; it does not define a separate branch or release workflow.

### Before every task

1. Read this roadmap and [the broker contract audit](../../docs/brokers-websocket-contract.md).
2. Inspect the latest `develop`, relevant open PRs, complete affected files, tests, package scripts/manifests, and all consumers of changed exports or methods.
3. Identify the next incomplete phase and its acceptance criteria. Do not jump phases without recording the reason.
4. Confirm that the task belongs to `packages/brokers/**`. Route bot, entity, utility, or other domain changes through the cross-domain request process.
5. Check for overlapping task branches/PRs and coordinate rather than overwriting another agent's work.

### During implementation

- Create a short-lived branch from the latest `develop`, named `feature/brokers/<task>` or `fix/brokers/<task>`.
- Keep changes within broker ownership. Do not modify bot application files or another package's implementation.
- Keep functions small, deterministic, and testable; prefer pure helpers for parsing, normalization, and mapping.
- Add deterministic tests for changed behavior and important failure paths.
- Do not add runtime dependencies without explicit justification and a roadmap decision.
- Do not use real credentials or live network calls in default tests.
- Never blindly replay a state-changing request after an uncertain disconnect.

### Before opening a PR

1. Synchronize the task branch with the latest `develop`; never rebase or force-push shared history.
2. Review the complete diff for unrelated changes, secrets, generated noise, and ownership violations.
3. Run narrow tests, broker package tests, relevant workspace tests, syntax checks, and dependency audit as applicable.
4. Open a focused PR targeting `develop` with scope, compatibility impact, test evidence, exact checked commit, and remaining limitations.
5. The responsible agent may merge after all required CI, freshness, and ownership gates pass. Routine human approval is not required for `develop`.

### Stop and ask the user when

- Official Binance documentation conflicts with this roadmap or leaves a security-critical behavior ambiguous.
- Native Node WebSocket cannot be proven to satisfy Binance's ping/pong or lifecycle requirements.
- A change would alter a public export, consumer contract, runtime floor, credentials, or third-party dependency policy.
- A cross-domain contract change cannot be agreed with affected owners.
- A test requires live credentials, a real order, or a potentially destructive exchange action.
- CI failures cannot be diagnosed safely.

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

## 9. Pull request and integration policy

- Each broker task uses a short-lived branch created from the latest `develop`.
- Every task PR targets `develop`; do not open new work against `migration/binance-native-ws`, `feature/brokers`, or `main`.
- Keep PRs focused on one broker task or a tightly coupled implementation/test/documentation change.
- A task is complete only after its PR is integrated into `develop`, all required checks pass, and this roadmap reflects the verified result.
- The responsible agent may merge a task PR after CI, target freshness, and ownership gates pass. No routine human approval is expected for `develop`.
- Keep all ongoing implementation and integration work on `develop`; do not create or manage release branches/PRs as part of a package task. Any separate release workflow requires an explicit user request.
- Do not claim a phase complete merely because a PR is open or CI has started.

Historical references to `migration/binance-native-ws` and its phase PRs above describe where earlier work was developed. They do not authorize new work on that retired long-lived branch.

---

## 10. Synchronization with the shared development branch

### Task branch synchronization

1. Before starting and before finalizing a task, fetch the latest `develop` and inspect changes affecting broker contracts, consumers, runtime, dependencies, tests, or documentation.
2. Merge the latest `develop` into the short-lived task branch. Preserve merge history; do not rebase or force-push shared history.
3. Resolve conflicts by reconciling complete files and preserving both domains' valid changes. Never blindly choose ours/theirs.
4. Re-run relevant broker tests, workspace checks, syntax checks, and dependency audit.
5. Verify required CI on the exact final PR head and confirm that the PR is up to date with `develop`.

### Shared develop branch policy

- `develop` is the only shared integration branch for ongoing implementation work in this repository.
- Create every task branch from the latest `develop`, keep it synchronized with `develop`, and target every implementation PR at `develop`.
- Do not independently update, synchronize against, or open task PRs targeting another branch.
- Release planning is a separate user-directed activity and is outside this package roadmap.
- Do not claim continuous background monitoring. Recheck branch state at task start, before opening a PR, and before reporting completion.

## 11. Official protocol and runtime references

Re-check these official sources during implementation because Binance protocol details and limits can change:

- [Binance Spot WebSocket API — Account](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/ws-api/account)
- [Binance Spot WebSocket API — Trade](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/ws-api/trade)
- [Binance Spot WebSocket API — General](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/ws-api/general)
- [Binance Spot WebSocket API — Market](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/ws-api/market)
- [Binance Spot WebSocket API — User Data Stream](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/ws-api/user-data-stream) — includes `session.subscriptions`, signature subscription, and subscription-scoped unsubscribe request/response schemas.
- [Binance Spot API changelog](https://github.com/binance/binance-spot-api-docs/blob/master/CHANGELOG.md) — 2025-08-12 documents one subscription per account per WebSocket API connection, HMAC signature subscription without Ed25519 login, and `session.subscriptions` listing.
- [Binance Spot WebSocket Streams — General](https://developers.binance.com/en/docs/products/spot/web-socket-streams)
- [Node.js v22 Global WebSocket documentation](https://nodejs.org/download/release/v22.23.4/docs/api/globals.html#class-websocket)
- [Node.js v22.23.4 release notes](https://nodejs.org/en/blog/release/v22.23.4) — includes Undici 6.29.1.
- [Binance Spot WebSocket API — protocol, responses, HMAC signing](https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-api.md) — request IDs are echoed, responses use `status` plus `result` or `error`, and HMAC-SHA-256 signs alphabetically sorted UTF-8 `key=value` parameters.

The [Phase 0 broker contract audit](../../docs/brokers-websocket-contract.md) records the sources reviewed and the findings at that audit date. Official docs remain authoritative if they change.


## 12. Cross-domain contract adoption

### Exact account balances (request #310)

- [x] Additive `getBalances()` API returns canonical Entities `Balance` values with exact free/locked `Quantity` amounts and a derived total (PR #312).
- [x] Preserve legacy `getAssets()` and its `Coin` result shape for compatibility; do not use its Number-based values for financial reconciliation.
- [x] Keep raw Binance asset codes intact when constructing canonical Asset identities; do not rewrite prefixed codes into another asset.
- [x] Include zero balances in the canonical snapshot so consumers can distinguish a confirmed zero from an omitted/unreported asset.
- [x] Consumer: Free-Roll recovery request #304 is integrated and verified through PRs #314/#315.

### Timestamped reconciliation snapshot ports (request #316)
- [x] Add `getServerTime()` using Binance `time` and `getAccountSnapshot()` exposing canonical balances with account `updateTime`.
- [x] Add validated `fromId` pagination to `getMyTrades()` and canonical `getFills()`, plus time-window filters to `getOrderHistory()` while preserving existing result shapes.
- [x] Validate response-side trade, fill, and order cursor IDs before exposing them; reject values outside JavaScript's safe-integer range ([PR #322](https://github.com/45s/coinzilla/pull/322)).
- [x] Keep full pages potentially incomplete by returning unchanged array results without a false `complete` claim; tests prove inclusive cursors can continue from the last returned ID + 1 without duplicates.
- Consumer: Free-Roll FR-057. Broker implementation is owned here; the consumer must not call Binance RPC methods directly.

### Canonical order-history records (request #321)
- [~] Add additive `getCanonicalOrderHistory()` returning immutable Entities `CanonicalOrder[]` while preserving the raw `getOrderHistory()` compatibility contract.
- Use exact `exchangeInfo` metadata for Market/Asset identity, preserve decimal strings and source timestamps, and map unsupported lifecycle states to canonical `UNKNOWN` without leaking Binance field names.
- Reject unsupported order types, malformed records, and unsafe numeric IDs; do not convert financial values through JavaScript `Number`.
- Consumer: Free-Roll FR-057 snapshot collection. Request: [#321](https://github.com/45s/coinzilla/issues/321).

## 13. Shared Entities contract adoption

### Canonical fills and commissions

- [~] Additive `getFills({ symbol, orderId?, fromId?, startTime?, endTime?, limit? })` returns immutable Entities `Fill` values backed by canonical `Market`, exact `Money`/`Quantity`, and `Commission` values.
- Preserve `getMyTrades()` and its existing plain-object result shape for current consumers; do not silently migrate bot code in this Brokers-owned change.
- Derive base/quote Asset identity only from the exact Binance `exchangeInfo` response for the requested symbol. Do not parse or split venue symbols.
- Preserve exact exchange decimal strings. Unknown commission denomination remains `UNKNOWN`; a confirmed zero commission is `COMPLETE` with an empty collection.
- Consumer migration is separate work. The Free-Roll recovery flow currently continues to use the compatibility `getMyTrades()` API until its owning domain deliberately adopts canonical fills.
- Canonical fill API implementation is present on `develop`; consumer migration remains separately owned by the bot domain.
