# Notifiers roadmap

**Owner:** packages/notifiers/  
**Status:** Telegram transport, provider-oriented source layout, reliability hardening, and Free-Roll consumer integration are merged into develop (PRs #346 and #348). A follow-up quality program is in progress on `feature/notifiers/telegram-quality-phases`.  
**Purpose:** provide small, dependency-free notification transports for operational alerts from Coinzilla applications.

Read AGENTS.md, README.md, and the repository's mandatory AI_AGENT_WORKFLOW.md.

## Product goals

1. Deliver high-signal operational events without coupling notification I/O to trading execution.
2. Keep the package dependency-free by preferring Node.js built-ins and injected side-effect boundaries.
3. Keep each transport isolated under its own folder, with a thin package entry point.
4. Make outbound content safe through explicit event allowlists and curated formatters.
5. Make delivery ordering, admission limits, failure handling, timeouts, and shutdown behavior explicit and testable.
6. Add transports only when a concrete consumer needs them; avoid speculative frameworks and empty provider scaffolding.

## Target architecture

    packages/notifiers/
      src/
        index.js                 # stable package exports only
        telegram/                # implemented
          index.js
          telegram-notifier.js
          telegram-event-subscriber.js
          format-telegram-notification.js
          *.test.js
        email/                    # future; create when implemented
        discord/                  # future; create when implemented

Each provider owns its transport client, provider-specific formatter, event integration where applicable, and tests. Keep cross-provider abstractions out until at least two implemented providers demonstrate a real shared contract.

## Phase 0 — Package foundation

- [x] Create the private pnpm workspace package @coinzilla/notifiers.
- [x] Define a thin public entry point and package-local AI-agent instructions.
- [x] Keep the initial scope Telegram-only and dependency-free.
- [x] Document setup, usage, security, and operational limitations.
- [x] Verify frozen lockfile installation in CI.

**Acceptance:** package is discoverable in the workspace and adds no runtime dependencies.

## Phase 1 — Telegram transport and event integration

- [x] Implement Telegram Bot API sendMessage using native fetch().
- [x] Validate token, chat ID, injected fetch, timeout, message length, HTTP response, and Telegram API response.
- [x] Format an explicit allowlist of lifecycle, recovery, pair-pause, order-fill, and execution-fill events.
- [x] Exclude raw exchange payloads and high-volume execution reports.
- [x] Serialize sends and expose explicit subscriber cleanup.
- [x] Integrate optional Telegram notifications into apps/bot-free-roll (consumer PR #346, merged).
- [x] Keep notifications disabled when both credentials are absent; reject partial configuration.

**Acceptance:** Telegram is optional, isolated from trading behavior, and usable without adding a runtime dependency.

## Phase 2 — Provider-oriented source layout

- [x] Move all Telegram-specific code and tests under src/telegram/.
- [x] Keep src/index.js limited to stable public re-exports.
- [x] Add src/telegram/index.js as the provider-local export surface.
- [x] Preserve the original formatNotification export as a compatibility alias.
- [x] Keep email/ and discord/ absent until those transports are actually implemented.

**Acceptance:** adding a provider does not scatter provider-specific code across the package root.

## Phase 3 — Reliability hardening and regression coverage

- [x] Ignore callbacks that begin after subscriber shutdown starts.
- [x] Make subscriber close idempotent and attempt every unsubscription even if one fails.
- [x] Attempt cleanup of all successful subscriptions when partial setup fails; preserve the original setup failure.
- [x] Add a configurable maxPending limit to bound the subscriber's local queue.
- [x] Recover the internal send queue after transport or logger failures.
- [x] Avoid duplicate delivery-error logging when a subscriber logger is configured; preserve event-bus reporting when it is not.
- [x] Normalize and bound untrusted event fields before formatting.
- [x] Redact Telegram credentials from transport and API error messages.
- [x] Reject malformed successful Telegram API responses instead of reporting false success.
- [x] Add deterministic regression tests for shutdown races, partial cleanup, queue overflow, malformed responses, secret redaction, and error recovery.
- [x] Pass package tests and the enforced 90% line / 85% branch coverage gate on the final merged commit.
- [x] Pass workspace tests, syntax, dependency audit, and all required CI checks on the final merged commit.

**Acceptance:** all resource cleanup paths are attempted, local pending work is bounded, failures remain observable, and no test requires real Telegram credentials or network access.

## Phase 4 — Future transports (demand-driven)

- [ ] **Email:** choose a provider/transport only after a consumer defines delivery, authentication, templates, and retry requirements. Keep implementation under src/email/.
- [ ] **Discord:** implement a webhook or bot adapter only after a consumer defines channel routing, payload format, and rate-limit requirements. Keep implementation under src/discord/.
- [ ] Define a shared provider contract only after at least two implemented transports demonstrate common behavior worth standardizing.
- [ ] Add transport-specific tests and coverage gates for every new provider.

**Acceptance:** each provider is independently testable, has clear operational guarantees, and does not introduce unnecessary dependencies into other transports.

## Phase 5 — Delivery guarantees (only when required)

- [ ] Define idempotency and duplicate-send semantics before implementing automatic retries.
- [ ] Add bounded retry/backoff and rate-limit handling if a consumer requires it.
- [ ] Add a persistent outbox only when crash-safe delivery is a product requirement and an appropriate storage owner exists.
- [ ] Add metrics/diagnostics only when their public contract is justified by production usage.

## Decision log

- Telegram is the first adapter because it satisfies the initial operator-alert use case.
- Node.js built-in fetch() is sufficient for Telegram's sendMessage; no SDK is needed.
- No Redis, worker, database, or external queue is included. The subscriber applies a local admission limit and serializes requests.
- No automatic retries: ambiguous network outcomes can produce duplicate messages.
- No subscribeAll(): explicit event allowlists reduce noise and prevent accidental sensitive-data disclosure.
- The package does not read environment variables; consuming applications own configuration and secret loading.
- The package does not promise durable or exactly-once delivery.
- Future provider folders remain absent until implementation begins.

## Completion policy

A roadmap item is complete only after its task PR is merged into develop and required CI checks pass. Never mark a task complete merely because code has been committed or a PR has been opened.


## Validation record

The refactor was merged to develop in PR #348. All required post-merge checks passed on commit 620818cb3ff3624c9869ab1d13fa181784dbbcbb:

- Unit tests: passed.
- Workspace test coverage: passed, including the notifiers 90% line / 85% branch gate.
- JavaScript syntax and actionlint: passed.
- Production dependency audit: passed.
- Utilities unit tests: passed.

CI run links: [Unit Tests](https://github.com/45s/coinzilla/actions/runs/41240703343), [Test Coverage](https://github.com/45s/coinzilla/actions/runs/41240703334), [JavaScript Syntax](https://github.com/45s/coinzilla/actions/runs/41240703427), [Dependency Audit](https://github.com/45s/coinzilla/actions/runs/41240703340), [Utils Unit Tests](https://github.com/45s/coinzilla/actions/runs/41240703355).


## Phase 4 — Integration confidence and operational diagnostics

- [~] Exercise the subscriber against the real EventBus implementation, including allowlisting, ordering, flush/close lifecycle, and failure reporting.
- [~] Expose immutable, process-local delivery counters for admitted, successful, failed, overflowed, and pending notifications.
- [~] Test the package through its public self-reference export, not only relative source imports.
- [ ] Validate all integration and diagnostic behavior with package and workspace CI on the PR head.

**Acceptance:** the adapter is verified against the real event-bus contract, and operators can distinguish admitted work, successful API sends, failures, and overload without inspecting mutable internals.

## Phase 5 — CI compatibility and documentation quality

- [~] Run the full unit suite on the pinned Node 22 baseline and the current Node 24 line.
- [~] Document diagnostics semantics, overload behavior, shutdown order, secret rotation, and common Telegram setup failures.
- [ ] Evaluate branch-coverage improvements using the resulting coverage report before raising thresholds; do not increase a percentage without evidence.
- [ ] Evaluate mutation testing only if it can run reproducibly without destabilizing the dependency-free package or adding unjustified maintenance cost.
- [ ] Record exact PR-head CI evidence and merge only after branch freshness and all required checks are verified.

**Acceptance:** supported Node lines are continuously exercised, operational guidance matches implementation, and any stronger quality gate is evidence-based rather than cosmetic.


## Phase 6 — Operator-controlled live verification

- [~] Add an explicit, credential-gated smoke-test command that sends one labeled message, validates the API result, and never retries.
- [~] Keep live delivery outside default CI and unit tests; document secure secret injection and the meaning of API acceptance.
- [~] Evaluate mutation testing. Deferred for now: the package has no established mutation-test infrastructure, the current test/coverage gates are stable and fast, and adding a separate mutation runner would add maintenance and CI cost without a demonstrated defect signal. Revisit if notifier complexity or regression history grows.
- [ ] Run the smoke test manually with a dedicated Telegram test chat after an operator supplies credentials.

**Acceptance:** live delivery can be verified deliberately without exposing secrets or making ordinary CI depend on external Telegram availability.
