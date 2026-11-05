# Harvester Journal Integration Roadmap

## Purpose and priority

This roadmap plans a small, staged integration of the existing `@coinzilla/event-bus` and `@coinzilla/journal` packages into Harvester.

**This work does not depend on trading or TESTNET progress.** EventBus and Journal provide operational observability for ordinary application lifecycle events. Harvester can record configuration validation, process startup/shutdown, and broker connectivity in read-only mode; no order, fill, position, or completed trading cycle is required.

The Journal is an operational observer, not trading-state authority or part of order execution, strategy evaluation, or fill accounting. Its persistence is optional only in configuration-only/no-broker mode. PR #545 added a mandatory account PREFLIGHT gate for every broker-connected startup, including read-only mode: the full account snapshot and account-wide open-order snapshot must be published and durably flushed before market subscriptions or trading-engine activation. After that gate passes, ordinary Journal event delivery remains asynchronous. The separate trading-safety contract requires order-submission and cancellation intent records to be durably flushed before the corresponding broker write; no other Journal I/O is awaited by market, strategy, or fill-accounting workflows. Trading-enabled graceful shutdown also requires a durable CLOSING account snapshot; failure is reported as incomplete shutdown.

Step 1 is implemented and merged into `develop` in [PR #453](https://github.com/45s/coinzilla/pull/453): the process entry point composes one EventBus and injects a best-effort publisher into bootstrap. No events are published and Journal is not initialized.

## Audit conclusions

- `@coinzilla/event-bus` already provides in-memory asynchronous fan-out, subscriber isolation, bounded pending deliveries, diagnostics, `flush()`, and `close()`.
- `@coinzilla/journal` already subscribes to EventBus, writes JSONL records through a serialized write queue, reports write failures, and drains/synchronizes on close.
- No shared-package changes are currently justified.
- Harvester already has suitable application boundaries: bootstrap lifecycle, the Conservative trading engine, order submission, sequential user-data processing, canonical Fill accounting, and Portfolio/RecoveryLedger transitions.
- Harvester has an application EventBus boundary, stable lifecycle event names/DTO mappings, an optional asynchronously started Journal service, and process/configuration/broker lifecycle publication.
- Initial lifecycle DTOs contain no financial amounts, so exact decimal-string preservation applies to later order/execution event mappings.
- Bot-Free-Roll is a reference for composition and lifecycle ownership, not a template to copy. In particular, its Journal startup/initial flush can prevent trading startup; Harvester must not inherit that dependency.

See [Architecture — operational event journal](./architecture.md#operational-event-journal) and the [AI implementation task](./tasks/AI_TASK_JOURNAL_INTEGRATION.md).

## Hard constraints

1. No trading, TESTNET, exchange credentials, orders, or fills are prerequisites for this roadmap. Use offline tests and a read-only/fake broker where useful.
2. Journal initialization is optional only when no broker is connected. Every broker-connected startup requires a ready Journal and durable PREFLIGHT account audit; a query, publication, or durability failure must stop startup before market subscriptions. Ordinary Journal write failures after the PREFLIGHT gate must not synchronously block trading workflows.
3. Never await Journal I/O from market-price evaluation, strategy policy, or fill-accounting processing. The explicit startup PREFLIGHT and trading-enabled CLOSING audits, plus the pre-side-effect order/cancel intent barriers, are the only approved durability waits.
4. Do not put Journal calls in awaited order lifecycle callbacks. Startup PREFLIGHT capture is serialized with early user-data delivery so events cannot race ahead of the account/order baseline; keep this exception confined to startup. The CLOSING audit runs after accepted user-data work has drained.
5. Event publication is best-effort. Catch both synchronous publication exceptions and failed `toResult` outcomes at the application boundary.
6. Keep domain policies pure and broker-independent. Domain code must not import EventBus or Journal.
7. Use object-shaped inputs and object-shaped results for functions. Use `toResult` for fallible workflows where appropriate.
8. Map application facts to small, plain, serializable DTOs. Never publish class instances, SDK objects, secrets, or whole account snapshots.
9. Do not journal every market-price update. Start with process/configuration/broker lifecycle events; add selected trading events later.
10. Keep live trading disabled by default. Default tests remain offline and credential-free.
11. Do not modify shared Journal/EventBus packages unless implementation reveals a reproducible, Harvester-blocking defect. Any such change needs a separate, explicitly justified cross-package task.
12. Every implementation PR must be small, independently testable, and update the relevant documentation and this roadmap in the same PR.

## Proposed event contract

All events use the existing EventBus envelope: generated event ID and timestamp, event name, source, and plain-object data. Use Harvester-owned names and stable business identifiers. Exact field names must be verified against the current source contracts before implementation; examples below are conceptual, not existing APIs.

| Event | Owner / publication point | Minimum useful data | Initial scope |
|---|---|---|---|
| `harvester.started` | Process entry point, after runtime startup | broker, mode, enabled markets, trading-enabled flag | Include |
| `harvester.startup_failed` | Process entry point, when startup fails | safe error name/message, startup stage | Include |
| `harvester.stopped` | Process entry point, after shutdown attempt | reason, shutdown outcome | Include |
| `config.validated` | Bootstrap, after validation | non-secret effective settings and enabled markets | Include |
| `broker.connected` / `broker.connection_failed` | Bootstrap around broker connection | broker identifier, outcome, safe error | Include |
| `broker.disconnected` | Bootstrap after disconnect attempt | broker identifier, outcome | Include |
| `broker.status_changed` | Broker/application boundary on meaningful stream transition | stream kind, status, safe reason | Include if source exposes transitions |
| `broker.subscription_established` / `broker.subscription_failed` | Bootstrap around subscriptions | market or stream kind, outcome | Include |
| `market.price_invalid` | Market-data boundary on rejected external data | market, validation reason, safe timestamp | Include |
| `strategy.decision` | Trading engine after meaningful policy result | strategy, market, reference price, action summary, reason | Include |
| `strategy.paused` / `strategy.resumed` | Trading engine on actual state transition | market, reason | Include if transition exists |
| `order.submission_requested` | Order use case after local pending registration, before broker call | client order ID, market, side, type, price, quantity | Include |
| `order.submitted` | Order use case after verified canonical acknowledgement | client/exchange order IDs, status | Include |
| `order.submission_failed` | Order use case on rejected/unknown outcome | identifiers, classified outcome, safe error | Include |
| `order.cancelled` / `order.cancel_failed` | Cancellation workflow after confirmed outcome | order IDs, final status, reason | Include |
| `execution.fill_applied` | Accounting workflow after successful Fill application | stable fill ID, order ID, market, side, actual price/quantity/fees | Include |
| `execution.rejected` / `execution.accounting_failed` | User-data/accounting boundary | safe identifiers and failure reason | Include |
| `execution.duplicate_ignored` | Fill deduplication boundary | fill ID, order ID | Optional |
| `portfolio.updated` / `position.opened` / `position.closed` | Portfolio transition boundary | market and compact resulting quantities/state | Defer unless a concrete operational question needs them |
| `recovery.cycle_completed` | Conservative recovery completion boundary | market, cycle identifiers, actual realized figures | Include only if a stable transition is exposed |
| `market.price_received` | Market-data boundary | price and market | Do not publish for every update; decision events already carry relevant price |

### Payload rules

- Preserve financial precision. Use canonical decimal strings for prices, quantities, fees, and monetary values.
- Include stable exchange/client order IDs and execution IDs where available.
- Distinguish requested, acknowledged, unknown, rejected, partially filled, and fully filled outcomes.
- An order acknowledgement is not a Fill; only actual normalized Fill facts change Portfolio.
- Do not serialize `Portfolio`, `Position`, `CanonicalOrder`, `Fill`, broker SDK objects, or raw exchange messages directly. Map the minimum required facts into plain DTOs.
- Never include credentials, signed requests, environment variables, or unnecessary account data.
- Avoid duplicate semantic events. If both an order-status transition and a fill are emitted, document their distinct meanings.

## Delivery model: one small PR per step

Do not combine the steps into one large PR. Each PR must contain only its milestone, focused tests, and the documentation/roadmap updates needed to describe the behavior that actually exists.

### Step 1 — Add an application EventBus boundary

**Status:** [x] Implemented, tested in CI, and merged into `develop` by [PR #453](https://github.com/45s/coinzilla/pull/453).

**Goal:** Introduce EventBus without changing trading decisions or broker behavior.

**Likely files:** `apps/harvester/package.json`; a focused application event publisher module; bootstrap composition; focused tests; this roadmap.

**Work:**
- Add `@coinzilla/event-bus` as a direct Harvester dependency.
- Construct exactly one EventBus in application composition and inject it explicitly.
- Implement a best-effort publisher that accepts one object argument and returns one object result.
- Catch synchronous publish exceptions and handle failed `toResult` results.
- Log publication failure once through the injected/default shared logger; logger failure must not escape into trading.
- Do not yet add Journal or publish high-volume events.

**Tests:** Accepted event; rejected result; synchronous throw; logger throw; malformed event; publisher never throws into its caller.

**Acceptance:** EventBus is composed once; no global singleton; no domain dependency; no trading behavior change; all publication failure cases are isolated.

**PR boundary:** EventBus dependency + publisher boundary + tests + minimal architecture/roadmap documentation only.

### Step 2 — Define stable Harvester event names and DTO mappings

**Status:** [x] Contract constants, allowlisted lifecycle DTO mappings, and offline contract tests are included in this PR; CI is the merge gate.

**Goal:** Define the application-owned event contract independently of Journal.

**Likely files:** `src/application/events/`; mapping helpers near the relevant application boundary; contract tests; architecture documentation; roadmap.

**Work:**
- Define stable event-name constants and focused DTO mapping functions for the initial process/configuration/broker lifecycle contract.
- Verify current Harvester startup/configuration fields and broker identifier before selecting payload fields; no SDK or domain objects are required for these lifecycle DTOs.
- Use one object input and one object result (`toResult({ data })`).
- Keep deterministic mapping and validation as pure application functions.
- Rely on the existing EventBus publisher boundary for plain-payload validation; EventBus rejects class instances and unsupported built-ins.
- Include safe identifiers; failure DTOs omit stack/cause and redact common labelled secret/token/authorization values.
- No financial amounts occur in these lifecycle DTOs; later financial DTOs must preserve exact decimal strings.
- Do not add event schemas for speculative events.

**Tests:** Every selected event payload; missing identifiers; invalid values; class-instance/unsupported-built-in rejection; secret omission/redaction; JSON serialization. Financial decimal precision is not applicable to this lifecycle-only contract and is required for later financial DTOs.

**Acceptance:** Contract names and payload examples are documented and tested; no EventBus/Journal imports in domain policy modules.

**PR boundary:** Event contract + DTO mapping + tests + documentation. No Journal lifecycle.

### Step 3 — Add optional, non-blocking Journal composition

**Status:** [x] Optional Journal service composition, asynchronous startup, health reporting, and offline failure tests are included in this PR; CI is the merge gate.

**Goal:** Connect the existing Journal to EventBus while keeping trading startup independent.

**Likely files:** `apps/harvester/package.json`; focused Journal preparation/lifecycle helper; `src/index.js` or bootstrap composition; tests; README/operations docs; roadmap.

**Work:**
- Add `@coinzilla/journal` as a direct dependency.
- Construct Journal with the shared EventBus, configured directory, and logger in `prepareOptionalJournal`.
- Start Journal asynchronously during process composition. Configuration-only/no-broker startup may proceed without it; broker-connected startup must complete the PREFLIGHT audit's durable flush before market subscriptions or engine activation.
- Expose `ready`, `status`, and an explicit `close()` operation; report startup/write/close outcomes without allowing logger failures to escape.
- The Journal subscribes only after its directory/session file is ready. Events published before that point are not captured; Steps 1–3 publish no application lifecycle events yet.
- Journal initialization failure must fail any broker-connected startup because the mandatory PREFLIGHT audit cannot be made durable; it must not affect configuration-only/no-broker startup.
- Do not await ordinary Journal record delivery from trading callbacks. Explicit PREFLIGHT/CLOSING account-audit flushes and the separate pre-side-effect order/cancel intent barriers are the only approved durability waits. Coordinated process shutdown draining remains Step 7.

**Tests:** Journal ready/close; invalid directory; pending initialization; construction exception with failing logger; disabled mode; write failure reflected in health status; Harvester startup proceeds while Journal readiness is pending.

**Acceptance:** With Journal unavailable, configuration-only/no-broker startup may proceed. Broker-connected startup must fail before market subscriptions if the PREFLIGHT audit cannot be durably recorded. After successful PREFLIGHT, ordinary trading callbacks do not await Journal writes.

**PR boundary:** Journal construction and optional lifecycle only; no broad event instrumentation.

### Step 4 — Publish configuration, process, and broker lifecycle events

**Status:** [x] Process/configuration/broker lifecycle instrumentation and offline tests are included in this PR; CI is the merge gate.

**Goal:** Make application startup and connectivity observable.

**Likely files:** `src/index.js`; `src/bootstrap/start-harvester.js`; event contract/mapping modules; tests; README/operations docs; roadmap.

**Work:**
- Publish validated non-secret configuration facts after trading configuration validation.
- Publish process startup/startup failure/shutdown outcomes from the process entry point.
- Publish broker connect/disconnect and user-data/market-price subscription outcomes from bootstrap.
- Publish only the broker user-data transitions exposed by the current broker callback: connectionClosed, recovering, recoveryFailed, recovered, reconciled, terminated, and rpcError. A recovered stream still requires Harvester's separate authoritative account/order reconciliation.
- Keep lifecycle ownership in the process/bootstrap layer; avoid duplicate started/stopped events. Never publish market-price updates.

**Tests:** Validated configuration; successful read-only startup without broker; startup failure; broker connect failure/success; user-data and market-price subscription success/failure; connectionClosed/recovered status filtering; normal/failed shutdown; publication failure containment.

**Acceptance:** One owner per lifecycle event; payloads contain no credentials, raw exchange messages, SDK/domain objects, or account snapshots; trading behavior is unchanged when publication fails. Journal capture gaps before subscription activation are explicit.

**PR boundary:** Lifecycle events only.

### Step 5 — Publish meaningful strategy and order lifecycle events

This step is split into small independently reviewable PRs to keep instrumentation narrow.

#### Step 5a — Actionable decisions and order submission

**Status:** Merged into `develop` by PR #460; all CI checks passed.

- Publish only actionable Conservative decisions after balance filtering; omit repeated NO_ACTION evaluations.
- Publish `order.submission_requested` after local PENDING registration and immediately before broker I/O.
- Publish `order.submitted` only after canonical acknowledgement validation and local registry update.
- Publish `order.submission_failed` for rejected/unknown outcomes with sanitized error details.
- Keep all payloads allowlisted and preserve exact decimal strings.
- Event publication remains synchronous best-effort admission only; never await subscriber or Journal work.

**Tests:** DTO allowlisting/redaction and exact decimal preservation; malformed decimal rejection; event ordering around broker I/O; no-action filtering; rejected and unknown outcomes; publisher throw and never-resolving promise do not block broker submission.

**PR boundary:** Actionable strategy decision + submission request/acknowledgement/failure only. No pause/resume, cancellation, execution, or accounting events.

#### Step 5b — Pause and trailing BUY cancellation transitions

**Status:** Merged into `develop` by PR #461; all CI checks passed.

- Publish the first actual pair-pause transition only; the current engine has no pair-resume transition, so do not invent one or emit a synthetic resume event.
- Publish confirmed trailing BUY cancellation only after canonical broker confirmation and registry update.
- Publish trailing BUY cancellation failure/unknown outcome with safe identifiers and bounded error details.
- Keep recovery SELL cancellation instrumentation separate as Step 5c.
- Preserve current cancellation/fill reconciliation and pause behavior exactly.

**PR boundary:** First pause transition and trailing BUY cancellation outcomes only. Recovery SELL cancellation is Step 5c. Resume events remain deferred until a real resume transition exists; do not include execution/accounting events.

### Step 6 — Publish execution and accounting facts

Split this work into two independently reviewable PRs; Step 6a must merge before Step 6b begins.

#### Step 6a — Successful Fill application

**Status:** Merged into `develop` by PR #465; all CI checks passed.

**Goal:** Record actual executions without changing accounting authority.

**Likely files:** `src/bootstrap/start-harvester.js`; `src/use-cases/update-trading-accounting.js`; focused DTO mappers; tests; event documentation; roadmap.

**Work:**
- Publish `execution.fill_applied` only when `updateTradingAccounting` reports `applied: true`, after the existing wrapper has committed both Portfolio and RecoveryLedger.
- Use a small allowlisted DTO containing stable fill/trade/order identifiers, symbol, side, exact price/quantity/quote-quantity strings, liquidity role, execution time when present, exact commission amount plus asset ID/code for each commission, and commission status.
- Do not publish repeated duplicate fills in this PR; duplicate suppression is Step 6c.
- Keep the sequential user-data queue and all current accounting invariants unchanged.
- Do not await EventBus delivery or Journal in the user-data queue.

**Tests:** Partial Fill; full Fill boundary where already covered; event only after accounting commit; duplicate Fill does not emit applied; malformed DTO; canonical decimal values remain unchanged; publisher failure while Portfolio/RecoveryLedger still update correctly.

**Acceptance:** Only newly applied canonical fills produce `execution.fill_applied`; Journal failure cannot block valid execution processing or strategy reevaluation.

**PR boundary:** Successful Fill application only.

#### Step 6b — Invalid execution and accounting failure diagnostics

**Status:** Merged into `develop` by PR #467; all CI checks passed.

- Publish invalid/missing Fill and unowned-order execution facts with safe identifiers.
- Publish accounting failures after the existing accounting workflow returns failure.
- Preserve existing pause behavior, serialized user-data ordering, and accounting authority.
- Do not publish duplicate-fill or recovery-completion events in this PR; those are Step 6c.

**Tests:** Missing/invalid Fill; fill/order identity mismatch after a distinct order update; unowned order; unsupported commission; accounting failure; publisher failure isolation.

**PR boundary:** Invalid/unowned execution and accounting failures only.

#### Step 6c — Duplicate and recovery-cycle diagnostics

**Status:** Merged into `develop` by PR #468; all CI checks passed.

- Optionally publish idempotent duplicate-fill suppression when the accounting result explicitly reports `duplicate: true`.
- Publish recovery completion only after the existing domain/application transition reports it eligible and commits the new cycle.
- Preserve existing accounting and strategy behavior.

**Tests:** Duplicate Fill; successful recovery completion; ineligible/failed completion; publisher failure isolation.

**PR boundary:** Duplicate and recovery-cycle transitions only.

### Step 7 — Complete shutdown draining and end-to-end failure isolation

Split this work into three independently reviewable PRs; each must merge before the next begins.

#### Step 7a — Stop intake, drain user-data, disconnect broker

**Status:** Merged into `develop` by PR #470; all CI checks passed.

- Close the trading gate and stop market-price plus user-data intake before draining.
- Ignore late callbacks after shutdown begins.
- Await the already-accepted serialized user-data queue.
- Disconnect the broker only after the queue drains.
- Preserve startup-failure cleanup behavior.

**Tests:** Pending user-data observer; both subscriptions removed before queue completion; broker remains connected while queue drains; broker disconnect occurs after drain; late user-data callbacks are ignored.

**PR boundary:** Broker intake and user-data queue shutdown ordering only.

#### Step 7b — Flush and close Journal/EventBus

**Status:** Merged into `develop` by PR #471; all CI checks passed.

- Publish the final `harvester.stopped` event while Journal and EventBus are still available.
- Close Journal after the final event so it can unsubscribe, drain accepted writes, and sync.
- Close EventBus after Journal.
- Do not await Journal during trading or user-data processing.

**Tests:** Final event captured before Journal close; pending Journal write drained; Journal closed before EventBus.

**PR boundary:** Normal observability shutdown ordering only.

#### Step 7c — Cleanup failure isolation and bounded shutdown

**Status:** Merged into `develop` by PR #472; all CI checks passed.

- Isolate runtime stop, Journal close, and EventBus close failures so later cleanup still runs.
- Coalesce repeated SIGINT/SIGTERM shutdown requests.
- Clean up observability after startup failure.
- Use the EventBus timeout contract; never report timeout as successful flush.
- Set non-zero process exit status when shutdown is incomplete.

**Tests:** Runtime stop failure; thrown/returned Journal close failure; EventBus close timeout; repeated shutdown; startup failure cleanup; no unhandled rejection.

**PR boundary:** Failure isolation, timeout reporting, and shutdown idempotency only.

### Step 8 — Final documentation and operational verification

**Status:** In progress on branch `docs/harvester/journal-operations-closeout`. PR #473 separately fixed the documented Journal environment settings.

**Goal:** Close the feature with accurate docs and evidence.

**Likely files:** Harvester README, architecture, operations/journal documentation, roadmap, AI task closeout.

**Work:**
- Document event inventory and actual payloads.
- Document journal path/configuration, file naming/session behavior, permissions, disk-full behavior, and retention/rotation limitations based on the actual Journal package.
- Document how to diagnose Journal health and missing capture windows.
- Verify no secrets are recorded.
- Run the full Harvester suite, coverage, relevant shared-package tests, and repository CI.
- Inspect actual JSONL records from an offline integration run.

**Acceptance:** Documentation describes only shipped behavior; CI is green; tests prove failure isolation; no live credentials/network are needed for default tests.

**PR boundary:** Documentation and final verification only, unless a specific defect is found (fix that in a separate focused PR).

## Cross-step definition of done

Every implementation PR must:
- Be one small milestone; do not bundle future steps.
- Update this roadmap and relevant docs in the same PR.
- Add deterministic offline tests for success, failure, boundaries, and lifecycle behavior relevant to that step.
- Preserve all existing Harvester tests and trading behavior.
- Demonstrate that Journal is never awaited by the trading workflow.
- Use existing `@coinzilla/utils` helpers and logger; do not duplicate generic helpers.
- Use `toResult` for fallible workflows where appropriate.
- Keep pure calculations, decisions, and deterministic mappings as plain pure functions.
- Use one object argument and one object result for functions.
- Keep strategy policies broker-independent.
- Avoid global `console` usage.
- Keep TESTNET tests opt-in and live trading disabled by default.
- State exact tests/checks run; never claim unrun checks passed.

## Explicit non-goals for this integration

- Durable Portfolio/RecoveryLedger persistence or restart recovery within this observability integration.
- Journal replay as a source of trading state within this observability integration.

A separate Harvester P0 recovery track may consume the Journal as validated recovery evidence; that work must define its own idempotency, ownership, checkpoint, and exchange-reconciliation guarantees. The operational Journal integration remains an observer and does not independently authorize trading.
- Exactly-once delivery.
- Database/outbox infrastructure.
- Every-tick market data capture.
- Notifications, dashboards, or operator control panels.
- Refactoring working strategy/order/accounting code solely to make instrumentation cleaner.
- Changes to shared Journal/EventBus packages without a separately justified defect.

## Status

- [x] Read-only source audit completed.
- [x] Step 1: EventBus boundary (PR #453).
- [x] Step 2: event contracts and DTOs (PR #455).
- [x] Step 3: optional Journal composition (PR #456).
- [x] Step 4: lifecycle events (PR #458).
- [x] Step 5a: actionable strategy decisions and order submission (merged PR #460).
- [x] Step 5b: pause and trailing BUY cancellation transitions (merged PR #461).
- [x] Step 5c: recovery SELL cancellation transitions (merged PR #463).
- [x] Step 5: strategy/order events (PRs #460, #461, #463).
- [x] Step 6a: successful Fill application event (merged PR #465).
- [x] Step 6b: invalid execution and accounting failure diagnostics (merged PR #467).
- [x] Step 6c: duplicate and recovery-cycle diagnostics (merged PR #468).
- [x] Step 6: execution/accounting events (PRs #465, #467, #468).
- [x] Step 7a: stop intake, drain user-data, disconnect broker (PR #470).
- [x] Step 7b: flush and close Journal/EventBus (PR #471).
- [x] Step 7c: cleanup failure isolation and bounded shutdown (PR #472).
- [x] Step 7: shutdown and failure isolation (PRs #470–#472).
- [ ] Step 8: final documentation and verification.
