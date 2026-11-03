# AI Task: Implement Harvester Journal Integration — One Milestone at a Time

## Role

You are implementing the Harvester Journal integration in repository `45s/coinzilla`.

Follow:
1. Repository root `AGENTS.md`.
2. `apps/harvester/AGENTS.md`.
3. `apps/harvester/docs/TRADING_FIRST.md`.
4. `apps/harvester/ROADMAP.md`.
5. `apps/harvester/docs/JOURNAL_INTEGRATION_ROADMAP.md`.
6. This task document.

The roadmap is the implementation plan and source of truth for step order. The audit is complete and implementation may begin immediately. **Do not require or wait for a real TESTNET trade.**

## Non-negotiable priority

Harvester exists to trade. Journal is an optional operational observer.

- Never make Harvester startup or trading readiness depend on Journal.
- Never await Journal initialization, writes, flushes, or close from market-price handling, strategy evaluation, order submission, execution processing, or the serialized user-data queue.
- If Journal is unavailable, slow, full, or broken, trading continues. The journal may have gaps; trading must not be delayed.
- Do not refactor working trading logic to make instrumentation easier.
- Keep live trading disabled by default.

## Before coding

Inspect the latest `develop`, open PRs, Harvester startup/bootstrap, the EventBus and Journal package APIs, and relevant tests. This is an ordinary application-observability task: no exchange credentials, TESTNET session, orders, fills, or trading-cycle evidence are needed. Keep trading disabled and use offline tests.

## Delivery model: one PR per roadmap step

Implement exactly one unchecked step from `docs/JOURNAL_INTEGRATION_ROADMAP.md` per PR.

- Start from the latest `develop`, create a short-lived task branch, and target the PR to `develop`.
- Do not commit directly to `develop` or `main`.
- Do not combine multiple roadmap steps into one PR, even if later steps appear easy.
- A step may be split into smaller PRs if tests or review show it is still too large.
- Do not start the next step until the current PR is merged and its roadmap status is updated on `develop`.
- Each PR must include implementation, focused tests, and the relevant documentation update in the same PR.
- Update the roadmap checklist only for behavior actually implemented, tested, and documented.
- Keep PR descriptions concise: scope, key decisions, tests/checks, documentation impact, and next step. Avoid unrelated boilerplate.
- Merge only after required CI checks pass. If a check is failing, investigate and fix it; never bypass or weaken it.
- Delete the short-lived source branch after successful merge, following repository workflow.

## Current implementation status

Steps 1–5 and Step 6a are complete and merged into `develop` (PRs #453, #455, #456, #458, #460, #461, #463, #465). Do not repeat them. Steps 1–6 are complete and merged into `develop` (PRs #453, #455, #456, #458, #460, #461, #463, #465, #467, #468). Do not repeat them. Steps 1–6 are complete and merged. Steps 7a–7b are merged into `develop` (PRs #470 and #471). The current assignment is **Step 7c — Cleanup failure isolation and bounded shutdown**, on branch `feature/harvester/shutdown-failure-isolation`, targeting `develop`.

### Completed Step 5a scope

- Publish `strategy.decision` only for actionable Conservative decisions, after balance filtering. Do not publish NO_ACTION or every market-price update.
- Publish `order.submission_requested` after local PENDING registration and immediately before broker I/O.
- Publish `order.submitted` only after canonical acknowledgement validation and successful local registry update.
- Publish `order.submission_failed` for rejected/unknown outcomes.
- Use small Harvester-owned allowlisted DTOs. Preserve exact decimal strings. Never include credentials, raw broker messages, SDK/domain instances, balances, or account snapshots.
- Reuse the existing EventBus publisher and lifecycle publication boundary. Do not change shared packages.
- Publication is best-effort and synchronous admission only. Never await EventBus subscriber work or Journal I/O from strategy/order workflows.
- Keep strategy policies independent of EventBus/Journal. Instrument only the application engine/use-case boundary.

### Completed Step 5b scope

- Publish `strategy.paused` only on the first transition into a pair's paused state; repeated pause causes do not emit duplicates.
- Publish `order.cancelled` only after a trailing BUY has a canonical CANCELED acknowledgement and the local registry accepts the update.
- Publish `order.cancel_failed` for unconfirmed, unregistered, or non-canceled trailing BUY outcomes, with safe identifiers and sanitized errors.
- Keep cancellation fill reconciliation and existing pause behavior unchanged.
- The current engine has no pair-resume transition; do not invent one solely for logging.

### Completed Step 5c scope

- Publish `order.cancelled` for recovery SELL cancellation only after canonical broker confirmation and local registry update.
- Publish `order.cancel_failed` for unknown order state, unconfirmed cancellation, unregistered order, or a broker response that is not CANCELED.
- Preserve recovery fill reconciliation, accounting, and pair-pause behavior.
- Do not change order selection or strategy policy.
- EventBus publication must not be awaited and must not change cancellation or fill-reconciliation behavior.

### Completed Step 6a scope

- Publish `execution.fill_applied` only after `updateTradingAccounting` returns success with `applied: true`; the wrapper must already have committed both Portfolio and RecoveryLedger.
- Use an allowlisted DTO with fill/order IDs, symbol, side, exact price/quantity/quote-quantity strings, liquidity role, execution time when present, and commission status.
- Do not publish idempotent duplicate fills in this PR; that is Step 6b.
- Never publish raw exchange messages, SDK objects, credentials, full account snapshots, commission objects, or mutable domain entities.
- Never await EventBus subscriber work or Journal persistence from the serialized user-data queue.
- Do not change accounting authority, fill identity, order ownership, or strategy behavior.

Run the Harvester unit and coverage commands plus relevant workspace checks. If local execution is unavailable, do not claim tests passed: open the PR and use its actual CI runs as the verification gate.

### Tests

Add deterministic offline tests for partial Fill application, publication only after accounting commit, duplicate Fill suppression, DTO allowlisting and decimal preservation, and publisher failure isolation. Keep the existing accounting and queue tests intact.

### Tests

Add deterministic offline tests for pending user-data work, stream unsubscribe ordering, late callback rejection, and broker disconnect after queue drain. Preserve the existing lifecycle tests.

### Completed Step 7b scope

- Publish `harvester.stopped` after runtime stop and broker disconnect have completed or reported failure.
- Keep EventBus and Journal open while publishing the final lifecycle event.
- Await Journal close so it can unsubscribe, drain accepted EventBus deliveries, drain writes, and sync.
- Close EventBus only after Journal close returns.
- Do not add cleanup failure isolation or timeout behavior in this PR; those are Step 7c.

### Current Step 7c scope

- Isolate runtime stop, Journal close, and EventBus close failures so later cleanup still runs.
- Coalesce repeated SIGINT/SIGTERM requests into one shutdown promise.
- Close Journal and EventBus after startup failure as well as normal shutdown.
- Use the EventBus close timeout contract (5 seconds); never report a timeout as a successful flush.
- Set non-zero process exit status when any shutdown stage is incomplete.
- Do not invent a Journal timeout; its current close contract has no timeout option.

Run the Harvester unit and coverage commands plus relevant workspace checks. If local execution is unavailable, use actual PR CI results as the verification gate and never claim unrun checks passed.

### Documentation

Update the integration roadmap, architecture event inventory, and this task document in the same PR. Mark only completed behavior. Resume events remain deferred until a real pair-resume transition exists.

## Subsequent milestones

- Step 7: orderly shutdown draining and failure isolation.
- Step 8: final event inventory, operational documentation, and verification.

No TESTNET orders, fills, credentials, or live exchange access are required for these lifecycle-observability milestones.

## Engineering standards

- Meaningful deterministic calculations, decisions, validation, and mappings are plain pure functions.
- Functions accept one object argument and return one object result.
- Use `toResult` for fallible operations where appropriate.
- Reuse `@coinzilla/utils` and existing entities/contracts.
- Strategies remain broker-independent.
- Use dependency injection and explicit composition.
- No global `console` in application runtime modules.
- Validate external data at system boundaries.
- Isolate consumer failures; one observer must not break unrelated consumers.
- Default tests are deterministic, offline, and credential-free.
- Exchange integration tests are opt-in and TESTNET-only; they are unrelated to Journal integration.
- Live trading remains disabled by default.
- Do not weaken tests or CI.
- Do not claim tests, CI, TESTNET behavior, or durability that was not actually verified.

## Required closeout and continuation prompt

At the end of each PR:
1. Re-check the actual PR, branch, latest commit, and CI status.
2. State the exact PR number, URL, title, source/target branches, state, and merge status.
3. State the latest commit message.
4. Summarize only completed work and list exact changed files.
5. Report exact tests/checks run, including pending, cancelled, and not-run checks.
6. State known limitations and remaining roadmap steps.
7. Provide the next complete copy-paste-ready AI prompt, instructing the next agent to inspect the latest `develop` and implement only the next unchecked step.
8. End the response with that continuation prompt.

Never say the whole Journal integration is complete after an individual step.
