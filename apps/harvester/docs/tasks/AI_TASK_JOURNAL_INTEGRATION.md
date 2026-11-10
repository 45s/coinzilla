# AI Task: Finalize Harvester EventBus/Journal Integration

## Repository and target

Repository: `45s/coinzilla`

Target branch: `develop`

## Verified implementation state

Steps 1–7 are implemented, tested, documented, and merged:

- PR #453 — EventBus boundary.
- PR #455 — Harvester event contracts and safe DTOs.
- PR #456 — Optional Journal composition.
- PR #458 — Process/config/broker lifecycle events.
- PR #460 — Strategy decisions and order submission events.
- PR #461 — Strategy pause and trailing BUY cancellation events.
- PR #463 — Recovery SELL cancellation events.
- PR #465 — Successful Fill application event.
- PR #467 — Invalid/unowned execution and accounting failure diagnostics.
- PR #468 — Duplicate Fill and recovery-cycle completion events.
- PR #469 — Step 6 roadmap/task closeout.
- PR #470 — Stop broker intake, drain accepted user-data, then disconnect.
- PR #471 — Publish stopped event, close Journal, then EventBus.
- PR #472 — Shutdown failure isolation, bounded EventBus close, startup-failure cleanup, and repeated-signal coalescing.

PR #473 fixed a Step 8 audit finding: `HARVESTER_JOURNAL_ENABLED` and `HARVESTER_JOURNAL_DIRECTORY` were documented and present in the example environment file but were not wired into direct process startup. It also added an offline JSONL integration test.

Do not redo completed milestones. Verify the actual current `develop` and PR state before making changes.

## Role and non-negotiable requirements

Harvester exists to trade. Journal is an optional operational observer.

- Journal must never block startup, broker connectivity, strategy execution, orders, fills, or the serialized user-data queue.
- Never await Journal initialization, writes, flushes, or close from trading workflows.
- Keep domain/strategy independent of EventBus and Journal.
- Publish only safe, serializable Harvester-owned event DTOs.
- Never publish credentials, raw exchange messages, SDK objects, full account snapshots, or raw commission objects.
- Do not publish every market-price update.
- Reuse existing shared packages; change them only for a demonstrated defect.
- Default tests must be offline and use mocks/fakes/temp files. No TESTNET trades, orders, fills, or real credentials are required.
- Do not weaken tests or CI, invent verification results, commit directly to `develop` or `main`, or make unrelated changes.

## Current assignment: Step 8 — Final documentation and verification

Current branch: `docs/harvester/journal-operations-closeout`

Review and finalize:

1. `apps/harvester/README.md`
2. `apps/harvester/docs/JOURNAL_OPERATIONS.md`
3. `apps/harvester/docs/JOURNAL_INTEGRATION_ROADMAP.md`
4. `apps/harvester/docs/architecture.md` and relevant Harvester task docs, without overwriting unrelated open-PR work.

Verify the event inventory and payload field summaries against the actual event-name constants and DTO mappers. Verify the operational documentation against the Journal/EventBus implementations, including:

- `HARVESTER_JOURNAL_ENABLED` and `HARVESTER_JOURNAL_DIRECTORY`.
- Default directory, relative/absolute path handling, session filenames, JSONL schema metadata, file permissions, and lack of automatic rotation/retention.
- Asynchronous Journal startup and the possible early-event capture gap.
- Write failure/degraded-session behavior and close/flush durability semantics.
- Shutdown order and the 5-second EventBus close timeout. Journal close itself has no timeout option.
- Diagnostics for missing or incomplete sessions.
- Security boundaries and the limitations of error-message redaction.

The actual JSONL file and stopped-event close path are already exercised offline by PR #473. Re-run relevant tests and CI on the final documentation PR. If a specific code defect is found, fix it in a separate focused PR rather than silently expanding the documentation PR.

## Delivery

- One small PR to `develop`.
- Update the roadmap and AI task in the same PR.
- Keep the PR description short: scope, tests/checks, documentation impact.
- Merge only after required checks pass.
- Do not mark Step 8 complete until the docs are verified against code and all required checks pass.

## Final report

After merge, provide a concise report with:
- All merged integration PRs and their milestones.
- Exact tests and CI checks that passed.
- Remaining limitations: no exactly-once delivery, no trading-state replay, no automatic retention/rotation, and possible capture gaps before Journal subscription readiness.
- Any unrelated open PRs that were deliberately left untouched.

Step 8 is the final milestone. Do not generate another implementation prompt unless a new, separately approved task is discovered.
