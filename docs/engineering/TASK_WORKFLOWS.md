# Task-specific agent workflows

All tasks must follow root AGENTS.md, AI_AGENT_WORKFLOW.md, the mandatory [AI Task Compliance Standard](AI_TASK_COMPLIANCE_STANDARD.md), the owning domain's AGENTS.md, and its roadmap. Use the smallest applicable checklist below; high-risk requirements are additive.

## Mandatory standards-compliance preflight

- [ ] Completed the task-start gate in [AI Task Compliance Standard](AI_TASK_COMPLIANCE_STANDARD.md) before changing state.
- [ ] Identified and read all applicable canonical standards, domain requirements, task checklist and linked specifications in full.
- [ ] Inspected the actual source, consumers, tests, configuration and file tree; did not rely on memory or summaries.
- [ ] Recorded task scope, constraints/invariants, acceptance criteria, verification and documentation impact.
- [ ] Reviewed names for new or materially changed modules/functions/exports/variables: helpers are fully self-descriptive; core/domain functions are behavior-descriptive with contextual brevity; orchestration names express the action/transition; modules/services/classes remain concise and responsibility-oriented.
- [ ] Resolved applicable requirements conflicts or documented a concrete blocker/exception; none were silently bypassed.
- [ ] Repeated standards discovery if task scope or affected domains changed.

## Task contract, incremental commits and handoff

For every non-trivial task, follow the mandatory [incremental commit and handoff protocol](../../AI_AGENT_WORKFLOW.md#11-incremental-commits-and-resumable-task-handoffs--mandatory).

- [ ] A GitHub Issue (or explicitly adopted existing issue) describes the goal, owning scope, exclusions, requirements/invariants, acceptance criteria, dependencies, verification and documentation impact.
- [ ] The issue, branch, PR and owning roadmap link to one another where applicable; update task state as scope, decisions, blockers and progress change.
- [ ] Work is split into cohesive, reviewable commits using `<type>(<scope>): <imperative outcome>`; preserve test-first RED/GREEN evidence and avoid unrelated or progress-only commits.
- [ ] Follow the commit-to-checkpoint loop in the canonical workflow: after each meaningful increment, inspect and validate it, commit and push it, synchronize with latest `develop` before pushing, and refresh the issue's current-state summary with the exact head SHA and next action before starting another increment.
- [ ] Keep implementation, tests, and affected living documentation consistent in the same logical increment; when no documentation change is warranted, record the reason. Keep the roadmap status accurate without turning it into a commit diary.
- [ ] Before pausing or changing owners, add a handoff checkpoint to the issue (and update the PR when applicable) with exact branch/head, base freshness, completed/in-progress work, next action, decisions, checks/CI SHA, blockers, safety boundaries and documentation/roadmap status.
- [ ] The task can be resumed from GitHub issue, branch, PR and canonical docs without relying on private chat history.

## Documentation-only change

- Confirm the owning documentation/domain, canonical source of truth and linked references.
- Review names of new or materially changed document headings, filenames and identifiers in examples for clarity; keep names concise where the surrounding context is explicit.
- Follow [Documentation Governance](../DOCUMENTATION_GOVERNANCE.md): classify the document, preserve historical provenance, and avoid creating competing sources of truth.
- Follow the canonical [Markdown style standard](../MARKDOWN_STYLE.md) for formatting and authoring conventions.
- Update the nearest documentation index when adding, moving, renaming, superseding or archiving a document.
- Follow the canonical [documentation-impact policy](../../ENGINEERING_STANDARDS.md#documentation-impact).
- Preserve technical meaning; verify every command, path, and policy statement against the repository.
- Run a living-document freshness sweep: search all discovered Markdown files for claims affected by the change; update affected living docs and indexes in the same PR; preserve historical records with dated addenda instead of rewriting them.
- If a domain roadmap status/priority/blocker changes, inspect and synchronize the root `ROADMAP.md` when it tracks that item; verify the owner roadmap agrees with any changed root priority.
- Do not equate passing link validation with factual freshness; compare affected docs against current source, tests, configuration and merged PR status.
- Run `pnpm run check:agent-policy` when ownership or agent instructions change.
- When Markdown/MDX changes, run `node --test scripts/markdown-path-policy.test.js scripts/check-markdown-style.test.js` and `node scripts/check-markdown-style.js --all-maintained`.
- When headings or local links change, run `node --test scripts/check-maintained-markdown-anchors.test.js` and `node scripts/check-maintained-markdown-anchors.js`; historical-source findings remain report-only.
- For pull requests, run `node scripts/check-markdown-style.js <exact-40-character-target-base-sha>` for the changed-file guard.
- Run actionlint/syntax checks when workflow or executable configuration files change.
- Do not run broad application test suites for prose-only edits unless the change affects executable examples or contracts.

## Bug fix

- Reproduce the defect with a deterministic regression test where practical.
- Identify the owning domain and inspect callers, public contracts, and adjacent failure paths.
- Make the smallest cohesive fix; do not bundle unrelated refactors.
- Run the owning package's tests and coverage, then applicable workspace CI.

## Feature or behavior change

- Identify the user-visible contract, owning roadmap item, dependencies, and failure modes before implementation.
- Add tests for success, invalid input, boundaries, failures, and relevant interactions.
- Apply the canonical [documentation-impact policy](../../ENGINEERING_STANDARDS.md#documentation-impact) to the changed behavior and affected roadmap.
- Include the required **Documentation impact** note in the PR description, as specified by the canonical policy.
- Run focused tests/coverage, workspace tests, syntax/policy checks, and applicable CI.

## Refactoring or code audit

- Read the canonical [AI Refactoring and Code Audit Standard](AI_REFACTORING_AUDIT_STANDARD.md) before inspecting or changing code.
- Keep one task on one task branch and one PR; include implementation, tests and affected living documentation together. Do not open a separate docs PR for documentation required by the same implementation.
- Audit architecture, dependencies, correctness, reliability, maintainability, tests, lint/static-analysis, security and performance where relevant to the authorized scope.
- Back bottleneck/performance claims with measurements or reproducible evidence; label unmeasured concerns as hypotheses, not confirmed defects.
- Prioritize findings by concrete risk and impact; record a disposition for each significant finding rather than creating an unbounded cleanup list.
- Confirm the exact user-authorized folder/package scope and owning domain; do not expand scope silently.
- Read applicable domain instructions, roadmap, specifications, contracts, implementation, consumers, tests, and configuration.
- Establish existing public behavior and invariants before proposing structural changes.
- Record findings with severity, exact location, evidence, impact, and a safe recommendation; distinguish confirmed defects from risks and suggestions.
- For behavior changes, demonstrate RED → GREEN → REFACTOR; add a meaningful regression test for every bug fix.
- Preserve public contracts unless an intentional, documented, tested behavior change is required.
- Prefer cohesive modules and meaningful pure-function extraction; avoid speculative abstractions and mechanical churn.
- Verify every changed file and relevant package/workspace checks; report exact results, skipped checks, and the final PR head.
- When the audit touches `helpers/`, run `pnpm run check:helper-policy`; inspect all detected violations and indirect dependencies rather than treating the scanner as a purity proof.
- Update affected living documentation and indexes; preserve historical evidence and include a Documentation impact note in the PR.

## Cross-domain or shared-infrastructure change

- Identify every affected owner and link the cross-domain request(s).
- Keep domain implementation changes in owner-scoped PRs where practical.
- For CI, agent policy, manifests, shared utilities, or GitHub rules, state the affected domains and verify all current consumers.
- Validate workflow syntax and the exact required GitHub status-check context names.
- Do not claim GitHub ruleset configuration changed unless the live ruleset was read back and verified.

## Financial, exchange, or production-safety change

- Preserve exact decimal arithmetic and established entity/broker boundaries.
- Keep default tests offline and credential-free.
- Broker order integration tests must use TESTNET only; no live order placement.
- Verify explicit safety gates, authorization, idempotency, reconciliation, failure handling, and secret redaction.
- Never enable production order execution or relax a safety gate without explicit user authorization.

## Before merge

Follow the authoritative synchronization, CI-gate, merge, branch-cleanup, and release requirements in [AI_AGENT_WORKFLOW.md](../../AI_AGENT_WORKFLOW.md). This checklist does not restate those lifecycle rules.
