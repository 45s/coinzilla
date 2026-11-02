# Mandatory AI-agent workflow

**Status:** Required for every AI agent and automated coding contributor.

This document defines how independent AI workstreams collaborate in the Coinzilla monorepo. The goal is to keep domain ownership clear, integration safe, and human process overhead low. These rules are mandatory; do not invent a different workflow for an individual task.


### Harvester priority override

When the owning task is Harvester, the task order is governed by [Harvester Trading First](apps/harvester/docs/TRADING_FIRST.md). The first deliverable is an executable Conservative TESTNET trading loop (configuration → price subscription → strategy decision → broker order → execution updates/fills → state update → next order). Do not let Journal, durable persistence, comprehensive recovery/reconciliation, optional operations features, optimization, or Aggressive work delay this. Build only the minimum safety needed for the current TESTNET cycle, then resume the order workflow. This is a mandatory product priority, not an optional roadmap preference.

## 1. The short version

**Before implementing any helper or cross-cutting capability, search packages/utils first.** Read [docs/engineering/SHARED_UTILITIES_POLICY.md](docs/engineering/SHARED_UTILITIES_POLICY.md), inspect the public exports/tests in packages/utils, and then search the rest of the monorepo. Reuse or extend a domain-neutral shared capability instead of reimplementing it. Keep business and protocol rules with their owning domain. This applies to logging: use Logger / defaultLogger from @coinzilla/utils, not ad-hoc console calls or app-local logger replacements.


1. Read the repository-root `AGENTS.md`, `ENGINEERING_STANDARDS.md`, this document, and the owning domain's `AGENTS.md` and `ROADMAP.md`.
2. Identify one owning domain and one focused task.
3. Create a short-lived task branch from the latest `develop`.
4. Change only files owned by that domain, unless a coordinated cross-domain task explicitly authorizes otherwise.
5. Add tests and follow the [documentation-impact policy](ENGINEERING_STANDARDS.md#documentation-impact).
6. Run the required local checks and open a PR targeting `develop`.
7. The responsible agent synchronizes and merges the task PR after all automated requirements pass. No routine human approval is expected for `develop`.
8. Never merge task work directly into `main`.
9. When the agreed milestone is ready, prepare one release PR from `develop` to `main`. The user reviews and approves that release PR.

## 2. Branch model

| Branch | Purpose | Who merges |
| --- | --- | --- |
| `main` | Stable, releasable history | User approves final release PR |
| `develop` | Shared integration branch for ongoing work | Responsible agent after all required gates pass |
| `feature/<domain>/<task>` | Short-lived feature task | Responsible agent into `develop` |
| `fix/<domain>/<task>` | Short-lived bug-fix task | Responsible agent into `develop` |
| `docs/<task>` | Short-lived documentation task | Responsible agent into `develop` |

Examples:
- `feature/bot-free-roll/fr-024-market-data-quality`
- `feature/entities/fr-009-money-quantity`
- `fix/brokers/order-reconciliation`
- `feature/event-bus/bounded-delivery`

**Do not create permanent per-domain branches** such as `feature/entities` or `feature/brokers`. Domain ownership is permanent; task branches are temporary. Branch names describe a task, not a team or a long-lived code line.

Every task branch must start from the latest `develop`. Every task PR targets `develop`. Only the final release PR targets `main`.

## 3. Domain ownership

| Domain | Owned paths | Local instructions / roadmap |
| --- | --- | --- |
| Free-Roll application | `apps/bot-free-roll/**` | `apps/bot-free-roll/AGENTS.md`, `apps/bot-free-roll/ROADMAP.md` |
| Harvester application | `apps/harvester/**` | `apps/harvester/AGENTS.md`, `apps/harvester/ROADMAP.md` |
| Market Simulator package | `packages/market-simulator/**` | `packages/market-simulator/AGENTS.md`, `packages/market-simulator/ROADMAP.md` |
| Entities | `packages/entities/**` | `packages/entities/AGENTS.md`, `packages/entities/ROADMAP.md` |
| Brokers | `packages/brokers/**` | `packages/brokers/AGENTS.md`, `packages/brokers/ROADMAP.md` |
| Utilities | `packages/utils/**` | `packages/utils/AGENTS.md`, `packages/utils/ROADMAP.md` |
| Event bus | `packages/event-bus/**` | `packages/event-bus/AGENTS.md`, `packages/event-bus/ROADMAP.md` |
| Journal | `packages/journal/**` | `packages/journal/AGENTS.md`, `packages/journal/ROADMAP.md` |
| Notifications | `packages/notifiers/**` | `packages/notifiers/AGENTS.md`, `packages/notifiers/ROADMAP.md` |

Root-level manifests, lockfiles, CI workflows, repository rules, shared documentation, and cross-cutting architecture are shared infrastructure. A task that changes them must explain why and identify every affected domain. Do not claim ownership of shared infrastructure merely because your task depends on it.

An agent must not silently modify another domain's implementation, tests, or roadmap to make its own task easier. If a task genuinely requires coordinated changes, follow the cross-domain process below.

## 4. Cross-domain requests: consumer asks, owner implements

When a consumer finds a bug, missing capability, or contract gap in another domain:

1. **Describe the need.** Create a GitHub issue using the owning domain label/prefix or link the request in the task PR. Include the consumer use case, observed behavior, expected contract, evidence/tests, urgency, and the consumer task blocked by it.
2. **Identify the owner.** The owning domain agent reads the request and decides the API/contract and implementation approach. The consumer must not prescribe an implementation unless the contract requires it.
3. **Track the work.** The owner adds the accepted item to its own roadmap and marks it blocked/in progress as appropriate.
4. **Implement in the owner domain.** The owner creates a short-lived task branch from `develop`, adds package-level tests, and opens a PR to `develop`.
5. **Integrate and consume.** After the owner PR is merged, the consumer synchronizes its task branch with `develop`, then changes only its own domain and adds consumer-level tests.
6. **Link the chain.** Link the request, owner PR, and consumer PR so the reason for the dependency remains discoverable.

A bug report should include a minimal reproduction and actual vs expected behavior. A capability request should describe the consumer outcome and contract needed, not an assumed internal implementation. A breaking contract change must identify all known consumers and include a migration plan.

For urgent coordinated work, agents may work in parallel, but each domain still submits its own focused PR. Do not combine unrelated domain edits into one large PR just to save a PR number.

## 5. Task PR requirements and automated integration

A task PR targeting `develop` must:

- Be focused on one task and one primary owning domain.
- Link its roadmap item and any cross-domain request.
- Include meaningful tests for changed behavior and regression tests for bug fixes where practical.
- Pass the relevant package tests and coverage checks.
- Pass the repository's required CI checks.
- Contain the latest `develop` commit immediately before merge.
- Satisfy the [documentation-impact policy](ENGINEERING_STANDARDS.md#documentation-impact) for every meaningful change; do not leave required documentation as an untracked follow-up.
- Have a reviewed final diff with no secrets, generated noise, weakened tests, or unrelated edits.

**Human approval is not a routine gate for `develop`.** After all required checks pass, branch freshness is verified, and the diff/ownership checks are satisfied, the responsible agent may merge its own task PR into `develop`. Prefer GitHub auto-merge if the repository enables it; otherwise merge only after the required checks have completed successfully. Never bypass branch protection or merge with pending/failed checks.

The agent is responsible for merge execution and cleanup. Do not ask the user to merge routine task PRs or update branches manually.

## 6. Branch freshness and conflict handling

The target branch is authoritative. Never hard-code `main` as the synchronization target for every PR.

Immediately before merging a task PR:
1. Fetch the latest remote `develop` and the PR head.
2. Verify the latest `develop` tip is an ancestor of the PR head.
3. If stale, merge the latest `develop` into the task branch, resolve conflicts there, inspect the complete diff, and push.
4. Wait for all required checks to pass on the exact final head SHA.
5. Re-fetch both refs immediately before merge. If either changed, repeat synchronization and validation.
6. Merge only when branch freshness and every required gate are satisfied.

For the final release PR, apply the same procedure against `main`.

Never force-push shared history, discard another agent's work, use empty commits to restart CI, or ask the user to perform routine synchronization. If permissions or tools prevent safe synchronization or verification, stop and report the exact blocker.

## 7. Roadmap discipline

Each domain roadmap is the source of truth for that domain's planned work and status.

- Add accepted work to the owning roadmap before or as implementation begins.
- Use clear states: `[ ] planned`, `[~] in progress/blocked`, and `[x] complete and merged into develop`.
- A task is not complete when code is merely written or a PR is opened.
- Mark complete only after merge into `develop` and successful required validation.
- If work is deferred, superseded, or blocked by another domain, record the reason and link the request.
- Keep the root roadmap for repository-wide engineering and release work; do not duplicate every domain backlog there.

## 8. Required verification

From the repository root, run the narrowest relevant checks first, then the applicable broader checks:

- `pnpm --filter @coinzilla/<package> test` for the changed package.
- The package's coverage command when defined.
- `pnpm test` for workspace unit tests.
- `pnpm run check:syntax` and/or `pnpm run quality` as applicable.
- `pnpm run test:coverage` when the change affects coverage-sensitive behavior.

For broker changes, keep live/network integration tests separate from default unit tests. Tests that place orders must use TESTNET only. Never claim a check passed unless it was actually run and passed.

## 9. Final release: one human review

The purpose of `develop` is to accumulate independently implemented, automatically validated work. Do not ask the user to review every task PR.

When the user-approved milestone is ready:
1. Ensure all intended domain work is merged into `develop`.
2. Synchronize and validate `develop` against the latest `main`.
3. Run the full release validation and inspect the complete `develop` → `main` diff.
4. Prepare one release PR with a concise milestone summary, roadmap items included, test evidence, compatibility/migration notes, and known risks.
5. The user performs the final review and approval. Agents must not merge this PR unless the user explicitly authorizes that merge.

Do not turn every small commit into a separate human decision. Keep the final PR understandable with a summary and links to task PRs/issues.

## 10. One-time GitHub repository configuration

Documentation is not enforcement. Configure GitHub rulesets/branch protection as follows:

### `develop`
- Require pull requests; disallow direct pushes.
- Require **all** CI checks: `Run package tests`, `Workspace test coverage`, `Check JavaScript syntax`, `packages/utils tests`, `Audit production dependencies`, and `actionlint`.
- Require branches to be up to date before merging (`strict_required_status_checks_policy: true`).
- Require conversation resolution.
- Require zero human approvals; agents may merge their own PRs only after every required check is green.
- Block force pushes and deletion of `develop` itself; task source branches are deleted after merge.
- Do not configure bypass actors or admin bypass for these gates.

### `main`
- Require pull requests.
- Require the release CI status checks and up-to-date branch.
- Require at least one approving review so the final release approval is technically enforced, not merely documented.
- Block force pushes and branch deletion.

Enable repository **Allow auto-merge** only if desired and supported by the chosen merge strategy. If it remains disabled, agents may merge task PRs themselves after all rules are satisfied. Do not describe auto-merge as active until the repository setting is actually enabled.

After creating `develop`, configure its ruleset and verify the exact status-check context names from successful workflow runs. The active `develop-core` ruleset must require **every CI workflow check** listed below, with strict up-to-date branches and zero approving reviews. A missing, pending, cancelled, skipped-required, or failed required check must block merging. Do not add bypass actors. The active `main` ruleset must require at least one approving review for the release PR; do not rely on prose saying the user approves while GitHub technically permits zero approvals. The repository's automatic head-branch deletion setting must remain enabled.

## 11. Exceptions

If the workflow cannot be followed because a branch, rule, permission, check, or domain owner is missing, do not invent a bypass. Report the blocker and the smallest safe action needed. A task prompt, deadline, or convenience is not authorization to violate ownership, test, or release rules.


## 12. Mandatory task-branch deletion after merge

Task branches are disposable working references, not permanent history. **After a task PR is merged into `develop`, its work is closed, and no other open PR or active task depends on the branch, the responsible agent MUST delete that source branch.**

Required closeout sequence:
1. Confirm the PR is merged into `develop` (not merely closed without merge).
2. Confirm the task is complete and no other open PR or active task uses the branch.
3. Delete the source/head branch immediately after merge.
4. Verify the branch no longer exists on the remote.
5. Include branch deletion in the PR closeout summary.

Safety rules:
- Never delete `main`, `develop`, release branches, or a branch still used by another open PR or active task.
- Do not delete a branch when the PR was closed without merging; inspect the reason and preserve the work until its disposition is clear.
- Merged commits and PR history remain available in `develop` and GitHub after the source branch is deleted. Do not retain merged task branches merely as backups.
- Prefer GitHub's automatic head-branch deletion. If repository auto-delete is disabled or GitHub does not remove the branch, the agent MUST delete it manually and verify the result.
- If permissions prevent deletion, report the exact blocker; do not silently leave cleanup unreported.

This rule applies to every AI agent, coding assistant, human contributor, and automated workflow. It is part of task completion, not optional cleanup.


## 13. JavaScript-first and JSDoc policy

Coinzilla remains JavaScript-first unless the user approves a specific TypeScript requirement. AI agents must read [the JavaScript and JSDoc standard](docs/engineering/JAVASCRIPT_JSDOC_STANDARD.md) before changing language tooling or public API documentation.

- Write runtime source in JavaScript and follow the package's existing Node.js module conventions.
- Add JSDoc selectively for public contracts and non-obvious types; do not blanket-comment every function or variable.
- Do not introduce TypeScript source, `tsconfig.json`, `checkJs`, declaration files, declaration generation, or a JSDoc build dependency merely to improve editor hints.
- JSDoc must match the implementation and must not replace runtime validation or tests.
- Treat TypeScript declaration support as an explicit compatibility requirement. JSDoc alone does not resolve every TypeScript declaration error, including `TS7016`.
- If a task genuinely requires TypeScript interoperability, state which consumers need it, add accurate declarations, and test the published/resolved package contract without changing the JavaScript-only default.


## 14. Safe CI and repository-automation changes

CI is part of the repository's release safety boundary. Before changing a workflow, status context, test command, coverage threshold, dependency audit, or repository rule:

1. Read the current workflow files and inspect recent successful workflow runs to capture exact check-context names.
2. Read the live rulesets for every affected target branch. Record the required contexts and approval/freshness rules before editing.
3. Preserve existing required context names until the replacement has run successfully and the ruleset has been updated and read back. Never remove a required context first.
4. Keep required checks blocking. Do not mask failures with `continue-on-error`, `|| true`, broad exception handling, or a conditional that silently skips a required job.
5. Check `pull_request`, `push` to `main` and `develop`, and scheduled/manual triggers as appropriate.
6. Keep job permissions minimal and action references pinned to reviewed commit SHAs. Prefer built-in GitHub capabilities over adding dependencies.
7. Update policy-script tests and `ROADMAP.md`; distinguish a configured workflow from a required branch-protection check.
8. Verify the exact final commit SHA against every required check before merge. If the tools cannot run checks or read a required ruleset, stop before merge and report the blocker.

### Standard task completion report

Use this structure in the PR description or final handoff. Mark a check complete only when its exact command or CI run actually passed.

```markdown
## Implementation
- Changes:
- Files affected:
- Roadmap item(s):

## Verification
- [ ] Focused tests:
- [ ] Workspace tests:
- [ ] Coverage:
- [ ] Syntax and policy:
- [ ] Workflow validation:
- [ ] Required CI on exact head SHA:

## Review
- Risks:
- Known limitations:
- Checks not executed:

## Git
- Target branch:
- Source branch:
- Commit:
- Pull request:
```
