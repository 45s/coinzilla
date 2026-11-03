# Instructions for coding agents

## Harvester execution priority — mandatory

For all work in `apps/harvester/**`, follow [apps/harvester/docs/TRADING_FIRST.md](apps/harvester/docs/TRADING_FIRST.md). **FIRST MAKE IT WORK. THEN MAKE IT BETTER.** The first deliverable is a working Conservative TESTNET trading loop: load config → connect/subscribe → receive price → decide → submit order → process order updates/fills → update state → repeat. Journal integration, durable persistence, comprehensive restart recovery/reconciliation, operational hardening, optimization, and Aggressive are secondary and MUST NOT delay the first working TESTNET cycle. Implement only the minimum targeted safety required for that cycle; then return to the trading workflow. The Harvester roadmap must reflect this priority.


Before making changes, select the task-specific checklist in [docs/engineering/TASK_WORKFLOWS.md](docs/engineering/TASK_WORKFLOWS.md), then read `AGENTS.md`, `ENGINEERING_STANDARDS.md`, `AI_AGENT_WORKFLOW.md`, and the closest affected package/application `AGENTS.md` and `ROADMAP.md`. Then inspect the relevant implementation, consumers, and tests.

## Non-negotiable engineering principles

1. **Test-First, Comprehensive Verification**
   - Every new or changed behavior must have meaningful automated tests. Tests are a required part of implementation, not optional follow-up work.
   - For bug fixes, add a regression test that reproduces the defect and fails before the fix whenever practical.
   - Cover success paths, invalid inputs, boundaries, edge cases, failure paths, and relevant interactions between features.
   - Test observable contracts and externally visible behavior. Test private implementation details only when a focused unit test adds meaningful confidence.
   - Prefer deterministic tests. Control time, randomness, scheduling, and concurrency; use promises/barriers instead of arbitrary sleeps.
   - Run the affected package's tests and coverage command, then applicable workspace and repository checks. Never claim a test or check passed unless it was actually executed and passed.
   - Do not weaken, skip, delete, or rewrite meaningful assertions merely to make a change pass. Explain any unavoidable gap.

2. **Reliability and Observability by Default**
   - Design for invalid input, partial failure, rejected promises, concurrency, cleanup, and resource exhaustion—not only the happy path.
   - Validate inputs at boundaries and preserve invariants throughout the implementation.
   - Handle every failure deliberately. Never silently swallow errors, hide rejected promises, or return success when an operation failed.
   - Provide useful, structured diagnostic context at meaningful system boundaries and on actionable failures. Include relevant operation/entity identifiers and the original error when available.
   - Logging must help diagnose behavior without flooding normal operation. Do not log the same failure redundantly, and never log secrets, credentials, tokens, or sensitive payloads.
   - Make retries, timeouts, cancellation, resource limits, and fallback behavior explicit and bounded where applicable.
   - Add tests for failure handling and for the behavior of logging/error-reporting hooks.

3. **Single-Responsibility Module Design**
   - Keep entry points and public index files thin: exports and composition only, not the home for an entire feature implementation.
   - Split implementation into cohesive modules based on responsibility, not arbitrary file size. Each module should have one clear reason to change.
   - Use package-local folders such as helpers/ for focused internal operations, utils/ for genuinely reusable generic utilities, constants/ for stable shared constants, errors/ for domain-specific errors, and adapters/ or services/ for integration and side-effect boundaries when those concepts exist.
   - Keep feature orchestration in a clearly named feature module. Avoid both giant files and excessive fragmentation into one-function files without a cohesion or testing benefit.
   - Use descriptive, consistent file and symbol names. Prefer domain-specific names over vague names such as common, misc, or stuff.
   - Keep dependencies flowing toward stable, lower-level contracts; avoid circular dependencies and hidden side effects.
   - **Extract meaningful pure logic when separation improves cohesion, testability, or comprehension.** A single caller does not prevent extraction, but purity alone does not require a separate file. Keep trivial expressions, tightly coupled callbacks, and context-dependent details local when extraction would obscure the flow.
   - Group related pure functions by domain/responsibility in focused modules (for example, `helpers/validate-telegram-options.js` or `telegram/telegram-message-validation.js`). Do not create a generic `utils.js` dumping ground or split trivial one-line expressions into files.
   - Classes and services should orchestrate side effects and own state. Separate validation, parsing, formatting, normalization, mapping, calculations, and business rules when doing so creates a clearer responsibility or independently testable contract.
   - Avoid god files. A file approaching 300 lines must be reviewed for cohesive extraction opportunities; files exceeding 500 lines require a clear technical justification in the PR or a refactoring plan. These are review triggers, not reasons to fragment tightly coupled code mechanically.

4. **Evidence-Based Completion**
   - Inspect the final diff for correctness, missing tests, accidental changes, dead code, secrets, and weakened checks.
   - Follow the canonical [documentation-impact policy](ENGINEERING_STANDARDS.md#documentation-impact) for every meaningful change.
   - In the completion summary, list the behavior changed, tests/checks actually run and their outcomes, and anything not run or still uncertain.

## Required workflow

**Shared-utility search is mandatory before implementation.** Before adding a helper, logger, validator, formatter, parser, numeric/decimal operation, time utility, or other cross-cutting capability, follow [docs/engineering/SHARED_UTILITIES_POLICY.md](docs/engineering/SHARED_UTILITIES_POLICY.md). Search packages/utils first, inspect its public exports and tests, then search the whole repository. Reuse or extend the shared public API when the behavior is domain-neutral; keep business and protocol rules in their owning domains. Do not create a duplicate generic implementation without recording why reuse is inappropriate.


1. Read `ENGINEERING_STANDARDS.md`, `AI_AGENT_WORKFLOW.md`, and the closest applicable package/application `AGENTS.md`.
2. Identify the owning domain and roadmap item before editing.
3. Inspect the affected implementation, consumers, tests, scripts, and relevant current branch history.
4. Add or update deterministic tests with the implementation; add regression coverage for defects whenever practical.
5. Make the smallest cohesive change and keep ownership boundaries intact.
6. Run focused tests and coverage, then applicable workspace checks.
7. Review the complete diff and satisfy the [documentation-impact policy](ENGINEERING_STANDARDS.md#documentation-impact); include the required impact note in the PR.
8. Follow the target-aware branch synchronization and PR rules in `AI_AGENT_WORKFLOW.md`.
9. Report exact commands, outcomes, and the final commit SHA. Never claim an unrun check passed.

## Mandatory AI-agent development workflow

**Every AI agent, coding assistant, and automated contributor MUST follow [AI_AGENT_WORKFLOW.md](AI_AGENT_WORKFLOW.md).** Read it before planning or editing. The workflow applies to every task, including documentation-only work.

- Work from `develop`, using a short-lived task branch. Do not use permanent per-domain development branches.
- Respect the domain ownership map and package/application instructions. Do not silently modify another domain's code.
- For cross-domain needs, create a request for the owning domain and coordinate the required changes; do not implement a workaround in the consumer domain.
- Keep task PRs focused and target `develop`. Run the required checks and merge the task PR after all automated gates pass; routine human approval is not required for `develop`.
- Never merge task work directly into `main`. Only a milestone/release PR from `develop` to `main` receives the user's final review and approval.
- Synchronize against the PR's actual target branch, not a hard-coded branch name. The agent owns branch freshness, conflict resolution, CI reruns, and verification; never ask the user to update a branch manually.
- For every meaningful change, follow the canonical [documentation-impact policy](ENGINEERING_STANDARDS.md#documentation-impact) and include its required impact note in the PR.
- If required permissions, checks, or branch rules are missing, do not bypass them. Report the exact blocker and continue only with safe work.

## Repository-specific constraints

- This is a pnpm workspace. Follow the package manager and versions declared in the root manifest.
- Default unit tests must not require local environment files, credentials, network access, or live exchange access.
- Broker integration tests must remain separate from default unit tests. Tests that place orders must use TESTNET only.
- Do not claim a check passed unless it was actually run and passed.
- Do not bypass or weaken CI checks to make a change pass. Explain any justified exception to the engineering standards.


## Reserved branch names (mandatory)

- Before creating, renaming, or pushing any task branch, apply the reserved-name check in [AI_AGENT_WORKFLOW.md](AI_AGENT_WORKFLOW.md#reserved-branch-name-protection--mandatory).
- Never create a task branch named `main` or `develop`, or containing either token delimited by `/`, `.`, `_`, or `-` (case-insensitive). Examples prohibited include `feature/main/task`, `feature/develop/task`, `fix-main`, and `docs_develop_cleanup`.
- If a proposed branch name matches, choose a task-specific alternative before creating it. This is a hard restriction for every AI agent and automated contributor.


## Task branch cleanup (mandatory)

- Every task branch is short-lived and exists only while its PR/work is active.
- Immediately after a task PR is successfully merged into `develop`, the task is closed, and no other open PR or active task depends on that branch, delete the source branch.
- Do not keep merged task branches as archives. The merged commits remain part of `develop`; deleting the branch does not delete the commits or PR history.
- Never delete `main`, `develop`, a release branch, or any branch with an open PR or active work depending on it.
- If GitHub's automatic head-branch deletion is enabled, verify that GitHub deleted the branch. If it is disabled or deletion fails, the responsible agent must delete the merged source branch manually and verify the branch is gone.
- Branch cleanup is part of completing the task PR, not optional housekeeping. Report any branch that could not safely be deleted and why.


## JavaScript and JSDoc policy

Coinzilla is JavaScript-first. Follow [the JavaScript and JSDoc standard](docs/engineering/JAVASCRIPT_JSDOC_STANDARD.md) for source-language, annotation, editor-support, and TypeScript-interop decisions.

- Do not introduce TypeScript source, TypeScript configuration, generated declaration files, or a TypeScript migration as an incidental cleanup.
- Use JSDoc where it communicates a public contract, non-obvious input/output shape, callback contract, or important constraint. Do not add comments that merely restate obvious code.
- JSDoc is documentation and editor assistance; it does not replace runtime validation or tests.
- Do not enable project-wide `checkJs` or add a documentation-generation dependency without a concrete, reviewed need.
- When a TypeScript consumer needs declarations, treat that as an explicit interoperability requirement and document its scope rather than changing the JavaScript-only default.


## Policy ownership and CI safety

Use the documents below as the canonical source for each concern; do not copy whole policy sections between them:

| Concern | Canonical document |
| --- | --- |
| Task selection and execution checklists | `docs/engineering/TASK_WORKFLOWS.md` |
| Branches, domain ownership, cross-domain coordination, PR lifecycle | `AI_AGENT_WORKFLOW.md` |
| Design, testing, security, dependencies, and definition of done | `ENGINEERING_STANDARDS.md` |
| Path ownership and domain responsibilities | `docs/engineering/DOMAIN_OWNERSHIP.md` |
| Domain-specific constraints and backlog | The owning domain's `AGENTS.md` and `ROADMAP.md` |

When changing CI or repository automation:

- Preserve the exact names of required status-check contexts unless the corresponding GitHub rulesets are updated and read back successfully.
- Do not remove, rename, skip, or make a required check non-blocking to get a green build.
- Do not use `continue-on-error`, `|| true`, or equivalent masking for required validation.
- Verify pull-request and push triggers for both `develop` and `main`, plus scheduled/manual triggers where applicable.
- Keep workflow permissions least-privilege; default to read-only and grant write access only to the job that needs it.
- Pin third-party Actions to reviewed full commit SHAs. Prefer GitHub-native automation before introducing another Action or package.
- Update tests for policy scripts and the root roadmap when enforcement or repository configuration changes.
- Report GitHub ruleset state separately from workflow presence. A workflow existing does not mean its check is required by branch protection.
