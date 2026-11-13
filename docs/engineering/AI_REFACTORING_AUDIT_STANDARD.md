# AI Refactoring and Code Audit Standard

**Status:** Mandatory for every AI-assisted refactoring or code-audit task.
**Applies to:** All applications, packages, scripts, tests, and shared repository code.
**Purpose:** Improve correctness, reliability, clarity, testability, and maintainability without destabilizing working behavior.

This is the canonical repository-wide standard for refactoring and code audits. It supplements—not replaces—the [Engineering Standards](../../ENGINEERING_STANDARDS.md), [Modularity Standard](MODULARITY_STANDARD.md), [JavaScript and JSDoc Standard](JAVASCRIPT_JSDOC_STANDARD.md), [Structured Error Handling Standard](structured-error-handling.md), [AI-agent workflow](../../AI_AGENT_WORKFLOW.md), and the owning domain's instructions. Where a subject already has a canonical standard, follow that standard rather than creating a competing rule here.

## 1. Define the task boundary first

Before inspecting or changing code:

1. Identify the exact target folder, package, application, or files named by the user.
2. Identify the owning domain and read its `AGENTS.md`, `ROADMAP.md`, README, documentation index, and applicable specifications, architecture decisions, contracts, runbooks, and test guidance.
3. Read the repository-wide policies and the applicable checklist in [Task Workflows](TASK_WORKFLOWS.md).
4. Map the target's public entry points, internal modules, consumers, dependencies, tests, configuration, and CI commands.
5. Record the intended outcome, constraints, compatibility requirements, acceptance criteria, and verification plan before editing.

Treat the user-named target as the default scope boundary. Do not expand into adjacent packages, applications, or unrelated cleanup without a demonstrated dependency and explicit authorization or the repository's cross-domain process. If a necessary change crosses ownership, coordinate through [Cross-domain Requests](CROSS_DOMAIN_REQUESTS.md).

## 2. Understand before changing

- Read the relevant implementation and its callers; do not infer behavior from filenames, comments, types, or tests alone.
- Establish the current behavior from source, tests, contracts, and observable interfaces.
- Identify public exports, signatures, defaults, return shapes, error semantics, ordering, timing, persistence, and side effects.
- Record invariants and lifecycle rules, including initialization, shutdown, retries, cancellation, concurrency, idempotency, cleanup, and recovery where relevant.
- Trace data and control flow across module boundaries. Check dependency direction, cycles, hidden coupling, and infrastructure leaking into domain logic.
- Distinguish confirmed defects from design risks, missing evidence, and optional improvements.
- Do not assume a test is correct merely because it passes; verify that its assertions exercise the intended contract.

## 3. Preserve behavior unless a change is justified

A refactor should improve structure without changing externally observable behavior.

- Treat existing public APIs and behavior as contracts by default.
- Preserve signatures, exports, defaults, data shapes, ordering, precision, error behavior, and side-effect timing unless an intentional behavior change is required and documented.
- Before changing a contract, identify affected consumers, explain why the old behavior is incorrect or unsafe, add tests for the new contract, and document compatibility or migration impact.
- Avoid broad rewrites, mechanical churn, speculative abstractions, unnecessary renames, and formatting unrelated to the task.
- Do not refactor code merely to make it look different or to reduce line counts.

## 4. Use evidence-led, test-first implementation

For every behavior change, follow strict **RED → GREEN → REFACTOR**:

1. Add a deterministic test that expresses the expected behavior or reproduces the defect.
2. Run it and confirm it fails for the expected reason.
3. Make the smallest implementation change that satisfies the test.
4. Run the focused test and confirm it passes.
5. Refactor while keeping the test green.
6. Run the relevant package and broader checks required by repository policy.

Every bug fix needs a regression test that would fail without the fix, unless a concrete technical limitation is documented. Tests must assert outcomes and invariants, not merely execute lines.

Cover relevant success, boundary, malformed-input, invalid-state, rejection/error, timeout, retry, concurrency, lifecycle, and cleanup paths. Select cases according to the actual contract and risk; do not add irrelevant test permutations just to inflate counts.

Never weaken, delete, skip, loosen, or rewrite meaningful assertions solely to make a test or coverage check pass. Investigate failures and distinguish regressions from pre-existing failures with evidence.

## 5. Prioritize correctness and domain invariants

Audit and protect the rules that make the system correct before pursuing style improvements.

Depending on the target, examine:

- Input validation, normalization, units, precision, rounding, and boundary values.
- State transitions, invariants, ownership, and lifecycle.
- Idempotency, duplicate delivery, ordering, replay, and consistency.
- Async behavior, race conditions, re-entrancy, concurrency, and cancellation.
- Persistence, transaction boundaries, durability, and recovery.
- Retry limits, timeout behavior, partial failure, and cleanup.
- Authorization, trust boundaries, secret handling, and sensitive-data exposure.
- Compatibility across consumers, runtime versions, and package entry points.

Do not replace exact arithmetic, established contracts, or safety gates with approximations or convenience shortcuts. Follow domain-specific standards whenever they are stricter.

## 6. Improve modularity without fragmentation

- Keep modules cohesive and organized by responsibility and domain.
- Keep public entry points thin; avoid circular dependencies and implementation-detail imports across package boundaries.
- Separate deterministic decisions from I/O, mutable state, clocks, randomness, and orchestration when doing so materially improves clarity or independent testing.
- Extract meaningful pure functions for domain rules, calculations, validation, normalization, mapping, and policy decisions when the extraction improves cohesion or testability.
- Do not create one-function files, generic frameworks, interfaces, classes, or shared packages solely to satisfy a style preference or eliminate trivial duplication.
- Keep domain-specific logic inside its owning domain. Share code only when behavior is genuinely domain-neutral and the shared-utilities policy permits it.
- Review large files for multiple responsibilities, but treat size thresholds as review triggers—not automatic instructions to split.

The [Modularity Standard](MODULARITY_STANDARD.md) is authoritative for extraction decisions and file/module boundaries.

## 7. Keep JavaScript and error handling consistent

- Follow the repository's JavaScript-first conventions, module format, control-flow style, and lint rules.
- Add JSDoc where it clarifies exported or non-obvious contracts, data shapes, units, nullability, defaults, or error behavior. Keep comments accurate and concise; do not narrate obvious code.
- Do not introduce TypeScript, declaration-generation, or checking infrastructure as an incidental refactor.
- Preserve useful error context and causes. Do not swallow errors, hide rejected promises, return misleading success values, or log secrets.
- Follow the [Structured Error Handling Standard](structured-error-handling.md) when adding or materially changing errors.

See the [JavaScript and JSDoc Standard](JAVASCRIPT_JSDOC_STANDARD.md) and [Engineering Standards](../../ENGINEERING_STANDARDS.md) for the authoritative details.

## 8. Audit findings must be actionable

For every confirmed finding, record:

- **Severity:** P0 critical, P1 high, P2 medium, or P3 low.
- **Location:** exact file path and relevant symbol or line range.
- **Evidence:** the observed implementation/test/contract and why it demonstrates the issue.
- **Impact:** concrete failure mode, affected behavior, consumers, or operational consequence.
- **Recommendation:** the smallest safe correction and the tests needed to prove it.

Use severity consistently:

- **P0:** immediate, severe correctness, security, data-loss, or production-safety risk.
- **P1:** high-impact defect or material reliability/compatibility risk likely to cause significant failure.
- **P2:** meaningful maintainability, testability, or reliability issue with bounded impact.
- **P3:** low-risk improvement or optional cleanup.

Do not present speculation as a confirmed bug. Label unverified concerns as risks or questions and state what evidence is missing. Do not classify cosmetic preferences as defects.

When asked to audit and refactor, fix justified in-scope findings rather than returning only recommendations. When asked for an audit only, do not modify implementation; provide an evidence-based, prioritized report.

## 9. Documentation and scope discipline

- Update living documentation when behavior, contracts, configuration, architecture, ownership, operations, or roadmap status changes.
- Keep documentation aligned with the actual implementation and tests; distinguish current guarantees from intended future behavior.
- Preserve historical audit reports, incident evidence, and accepted decisions. Add dated corrections or link to current sources instead of silently rewriting history.
- Maintain one canonical source per subject. Update relevant indexes and replace duplicated guidance with links.
- Record why no documentation change was needed when the work is an internal refactor with no documented contract impact.
- Do not silently add dependencies, alter CI requirements, change public APIs, broaden permissions, or modify production/financial safety controls.

Follow [Documentation Governance](../DOCUMENTATION_GOVERNANCE.md) and the [documentation-impact policy](../../ENGINEERING_STANDARDS.md#documentation-impact).

## 10. Verification is part of completion

- Discover the actual package scripts and CI workflows; do not guess command names.
- Run focused tests first, then package tests and coverage, and applicable workspace checks.
- Verify every changed file: source behavior, tests, documentation links/commands, configuration, generated output, and workflow syntax as applicable.
- Inspect the complete diff for accidental changes, unrelated churn, weakened tests, secrets, and compatibility regressions.
- Use GitHub Actions as the repository's authoritative PR verification path when required. Confirm results on the exact final PR head SHA; earlier green runs do not count.
- Record commands/checks actually run and their outcomes. Explicitly list skipped checks and why they were not run.
- Never claim that a check passed, a behavior is safe, or documentation is current without evidence.

## 11. Pull request and final report

Keep the work focused and reviewable, with logically separated commits where useful. Follow [AI_AGENT_WORKFLOW.md](../../AI_AGENT_WORKFLOW.md) for branch freshness, PR target, required checks, merge, and branch cleanup. Do not bypass branch protection or merge into `main` as task work.

The PR description must include:

- Target scope and objective.
- Confirmed findings and their severity.
- Fixes and rationale.
- Behavior/API compatibility statement.
- Tests added or changed and the RED/GREEN evidence for behavior changes.
- Exact verification results and final head SHA.
- Documentation impact.
- Remaining risks, deferred findings, and skipped checks.

The completion report to the user must state:

1. What folders/packages were audited.
2. What confirmed bugs or risks were found.
3. What was fixed, with file references.
4. Tests added and the verification actually completed.
5. Documentation and PR links.
6. Remaining risks, limitations, and intentionally deferred work.

Be concise, factual, and explicit about incomplete work.

## 12. Non-negotiable principles

- Understand first; change second.
- Correctness and compatibility outrank cosmetic cleanup.
- Every behavior change is test-first.
- Every bug fix has a meaningful regression test.
- Fix only evidence-backed problems within the authorized scope.
- Prefer cohesive modules and meaningful pure-function extraction; avoid fragmentation.
- Keep docs, tests, and implementation consistent.
- Never weaken safety, security, or test guarantees to make a task appear complete.
- Verify the exact final change and report only what the evidence supports.
