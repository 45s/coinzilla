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

## First implementation assignment

Start with **Step 1 — Add the application EventBus boundary** only.

Do not implement Journal initialization or publish lifecycle/trading events in this first PR. Keep this PR limited to the EventBus boundary and its tests.

### Step 1 objective

Introduce the existing `@coinzilla/event-bus` package into Harvester at the application composition boundary and create a best-effort publisher whose failures cannot escape into trading.

### Before implementation

Inspect the current versions of:
- `apps/harvester/src/index.js`
- `apps/harvester/src/bootstrap/start-harvester.js`
- `apps/harvester/package.json`
- `packages/event-bus`
- `packages/utils` (especially `toResult` and logger contracts)
- Relevant Harvester tests and workspace conventions.

Verify the exact current EventBus API and result shape. Do not infer APIs from this prompt or copy Bot-Free-Roll blindly.

### Implementation constraints

- Add `@coinzilla/event-bus` as a direct workspace dependency.
- Construct one EventBus per Harvester process in the composition/bootstrap layer.
- Inject it explicitly; no global singleton and no domain dependency.
- Add a focused publisher module only if it improves cohesion and gives a useful test boundary.
- Publisher functions accept one object argument and return one object result.
- Catch synchronous `publish()` exceptions and handle failed `toResult` results according to the actual EventBus contract.
- Log publication failures once using the injected/shared `defaultLogger` from `@coinzilla/utils`.
- A logger failure must not escape into the trading caller.
- Do not add Journal yet.
- Do not publish events yet, except a narrowly scoped test proving the boundary if needed.
- Do not alter strategy decisions, order callbacks, user-data queue behavior, broker contracts, trading configuration, or startup readiness.
- Do not use global `console`.
- Reuse existing utilities; do not add dependencies unnecessarily.
- Do not create a generic event framework or speculative abstraction.

### Step 1 tests and acceptance

Add deterministic offline tests for:
1. EventBus accepts an event.
2. EventBus returns a failed result.
3. EventBus throws synchronously.
4. The logger throws while reporting a publication failure.
5. Invalid/non-serializable payload handling follows the actual package contract.
6. Publisher caller always receives the documented result and never an uncaught publication/logging exception.

Also verify:
- Exactly one EventBus is composed per process.
- Existing startup and trading tests remain unchanged and pass.
- No EventBus import is introduced into domain strategy modules.
- No behavior in the trading workflow waits for a subscriber or disk I/O.

Run the Harvester test and coverage commands, relevant EventBus tests, and applicable workspace checks. Report exact commands and outcomes.

### Step 1 documentation

Update:
- `apps/harvester/docs/architecture.md` with the actual application event boundary and its current limited status.
- `apps/harvester/ROADMAP.md` to link this staged roadmap and accurately mark Step 1 only when complete.
- `apps/harvester/docs/JOURNAL_INTEGRATION_ROADMAP.md` status/checklist.

Do not claim Journal is integrated or that any events are persisted.

## Subsequent steps

After Step 1 is merged, follow the roadmap in order:

- Step 2: define the small lifecycle event contracts and plain DTO mappings.
- Step 3: compose Journal as an optional, non-blocking service.
- Step 4: publish process/configuration lifecycle events (started, startup failed, stopped, config validated).
- Step 5: publish broker lifecycle events (connected, connection failed, disconnected, subscriptions).
- Step 6: publish selected strategy/order events.
- Step 7: publish actual execution/accounting facts and complete shutdown failure isolation.
- Step 8: final documentation and operational verification.

The first useful operational output is intentionally simple: application started and broker connected/disconnected. This must work in broker read-only mode; trading events are later optional instrumentation.

Each step is a separate PR. Re-read the roadmap and current source before each step; do not assume the previous agent's implementation details are still current.

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
