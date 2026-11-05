# Engineering Standards

This document is the engineering contract for Coinzilla. Apply it to new code and to code materially changed by a pull request. Automated checks are authoritative where available; principles that cannot be reliably automated require explicit review.

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

Other repository instructions and task checklists should link to this section rather than restating its policy.

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
- If the test cannot be executed, the expected failure cannot be distinguished from an invalid test/setup, or the behavior cannot reasonably be tested automatically, stop before implementation and document the concrete blocker or narrowly scoped exception in the PR. Do not silently skip the RED step or claim it occurred.
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
- Review coverage reports for uncovered lines and branches, especially error and lifecycle paths. Aim for high line and branch coverage; critical behavior and failure branches must be covered. A percentage alone is not proof of test quality.
- Add or maintain package-specific coverage thresholds where the tooling supports them. A threshold must be meaningful, enforced by CI, and increased deliberately; do not claim coverage is gated when it is not.
- Run the affected package's test and coverage scripts first, then relevant workspace tests and repository quality checks. Report exact commands and outcomes accurately.
- Never claim tests passed unless they were actually executed and passed.

### 3. Reliability, error handling, and observability

- Treat diagnostics as part of the feature design. A failure should be understandable from its error and logs without requiring guesswork.
- Use structured logging with stable fields and relevant context (for example: operation, component, entity/event identifier, state, and original error) when that context exists.
- Log at meaningful boundaries and actionable failure points. Avoid noisy per-item logs, duplicate reports, and logging the same error at multiple layers without adding context.
- Do not silently catch and ignore errors. If an error is intentionally handled, make the recovery or suppression explicit and test it.
- Ensure logging/error-reporting failures do not create unhandled rejections or mask the original failure.
- Never log secrets, credentials, access tokens, private keys, or sensitive user data. Prefer safe identifiers and redacted summaries over full payloads.
- Expose enough diagnostics to understand resource pressure and lifecycle state where relevant, without leaking mutable internal state.
- Test important error paths and verify that diagnostic hooks receive the expected context.

### 4. Naming and readability

- Use intention-revealing names for variables, functions, classes, files, and tests.
- Prefer domain language over vague names such as data, value, item, temp, common, or unexplained abbreviations when a more precise name is available.
- Use consistent naming conventions already established in the relevant package.
- Name booleans as predicates (for example, isEnabled, hasBalance, canRetry).
- Functions should communicate their action or result. Tests should describe the behavior being verified.
- Avoid comments that merely restate code. Explain non-obvious intent, constraints, and trade-offs.

### 5. Functions and side effects

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
4. Are names and control flow easy to understand?
5. Are side effects and state changes explicit?
6. Are logs and errors actionable, appropriately contextual, and free of sensitive data?
7. Are module responsibilities cohesive, with thin public entry points and no catch-all modules?
8. Have meaningful pure functions been extracted into focused modules instead of being embedded in classes/services or large files?
9. If a file is approaching 300 lines or exceeds 500 lines, has its structure been reviewed and any justified exception documented?
10. Is logic duplicated, or has an abstraction been introduced too early?
11. Could the change expose secrets, weaken security, or break compatibility?
12. Does the PR branch contain the latest commit from its actual target (`develop` for task PRs, `main` for release PRs), verified immediately before merge?
13. Do all required automated checks and coverage gates pass for the exact final PR head SHA?
14. Are the requirements in [Documentation impact](#documentation-impact) satisfied?

## Rollout policy

This document describes the intended standard; it does not automatically enforce every principle. Enforce objectively checkable rules with lint/type-check/test/build/security tools in CI. Start with rules that match the existing codebase, fix or explicitly baseline existing violations, then tighten the gate incrementally. Do not claim a principle is CI-enforced until an automated check actually verifies it.

The repository's GitHub Actions workflows currently run package tests and test coverage. Configure repository rulesets or branch protection to require the desired status checks; a workflow running on a pull request does not by itself prevent merging.


## AI-agent workflow authority

The repository-wide workflow, domain ownership, cross-domain request process, and release policy are defined in [`AI_AGENT_WORKFLOW.md`](AI_AGENT_WORKFLOW.md). It is mandatory and takes precedence over a task prompt that asks an agent to bypass it. Package/application `AGENTS.md` files may add stricter local rules but must not weaken repository-wide requirements.


## JavaScript and JSDoc

Coinzilla's default implementation language is modern JavaScript using the repository's Node.js and ECMAScript-module conventions. TypeScript is not the default and must not be introduced as an incidental refactor.

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
