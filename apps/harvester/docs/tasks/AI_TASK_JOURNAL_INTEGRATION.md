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

Steps 1–5a are merged into `develop` (PRs #453, #455, #456, #458, #460). Do not repeat them. The current assignment is **Step 5b — Pause and trailing BUY cancellation transitions**, on branch `feature/harvester/pause-cancellation-events`, targeting `develop`.

### Completed Step 5a scope

- Publish `strategy.decision` only for actionable Conservative decisions, after balance filtering. Do not publish NO_ACTION or every market-price update.
- Publish `order.submission_requested` after local PENDING registration and immediately before broker I/O.
- Publish `order.submitted` only after canonical acknowledgement validation and successful local registry update.
- Publish `order.submission_failed` for rejected/unknown outcomes.
- Use small Harvester-owned allowlisted DTOs. Preserve exact decimal strings. Never include credentials, raw broker messages, SDK/domain instances, balances, or account snapshots.
- Reuse the existing EventBus publisher and lifecycle publication boundary. Do not change shared packages.
- Publication is best-effort and synchronous admission only. Never await EventBus subscriber work or Journal I/O from strategy/order workflows.
- Keep strategy policies independent of EventBus/Journal. Instrument only the application engine/use-case boundary.
- Implement only the first pause transition and trailing BUY cancellation success/failure. Do not instrument recovery SELL cancellation (Step 5c), execution/accounting, or invent pair-resume behavior; the current engine has no pair-resume transition.

### Tests

Add offline tests covering:
1. Actionable strategy decision DTO and event publication.
2. Repeated NO_ACTION evaluations are not published.
3. Pending request is published after local registration and before broker submission.
4. Submitted is published only after canonical acknowledgement and registry update.
5. Rejected and unknown outcomes publish the correct safe failure DTO.
6. EventBus throw/rejected result cannot block a real fake-broker order or alter its result.
7. Invalid DTO values are rejected; credentials and extra properties are never copied.
8. Existing Harvester strategy/order tests continue to pass.

Run the Harvester unit and coverage commands plus relevant workspace checks. If local execution is unavailable, do not claim tests passed: open the PR and use its actual CI runs as the verification gate.

### Documentation

Update the integration roadmap, architecture event inventory, and this task document in the same PR. Mark only completed behavior. Step 5b (pause/resume and cancellation) remains separate.

## Subsequent milestones

- Step 5c: recovery SELL cancellation success/failure.
- Resume events remain deferred until the engine has a real, explicit pair-resume transition.
- Step 6: canonical execution and accounting facts.
- Step 6: canonical execution and accounting facts.
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
