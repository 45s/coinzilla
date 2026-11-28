# AI task standards and verification guide

**Status:** Repository engineering guidance
**Applies to:** AI agents and automated coding contributors
**Owner:** Repository engineering
**Canonical source:** This document

Use this guide to discover only the engineering standards relevant to a task and to keep implementation quality consistent. It defines progressive context loading, not an additional task-start gate or administrative reporting process.

## 1. Practical task workflow

1. Read the repository-root `AGENTS.md`, `ENGINEERING_STANDARDS.md`, and `AI_AGENT_WORKFLOW.md`.
2. Understand the request or issue, its scope, acceptance criteria, dependencies, and constraints.
3. Select the smallest applicable checklist in [Task Workflows](TASK_WORKFLOWS.md). Read the owning application's or package's `AGENTS.md` and `ROADMAP.md` only when that domain is affected.
4. Load the canonical standards that govern the changed behavior or files; use the task-type map below as a discovery index, not a reading list. Do not read unrelated domain internals or every document linked from an entry-point file.
5. Inspect relevant implementation, consumers, documentation, configuration, and tests. Do not rely on summaries or assumptions when source inspection is available.
6. Plan the change, implement it, add meaningful tests, update affected documentation, and run relevant checks.
7. Keep issue and PR descriptions accurate as scope, decisions, blockers, or verification change.

No Task Preflight command, readiness report, reading attestation, or issue-evidence comment is required before implementation, before committing, or to complete a task. Resolve genuine requirement conflicts or safety blockers directly; do not create a replacement generic gate.

## 2. Progressive context loading

Load context in layers and stop when the task is adequately constrained:

1. **Always required:** root `AGENTS.md`, `ENGINEERING_STANDARDS.md`, `AI_AGENT_WORKFLOW.md`, and the GitHub task contract for non-trivial work.
2. **Task-specific:** the smallest checklist in `TASK_WORKFLOWS.md`; the owning domain's `AGENTS.md` and `ROADMAP.md` when an application/package is affected.
3. **Conditional standards:** read the canonical standard for each concern the task actually touches (for example JavaScript, configuration, errors, logging, database migrations, broker safety, Markdown, or refactoring). A link in an index does not make its target mandatory for every task.
4. **Implementation evidence:** inspect the relevant entry points, implementations, direct consumers, tests, configuration and documentation. Expand to adjacent modules only when imports, callers, contracts, tests or the issue show a dependency.
5. **Re-evaluate on scope change:** when a change crosses a domain boundary or adds a new concern, load that owner's instructions and the newly applicable standards before proceeding.

Do not optimize by skipping an applicable safety or engineering rule. Optimize by excluding irrelevant context, using section-level reads when sufficient, and following canonical links instead of loading duplicate explanations.

### Short examples

| Task | Load | Do not load by default |
| --- | --- | --- |
| Documentation-only edit to a repository policy | **Always:** root `AGENTS.md`, `ENGINEERING_STANDARDS.md`, `AI_AGENT_WORKFLOW.md`, this compliance guide, GitHub issue/task contract. **Task-specific:** documentation-only checklist. **Conditional:** Documentation Governance, Markdown Style, target document and affected indexes/references. | Harvester, Brokers, Database or other domain `AGENTS.md`/`ROADMAP.md`, implementation and source internals unless the policy change affects that domain. |
| Dashboard API client change | **Always:** root `AGENTS.md`, `ENGINEERING_STANDARDS.md`, `AI_AGENT_WORKFLOW.md`, this compliance guide, GitHub issue/task contract. **Task-specific:** feature/behavior checklist, Dashboard `AGENTS.md` and `ROADMAP.md`, relevant API/client implementation and tests. **Conditional:** JavaScript, ESLint, error-handling and API-contract standards only for concerns touched. | Harvester trading/recovery docs, broker provider references, unrelated package roadmaps and internals. |
| Bitunix Spot broker change | **Always:** root `AGENTS.md`, `ENGINEERING_STANDARDS.md`, `AI_AGENT_WORKFLOW.md`, this compliance guide, GitHub issue/task contract. **Task-specific:** financial/exchange-safety checklist, Brokers `AGENTS.md` and `ROADMAP.md`, mandatory [Bitunix workflow](../../packages/brokers/docs/BITUNIX_WORKFLOW.md) and [reference audit](../../packages/brokers/AGENTS.md#bitunix-spot-development--mandatory-reference-audit), relevant broker implementation and tests. **Conditional:** exact-decimal and security standards where applicable. | Dashboard internals, unrelated Harvester orchestration and other exchange providers unless the task crosses those boundaries. |

## 3. Standards discovery by task type

Use this table as a starting point. Follow applicable links and local domain guidance; do not read unrelated domain internals. A row identifies candidate sources, not a requirement to open every link.

| Task type / affected area | Relevant standards and sources |
| --- | --- |
| Any repository task | Root `AGENTS.md`; [AI Agent Workflow](../../AI_AGENT_WORKFLOW.md); [Engineering Standards](../../ENGINEERING_STANDARDS.md); smallest applicable [Task Workflow](TASK_WORKFLOWS.md). Add nested instructions, domain roadmaps and Documentation Governance when the affected scope requires them |
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

## 4. Optional Task Preflight validator

The repository retains `pnpm run task:preflight` and its tests as optional developer tooling for issue/task-content validation and local readiness snapshots. Use it only when it helps; it does not authorize or block implementation, commits, PRs, or completion. The `--attest-read`, `--attest-nested`, and `--record` options are optional tool features, not agent requirements.

The validator's parser/security correction and regression tests remain preserved. Its local report format and issue checks do not replace source review, meaningful tests, or accurate PR verification. It is not invoked by required CI workflows or branch-protection checks.

## 5. Engineering quality throughout the task

- Follow applicable architecture, dependency, naming, validation, error, logging, security, and safety standards while implementing.
- Prefer existing utilities, patterns, and contracts after checking their source and consumers.
- Keep implementation, tests, and affected living documentation consistent in the same PR.
- Write meaningful tests for changed behavior, including relevant boundaries and failure paths. Preserve existing tests and checks.
- Revisit standards discovery when the task expands into another domain or changes affected paths.
- For behavior changes, follow the repository's test-first RED → GREEN → REFACTOR standard; do not weaken or skip meaningful tests.
- Review names of new or materially changed modules, functions, exports, and important variables using the [Modularity Standard](MODULARITY_STANDARD.md#naming-standard).
- Resolve concrete conflicts between applicable requirements and preserve source/test evidence; do not silently choose an easier interpretation.
- Report verification honestly. A check that did not run is not a pass.

## 6. Completion review

Before handing work over, confirm that:

- The requested behavior or documentation change is implemented within scope.
- Meaningful regression tests and relevant checks are complete, or limitations are stated.
- Independent engineering, security, and safety requirements remain intact.
- Affected living documentation, indexes, and roadmap status are consistent.
- The complete diff is focused and reviewed.
- The PR describes the change, documentation impact, and actual verification on the exact head SHA.

This review is ordinary engineering work; it does not require a Task Preflight report, attestation, or issue-evidence recording ceremony.
