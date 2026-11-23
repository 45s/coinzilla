# AI task standards and verification guide

**Status:** Repository engineering guidance
**Applies to:** AI agents and automated coding contributors
**Owner:** Repository engineering
**Canonical source:** This document

Use this guide to discover the engineering standards relevant to a task and to keep implementation quality consistent. It is not a mandatory task-start gate or an administrative reporting process.

## 1. Practical task workflow

1. Read the repository-root `AGENTS.md` and the applicable nested `AGENTS.md` files.
2. Understand the request or issue, its scope, acceptance criteria, dependencies, and constraints.
3. Consult the smallest applicable checklist in [Task Workflows](TASK_WORKFLOWS.md) and the canonical standards that govern the affected area.
4. Inspect relevant implementation, consumers, documentation, configuration, and tests. Do not rely on summaries or assumptions when source inspection is available.
5. Plan the change, implement it, add meaningful tests, update affected documentation, and run relevant checks.
6. Keep issue and PR descriptions accurate as scope, decisions, blockers, or verification change.

No Task Preflight command, readiness report, reading attestation, or issue-evidence comment is required before implementation, before committing, or to complete a task. Resolve genuine requirement conflicts or safety blockers directly; do not create a replacement generic gate.

## 2. Standards discovery by task type

Use this table as a starting point. Follow applicable links and local domain guidance; do not read unrelated domain internals.

| Task type / affected area | Relevant standards and sources |
| --- | --- |
| Any repository task | Root and applicable nested `AGENTS.md`; [AI Agent Workflow](../../AI_AGENT_WORKFLOW.md); [Engineering Standards](../../ENGINEERING_STANDARDS.md); [Task Workflows](TASK_WORKFLOWS.md); [Documentation Governance](../DOCUMENTATION_GOVERNANCE.md) |
| JavaScript changes | [JavaScript and JSDoc Standard](JAVASCRIPT_JSDOC_STANDARD.md); effective `eslint.config.js`; package scripts and tests |
| Helpers or pure-function extraction | [Modularity Standard](MODULARITY_STANDARD.md); [Shared Utilities Policy](SHARED_UTILITIES_POLICY.md); relevant domain contracts |
| Refactor / audit | [AI Refactoring and Code Audit Standard](AI_REFACTORING_AUDIT_STANDARD.md); applicable checklist; public contracts, callers, and tests |
| Domain behavior or strategy | Owning domain instructions, roadmap, canonical specification, architecture/ADRs, safety and test documents |
| Configuration / schema | Configuration ownership, schema/validation contracts, defaults, compatibility and migration guidance |
| Errors / diagnostics | [Structured Error Handling Standard](structured-error-handling.md); [Logging and Observability Standard](LOGGING_OBSERVABILITY_STANDARD.md) |
| Broker / exchange / financial behavior | Broker instructions, provider references, exact-decimal policy, exchange environment and financial-safety rules; TESTNET/LIVE boundaries |
| CI / scripts / repository policy | Current workflows and scripts, CI governance, required check contexts, actionlint/syntax and policy-script tests |
| Markdown / documentation | [Documentation Governance](../DOCUMENTATION_GOVERNANCE.md); [Markdown Style](../MARKDOWN_STYLE.md); owner indexes and canonical sources |
| Shared utilities / cross-domain changes | [Shared Utilities Policy](SHARED_UTILITIES_POLICY.md); [Cross-domain Requests](CROSS_DOMAIN_REQUESTS.md); affected owner contracts |

## 3. Optional Task Preflight validator

The repository retains `pnpm run task:preflight` and its tests as optional developer tooling for issue/task-content validation and local readiness snapshots. Use it only when it helps; it does not authorize or block implementation, commits, PRs, or completion. The `--attest-read`, `--attest-nested`, and `--record` options are optional tool features, not agent requirements.

The validator's parser/security correction and regression tests remain preserved. Its local report format and issue checks do not replace source review, meaningful tests, or accurate PR verification. It is not invoked by required CI workflows or branch-protection checks.

## 4. Engineering quality throughout the task

- Follow applicable architecture, dependency, naming, validation, error, logging, security, and safety standards while implementing.
- Prefer existing utilities, patterns, and contracts after checking their source and consumers.
- Keep implementation, tests, and affected living documentation consistent in the same PR.
- Write meaningful tests for changed behavior, including relevant boundaries and failure paths. Preserve existing tests and checks.
- Revisit standards discovery when the task expands into another domain or changes affected paths.
- For behavior changes, follow the repository's test-first RED → GREEN → REFACTOR standard; do not weaken or skip meaningful tests.
- Review names of new or materially changed modules, functions, exports, and important variables using the [Modularity Standard](MODULARITY_STANDARD.md#naming-standard).
- Resolve concrete conflicts between applicable requirements and preserve source/test evidence; do not silently choose an easier interpretation.
- Report verification honestly. A check that did not run is not a pass.

## 5. Completion review

Before handing work over, confirm that:

- The requested behavior or documentation change is implemented within scope.
- Meaningful regression tests and relevant checks are complete, or limitations are stated.
- Independent engineering, security, and safety requirements remain intact.
- Affected living documentation, indexes, and roadmap status are consistent.
- The complete diff is focused and reviewed.
- The PR describes the change, documentation impact, and actual verification on the exact head SHA.

This review is ordinary engineering work; it does not require a Task Preflight report, attestation, or issue-evidence recording ceremony.
