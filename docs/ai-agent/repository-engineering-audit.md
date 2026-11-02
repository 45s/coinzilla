# AI Agent Engineering Task Brief

## Repository-Wide Architecture, Reliability & Maintainability Audit

**Repository:** `45s/coinzilla`  
**Target branch:** `develop`  
**Task type:** Engineering audit + implementation + testing + documentation  
**Priority:** High  
**Primary objective:** Improve repository-wide code quality, reliability, maintainability, and consistency without introducing regressions.

---

# 1. Mission

Perform a systematic engineering audit of the entire `45s/coinzilla` repository.

Previous audits have already hardened these packages:

- `packages/utils`
- `packages/notifiers`
- `packages/event-bus`

Use those completed audits as reference points for engineering standards and implementation quality.

Do not simply produce a list of recommendations. Investigate real problems, determine their impact, implement justified improvements, add regression tests, update documentation, and verify everything through CI.

The goal is to leave the repository in a measurably better state.

**Important:** Prioritize correctness and backward compatibility over the number of changes. Do not refactor code merely to make it look different.

# 2. Initial reconnaissance

Before changing anything:

1. Inspect the repository structure.
2. Read the root `README.md`, `package.json`, workspace configuration, and relevant development documentation.
3. Inspect the current `develop` branch and recent commit history.
4. Identify all packages, applications, shared modules, scripts, and CI workflows.
5. Inspect package-level READMEs, ROADMAP files, and existing tests.
6. Review the merged implementation of PRs #383 and #384 for `packages/utils`.
7. Review the previous hardening work for `packages/notifiers` and `packages/event-bus`.
8. Identify existing architectural conventions and testing standards.

Do not assume that every package uses the same architecture.

Build a repository map before making architectural recommendations.

# 3. Audit priorities

Work through the following phases in order.

## Phase A — Cross-package dependencies and architecture

**Primary focus: dependency direction, coupling, and circular dependencies.**

Inspect:

- All package-to-package imports.
- Relative imports that cross package boundaries.
- Circular dependencies.
- Unexpected dependency chains.
- Shared functionality duplicated across packages.
- Packages importing implementation details from other packages.
- Public entry points versus internal modules.
- Dependencies that should be optional but are currently required.
- Unnecessary dependencies and unused package references.
- Inconsistent module boundaries.

Determine whether packages depend on one another in a clear and maintainable way.

Look for:

- Circular dependency risks.
- Hidden runtime coupling.
- Internal modules imported directly by consumers.
- Repeated utility implementations with genuinely shared behavior.
- Dependencies that make testing unnecessarily difficult.
- Packages that cannot be tested independently.

**Deliverables:**

- Dependency and architecture findings.
- Prioritized issues with file paths and evidence.
- Dependency improvements where justified.
- Regression tests for every code or configuration change.
- Architecture documentation if the changes warrant it.

Do not introduce a new shared package just to eliminate a small amount of duplication.

## Phase B — Error handling and logging consistency

Inspect error handling throughout the repository.

Look for:

- Empty or swallowed catch blocks.
- Errors logged without useful context.
- Errors accidentally exposing credentials or sensitive information.
- Inconsistent error types and error propagation.
- Lost original errors and stack traces.
- Async functions that fail silently.
- Unhandled promise rejections.
- Logging that can itself cause unexpected failures.
- Inconsistent behavior when optional loggers or callbacks fail.

Establish consistent behavior without unnecessarily changing public APIs.

Where practical:

- Preserve original errors and causes.
- Make failure behavior deterministic.
- Avoid exposing secrets in diagnostics.
- Keep logs useful and actionable.
- Test hostile and malformed inputs.

Do not log sensitive data just because it makes debugging easier.

## Phase C — Test quality and coverage

Inspect tests across all packages.

Look for:

- Missing edge-case coverage.
- Weak assertions.
- Tests that only verify implementation details.
- Flaky or timing-sensitive tests.
- Tests dependent on execution order.
- Missing async failure tests.
- Inadequate mock cleanup.
- Missing boundary-value tests.
- Tests that pass without exercising the intended behavior.
- Missing integration tests for important package interactions.

Protect public contracts and realistic failure scenarios with tests.

**Every code change must have an appropriate automated test.** This applies to every code change, not only bug fixes, risky changes, or changes considered meaningful. Do not leave any changed code untested because it appears trivial.

Do not increase coverage percentages by adding meaningless tests. Tests must assert the intended behavior and fail when that behavior regresses.

Use existing repository coverage standards as a baseline. Where appropriate, establish package-level thresholds based on actual risk and achievable coverage.

## Phase D — Public APIs and backward compatibility

Inspect all package entry points and exported APIs.

Check:

- Public exports.
- Internal exports accidentally exposed.
- Naming consistency.
- Function argument validation.
- Return-value consistency.
- Error contracts.
- Default values.
- Optional arguments.
- Deprecated functionality.
- Runtime compatibility.
- Type declarations, if present.
- Package entry-point configuration.

Identify breaking changes and compatibility risks.

**Default rule: preserve existing public APIs.**

If a behavior change is necessary:

1. Explain the problem.
2. Explain why the existing behavior is unsafe or incorrect.
3. Identify affected consumers.
4. Add tests documenting the new contract.
5. Update documentation.
6. Clearly identify the compatibility impact in the PR.

Do not silently change existing behavior.

## Phase E — CI, dependencies, and release readiness

Inspect:

- GitHub Actions workflows.
- Node.js version coverage.
- Workspace test execution.
- Package-level test scripts.
- Coverage enforcement.
- JavaScript syntax checks.
- Dependency audits.
- Lockfile consistency.
- Production versus development dependencies.
- Unused dependencies.
- Package publishing configuration.
- Versioning and release scripts.
- Build and packaging behavior.

Look for gaps that allow broken code to merge.

Improve CI only where it provides meaningful protection.

Do not add expensive or redundant workflows without justification.

# 4. Implementation rules

Follow these rules throughout the task.

### Rule 1 — Evidence before changes

Every change must address an identified problem.

For each proposed fix, record:

- File path.
- Current behavior.
- Actual problem.
- Potential impact.
- Proposed solution.
- Compatibility risk.

Do not implement speculative improvements.

### Rule 2 — Small, isolated changes

Prefer focused commits and logically separated changes.

Avoid:

- Large unrelated refactors.
- Renaming public APIs without a compelling reason.
- Reformatting entire directories.
- Rewriting working modules without evidence.
- Introducing unnecessary abstractions.

### Rule 3 — Preserve existing behavior

Treat existing public behavior as a contract unless there is a documented reason to change it.

Before implementation:

- Identify affected consumers.
- Check existing tests.
- Understand edge cases.
- Record compatibility risks.

### Rule 4 — No unnecessary dependencies

Do not add runtime dependencies unless absolutely necessary.

Prefer existing repository tools and native platform capabilities.

If a dependency is required, explain why it is justified.

### Rule 5 — Test every change — no exceptions

**Every change must be tested or explicitly verified. Do not use “meaningful change” as a threshold for testing.**

Apply this rule to every changed file and every changed behavior:

- **Production code:** Add or update automated tests that exercise the changed behavior. Cover relevant success paths, failure paths, and boundary conditions.
- **Test code:** Run the tests and verify that the new or modified assertions actually exercise the intended behavior. Do not add tests that merely execute code without meaningful assertions.
- **CI and workflow configuration:** Validate the workflow configuration and run the affected workflow or its relevant checks.
- **Build, package, and dependency configuration:** Run the affected install, build, packaging, audit, or validation commands.
- **Documentation:** Check Markdown formatting where tooling exists, verify links and referenced paths, and confirm examples and commands against the actual repository.
- **Refactors and code moves:** Run relevant tests before and after the change; add tests if behavior or contracts were not already adequately covered.
- **Formatting and generated-file changes:** Run the applicable formatter, generator, or consistency check and verify the resulting diff.

For each change, record the exact verification performed and its result. If a change cannot be meaningfully automated, document the manual verification and why automation is not applicable.

Run relevant package tests after each logical change, then run workspace-wide checks before merging.

Do not:

- Skip tests because a change looks trivial.
- Rely only on a successful build when behavior changed.
- Weaken or delete tests to make CI pass.
- Ignore failures in tests unrelated to the changed file without investigating them.
- Claim a change is verified when its required check was not run.

A change is not complete until its applicable tests and verification have passed.

### Rule 6 — Security and sensitive information

Never introduce:

- Hardcoded credentials.
- Secrets in logs.
- Unsafe input handling.
- Unnecessary exposure of internal data.
- Insecure defaults.

Treat external input and serialized data as potentially malformed or hostile.

### Rule 7 — Documentation must match reality

Update relevant:

- `README.md` files.
- Package documentation.
- `ROADMAP.md` files.
- API documentation.
- Architecture documentation.
- CI documentation, where relevant.

Do not mark work complete until the corresponding tests and verification have passed.

# 5. Repository workflow

Follow this Git workflow.

1. Start from the latest `develop`.
2. Verify the working tree is clean.
3. Create a focused task branch, for example:
   - `audit/cross-package-architecture`
   - `audit/error-handling`
   - `audit/test-quality`
   - `audit/api-compatibility`
   - `audit/ci-release-readiness`
4. Make changes in small, reviewable commits.
5. Run the applicable tests and checks for every change.
6. Push the branch.
7. Open a pull request against `develop`.
8. Include findings, changes, compatibility notes, and test results in the PR description.
9. Wait for all required CI checks to pass.
10. Fix failures rather than bypassing checks.
11. Merge only after all required checks pass.
12. Verify the final `develop` commit and branch cleanup.

Prefer separate PRs for separate phases when that makes reviews safer.

Do not bundle unrelated changes into one massive PR.

If a serious issue is discovered that requires a breaking change or architectural redesign, stop and document the issue before proceeding with that change.

# 6. Required testing and verification

Run the relevant commands discovered from the repository configuration.

At minimum, verify:

- Package-level unit tests.
- Workspace-wide tests.
- Coverage checks.
- JavaScript syntax checks.
- Dependency audit.
- CI workflow validation.
- Build or packaging checks, if available.
- The appropriate verification for every other changed file, as specified in Rule 5.

Test on all Node.js versions supported by the repository.

For every CI failure:

1. Identify the actual cause.
2. Determine whether it is a regression or a pre-existing issue.
3. Fix it where it falls within the task scope.
4. Never hide failures by weakening tests or removing checks.

Record the exact commands, results, and CI run links.

# 7. Required documentation

Create a repository-level audit report:

`docs/audits/repository-engineering-audit.md`

If the directory does not exist, create it.

The report must contain:

### Executive summary

- Overall findings.
- Most important risks.
- Work completed.
- Remaining work.

### Repository architecture

- Package inventory.
- Dependency relationships.
- Circular dependency findings.
- Coupling problems.
- Architectural recommendations.

### Reliability

- Error-handling findings.
- Logging findings.
- Security-related findings.
- Fixes implemented.

### Testing

- Existing test infrastructure.
- Important coverage gaps.
- Tests added.
- Verification performed for every change.
- Remaining testing risks.

### API compatibility

- Public API findings.
- Compatibility risks.
- Contract changes.
- Documentation updates.

### CI and dependencies

- Workflow findings.
- Dependency findings.
- Improvements implemented.
- Remaining gaps.

### Validation record

- Commands executed.
- Test results.
- Coverage results.
- CI workflow links.
- Final commit hashes.

### Remaining recommendations

Prioritize remaining work as:

- P0 — Critical.
- P1 — High.
- P2 — Medium.
- P3 — Low / optional.

Do not classify cosmetic preferences as critical problems.

# 8. Definition of done

The task is complete only when:

- [ ] All five audit phases have been investigated.
- [ ] Findings have evidence and file references.
- [ ] High-priority issues within scope have been fixed.
- [ ] Every code change has an appropriate automated test.
- [ ] Every changed file and configuration has its applicable verification recorded.
- [ ] Public API compatibility has been considered.
- [ ] Documentation reflects the actual implementation.
- [ ] CI passes on supported Node.js versions.
- [ ] Coverage checks pass.
- [ ] No unnecessary runtime dependencies were introduced.
- [ ] Pull requests have been merged into `develop`.
- [ ] Final repository state has been verified.
- [ ] Remaining issues are documented and prioritized.

A report containing only recommendations does not satisfy this task.

Code changes without tests and verification do not satisfy this task.

A test or verification skipped because a change was considered trivial does not satisfy this task.

# 9. Final report to the user

When finished, provide a concise but complete report containing:

1. What was audited.
2. What problems were discovered.
3. Which problems were fixed.
4. Which files and packages were changed.
5. Tests added.
6. Test and coverage results.
7. CI results and links.
8. PR links and merge commits.
9. Any compatibility changes.
10. Remaining risks and recommended next steps.

Be honest about incomplete work. Never claim that something passed unless it was actually executed and verified.

---

# 10. Final engineering principle

**Improve the repository without destabilizing it.**

The objective is not to maximize the number of changed files, lines of code, abstractions, or tests.

The objective is to make the codebase more reliable, understandable, testable, secure, and maintainable while preserving working functionality.

Think like a senior engineer responsible for the long-term health of a production codebase.

Investigate first. Prove the problem. Make the smallest effective fix. Test every change. Document it. Verify it. Then merge.
