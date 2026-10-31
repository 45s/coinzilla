# Bug-Resistance Roadmap

Goal: make Coinzilla safer to change and release, without adding product features.

Prioritize demonstrated engineering risks over checklist progress. Keep changes focused, inspect complete affected files against current `main`, and verify mergeability and checks before calling work complete.

## 1. Make CI trustworthy

- [x] Provide repository workflows for package tests and workspace test coverage.
- [x] Audit which tests need environment variables, network access, exchange APIs, or other external services.
- [x] Separate deterministic unit tests from integration tests that contact exchanges or other services.

  Audit result: the broker package has two `.integration.js` tests that require network access. The default `pnpm test` runs package `node --test` scripts and discovers `.test.js` files, so those integration tests are not part of the deterministic unit-test run. Run them explicitly with `pnpm --filter @coinzilla/brokers test:integration`; the Binance SDK integration suite skips unless non-placeholder credentials are configured. Integration tests are not currently run in CI.
- [ ] Verify all relevant checks consistently pass on pull requests; distinguish checks that run from checks enforced by branch protection.
- [ ] Give unit tests explicit test configuration and mocks. Keep live API tests opt-in and use GitHub Secrets only when genuinely required.

## 2. Protect main and improve change safety

- [x] Protect `main`: require pull requests and passing required status checks; enable review requirements where appropriate.

  Current configuration: the active repository ruleset `core` targets `refs/heads/main`, requires a pull request, requires the branch to be up to date, requires conversation resolution, and enforces these status checks: `Run package tests`, `Check JavaScript syntax`, `packages/utils tests`, and `Audit production dependencies`. It requires zero approvals, has no bypass actors, and blocks force pushes and deletions.
- [x] Pin third-party GitHub Actions to reviewed commit SHAs where practical.
- [ ] Review dependency updates and GitHub Actions permissions for least privilege.

## 3. Test critical behavior

- [ ] Audit test coverage across every package and important cross-package flow.
- [ ] Cover invalid input, missing data, API errors, timeouts, retries, duplicate events, concurrency, and partial failures.
- [ ] Keep tests isolated, repeatable, and independent of execution order.
- [ ] Add a regression test for each bug fix when practical.

## 4. Improve code quality and dependency safety

- [ ] Add consistent linting and formatting checks if the repository does not already enforce them. GitHub Actions workflow linting is enforced by the existing JavaScript Syntax workflow; JavaScript linting and formatting are still follow-up work.
- [x] Add dependency vulnerability checks to CI.

  Current check: `pnpm audit --prod --audit-level high` runs on pull requests, pushes to `main`, and the weekly schedule.
- [x] Keep the existing mock Binance key/secret examples in `.env.example` to demonstrate expected format, with an explicit comment that the values are fake.

## 5. Release safely

- [x] Document release and rollback steps.
- [ ] Verify critical workflows in a staging/test environment before production use.

## 6. Remove third-party runtime dependencies from the Binance broker

### Goal and non-goals

The target is a Binance broker implementation with **zero third-party runtime dependencies**. Use Node.js built-in capabilities for WebSocket transport and cryptography. Existing internal workspace packages such as `@coinzilla/entities` and `@coinzilla/utils` may remain where they provide shared project contracts; they are not third-party dependencies.

For the supported Binance integration, use WebSockets for both:
- **WebSocket API (request/response):** order placement, order cancellation, order status/history, account status, trade history, symbol exchange information, and authenticated user-data subscription.
- **WebSocket Streams (push events):** market data and user-data events.

Do not build a new REST trading client. Move symbol-filter retrieval to the WebSocket API `exchangeInfo` method. The old custom REST broker and REST helpers are legacy code: mark them deprecated, stop expanding them, and remove them once compatibility and consumer checks prove they are unused.

This is a transport/dependency modernization, not a bot feature project. Do not modify `apps/bot-free-roll` or other bot application code as part of this roadmap. Preserve the existing broker-facing behavior used by consumers while the implementation is replaced.

### Current findings (baseline; re-check before implementation)

- `packages/brokers/package.json` declares `@binance/spot` as a runtime dependency.
- `BinanceSdkBroker` delegates WebSocket API and WebSocket Streams work to `@binance/spot`.
- Its order/account methods already use the WebSocket API. `getSymbolFilters()` is currently the notable direct REST call and should move to WebSocket API `exchangeInfo`.
- The old custom `BinanceStreamClient` is not a safe replacement yet: `WS.js` has a stubbed `createWebSocket()`, assumes an EventEmitter-style socket with low-level `ping()`/`pong()`, and its listen-key management uses the legacy REST path.
- Existing public exports and consumer method names are compatibility requirements until a deliberate migration proves otherwise.

These are audit observations, not permission to assume undocumented Binance protocol behavior. Verify each method and event against current official Binance Spot WebSocket API and Streams documentation during implementation.

### Architecture rules

- One small, well-defined native WebSocket transport; inject a socket factory for deterministic tests.
- Separate the WebSocket API RPC connection from market-data stream connections. Do not blur their message formats, authentication, reconnect rules, or lifecycle.
- Keep protocol handling, signing, message validation/adaptation, and broker-level result mapping in separate testable modules.
- Use Node.js built-in `WebSocket` and `node:crypto` only if the repository's supported Node runtime provides the required behavior. Prove this in CI and integration tests before removing the SDK. Do not add another WebSocket package as a shortcut.
- No hidden network calls in unit tests. Use fake sockets and deterministic clocks/timers where needed; keep live exchange tests opt-in.
- Never automatically replay an order-placing or other state-changing RPC after an uncertain disconnect. Surface an explicit uncertain outcome and reconcile by client order ID/order query before retrying.
- Reconnect market streams safely and restore desired subscriptions without duplicating handlers. Make connection state and shutdown behavior explicit.
- Treat credentials and signed payloads as secrets: never log API secrets, private keys, signatures, or full authenticated payloads.
- Do not claim zero third-party runtime dependencies until the production dependency tree and lockfile confirm it.

### Phased delivery plan

Each phase is a separate, reviewable PR unless a tightly coupled test or documentation change belongs with its implementation. Keep each PR limited to the broker package, its tests, root dependency metadata/lockfile when required, and relevant documentation. Never stack work on a stale base.

#### Phase 0 — Contract and dependency inventory

- [ ] Inventory every export from `packages/brokers`, every method used by repository consumers, and all imports of `@binance/spot`.
- [ ] Map each required broker method to its Binance WebSocket API or Streams operation, including parameters, response shape, authentication, and error behavior.
- [ ] Confirm the supported Node.js versions and the native WebSocket API available in those versions.
- [ ] Verify current Binance documentation for WebSocket API connection/authentication, request IDs, signing, rate limits, session lifetime, user-data subscription, stream limits, and reconnect behavior.
- [ ] Record the compatibility contract and identify legacy REST exports that can be deprecated.
- **Exit criteria:** a checked-in method/protocol matrix; no unknown consumer dependencies; a clear transport decision supported by runtime and Binance documentation. No runtime code changes in this phase.

#### Phase 1 — Characterization tests and test seams

- [ ] Add broker contract tests for the public methods that must remain compatible.
- [ ] Add fake-socket infrastructure that can simulate open, message, error, close, timeout, and late/duplicate responses.
- [ ] Capture existing normalization and `toResult` behavior in tests before changing implementation.
- [ ] Add regression cases for concurrent requests, malformed messages, unknown request IDs, and disconnects during requests.
- **Exit criteria:** tests describe existing required behavior without relying on live credentials or network access.

#### Phase 2 — Native WebSocket transport

- [ ] Implement a small Node-native WebSocket transport with injectable construction.
- [ ] Normalize lifecycle events, message data, close codes/reasons, and send failures behind one internal interface.
- [ ] Implement explicit connect/close state, connection timeout, idempotent shutdown, and listener cleanup.
- [ ] Verify server ping/pong behavior using the native implementation; do not call unsupported low-level socket methods.
- [ ] Test duplicate close/error events, connect failure, close during connect, send while disconnected, and cleanup.
- **Exit criteria:** transport unit tests pass on every supported Node version; no third-party WebSocket package is introduced.

#### Phase 3 — WebSocket API RPC client

- [ ] Implement request IDs and a pending-request map with deterministic response correlation.
- [ ] Implement bounded request timeouts, cleanup on every success/failure path, and rejection of pending work on disconnect.
- [ ] Implement the authentication/signature scheme required by the selected Binance WebSocket API methods using `node:crypto`.
- [ ] Validate response envelopes and normalize Binance API errors without losing error codes or useful context.
- [ ] Handle concurrent requests and out-of-order responses.
- [ ] Make reconnect behavior explicit; never silently replay state-changing requests.
- **Exit criteria:** fake-socket tests cover successful, failed, timed-out, malformed, concurrent, and interrupted RPCs; signing has known test vectors.

#### Phase 4 — WebSocket Streams client

- [ ] Implement market-stream connection and subscription management using the native transport.
- [ ] Support the streams required by current consumers first, then preserve other already-exported stream methods where they are part of the compatibility contract.
- [ ] Validate stream names and parameters before sending or opening a connection.
- [ ] Handle raw and combined-stream envelopes consistently and adapt events through pure functions.
- [ ] Track desired subscriptions and restore them after reconnect without duplicate listeners.
- [ ] Respect Binance connection, subscription, and message limits; expose actionable errors for rejected subscriptions.
- **Exit criteria:** deterministic tests cover subscribe/unsubscribe, combined streams, message adaptation, reconnect/resubscribe, malformed events, and shutdown.

#### Phase 5 — Rebuild the broker on the native clients

- [ ] Replace `BinanceSdkBroker` internals with the new WebSocket API and Streams clients while preserving its public methods and result shapes.
- [ ] Implement order place/cancel/query, open orders, account status, order history, and trade history through WebSocket API methods.
- [ ] Move `getSymbolFilters()` from REST to WebSocket API `exchangeInfo`; preserve validated `tickSize`/`stepSize` output and error behavior.
- [ ] Preserve `subscribeForPrices()` and `subscribeForUserData()` consumer contracts, including normalized event payloads.
- [ ] Make `connect()` failure-safe if either connection fails; make `disconnect()` idempotent and ensure all resources are released.
- [ ] Keep order mutation uncertainty visible to callers; do not retry blindly after connection loss.
- **Exit criteria:** broker contract tests pass against the native clients; no REST request is required by the supported broker path.

#### Phase 6 — User-data session lifecycle and recovery

- [ ] Implement the current documented WebSocket API user-data subscription/authentication flow; do not carry forward the legacy REST listen-key timer by assumption.
- [ ] Handle session expiration, subscription failure, disconnect, reconnect, and resubscription explicitly.
- [ ] Define event ordering/deduplication expectations and ensure reconnect does not register duplicate callbacks.
- [ ] Test execution reports, account updates, duplicate events, gaps, and recovery behavior.
- [ ] Document what cannot be recovered from the stream alone and which WebSocket API queries are used for reconciliation.
- **Exit criteria:** user-data subscription and recovery behavior is covered by deterministic tests and an opt-in testnet integration test.

#### Phase 7 — Remove the SDK and retire legacy REST implementation

- [ ] Confirm all repository consumers use the supported WebSocket broker contract.
- [ ] Mark the old custom REST broker and REST-specific exports as deprecated before removal, with a clear migration note.
- [ ] Remove `@binance/spot` from `packages/brokers/package.json` and regenerate `pnpm-lock.yaml`.
- [ ] Remove dead REST transport/signing/adaptation code only after confirming no supported consumer imports it.
- [ ] Remove or replace obsolete tests and examples; retain useful compatibility tests.
- [ ] Search the full repository for remaining `@binance/spot` imports and obsolete REST broker references.
- **Exit criteria:** no `@binance/spot` reference remains in runtime manifests or source; production dependency audit and lockfile confirm no third-party runtime dependency is required by `@coinzilla/brokers`; all supported consumer imports remain valid.

#### Phase 8 — Operational hardening and completion

- [ ] Add opt-in Binance testnet integration coverage for connection, public stream, signed RPC, order lifecycle where safe, and user-data events.
- [ ] Document supported Node versions, required API permissions, endpoints, reconnect semantics, rate limits, failure modes, and safe shutdown.
- [ ] Verify package tests, full workspace tests, syntax checks, production dependency audit, and the repository's required branch-protection checks.
- [ ] Review logs for secret leakage and ensure timers, sockets, and listeners are cleaned up on shutdown.
- **Exit criteria:** all required CI checks pass on the exact PR head; opt-in integration checks are documented and their results recorded; no bot application files were changed; roadmap completion is based on verified evidence.

### PR sequencing and review policy

1. Phase 0 is the first PR: inventory and protocol matrix only.
2. Complete and review each phase before beginning the next phase's implementation.
3. Keep PRs small enough to review, but replace complete affected files when that reduces merge-conflict risk.
4. Do not merge PRs automatically. Wait for the user's review/merge instruction.
5. If Binance documentation, Node runtime behavior, or a consumer contract contradicts this plan, stop and update the roadmap before coding around the discrepancy.
6. Update checkboxes only after the phase's exit criteria are verified. A PR being opened or CI merely starting does not mean a phase is complete.


## 7. Keep the migration branch synchronized with main

The migration branch is an integration branch, not a long-lived fork. `main` remains the source of truth because other teams continue developing bot and broker functionality there. Prevent drift throughout the migration, not only during the final release.

### Mandatory monitoring and immediate sync triggers

- Before starting **every** migration task or phase, inspect the latest `main` and compare it with `migration/binance-native-ws` since the last recorded sync.
- Recheck `main` before opening each migration PR and before declaring a phase complete. For long-running work, recheck before finalizing the work; do not rely on a snapshot taken at task start.
- **Immediately after significant broker/API changes land on `main`, stop further migration implementation and synchronize `main` into `migration/binance-native-ws` before continuing.** Do not wait for the next phase or the final release.
- Treat a change as significant if it changes broker package exports or implementation, Binance/API or WebSocket behavior, broker method signatures or result/event shapes, shared entities/configuration used by brokers, Node.js or package-manager/runtime requirements, dependency manifests/lockfiles, or tests/fixtures that define those contracts. Also treat new broker consumers or changes to existing consumers' broker usage as significant.
- When uncertain whether a main-branch change affects the migration, inspect it and treat it as significant until proven otherwise.
- Record the last synchronized `main` commit SHA and a concise summary of relevant changes in the migration PR/roadmap notes. Never claim continuous background monitoring: the agent must perform these checks at each work session and at the checkpoints above.

### Safe synchronization procedure

1. Fetch the latest `main` and integration branch refs. Compare the commits since the last sync and review the commit messages and changed-file list; inspect the full relevant diffs for broker/API, consumer, runtime, dependency, and test changes.
2. Update the migration branch by merging the latest `main` into `migration/binance-native-ws`. Preserve a merge commit; do not rebase or force-push the shared integration branch.
3. Resolve conflicts by understanding both sides' intent and reconciling the complete affected files. Never blindly choose ours/theirs, discard bot-team changes, or revert unrelated work to make the merge easy.
4. Do not independently edit bot application files (including `apps/bot-free-roll`) as part of this migration. Changes already made by other teams and merged through `main` must be preserved. If those changes reveal a broker contract requirement, adapt the broker migration and tests on the migration branch without taking ownership of bot feature work.
5. Re-run the relevant package tests, workspace tests, syntax checks, and dependency audit. Verify all required checks on the exact synchronized integration-branch commit before continuing.
6. Re-audit the broker consumer inventory, method/protocol matrix, and migration assumptions. Update this roadmap and the phase scope if `main` introduced new consumers, changed contracts, or invalidated earlier findings.
7. If conflicts or behavior changes cannot be resolved confidently, stop and report the exact files/contracts in question rather than guessing.

Use a dedicated synchronization PR from `main` into `migration/binance-native-ws` when direct branch synchronization is not available or when review of the incoming changes is useful. The synchronization PR must target the integration branch, preserve the merge history, and pass the integration branch's required checks. Never merge migration work into `main` during the phased implementation.

### Required checkpoints

- Before Phase 0 inventory and before each subsequent phase begins.
- Immediately after any significant broker/API or consumer-contract change is detected on `main`.
- Before each phase PR is opened and before its completion is reported.
- Before the final release PR from `migration/binance-native-ws` to `main`.

The final release PR is not a substitute for ongoing synchronization. Its purpose is to deliver an already-current, fully tested integration branch to `main`.

## Working rules

- Work one meaningful change at a time.
- Before editing, inspect the latest `main`, the complete affected file(s), related tests, and branches/PRs touching the same paths.
- When changes overlap, reconcile the full file against current `main`; do not stack stale, partial patches.
- Run the narrow tests first, then relevant package/workspace checks. Fix failures rather than hiding them or using empty commits to restart CI.
- Check mergeability and all relevant CI results after pushing. Never claim checks are green while they are pending or failed.
- Update this roadmap when a task is actually verified complete; distinguish repository configuration from checks that are merely present.
