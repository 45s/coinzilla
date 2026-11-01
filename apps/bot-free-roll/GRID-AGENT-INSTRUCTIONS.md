# Grid Workstream — AI Agent Instructions

**Application:** Coinzilla Free-Roll (`apps/bot-free-roll`)  
**Work branch:** `feature/bot-grid`  
**Reference branch:** `develop`  
**Status:** Design and audit only. No Grid implementation work is authorized yet.

These instructions are specific to the Grid workstream and override conflicting generic branch/PR workflow instructions for this workstream. They do not authorize changes outside the rules below.

## 1. Absolute repository and Git boundaries

For all Grid work:

1. Work **only** on `feature/bot-grid`.
2. Never switch to `develop` to make changes. `develop` is a read-only reference for audits and comparisons.
3. Never commit, push, cherry-pick, or otherwise write Grid work to `develop` or `main`.
4. **Do not create PRs** for this workstream. This includes draft PRs.
5. **Do not merge anything** into `develop`, `main`, or any other branch.
6. Do not close, retarget, merge, or otherwise modify existing PRs unless the user explicitly asks.
7. Do not create another Grid branch. The workstream branch is exactly `feature/bot-grid`.
8. Before every write, verify the target branch is `feature/bot-grid`. If the branch cannot be verified, stop before writing.
9. Preserve all existing work on `feature/bot-grid`. Do not reset, force-push, discard, or overwrite commits.
10. Do not ask the user to manually synchronize branches. The agent is responsible for understanding branch ancestry and reporting divergence; synchronization or rebasing requires explicit authorization if it would rewrite or alter the workstream.

The existing repository-wide AI workflow may describe short-lived branches, PRs, and merges to `develop`. **Those generic instructions do not apply to this Grid workstream while this document is in force.**

## 2. User-approved Grid proposals

The following are decisions already made by the user. Treat them as requirements, not open questions.

### 2.1 Explicit strategy modes

- Each pair explicitly selects `aggregated` or `grid`.
- `aggregated` manages one BUY and one SELL order per pair.
- `grid` supports multiple independently managed BUY orders and multiple independently managed SELL orders per pair.
- Grid is an order-management mode. It does not change the fundamental profitability/accounting rules.
- Any configured pair may use Grid. Grid eligibility is **not** determined by `makerPercent`.
- Maker fees and commissions affect order economics and profit calculations, not Grid eligibility.
- Never switch modes automatically.
- Never silently fall back from Grid to aggregated mode, or vice versa.
- Preserve existing aggregated behavior. Grid changes must be isolated behind explicit mode selection.

### 2.2 Initial BUY behavior

This is the only approved initial-entry distinction:

- When `makerPercent = 0`, submit the initial BUY immediately as post-only `LIMIT_MAKER`.
- When `makerPercent > 0`, use the existing price-trigger behavior for the initial BUY.
- Do not invent additional startup conditions or infer further BUY scheduling rules from this decision.

### 2.3 Independent BUY cycles and SELL ownership

- A fully filled and reconciled BUY creates exactly one independent recovery cycle.
- Each cycle owns its own BUY facts, recovery accounting, SELL attempts, reservations, and completion state.
- Each cycle gets its own recovery SELL when its plan is safe.
- Multiple BUY orders and multiple cycle SELL orders may be active at the same time.
- A new BUY filling must not cancel, resize, replace, or otherwise alter an unrelated cycle's SELL.
- A SELL filling or being canceled affects only its owning cycle.
- Different cycles may complete in any order.
- A cycle's `keepQuantity` becomes free inventory only after that cycle's SELL is fully reconciled and the actual net-profit requirement is satisfied. Retain it per successfully completed cycle.
- Never combine different BUYs into one recovery cycle or pool one cycle's costs, proceeds, fees, reservations, or inventory with another.
- Do not allocate free inventory early, on a partial SELL, or merely because an order reports `FILLED` before its actual fills and commissions have been reconciled.

### 2.4 First working milestone: in-process only

- First deliver a working Grid lifecycle within the running process.
- **Do not implement or require persisted Grid-state restoration, restart recovery, or crash recovery for this first milestone.**
- Existing persistence/restore code on the branch must be audited and its role in the first milestone explicitly assessed; do not assume it should remain in the execution path merely because it already exists.
- Do not claim restart safety until a later, separately planned and implemented phase.
- Do not let future restore requirements block the first working in-process lifecycle.

### 2.5 Trading safety: fail closed

This rule applies to both aggregated and Grid modes.

- If an error compromises trading safety or makes the affected pair's state uncertain, pause that pair.
- If the failure is bot-wide, pause the bot.
- A pair-specific failure must not unnecessarily stop other pairs that are demonstrably safe.
- Never silently swallow a trading error, continue on guessed/assumed order state, submit a replacement while the prior order's state is unknown, or silently change strategy mode.
- Reconcile broker orders, fills, commissions, inventory, and reservations before resuming where those facts are relevant.
- Resume only after the cause is resolved and the affected state is verified safe.
- Classify errors by safety scope and impact; harmless diagnostic/logging failures do not automatically imply a trading-state failure.

## 3. Required work sequence — do not skip or reorder

The work must proceed through these gates:

### Gate A — Audit first; no implementation

1. Read the root and Free-Roll agent instructions, engineering standards, current Free-Roll `README.md` and `ROADMAP.md`, `GRID-README.md`, `GRID-ROADMAP.md`, and this file.
2. Inspect the current `develop` branch as a **read-only baseline**. Audit all relevant Free-Roll source code, configuration, tests, package scripts, and documentation—not only files whose names contain `grid`.
3. Inspect every currently open repository PR that targets `develop` and is relevant to Free-Roll, its broker/entity dependencies, or Grid. Also inspect existing open Grid-workstream PRs and determine their actual base/head branches and dependencies. Do not infer PR targets from titles or descriptions.
4. Compare the current `feature/bot-grid` implementation with the audited `develop` baseline. Identify behavior already present, partial implementations, dead/unreachable code, duplicated logic, conflicting assumptions, and missing integration/tests.
5. Audit all `GRID-` roadmap entries against actual source and tests. Do not mark an item complete based only on a helper existing or a PR being open.
6. Update `GRID-ROADMAP.md` with evidence-based statuses, dependencies, blockers, and the proposed implementation order. Keep future restore/restart work separate from the first in-process milestone.
7. Update `GRID-README.md` only when the specification needs correction to match an already approved decision. Do not use documentation edits to make undecided behavior appear approved.
8. Record the audit scope, inspected PRs, branch comparison, and evidence in the roadmap or a concise audit section. If an item cannot be verified, label it unknown—not complete.

**Gate A deliverable:** an accurate source/PR audit and an updated Grid roadmap on `feature/bot-grid`. No trading implementation changes.

### Gate B — Produce one consolidated question register

After Gate A, prepare a finite, numbered list of all decisions that are genuinely still needed before implementation.

- Group related questions into short topics (BUY scheduling, concurrent order limits/exposure, partial fills, SELL replacement/cancel races, inventory/balance ownership, error recovery/resume, configuration/migration, testing/release gates).
- For each question include only:
  1. the concrete situation/example;
  2. the proposed behavior;
  3. why the decision matters / what implementation choice it controls.
- Clearly mark already approved decisions as **DECIDED**. Do not ask the user to decide them again.
- Do not turn assumptions, implementation preferences, or future-phase requirements into user decisions.
- Avoid long essays and repeated explanations. The user explicitly wants one manageable consolidated list—not a stream of one-question-at-a-time messages and not another enormous wall of text.
- Do not start implementation while any required design question remains unresolved.

### Gate C — Discuss and close the questions

- Discuss the consolidated list with the user.
- Keep a visible decision register with statuses such as `OPEN`, `DECIDED`, and `DEFERRED`.
- When the user answers, record the exact decision in `GRID-README.md` and/or `GRID-ROADMAP.md`, as appropriate.
- Do not ask again about a decision already recorded unless new source evidence reveals a genuine contradiction; if so, explain the contradiction briefly.
- If the user defers a question, record it as deferred and define whether it blocks the first milestone. Do not quietly decide it yourself.
- Implementation begins only after the user explicitly confirms that all decisions required for the first milestone are closed.

### Gate D — Implementation, only after explicit authorization

- Implement only the behavior covered by closed decisions and the approved roadmap.
- Keep all changes on `feature/bot-grid`; no PRs and no merges.
- Preserve aggregated behavior and test it for regressions.
- Use the project's engineering standards: object-shaped function inputs and outputs, `toResult` for result contracts, pure functions wherever practical, exact decimal arithmetic, immutable state transitions, focused native Node.js tests, explicit public module APIs, and no hidden circular dependencies.
- Test success, boundaries, duplicate/replayed events, out-of-order events, partial fills, cancel/fill races, broker failures, ambiguous state, and relevant concurrency.
- Validate broker-facing data at boundaries. Never invent exchange facts or treat configured fee assumptions as actual commissions.
- Update the Grid roadmap with implementation evidence. Do not mark items complete until the relevant code and tests are present and verified on this branch.
- Report exactly what changed, what tests/checks were run, what failed or was not run, and any remaining risks.

## 4. How to handle cross-domain dependencies

Grid is owned by `apps/bot-free-roll`, but the audit may find required changes in `packages/brokers`, `packages/entities`, or other domains.

- Identify the owning package and the exact missing contract/behavior.
- Do not silently implement another team's domain logic inside Free-Roll.
- Record the dependency and proposed owner/change in the Grid roadmap and question register.
- During the audit/design gates, do not create issues, PRs, or changes in another branch unless the user explicitly authorizes it.
- After implementation is authorized, follow the user's direction on cross-domain coordination. The Grid branch remains the only write target unless the user explicitly changes that constraint.

## 5. Conversation and reporting rules

- The user wants to agree on behavior before code is written. Do not rush into implementation.
- Be concise. Do not overwhelm the user with a huge narrative or ask the same question repeatedly.
- Present one consolidated, prioritized question register after the audit—not a long sequence of separate scenario prompts.
- Separate facts observed in source code from assumptions and proposed design.
- Never claim that a feature is implemented, tested, enabled, safe, or restart-safe without evidence.
- Use the project name **Coinzilla** and application name **Free-Roll**. Do not use the obsolete project name Coinminator.
- The current Grid branch is `feature/bot-grid`; do not confuse it with `feature/grid`.

## 6. Immediate next action

**Perform Gate A only:** audit the current `develop` baseline, all relevant open PRs, and the complete Grid implementation on `feature/bot-grid`; then update `GRID-ROADMAP.md` with verified statuses and dependencies. Do not implement Grid behavior. After the audit, present the consolidated question register and wait for the user's decisions.
