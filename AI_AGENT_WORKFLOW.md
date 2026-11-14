# Mandatory AI-agent workflow

**Status:** Required for every AI agent and automated coding contributor.

This document defines how independent AI workstreams collaborate in the Coinzilla monorepo. The goal is to keep domain ownership clear, integration safe, and human process overhead low. These rules are mandatory; do not invent a different workflow for an individual task.

## Harvester priority

Harvester's mandatory execution order is defined only in [TRADING_FIRST.md](apps/harvester/docs/TRADING_FIRST.md). Harvester agents must read and follow that document; do not duplicate its product priorities here.

Visual workflow diagrams follow the canonical [visual documentation and workflow schemas standard](ENGINEERING_STANDARDS.md#visual-documentation-and-workflow-schemas). Consider flowcharts and sequence diagrams for complex work, and keep them aligned with source code and tests.

## 1. The short version
## 0. Mandatory documentation and requirements preflight

Before **any** task or state-changing action, every agent MUST complete the documentation preflight defined in the repository-root [AGENTS.md](AGENTS.md#mandatory-documentation-and-requirements-preflight--hard-gate) and follow [Documentation Governance](docs/DOCUMENTATION_GOVERNANCE.md). Start from the [repository documentation index](docs/README.md) and the owning domain's local index. Inventory and read in full all repository-wide policies and every applicable task checklist, domain instruction, roadmap, specification, architecture/ADR, runbook, contract, configuration guide, and test requirement; follow applicable document links recursively. Then inspect the affected implementation, consumers, tests, and configuration, and provide a concise readiness summary with the documents read, constraints, acceptance criteria, and blockers. **Do not implement, edit, mutate configuration/state, or start adjacent work until this review is complete and understanding is established.** If anything required is inaccessible, unclear, or contradictory, stop and report the blocker. Each agent must do this independently.

Before implementing a shared helper or cross-cutting capability, follow the single [shared-utilities policy](docs/engineering/SHARED_UTILITIES_POLICY.md).

For any refactoring or code-audit task, use the canonical [AI Refactoring and Code Audit Standard](docs/engineering/AI_REFACTORING_AUDIT_STANDARD.md) together with the applicable checklist in [Task Workflows](docs/engineering/TASK_WORKFLOWS.md). Treat its scope, evidence, test-first, compatibility, verification, and reporting requirements as mandatory.

1. Read the repository-root `AGENTS.md`, `ENGINEERING_STANDARDS.md`, this document, and the owning domain's `AGENTS.md` and `ROADMAP.md`.
2. Identify one owning domain and one focused task.
3. Create a short-lived task branch from the latest `develop`.
4. Change only files owned by that domain, unless a coordinated cross-domain task explicitly authorizes otherwise.
5. Add tests and follow the [documentation-impact policy](ENGINEERING_STANDARDS.md#documentation-impact).
6. Commit the implementation, strong regression tests, and documentation, then open a PR targeting `develop`. GitHub Actions is the required verification runner; run local checks when a working local environment is available, but local execution is not a prerequisite for implementation or PR creation.
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

- `feature/entities/fr-009-money-quantity`
- `fix/brokers/order-reconciliation`
- `feature/event-bus/bounded-delivery`

**Do not create permanent per-domain branches** such as `feature/entities` or `feature/brokers`. Domain ownership is permanent; task branches are temporary. Branch names describe a task, not a team or a long-lived code line.

**Absolute target-branch rule — no exceptions for task work:**

- Every feature, bug fix, refactor, maintenance change, and documentation task MUST start from the latest `develop` and its PR MUST target `develop`.
- A task PR targeting `main` is invalid. Do not create it, retarget it, or merge it. Do not use `main` as the base for task branches.
- The ONLY permitted PR targeting `main` is the final release PR whose source/head is `develop` and whose target/base is `main`.
- Therefore the only permitted integration direction into `main` is `develop` → `main`. All ongoing work flows into `develop` first.
- This applies to urgent fixes too: implement and validate them through `develop`; include them in the next user-approved `develop` → `main` release. Do not invent hotfix exceptions.
- Before creating a PR, explicitly verify both refs: task PR = `<task-branch> → develop`; release PR = `develop → main`. If the pair does not match one of these two forms, stop and correct it before opening/updating the PR.

Every task branch must start from the latest `develop`. Every task PR targets `develop`. Only the final release PR from `develop` targets `main`.

### Reserved branch-name protection — mandatory

AI agents and automated contributors MUST NOT create a task branch whose name is, or contains as a delimited token, either reserved branch name: `main` or `develop`. This applies case-insensitively and regardless of the branch prefix or task type.

- Reject names matching `(^|[\\/._-])(main|develop)(?=$|[\\/._-])` (case-insensitive).
- Examples that MUST NOT be created: `main`, `develop`, `feature/main/fix-login`, `feature/develop/task-123`, `fix-main`, and `docs_develop_cleanup`.
- Use a task-specific name such as `feature/auth/fix-login`, `fix/brokers/order-retry`, or `docs/agent-branch-policy` instead.
- The rule applies to local and remote branch creation, renaming, and pushing. Check the proposed name before creating the branch; if it matches, choose a compliant name. Never create a reserved-pattern branch and plan to rename or delete it later.
- `main` and `develop` are existing protected integration branches, not task-branch names. PR destination is selected separately: routine task PRs target `develop`; only the final release PR targets `main`.

This restriction exists because GitHub's automatic head-branch deletion is not guaranteed to remove branches whose names collide with or imitate the permanent integration branches. Treat the naming check as a hard precondition, not a preference.

## 3. Domain ownership

The authoritative domain/path/responsibility map is [DOMAIN_OWNERSHIP.md](docs/engineering/DOMAIN_OWNERSHIP.md). Each task must have one primary owning domain. Read that domain's local `AGENTS.md` and `ROADMAP.md`; local instructions add domain constraints but do not redefine repository-wide policy.

Shared infrastructure is identified in the ownership document. Coordinate changes that cross ownership boundaries rather than silently modifying another domain.

## 4. Cross-domain requests

Use the authoritative [cross-domain request process](docs/engineering/CROSS_DOMAIN_REQUESTS.md) for bugs, capability gaps, and contract changes owned by another domain. The owning domain decides and implements its contract; consumers coordinate through linked requests and PRs.

## 5. Task PR requirements and automated integration

## 5.1 Pull-request title convention — mandatory

Every task PR title MUST communicate the actual change in a short, specific phrase. Use this format:

`<type>(<app-or-package>): <specific change and outcome>`

- **Type:** use `feat` for new behavior/capability, `fix` for correcting broken or unsafe behavior, and `docs` for documentation-only changes.
- **Scope:** name the owning application or package, using its repository directory name (for example, `harvester`, `brokers`, or `utils`). For a genuinely repository-wide change with no single app/package owner, use `repo`.
- **Description:** start with a clear action verb and name the behavior being added, corrected, or documented. Include a short outcome when it makes the functionality clearer.
- Keep the title concise (normally 50–90 characters). A reader should understand the PR's purpose without opening it.
- Describe the delivered functionality, not the implementation phase, internal milestone, architecture jargon, or issue number alone.
- Avoid vague titles such as `build operator control`, `begin Step 8`, `update Harvester`, or `fix issue #123`. Do not claim a capability is runtime-enabled when the PR only adds its foundation.
- Do not put a list of changed files, test status, or the full PR summary in the title; keep those in the PR body.

Examples:

- `feat(harvester): add transport-independent operator pause controls`
- `feat(harvester): record durable order facts for future recovery`
- `fix(harvester): preserve reasons when order submission is deferred`
- `docs(harvester): explain volatility protection thresholds with examples`

The PR template reminds contributors of this format. Apply it to new PRs and improve existing titles when updating those PRs, after completing the required branch-freshness check.

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

## 6. Branch freshness and conflict handling — required on every PR update

The PR's actual target branch is authoritative. Never hard-code `main` as the synchronization target for every PR. **A PR branch must never be knowingly outdated when the PR is created, updated, pushed, marked ready, reviewed, or merged.** The responsible agent owns all freshness checks and synchronization; never ask the user to update a routine task branch.

### Mandatory freshness check before every PR update

Before **each** action that updates an existing PR or its source branch—including pushing or amending commits, changing the PR title/body/base, changing draft/ready state, requesting review, or enabling auto-merge—the agent MUST:

1. Fetch the latest remote PR target branch and the current PR head.
2. Compare the PR head with its actual target (`develop` for task PRs; `main` for the final release PR). Verify the latest target tip is an ancestor of the PR head; a branch that is merely ahead but also behind is stale.
3. If the PR branch is behind or has diverged, synchronize it with the latest target **before updating the PR**. For task PRs, merge the latest `develop` into the task branch. For the final release PR, synchronize against `main`. Resolve conflicts only on the task branch, inspect the complete resulting diff, and never force-push shared history.
4. After synchronization, fetch and compare both refs again. Do not proceed until the target tip is confirmed as an ancestor of the PR head.
5. Re-run the checks affected by the synchronization and wait for all required checks to pass on the exact resulting head SHA. A previous green run on an older head does not count.
6. Only then perform the intended PR update. Immediately afterward, re-fetch both refs and verify freshness again; if the target advanced during the update, synchronize and repeat validation before proceeding with further PR actions.

This procedure applies every time, not only once per PR and not only before merge. If a PR is already current, record/confirm that result and proceed without creating an unnecessary synchronization commit. Metadata-only changes still require the pre-update freshness check.

### Mandatory final merge check

Immediately before merging, repeat the full freshness check against the PR's actual target. If either ref changes during validation, repeat synchronization and required checks. Merge only when the latest target tip is an ancestor of the exact PR head being merged and every required gate is satisfied.

Never force-push shared history, discard another agent's work, use empty commits to restart CI, or ask the user to perform routine synchronization. If permissions or tools prevent safe synchronization or verification, stop and report the exact blocker. Never merge a stale PR or bypass branch protection.

## 7. Roadmap discipline

Each domain roadmap is the source of truth for that domain's planned work and status.

- Add accepted work to the owning roadmap before or as implementation begins.
- Use clear states: `[ ] planned`, `[~] in progress/blocked`, and `[x] complete and merged into develop`.
- A task is not complete when code is merely written or a PR is opened.
- Mark complete only after merge into `develop` and successful required validation.
- If work is deferred, superseded, or blocked by another domain, record the reason and link the request.
- Keep the root roadmap for repository-wide engineering and release work; do not duplicate every domain backlog there.

## 8. Required verification

Run the narrowest relevant checks first, then the applicable broader checks. **GitHub Actions is the authoritative execution environment for PR verification.**

- When a working local checkout and toolchain are available, run the relevant package test, coverage, syntax, and quality commands locally for fast feedback.
- When local execution is unavailable, do not pause implementation, ask the user to run commands, or report local-environment limitations as blockers. Commit the actual source changes, strong tests, and documentation; open/update the PR and let GitHub Actions execute the required checks.
- Inspect check conclusions for the exact current PR head SHA. A green run on an earlier SHA does not count.
- Fix failed checks by correcting source, tests, or workflow defects without weakening assertions, skipping tests, reducing coverage, or masking failures. Push the fix and wait for GitHub to rerun.
- Merge only after every required check passes on the exact head SHA and branch freshness is verified.

For broker changes, keep live/network integration tests separate from default unit tests. Tests that place orders must use TESTNET only. Never claim a check passed unless GitHub (or an actually executed local runner when GitHub is not the applicable runner) reports success.

## 9. Final release: one human review

The purpose of `develop` is to accumulate independently implemented, automatically validated work. Do not ask the user to review every task PR.

When the user-approved milestone is ready:

1. Ensure all intended domain work is merged into `develop`.
2. Synchronize and validate `develop` against the latest `main`.
3. Run the full release validation and inspect the complete `develop` → `main` diff.
4. Prepare one release PR with a concise milestone summary, roadmap items included, test evidence, compatibility/migration notes, and known risks.
5. The user performs the final review and approval. Agents must not merge this PR unless the user explicitly authorizes that merge.

Do not turn every small commit into a separate human decision. Keep the final PR understandable with a summary and links to task PRs/issues.

### Post-release ancestry reconciliation — mandatory

A successful `develop` → `main` release PR creates a merge commit on `main` that is not automatically reachable from `develop`. After **every** user-approved release merge, the responsible agent MUST reconcile that release-merge ancestry back into `develop` before treating the branches as synchronized or preparing another release.

1. Re-fetch and record the exact `main` and `develop` HEAD SHAs. Verify the merged PR was exactly `develop` → `main`, inspect its merge commit and both parents, confirm the user's approving review is recorded, and confirm every required check passed on the exact release PR head. If the approval is absent, the live `main` ruleset does not require at least one approval, or the ruleset cannot be verified, stop: do not merge another release PR.
2. Compare the branches and inspect every commit exclusive to `main`. Do not infer that commits are harmless from their count or message. For each release merge commit, verify its second parent is the exact release PR head, its tree SHA equals that second parent's tree SHA, and that source/head commit is an ancestor of the current `develop`. Inspect file-level differences as well. If any main-only commit contains content not already present in `develop`, any source head is not an ancestor, or any tree/diff is unexpected, stop and prepare a separately reviewed reconciliation; never use a blanket `ours`/ `theirs` resolution.
3. When the evidence proves that only release-merge ancestry is missing and the `main` tree introduces no content absent from `develop`, create a short-lived task branch from the exact latest `develop` SHA. Merge the exact latest `main` into that task branch, preserving both histories with `develop` as the first parent. Inspect the complete resulting tree and diff; the resulting tree must retain the full `develop` tree unchanged. Do not force-push or update either integration branch directly.
4. Open a PR from that task branch into `develop`. Include the before/after SHAs, release PR links, parent/tree verification, and an explicit statement that this is ancestry-only reconciliation with no runtime/content changes. Run all required checks on the exact PR head, verify branch freshness, and merge only under the ordinary `develop` PR gates. Delete the task branch after successful merge.
5. Re-fetch both integration refs and verify `main` is now an ancestor of `develop` (`main` → `develop` comparison has `behind_by = 0`). Record the resulting SHAs. If either branch advanced during the procedure, repeat the audit against the new tips.

This is repository-history maintenance, not permission to merge task work into `main`. The only permitted PR target for this reconciliation is `develop`; the only permitted PR target for a release remains `main` with source `develop` and explicit user approval. Never reset, rebase, force-push, delete, or recreate either integration branch.

## 10. One-time GitHub repository configuration

Documentation is not enforcement. Configure GitHub rulesets/branch protection as follows:

### `develop`

- Require pull requests; disallow direct pushes.
- Require **all** CI checks: `Run package tests`, `Workspace test coverage`, `Check JavaScript syntax`, `packages/utils tests`, `Audit production dependencies`, and `actionlint`.
- Require branches to be up to date before merging (`strict_required_status_checks_policy: true`).
- Require conversation resolution.
- Require zero human approvals; agents may merge their own PRs only after every required check is green.
- Block force pushes and deletion of `develop` itself; task source branches are deleted after merge.
- Keep GitHub automatic head-branch deletion enabled.
- Do not configure bypass actors or admin bypass for these gates.

### `main`

- Require pull requests.
- Require the release CI status checks and up-to-date branch.
- Require at least one approving review so the final release approval is technically enforced, not merely documented.
- Block force pushes and branch deletion.

Enable repository **Allow auto-merge** only if desired and supported by the chosen merge strategy. If it remains disabled, agents may merge task PRs themselves after all rules are satisfied. Do not describe auto-merge as active until the repository setting is actually enabled.

After configuration, read back both live rulesets and verify they match the requirements above. Derive exact required-check context names from successful workflow runs; never assume a workflow name is its status context. Do not claim a rule is active until the live ruleset confirms it.

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

Follow the authoritative [JavaScript and JSDoc standard](docs/engineering/JAVASCRIPT_JSDOC_STANDARD.md). Do not restate or fork its language/tooling rules in workflow instructions.

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

## User-provided file protection — mandatory

**DO NOT MODIFY PROVIDED FILE WITHOUT MY APPROVAL!**

AI agents MUST NOT modify, overwrite, replace, delete, move, or reformat a file supplied or designated by the user unless the user has explicitly approved modifying that specific file. Treat user-provided files as read-only by default. When changes are needed for tests or experiments, create and modify an isolated copy or fixture instead; preserve the original byte-for-byte. Approval to modify one file does not authorize changes to other provided files. If it is unclear whether a file is user-provided or whether approval covers the proposed change, leave it untouched and ask.

## AI-agent communication rules

These rules apply to every AI agent and coding assistant in this repository, in every conversation and task:

- **Do not append continuation prompts.** Never end a command, response, task summary, or conversation with a suggested prompt, a prompt to continue, or instructions telling the user what to ask next. Stop after delivering the requested result. The user will ask when they want a prompt or continuation.
- **Do not repeat information.** Do not restate facts, decisions, explanations, progress, or results already provided unless repetition is necessary to resolve ambiguity or prevent a material mistake. Carry forward established context instead of making the user read it again.
- **Be concise by default.** Give the shortest complete answer: lead with the outcome, include only relevant details, and summarize verification without dumping logs. Avoid bloated explanations and excessively long responses (including 1,000-line answers). Include detail only when the task genuinely requires it or the user asks.
- **No unsolicited follow-up prompt or menu.** Do not add generic offers, suggested next steps, or question lists merely to keep the conversation going. Ask a question only when a missing detail blocks safe or correct progress.

These communication rules do not reduce the required engineering work, testing, or accuracy. Report material limitations and verification evidence concisely.

## Execution-first behavior for user requests — mandatory

Every AI agent and coding assistant MUST execute clear user requests to implement, fix, build, change, or configure something. A request to implement is authorization to do that work within its stated scope; it is not an invitation to debate whether the user should want it.

- Inspect applicable requirements and the affected code, then implement the requested outcome. Do not substitute a plan, explanation, pseudocode, or self-service instructions when the agent can perform the work.
- Do not argue, unnecessarily challenge the user's chosen approach, or ask for confirmation already provided by the request.
- Ask a question only when a missing detail is essential to correctness or safety. Otherwise make a reasonable, reversible choice consistent with repository conventions and proceed.
- If the exact approach is blocked, find and implement the closest safe alternative within scope. Keep moving on independent parts of the task rather than abandoning all work.
- Include relevant tests, documentation, and verification as part of implementation. Report what actually changed and which checks actually ran.
- Be honest about limits: never claim success for an action that did not complete. If permissions, tools, external dependencies, or a genuine safety requirement prevent completion, identify the precise blocker and complete whatever safe work remains.
- This execution-first rule does not override security, privacy, domain ownership, financial/production safeguards, required tests, branch protection, or explicit approval gates for destructive actions and releases.

**Expected behavior: act first, deliver the working change, and keep discussion limited to essential decisions and material blockers.**

## 15. Pull-request draft and ready-for-review lifecycle — mandatory

A pull request's GitHub lifecycle state and its draft/ready-for-review state are different. GitHub reports an unmerged draft PR as `state: open` with `draft: true`. In this policy, **READY/OPEN** means explicitly marked ready for review (`draft: false`); **DRAFT/WIP** means work is still in progress (`draft: true`).

- Create every task PR as a **draft**. Keep it draft throughout implementation, investigation, conflict resolution, and verification.
- Never mark a PR ready for review merely because a PR exists, a branch is mergeable, or some checks have passed.
- A PR may be marked **ready for review (OPEN)** only when the task is genuinely complete: all agreed acceptance criteria and implementation are finished; tests and required documentation are included; the complete diff has been reviewed; there are no known unresolved blockers or requested changes; and every required CI check has passed on the exact current PR head SHA.
- **Branch freshness is an absolute precondition to marking a PR ready.** Immediately before the transition, fetch the latest target branch and PR head, compare them, and verify the latest target tip is an ancestor of the exact PR head (`behind_by = 0`). If behind or diverged, keep the PR draft, synchronize safely, inspect the complete diff, and rerun affected checks. Do not mark ready while stale, conflicted, or while required checks are pending or failing.
- After marking ready, immediately fetch and compare the refs again and verify that the PR is still current. If the target advanced during the transition, or any completion gate is no longer satisfied, convert the PR back to draft, synchronize, and repeat verification.
- If implementation resumes, a new commit is pushed, a required check fails, a new blocker is found, or requested changes remain unresolved after a PR was marked ready, convert it back to draft immediately. It stays draft until every completion gate is satisfied again.
- Agents must report the PR's actual draft flag, mergeability, ahead/behind counts, and exact-head CI result. Never describe a draft PR as ready/open for review, and never describe a merely open GitHub state as proof that work is complete.
- A PR being ready for review is not the same as being merged. Follow the separate merge gates and ownership rules in this workflow; never merge solely because the PR was marked ready.

This rule applies to every AI agent, coding assistant, human contributor and automation. Draft is the default working state; ready-for-review is an explicit completion signal, not a progress indicator.
