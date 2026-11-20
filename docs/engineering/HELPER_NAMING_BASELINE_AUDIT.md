# Helper Naming Baseline Audit — Non-Harvester Scope

**Tracking:** [Issue #1582](https://github.com/45s/coinzilla/issues/1582)  
**Audit date:** 2026-11-20  
**Scope:** `packages/` helper modules only. **`apps/harvester/` was explicitly excluded and not inspected or modified.**

## Audit method and limits

Reviewed repository naming standards and source-level evidence available through GitHub search and file retrieval. The current naming scanner is heuristic: it detects a fixed list of vague filenames and exported function names, but does not detect contextually vague names such as `adaptMsg`, `adaptUser`, or `run-validation.js`.

This is a focused audit of discoverable package helper modules, not a verified complete repository baseline. GitHub search results and source retrieval are not equivalent to running the scanner against a checkout. No tests or local scanner execution are claimed.

## Findings

### P1 — Binance WebSocket event adapter uses an ambiguous abbreviation

- **File:** `packages/brokers/src/infrastructure/binance/broker-websocket/helpers/adapters/adapt-msg.js`
- **Export:** `adaptMsg(message)`
- **Evidence:** The implementation dispatches Binance WebSocket event types and normalizes execution reports, account events, aggregate trades, and list-status events. Its name does not communicate the event source or event-normalization behavior.
- **Proposed:** `adapt-binance-websocket-event.js` / `adaptBinanceWebSocketEvent`.
- **Consumers located:** `user-data-client-adapter.js`, its colocated test, and `adapt-canonical-fill.test.js` (dynamic import).
- **Classification:** Genuine naming issue; rename requires updating all imports and tests.

### P1 — Binance user-data adapter module is too generic

- **File:** `packages/brokers/src/infrastructure/binance/broker-websocket/helpers/adapters/user.js`
- **Export:** `adaptUser`
- **Evidence:** The object maps Binance user-data event types (balance update, account information/position, execution report, list status) into normalized payloads. `user` does not identify the event contract or transformation.
- **Proposed:** `user-data-event-adapters.js` / `userDataEventAdapters`.
- **Consumers located:** `adapt-msg.js` and `user.test.js`.
- **Classification:** Genuine naming issue; rename should be done with the parent event-adapter rename.

### P2 — Telegram input validation helper filename starts with vague verb

- **File:** `packages/notifiers/src/telegram/helpers/run-validation.js`
- **Exports:** `validateTelegramOptions`, `validateTelegramMessage`
- **Evidence:** Validates notifier configuration and outbound message constraints. The filename's `run-` prefix does not add meaning.
- **Proposed:** `telegram-input-validation.js`.
- **Consumers located:** `notifier.js`, `run-validation.test.js`, architecture test, package coverage configuration, README, ROADMAP, and Modularity Standard examples.
- **Classification:** Genuine naming issue; docs, tests, and coverage command must be updated together.

### P2 — Telegram API response validation helper filename is vague

- **File:** `packages/notifiers/src/telegram/helpers/run-response-validation.js`
- **Exports:** `assertHttpResponse`, `getHttpStatus`, `createHttpFailure`, `validateSuccessfulPayload`
- **Evidence:** It validates HTTP response shape, status, Telegram API failures, and successful sendMessage payloads. `run-` is redundant and the filename does not clearly identify the Telegram API response boundary.
- **Proposed:** `telegram-api-response-validation.js`.
- **Consumers located:** `notifier.js`, architecture test, package coverage configuration, README, ROADMAP, and Modularity Standard examples.
- **Classification:** Genuine naming issue; update all references atomically.

### P2 — Error-message helper filename is abbreviated and uses a generic getter prefix

- **File:** `packages/notifiers/src/telegram/helpers/get-safe-error-msg.js`
- **Export:** `safeErrorMessage`
- **Evidence:** The function converts arbitrary errors to bounded text and redacts raw/URL-encoded Telegram tokens. The filename abbreviates `message` and uses `get-` despite performing sanitization.
- **Proposed:** `sanitize-error-message.js` / `sanitizeErrorMessage` (or retain the export if compatibility review shows it is part of a public contract).
- **Consumers located:** `notifier.js`, `run-response-validation.js`, its colocated test, architecture test, coverage configuration, README, ROADMAP, and Modularity Standard examples.
- **Classification:** Genuine naming issue; rename is coupled with Telegram response helper cleanup.

## Names reviewed — no change recommended

- `packages/event-bus/src/helpers/options.js` — `validateOptions` is clear within EventBus module context.
- `event-name.js` — `isValidEventName` is descriptive.
- `payload.js` — `assertSupportedPayload` and `cloneAndFreezePayload` describe the contract.
- `delivery-capacity.js` — `canAcceptDeliveries` is descriptive.
- `packages/journal/src/helpers/journal-record.js` — `serializeJournalRecord` and `parseJournalSession` clearly describe the format boundary.
- Binance `adapt-book-ticker.js`, `adapt-kline.js`, `adapt-trades.js`, `order-history.js`, `canonical-fills.js`, `order-request-params.js`, `history-query-params.js`, `symbol-filter-adapters.js`, `public-stream-adapters.js`, and `user-data-event-deduplicator.js`: names are reasonably specific in their exchange/infrastructure context. `params` is an abbreviation but not currently prioritized over the findings above.

## Prioritized remediation

1. Rename the Binance event adapter and user-data adapter together; update the three identified call sites/test references and add/adjust tests for the renamed public internal exports.
2. Rename Telegram validation, response-validation, and error-message sanitization modules as one cohesive package refactor; update imports, architecture tests, coverage script paths, README, ROADMAP, and standards examples.
3. Re-run the full helper naming scanner and package tests/coverage for Brokers and Notifiers; review scanner output manually.
4. Expand search/retrieval to remaining helper directories before calling the baseline complete.

## Out of scope

- `apps/harvester/` — explicitly excluded; no audit, source edits, or recommendations made for this application.
- Runtime behavior, domain logic, and public package contracts — no changes proposed.
