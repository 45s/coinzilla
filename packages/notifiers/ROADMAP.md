# Notifiers roadmap

**Owner:** `packages/notifiers/`  
**Status:** Initial implementation in progress on `feature/notifiers`.  
**Purpose:** provide a small, transport-focused notification package for operational alerts from Coinzilla applications.

Read [AGENTS.md](./AGENTS.md), [README.md](./README.md), and the repository's mandatory [AI-agent workflow](../../AI_AGENT_WORKFLOW.md).

## Product goals

1. Deliver high-signal operational events to an operator without coupling notification I/O to trading execution.
2. Keep the package dependency-free by preferring Node.js built-ins and explicit injected boundaries.
3. Make outbound content safe by using event allowlists and curated formatters rather than forwarding arbitrary event payloads.
4. Make delivery, ordering, failure, timeout, and shutdown behavior explicit and testable.
5. Keep transport adapters replaceable without inventing a speculative plugin framework.

## Phase 0 — Contract and package foundation

- [x] Create a private pnpm workspace package named `@coinzilla/notifiers`.
- [x] Define public exports and package-local AI-agent instructions.
- [x] Define initial Telegram-only transport scope and explicit event allowlist.
- [x] Document setup, usage, security, and operational limitations.
- [ ] Confirm package installation and workspace lockfile consistency in a local pnpm environment.

Acceptance: package is discoverable in the workspace, documented, and does not add runtime dependencies.

## Phase 1 — Telegram transport

- [x] Implement Bot API `sendMessage` with native `fetch()`.
- [x] Validate token, chat ID, injected fetch, timeout, and message length.
- [x] Apply bounded request timeout using `AbortSignal.timeout()`.
- [x] Validate HTTP response shape and Telegram's JSON `ok` contract.
- [x] Ensure errors never include the bot token.
- [ ] Decide and test retry policy only after delivery idempotency and duplicate-send semantics are specified.

Acceptance: success and all transport/API failure paths are covered without live network calls.

## Phase 2 — Event-bus integration and formatting

- [x] Format a curated set of bot lifecycle, recovery, pair-pause, order-fill, and execution-fill events.
- [x] Exclude noisy raw execution reports and never forward arbitrary/raw exchange payloads.
- [x] Subscribe only to named, whitelisted events.
- [x] Serialize notification sends and expose an explicit close/drain handle.
- [x] Isolate transport errors from the trading publisher while preserving event-bus error reporting.
- [ ] Integrate the package into `apps/bot-free-roll` in a separate consumer-owned task/PR after this package contract is merged.

Acceptance: subscribers can attach to an existing event bus without changing trading logic; notification errors are observable and do not change trading outcomes.

## Phase 3 — Quality and coverage

- [x] Add deterministic tests for transport validation, HTTP/API errors, malformed responses, and transport rejection.
- [x] Add formatter tests for supported events, missing fields, unsupported event names, and raw payload exclusion.
- [x] Add subscriber tests for allowlist registration, ordered delivery, drain-on-close, partial setup cleanup, and logger failures.
- [x] Configure package-specific coverage thresholds (90% lines, 85% branches).
- [ ] Execute package tests and coverage on Node.js 22.8+ and inspect uncovered branches.
- [ ] Execute workspace tests, syntax check, and quality gate.
- [ ] Review final diff and validate pnpm lockfile with the declared pnpm version.

Acceptance: all required checks pass on the exact final branch head and CI verifies the package coverage gate.

## Phase 4 — Future capabilities (only with a concrete consumer requirement)

- [ ] Additional transports (Discord, Slack, email, webhooks) with separate adapters and tests.
- [ ] Durable outbox or persistent retry support if an application requires crash-safe delivery.
- [ ] Bounded retry/backoff after defining duplicate-send behavior and Telegram rate-limit handling.
- [ ] Message templates/configurable event routing when multiple real consumers demonstrate the need.
- [ ] Delivery diagnostics/metrics if operational usage justifies a stable public contract.

## Decision log

- Telegram is the first adapter because it directly satisfies the initial operator-alert use case.
- No Telegram SDK: Node.js built-in `fetch()` is sufficient for the Bot API method used.
- No Redis, queue package, worker, or database: event-bus delivery is already asynchronous and bounded; the subscriber serializes sends.
- No automatic retries: ambiguous network outcomes can produce duplicate alerts; reliability guarantees must be designed with idempotency/outbox support.
- No `subscribeAll()`: explicit event allowlists reduce noise and prevent accidental sensitive-data disclosure.
- The package does not read environment variables; applications own configuration and secret loading.
- This package does not promise durable or exactly-once delivery.

## Completion policy

A roadmap item is complete only after its task PR is merged into `develop` and required CI checks pass. Never mark a task complete merely because code has been committed or a PR has been opened.
