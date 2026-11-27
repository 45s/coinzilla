# Engineering Standards

This document is the repository-wide engineering contract. Apply it to new code and to code materially changed by a pull request. Automated checks are authoritative where available; principles that cannot be reliably automated require explicit review.

## Definition of Done

A change is ready to merge only when:

- [ ] The change solves the stated problem and handles expected edge cases.
- [ ] Every new or changed behavior has meaningful automated test coverage, including relevant success, boundary, invalid-input, and failure scenarios.
- [ ] For every behavior change, the test was written first, observed failing for the expected reason before implementation, then observed passing after the implementation (RED → GREEN → REFACTOR).
- [ ] Every bug fix includes a regression test that reproduces the defect, unless a documented technical reason makes that impractical.
- [ ] Tests are deterministic and do not depend on production services, credentials, or live exchange access.
- [ ] The affected package's tests and coverage checks pass; applicable workspace and CI checks pass.
- [ ] Error handling, validation, structured diagnostics, security, and resource cleanup are appropriate to the change.
- [ ] Modules are cohesive, follow single-responsibility boundaries, and do not turn public entry points into implementation dumping grounds.
- [ ] Non-trivial pure logic is extracted into cohesive, independently testable modules rather than embedded in large classes/services or unrelated files.
- [ ] Large files have been split by responsibility, or a concrete reason for keeping them together is documented in the PR.
- [ ] Documentation impact requirements in [Documentation impact](#documentation-impact) are satisfied.
- [ ] No secrets, credentials, generated artifacts, or unrelated changes are included.
- [ ] Any deliberate deviation from these standards is explained in the pull request, with a reason and follow-up plan when appropriate.

## Documentation impact

This section is the canonical policy for assessing and updating documentation in every meaningful change.

- Assess whether the change affects documented behavior, public APIs/contracts, configuration, architecture, ownership, operational procedures, examples, or roadmap status.
- Update every affected source of documentation in the same task/PR as the change and, where practical, in the same commit. This includes agent instructions and domain roadmaps when their guidance or status changes.
- If no documentation update is warranted (for example, an internal refactor or test-only change that does not alter a documented contract), record a concise reason in the PR description.
- Do not defer a required documentation update to an unspecified follow-up. Include a **Documentation impact** note in every meaningful PR, listing updates or explaining why none are needed.

Other repository instructions and task checklists should link to this section rather than restating its policy. Document ownership, classification, lifecycle, ADRs, historical evidence, naming, indexes, migration safety and AI-agent maintenance requirements are defined in the canonical [Documentation Governance](docs/DOCUMENTATION_GOVERNANCE.md); follow it rather than creating local variants.

## ESLint compliance — mandatory

All JavaScript contributors, including AI agents, MUST follow the canonical [ESLint Standard](docs/engineering/ESLINT_STANDARD.md). Read it and inspect the effective eslint.config.js rules before writing or changing JavaScript. ESLint rules are engineering constraints, not suggestions to work around. Do not add inline suppressions, weaken rule settings, reduce lint coverage, or alter lint commands to make a change pass. Refactor the implementation to satisfy the existing rules. The root ESLint configuration disables inline configuration so source comments cannot suppress or override configured rules.

## Configuration

Follow the canonical [Configuration Standard](docs/engineering/CONFIGURATION_STANDARD.md) for ownership, loading, validation, defaults, environment access, immutability, secrets, compatibility and tests. Domain instructions may add stricter application-specific requirements but must link to this standard rather than redefine the repository-wide contract.

## Executable CLI identity — mandatory

Every maintained, user-invoked executable CLI entrypoint MUST make its running source revision identifiable before performing work.

- Print an identity banner at startup, before loading credentials, contacting external services, changing branches, writing reports, or performing mutations.
- Provide a side-effect-free `--version` (or the platform's equivalent) that prints the same identity and exits without credentials, network access, external-service calls, or state changes.
- Include the script/command name, owning package version, full Git commit SHA, worktree state (`clean`, `dirty`, or `unknown`), and runtime version where applicable.
- Resolve the commit from the exact checkout used to execute the script. Do not use a branch name, a moving tag, a guessed version, or a short SHA as a substitute for the full commit.
- If Git metadata cannot be read, print `commit unknown` and/or `worktree unknown`; never silently claim a version or clean state.
- Do not print secrets, environment values, private paths, or unrelated Git status details in the identity banner.
- Reuse a shared identity helper where appropriate. Do not copy/paste Git subprocess logic into every entrypoint.
- Inventory maintained executable CLI entrypoints and migrate them in coherent increments. Exclude libraries, imported modules, generated artifacts, test fixtures, and non-user-invoked scripts; document justified exceptions.
- Keep identity discovery read-only and deterministic. It must not fetch from remotes or alter the working tree.

The owning package documents any command-specific presentation details; this section is the repository-wide source of truth. The incremental migration inventory and current entrypoint status are maintained in [CLI source identity rollout](docs/engineering/CLI_SOURCE_IDENTITY.md).

## Exchange environment configuration

Binance exchange endpoint selection is governed by [ADR-0002: Explicit Binance trading environment](docs/architecture/decisions/ADR-0002-explicit-binance-trading-environment.md). All consumers MUST pass an explicit `TRADING_MODE=testnet|live`; missing or invalid values fail closed. `NODE_ENV` is application runtime metadata only and MUST NOT select or influence Binance endpoints. Keep the ADR as the cross-workspace decision source and the Brokers/Harvester documentation as the operational guides.

## Visual documentation and workflow schemas

Visual explanations are a preferred documentation technique across **all applications, packages, infrastructure, and engineering workflows** when they make a non-trivial process easier to understand. They complement—not replace—the authoritative prose contract.

- Prefer **Mermaid flowcharts** for workflows, decision trees, validation gates, state transitions, retry paths, and failure handling.
- Prefer **Mermaid sequence diagrams** when the important detail is the order of messages or calls between actors, components, services, brokers, databases, or external systems.
- Use diagrams when they materially improve understanding. Do not force them into trivial changes, simple reference material, or explanations that are already clearer as prose or a table.
- When adding or materially changing a complex workflow, assess whether its owning documentation should gain or update a diagram in the same task/PR. Do not leave a useful diagram as an informal chat-only explanation.
- Show meaningful branches, including rejected decisions, timeouts, unknown outcomes, retries, reconciliation, fallback behavior, and safety boundaries. Do not draw only the happy path when failure behavior is part of the contract.
- Keep diagrams synchronized with the actual implementation, tests, and authoritative specification. Verify each node and transition against source code and tests before publishing.
- Place a concise explanation near each diagram. State what the diagram covers, clarify important invariants, and identify which prose/specification remains authoritative if a diagram is illustrative.
- Use GitHub-compatible Markdown Mermaid fences (`\`\`mermaid`) and valid Mermaid syntax. Keep labels concise and readable; split an oversized diagram into focused diagrams rather than shrinking text or omitting important behavior.
- AI agents should proactively use these visual forms in technical documentation, PR descriptions, code reviews, investigation summaries, and user-facing explanations whenever they improve comprehension. Prefer a diagram followed by a concise explanation over unnecessarily long prose.

This is a repository-wide convention. Domain-specific agent instructions may add examples or constraints, but must link here rather than define competing diagram rules.

## Principles

### 1. Correctness and reliability first

- Prefer the simplest implementation that correctly expresses the requirement.
- Design for expected failures and adverse conditions, not only the happy path.
- Validate untrusted input at system boundaries and preserve invariants internally.
- Handle failures intentionally. Do not silently swallow errors, hide rejected promises, or return misleading success values.
- Preserve useful error context when propagating or reporting failures.
- Make retries, timeouts, cancellation, concurrency, resource limits, and fallback policies explicit and bounded where applicable.
- Avoid hidden dependencies on time, randomness, process state, network services, or global mutable state.

### 2. Test-first development and comprehensive coverage

- **Strict TDD is mandatory for all code changes that introduce or alter behavior: tests first, implementation second.** Do not write or modify production implementation to satisfy a requirement until the corresponding test exists and has been run.
- **RED:** write the smallest meaningful test that expresses the required observable behavior. Run it against the current implementation and confirm that it fails because the behavior is missing or incorrect—not because of a syntax error, broken fixture, invalid test, or unrelated setup failure. Record/inspect that failure before proceeding.
- **GREEN:** only after the expected RED result, make the smallest production change that makes the test pass. Run the new test again and confirm it passes. Add further tests in the same test-first cycle for relevant boundaries, invalid inputs, failures, and interactions.
- **REFACTOR:** only after GREEN, improve structure or remove duplication while preserving behavior. Re-run the relevant tests after each refactoring step; keep the suite green.
- Repeat RED → GREEN → REFACTOR in small increments. Do not write a batch of implementation and add tests afterward. Do not treat a test that passes before the implementation as proof of RED; investigate whether the behavior already exists or the test is ineffective.
- For a bug fix, first add a regression test that reproduces the defect and verify that it fails for the defect. Then implement the fix. A regression test added only after the fix does not satisfy this requirement.
- If local execution is unavailable, perform the RED/GREEN cycle through GitHub Actions: commit the test first, open/update a Draft PR or otherwise trigger the applicable PR workflow, inspect the exact test result and job log, then implement only after confirming the expected behavioral failure. If no workflow covers the test, add or extend a safe, least-privilege workflow in the task PR. A missing terminal, local checkout, package manager, or local runner is not a valid reason to stop. Stop before implementation only when the test cannot be executed locally **and** no safe GitHub Actions path can be made available, the expected failure cannot be distinguished from an invalid test/setup after investigating the remote run, or the behavior cannot reasonably be tested automatically. Record the concrete GitHub-side blocker or narrowly scoped exception in the PR; do not silently skip RED or claim it occurred.
- For documentation-only, formatting-only, or other changes with no runtime behavior, use the applicable task checklist; do not invent meaningless tests. If a documentation change alters an executable contract or example, test that contract/example where practical.
- **Every new or changed behavior must be tested.** Tests are a required part of implementation, not optional follow-up work.
- For every bug fix, add a regression test that demonstrates the original defect and fails before the fix whenever practical.
- Cover normal behavior, boundaries, malformed and adversarial input, exceptional conditions, rejected promises, concurrency/races, cleanup, and interactions with neighboring functionality as relevant to the risk.
- Test public, observable contracts. Add narrow unit tests for internal pure logic when they materially improve confidence.
- Prefer a test pyramid: many fast isolated unit tests, focused integration tests for important boundaries, and end-to-end tests only where they provide distinct value.
- Keep tests deterministic, isolated, repeatable, and independent of execution order. Control clocks, randomness, schedulers, and concurrency; prefer deferred promises/barriers over arbitrary sleeps.
- Tests must clean up resources they create: listeners, timers, servers, temporary files, subscriptions, and pending work.
- Do not mock away the behavior under test. Mock external boundaries, not every internal function.
- Do not delete, skip, weaken, or loosen assertions to make a suite pass. If a test is invalid, replace it with an equally strong test and explain why.
- **Every assertion must include a detailed failure message.** The message must explain the behavior/invariant being checked and, where useful, identify the relevant scenario or expected state; avoid restating only the expected literal (for example, `"expected 2"`). Assertions without a message are not acceptable in new or materially edited tests. When updating an existing test, add meaningful messages to every assertion in the edited test case.
- Review coverage reports for uncovered lines and branches, especially error and lifecycle paths. Aim for high line and branch coverage; critical behavior and failure branches must be covered. A percentage alone is not proof of test quality.
- Add or maintain package-specific coverage thresholds where the tooling supports them. A threshold must be meaningful, enforced by CI, and increased deliberately; do not claim coverage is gated when it is not.
- Run the affected package's test and coverage scripts first, then relevant workspace tests and repository quality checks. Report exact commands and outcomes accurately.
- Never claim tests passed unless they were actually executed and passed.

### Test expectations by module and layer

Choose tests from the behavior and risk being changed. Use the lowest-cost test that proves the contract; add a higher-level test only when it proves an interaction that a lower-level test cannot.

| Module or boundary | Expected test evidence | What the test should prove |
|---|---|---|
| Pure helper / calculation / mapper | Direct unit test, colocated with the helper | Deterministic output, normal and boundary inputs, invalid input, immutability where promised; no infrastructure mocks |
| Domain value object / entity | Unit test | Construction and validation, invariants, equality/serialization where public, exact decimal and asset/unit behavior |
| Domain policy / decision function | Unit test or named behavior matrix | Each meaningful rule, threshold boundary, rejected decision, and combinations that affect the result |
| State machine / lifecycle model | Unit test | Allowed and rejected transitions, invariants, terminal states, duplicate/out-of-order events, and recovery from incomplete state |
| Application use case / handler | Focused unit or integration test with injected ports | Observable result, dependency calls and ordering, side-effect boundary, partial failure, retry/unknown outcome handling, and cleanup |
| Infrastructure adapter / external protocol | Adapter contract tests using fake transport or captured fixtures | Exact request/response mapping, validation before I/O, malformed responses, timeouts, transport failures, error classification, and redaction |
| Repository / persistence | Contract and integration tests against a deterministic local provider or temporary database | Serialization, isolation, transaction commit/rollback, atomicity, reopen/recovery and failure behavior |
| Runtime composition / lifecycle | Integration test with real in-process components and fake external boundaries | Wiring, startup/shutdown ordering, concurrency, resource ownership, idempotent cleanup, and failure propagation |
| Public package contract | Consumer-facing contract or shared conformance suite | Public exports, result/error shapes, compatibility and consistent behavior across implementations |
| Cross-layer user workflow | End-to-end test only when it proves a distinct risk | A meaningful complete workflow across real internal boundaries; do not duplicate lower-level coverage without added confidence |

For financial, broker, order, fill, accounting and recovery behavior, select the relevant rows together: test exact decimal values, partial and duplicate fills, event ordering, commissions, reconciliation, unknown outcomes, persistence boundaries and restart behavior. A passing happy-path test is not sufficient where failure or uncertainty changes safety.

### Test placement and boundaries

- Keep a module's focused unit tests beside the module as `.test.js` or `.spec.js`. The [Modularity Standard](docs/engineering/MODULARITY_STANDARD.md) additionally requires every production helper to have a directly colocated unit test.
- Use an existing package-level `test/` tree for scenarios spanning multiple modules, replay/crash matrices, and end-to-end workflows. Use `scripts/*.test.js` for developer/maintenance tooling. Do not create mirrored test trees or move existing tests solely to satisfy a universal layout.
- Keep tests in the owning package. Shared contract/conformance helpers may be reused when they express a real public contract; keep provider-specific assertions with the provider.
- Name external/network integration files distinctly (the repository uses `.integration.js`) and expose them through a separate, explicit command or workflow gate. Never let an opt-in external test silently enter the default unit-test command.
- Default unit and CI tests must be deterministic, offline, credential-free and safe to repeat. Replace external systems at the boundary with controlled fakes; do not mock the behavior being tested or every internal call.
- Use captured, sanitized protocol fixtures where they add value. Do not treat a fixture or third-party implementation as proof of an external guarantee.
- Control time, randomness, scheduling and concurrency through injected dependencies. Prefer deferred promises, barriers and deterministic schedulers over arbitrary sleeps. Clean up listeners, timers, temporary files, servers, subscriptions and pending work.
- Broker tests that mutate exchange state must be explicitly gated and TESTNET-only. They are not part of ordinary pull-request tests. LIVE mutation is never a test strategy. Read-only external checks also require an explicit opt-in when they use credentials or a network service.
- Keep test commands owned by package manifests and workflow matrices. When adding a workspace package, update both unit-test and coverage matrices in the same change. Preserve required status-context names unless a separately reviewed ruleset migration is planned.
- Coverage percentages are guardrails, not proof of behavior. Review uncovered branches and critical failure paths. Keep thresholds package-owned and evidence-based; do not impose a universal percentage or invent a threshold without measuring the package. A package without a threshold is an explicit gap, not evidence that coverage is sufficient.
- Do not run the same suite twice merely to produce two reports unless the separate run adds a distinct enforced check. CI duplication and required-context changes belong to the repository quality-gate owner, not an individual package test-policy change.

### Human-readable test design

Tests are executable specifications for people, not merely machine checks. A reviewer must be able to understand the scenario, the action, and the expected business outcome from the test name, local variable names, and assertion message without opening helper implementations or asking an author to decode abbreviations.

Required practices:

- Name suites and test cases in plain English. Describe the observable behavior and important scenario (for example, "submits the recovery SELL before the next standing BUY after the actual BUY fill"), not an implementation detail or vague verb such as "handles".
- Write each test in a clear Arrange → Act → Assert flow. Keep setup and infrastructure behind a small, intention-revealing fixture/harness API; keep business expectations in the test itself.
- Use precise domain names for values: `initialBuyOrder`, `recoverySellOrder`, `completedBuyOrders`, `retainedInventoryQuantity`, and `receivedExecutionReports`. Avoid opaque aliases such as `replay`, `buy`, `sell`, `pair`, `item`, `tmp`, `x`, or unexplained abbreviations when the value's role can be stated.
- Do not make readers decode positional tuples. When comparing orders, fills, requests, positions, or lifecycle records, map them to objects with named fields such as `{ marketSymbol, side, price, quantity, orderType }`. Use arrays only when sequence or order is itself the behavior being verified, and keep each array element meaningful.
- Give scenario constants and expected financial values descriptive names. Keep monetary and quantity values as exact decimal strings; do not replace exact comparisons with floating-point approximations.
- Every assertion MUST include a detailed, plain-English failure message describing the invariant and scenario. A message that only repeats a literal or says "should equal" is insufficient. Include useful context such as the order role, market, lifecycle stage, or accounting outcome.
- Prefer one assertion per business invariant. Group related assertions in a named helper only when that helper preserves the invariant's meaning and still receives a detailed failure message.
- Name test helpers after the domain action or result they represent (for example, `submitInitialBuyOrder` or `waitForRecoveryCycleCompletion`). Keep fake broker/exchange mechanics separate from the scenario specification.
- A test should be understandable top-to-bottom without navigating into the harness. If the harness is complex, give it a dedicated module and expose only the small operations the scenario needs. Keep scenario-specific fixture modules cohesive, hide their internal fake-exchange maps, and do not let test cases manipulate broker internals directly.

A materially edited test case must comply with these practices throughout that case, not only on newly added lines. Review the full changed test file for opaque names, tuple-based comparisons, missing assertion messages, and unexplained expected values before delivery.

### Scenario catalog and traceability

The repository-wide [Test Scenario Catalog](docs/testing/SCENARIO_CATALOG.md) is the human-readable entry point for important application behavior. For meaningful new behavior, public/domain contract changes, correctness fixes, and critical lifecycle or safety guarantees:

- Add a stable scenario ID and describe the observable business behavior in plain language, including preconditions, concrete inputs/events, expected outputs/state changes, and important negative assertions.
- List meaningful boundary, invalid-input, duplicate/conflict, ordering, concurrency, and failure subcases as relevant to the behavior.
- Link the production implementation owner and the exact automated test file **and named test case** that proves each mapped behavior. Do not make readers infer coverage from filenames.
- Keep the catalog status honest: an existing test name is only a candidate mapping until its assertions are reviewed; VERIFIED requires reviewed assertions and successful execution on an exact cited commit/PR head.
- If a behavior is unresolved or unsupported, mark it BLOCKED or UNSUPPORTED rather than inventing an expected result.
- Keep detailed domain matrices and evidence in their owning specifications/issues when that is their established home; link them from the catalog rather than copying entire checklists.

The catalog is a navigation and traceability layer, not a replacement for domain specifications or executable tests. This is a lightweight discoverability requirement, not a new generic preflight command, readiness report, or CI gate.

### 3. Reliability, error handling, and observability

Follow the canonical [Structured Error Handling Standard](docs/engineering/structured-error-handling.md) for the shared `SystemCustomError` base, component-owned subclasses and codes, cause preservation, safe diagnostic context, and gradual adoption. New functionality and materially changed bug-fix paths must follow it; unrelated legacy code is migrated incrementally.

Follow the canonical [Logging and Observability Standard](docs/engineering/LOGGING_OBSERVABILITY_STANDARD.md) for structured records, severity meanings, operational versus diagnostic events, correlation/context, redaction, transport failures, and logging ownership.

### 4. Naming and readability

- Use intention-revealing names for variables, functions, classes, files, and tests.
- Prefer domain language over vague names such as data, value, item, temp, common, or unexplained abbreviations when a more precise name is available.
- Use consistent naming conventions already established in the relevant package.
- Name booleans as predicates (for example, isEnabled, hasBalance, canRetry).
- Functions should communicate their action or result. Tests should describe the behavior being verified.
- Avoid comments that merely restate code. Explain non-obvious intent, constraints, and trade-offs.

### JavaScript control flow

- Do not use nested ternary operators. Use `if`/`else` statements or extract a clearly named helper when conditional logic needs multiple branches.
- Always use braces for control statements, including single-line bodies: `if`, `else`, `for`, `while`, `do`, and other block-controlled statements. Do not write unbraced one-line control flow.

### JavaScript linting

The workspace uses the root ESLint flat configuration in `eslint.config.js`. It applies to JavaScript in `apps/`, `packages/`, and repository tooling, including tests. The configuration uses the `@eslint/js` recommended rules and Node built-in globals; browser globals and implicit test-runner globals are not enabled.

The additional enforced rules are `eqeqeq` (with intentional `null` comparisons allowed), `curly` (all control-flow bodies), `no-nested-ternary`, `prefer-const`, `no-eval`, `no-new-func`, `no-alert`, `no-param-reassign`, and `prefer-promise-reject-errors`. Formatting rules remain intentionally limited; `object-property-newline` is enforced so each object-literal property is written on its own line. Keep destructured option properties one per line as well. Do not add inline suppressions or disable this rule to accommodate changed files.

Strict full-workspace enforcement has no migration baseline, grandfathered findings, or changed-file-only exception:

- `pnpm lint` runs ESLint across the complete JavaScript workspace and fails on every error and warning (`--max-warnings 0`).
- The required `Check JavaScript syntax` CI context runs `pnpm lint`; it is required by both active branch rulesets, so any workspace finding blocks the pull request.
- Existing and newly changed JavaScript files are held to the same standard. A legacy finding is still a finding and must be fixed.
- `pnpm lint:fix` applies supported automatic fixes across the workspace. Review its complete diff before committing, then rerun `pnpm lint`.
- Do not disable rules globally, add inline suppressions, introduce exceptions, or restore a baseline comparator to silence findings.

### 5. Functions and side effects

Module boundaries and feature-folder organization MUST follow the canonical [Modularity Standard](docs/engineering/MODULARITY_STANDARD.md), including its rule for feature-root components and pure local helpers.

- Prefer small, cohesive functions with one clear responsibility.
- Prefer pure functions when practical: same inputs produce the same outputs, with no observable side effects.
- Keep I/O (network, filesystem, database, clock, randomness, process environment) at explicit boundaries; pass dependencies in when that improves testability.
- Separate decision-making from effects. Keep domain logic testable without external services.
- Avoid boolean flag parameters and long parameter lists when they obscure different behaviors; use a well-named options object or separate functions when clearer.
- Use early returns and guard clauses when they improve clarity, not as a rigid style rule.

### 6. Immutability and state

- Prefer const by default; use reassignment only when it materially improves clarity.
- Do not mutate function arguments or shared objects unexpectedly.
- Prefer non-mutating array/object operations and return new values when practical.
- Mutation is acceptable when it is local, explicit, safe, and measurably clearer or more efficient. Do not sacrifice correctness or readability to pursue theoretical purity.
- Make state transitions explicit. Avoid shared mutable state unless ownership and synchronization are clear.
- Remember that const prevents rebinding, not mutation of an object's contents.

### 7. DRY, abstraction, and module architecture

- Avoid copy-pasting the same business rule in multiple places; extract shared logic when the duplication is meaningful.
- Do not create abstractions merely to eliminate a few similar lines. Prefer duplication over a premature abstraction that couples unrelated concepts.
- Keep modules cohesive and coupling low. A module should have one clear responsibility and one cohesive reason to change.
- Keep index.js and other public entry points thin: export the public API and compose modules, but do not accumulate feature implementation there.
- Organize code by responsibility and domain, not by arbitrary line count or a rigid folder template. Use focused folders where they clarify ownership:
  - helpers/: package- or feature-specific internal operations that support a focused responsibility.
  - utils/: genuinely generic, reusable utilities shared by multiple modules; do not use it as a miscellaneous dumping ground.
  - constants/: stable named constants shared across a feature or package.
  - errors/: domain-specific error types and error construction.
  - adapters/ or services/: external integrations and side-effectful coordination, when the architecture needs them.
  - Feature modules: named after the domain capability they implement and responsible for coordinating their focused collaborators.
- Do not create a folder or one-function module solely to satisfy a template. Split when it improves cohesion, testability, readability, or change isolation.
- Avoid giant modules, god objects, circular dependencies, miscellaneous catch-all files, and excessive fragmentation.
- Apply SOLID as design guidance, not a checklist to force object-oriented patterns into every module. Prefer composition and simple functions when they fit the domain better than classes.
- Avoid overengineering, speculative generality, unnecessary dependencies, and abstraction layers without a concrete benefit.
- Refactor when it improves understanding, testability, or change safety—not solely to make files shorter.

### 7.1 Modularity

Follow the single [Modularity Standard](docs/engineering/MODULARITY_STANDARD.md) for pure-function extraction, module boundaries, and file-size review. This standard is mandatory; do not copy its detailed rules into local agent instructions.

### 7.2 Shared utilities

Follow the single [Shared Utilities Policy](docs/engineering/SHARED_UTILITIES_POLICY.md) for search-first reuse, utility ownership, logging, and generic-helper decisions. Do not duplicate that procedure in other policy documents.

### 8. Security and external boundaries

- Fail clearly and early when an invariant or required input is invalid.
- Do not use exceptions for ordinary control flow when a clearer result type or return value is appropriate.
- Never log secrets, credentials, access tokens, or sensitive payloads.
- Treat external API responses and user input as untrusted.
- Keep production and test credentials separate; tests that place orders must use TESTNET only.

### 9. Dependencies and maintainability

- Prefer built-in platform capabilities and existing dependencies before adding a new package.
- Pin or constrain dependencies according to repository policy and update the lockfile with package-manager changes.
- Keep public interfaces small and document non-obvious contracts.
- Remove dead code when safe; do not leave commented-out implementations or unexplained TODOs.
- Keep changes focused. Avoid opportunistic rewrites unrelated to the task.

## Enforcement levels

### Required — CI blocker

- Dependency installation must be reproducible from the committed lockfile.
- The applicable unit-test suite and configured coverage thresholds must pass.
- Configured lint, type-check, build, security, and other required CI checks must pass.
- No secrets or credentials may be committed.
- Pull requests must satisfy repository rulesets/branch protection and required reviews where configured.

### Expected — review requirement

- Every changed behavior has meaningful tests, including regression coverage for bug fixes.
- Strict TDD evidence is present for behavior changes: the test failed for the expected reason before implementation and passed afterward; refactoring preserved green tests.
- Important edge cases, failure paths, and cleanup behavior are covered.
- Logging and error handling provide actionable context without leaking sensitive data or creating noise.
- Naming, module cohesion, single-responsibility boundaries, pure-function preference, controlled side effects, and explicit state ownership are respected.
- No unjustified complexity, speculative abstractions, or silent error handling.
- A reviewer should request changes for a material violation that affects correctness, security, maintainability, observability, or testability.

### Advisory — discuss trade-offs

- Refactoring stable legacy code unrelated to the change.
- Applying a design pattern or abstraction where the benefit is uncertain.
- Enforcing purity or immutability where it conflicts with a clear, measured need.

## PR branch freshness

The mandatory branch-freshness procedure is defined in [AI_AGENT_WORKFLOW.md — Branch freshness and conflict handling](AI_AGENT_WORKFLOW.md#6-branch-freshness-and-conflict-handling--required-on-every-pr-update). It applies before and after **every PR update**, as well as immediately before merge. Follow that single authoritative procedure for task PRs targeting `develop` and release PRs targeting `main`; do not maintain a separate or weaker synchronization process here.

## Exceptions

A rule may be waived when following it would make the code less correct, less secure, less clear, or materially less efficient. Explain the trade-off in the pull request and, where useful, create a follow-up issue. Do not disable checks globally to get one change through.

## Review checklist

Before approving a pull request, ask:

1. Is the behavior correct, and are success, edge, boundary, and failure cases covered?
2. Does every bug fix have a regression test?
3. Are tests deterministic, meaningful, and free of leaked resources?
4. Are test names, variables, comparisons, and failure messages understandable in plain English without decoding tuples or asking for context?
5. Are names and control flow easy to understand?
6. Are side effects and state changes explicit?
7. Are logs and errors actionable, appropriately contextual, and free of sensitive data? Do changed error paths use the owning component's specific error type/code and preserve the original cause?
8. Are module responsibilities cohesive, with thin public entry points and no catch-all modules?
9. Have meaningful pure functions been extracted into focused modules instead of being embedded in classes/services or large files?
10. If a file is approaching 300 lines or exceeds 500 lines, has its structure been reviewed and any justified exception documented?
11. Is logic duplicated, or has an abstraction been introduced too early?
12. Could the change expose secrets, weaken security, or break compatibility?
13. Does the PR branch contain the latest commit from its actual target (`develop` for task PRs, `main` for release PRs), verified immediately before merge?
14. Do all required automated checks and coverage gates pass for the exact final PR head SHA?
15. Are the requirements in [Documentation impact](#documentation-impact) satisfied?

## Rollout policy

This document describes the intended standard; it does not automatically enforce every principle. Enforce objectively checkable rules with lint/type-check/test/build/security tools in CI. Start with rules that match the existing codebase, fix or explicitly baseline existing violations, then tighten the gate incrementally. Do not claim a principle is CI-enforced until an automated check actually verifies it.

The repository's GitHub Actions workflows currently run package tests and test coverage. Configure repository rulesets or branch protection to require the desired status checks; a workflow running on a pull request does not by itself prevent merging.

## AI-agent workflow authority

The repository-wide workflow, domain ownership, cross-domain request process, and release policy are defined in [`AI_AGENT_WORKFLOW.md`](AI_AGENT_WORKFLOW.md). It is mandatory. User authorization governs whether a PR may be merged; repository instructions never grant an agent permission to merge on the user's behalf. Package/application `AGENTS.md` files may add stricter local rules but must not weaken repository-wide requirements.

### ECMAScript module exports

- Use named exports for application, package, script, and test modules. Do not add ESM default exports.
- ESLint enforces this rule with an AST-level restriction on `ExportDefaultDeclaration`.
- The root `eslint.config.js` is the sole loader-contract exception: ESLint's flat-config loader requires that file to provide its configuration as a default export. Do not extend this exception to application or package modules.

## JavaScript and JSDoc

The default implementation language is modern JavaScript using the repository's Node.js and ECMAScript-module conventions. TypeScript is not the default and must not be introduced as an incidental refactor.

- Keep implementation files as JavaScript (`.js`). Do not add `tsconfig.json`, TypeScript build steps, `.ts` source, or generated `.d.ts` files unless a separately approved requirement explicitly calls for TypeScript interoperability or migration.
- Use JSDoc selectively to describe public/exported APIs, non-obvious parameter and return shapes, callbacks, important invariants, and meaningful exceptions.
- Do not annotate every trivial local variable or obvious one-line function. Avoid comments that repeat the implementation or become stale.
- Prefer precise JSDoc types that match runtime behavior. Represent optional values, defaults, nullability, promises, and thrown errors accurately; do not promise validation or guarantees the implementation does not provide.
- Use `@param`, `@returns`, `@throws`, `@typedef`, and `@callback` when they improve clarity. Keep shared typedefs close to their owning domain and avoid a global type-definition dumping ground.
- JSDoc does not validate runtime input. Validate untrusted values in code and test the behavior with the native Node.js test conventions.
- VS Code and other language servers can use JSDoc for IntelliSense without installing the JSDoc documentation generator. Add a documentation generator or CI documentation job only when maintainers have a concrete published-docs requirement.
- Do not turn on project-wide `checkJs` or `@ts-check` by default. Adopt static checking incrementally only with a defined scope, a clean baseline, and CI ownership.
- A TypeScript consumer reporting `TS7016` is a separate package-interop issue. JSDoc comments alone do not guarantee that TypeScript can resolve declarations. If TypeScript consumers become a supported contract, add and test accurate declarations or an intentional declaration-generation workflow; do not solve it by silently declaring the package as `any`.

See [JavaScript and JSDoc standard](docs/engineering/JAVASCRIPT_JSDOC_STANDARD.md) for examples and decision guidance.

## CI and repository automation safety

Treat required CI as a production safety boundary, not as advisory feedback.

- Required status-check context names are contracts with GitHub rulesets. Do not rename or remove one until the replacement has passed and every affected ruleset has been updated and read back.
- A required check must fail closed. Do not use `continue-on-error`, `|| true`, broad catch-and-log behavior, or conditions that turn missing validation into success.
- Keep workflow permissions least-privilege. Use read-only defaults and narrowly scoped job-level write permissions only when needed.
- Pin third-party Actions to reviewed full commit SHAs. Prefer native GitHub features before introducing another Action or package.
- Validate workflow triggers for pull requests and pushes to both `main` and `develop`; preserve scheduled and manual runs where they serve a distinct purpose.
- Keep unit tests deterministic and offline. Integration tests requiring credentials or network access must remain explicitly separate.
- Report workflow availability, actual successful runs, and branch-protection enforcement as three distinct facts.
- When changing policy enforcement, add regression tests for both the passing case and representative invalid configurations.
