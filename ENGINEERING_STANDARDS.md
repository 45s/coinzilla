# Engineering Standards

This document is the engineering contract for Coinzilla. Apply it to new code and to code materially changed by a pull request. Automated checks are authoritative where available; principles that cannot be reliably automated require explicit review.

## Definition of Done

A change is ready to merge only when:

- [ ] The change solves the stated problem and handles expected edge cases.
- [ ] Every new or changed behavior has meaningful automated test coverage, including relevant success, boundary, invalid-input, and failure scenarios.
- [ ] Every bug fix includes a regression test that reproduces the defect, unless a documented technical reason makes that impractical.
- [ ] Tests are deterministic and do not depend on production services, credentials, or live exchange access.
- [ ] The affected package's tests and coverage checks pass; applicable workspace and CI checks pass.
- [ ] Error handling, validation, structured diagnostics, security, and resource cleanup are appropriate to the change.
- [ ] Modules are cohesive, follow single-responsibility boundaries, and do not turn public entry points into implementation dumping grounds.
- [ ] Public APIs, configuration, and documentation are updated when behavior changes.
- [ ] No secrets, credentials, generated artifacts, or unrelated changes are included.
- [ ] Any deliberate deviation from these standards is explained in the pull request, with a reason and follow-up plan when appropriate.

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
- Important edge cases, failure paths, and cleanup behavior are covered.
- Logging and error handling provide actionable context without leaking sensitive data or creating noise.
- Naming, module cohesion, single-responsibility boundaries, pure-function preference, controlled side effects, and explicit state ownership are respected.
- No unjustified complexity, speculative abstractions, or silent error handling.
- A reviewer should request changes for a material violation that affects correctness, security, maintainability, observability, or testability.

### Advisory — discuss trade-offs

- Refactoring stable legacy code unrelated to the change.
- Applying a design pattern or abstraction where the benefit is uncertain.
- Enforcing purity or immutability where it conflicts with a clear, measured need.

## PR branch freshness — required before merging to main

A pull request targeting main must include the latest main commit before it is merged. The contributor/AI agent is responsible for synchronizing the PR branch; the user must not be asked to update it manually.

Immediately before merge, fetch the latest remote main and PR head and verify that the current main tip is an ancestor of the PR head. If it is not, rebase the PR branch onto the latest main or merge main into the PR branch according to repository history policy, resolve conflicts, review the diff, and push the update. Do not force-push shared history unless explicitly authorized and safe.

After any branch update, wait for required CI checks to pass on the exact final head SHA. Re-check branch freshness and CI immediately before merging; if main advances or the PR head changes, synchronize and validate again. Never merge a stale/unverified branch or bypass required checks. If tooling or permissions prevent synchronization or verification, stop and report the blocker rather than asking the user to perform a routine manual update.

This applies to every PR targeting main, including documentation-only changes. Repository branch protection/rulesets should enforce this where GitHub supports it; written agent instructions alone are not a technical merge lock.

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
8. Is logic duplicated, or has an abstraction been introduced too early?
9. Could the change expose secrets, weaken security, or break compatibility?
10. Does the PR branch contain the latest main commit, verified immediately before merge?
11. Do all required automated checks and coverage gates pass for the exact final PR head SHA?

## Rollout policy

This document describes the intended standard; it does not automatically enforce every principle. Enforce objectively checkable rules with lint/type-check/test/build/security tools in CI. Start with rules that match the existing codebase, fix or explicitly baseline existing violations, then tighten the gate incrementally. Do not claim a principle is CI-enforced until an automated check actually verifies it.

The repository's GitHub Actions workflows currently run package tests and test coverage. Configure repository rulesets or branch protection to require the desired status checks; a workflow running on a pull request does not by itself prevent merging.
