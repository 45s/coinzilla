# Engineering Standards

This document is the engineering contract for Coinzilla. Apply it to new code and to code materially changed by a pull request. Automated checks are authoritative where available; principles that cannot be reliably automated require explicit review.

## Definition of Done

A change is ready to merge only when:

- [ ] The change solves the stated problem and handles expected edge cases.
- [ ] Relevant unit tests are added or updated; bug fixes include a regression test where practical.
- [ ] Tests are deterministic and do not depend on production services, credentials, or live exchange access.
- [ ] The full applicable test suite passes locally and in CI.
- [ ] Before merging into `main`, the PR branch contains the latest `main` commit and all required checks pass for the exact final PR head SHA.
- [ ] Error handling, validation, security, logging, and resource cleanup are appropriate to the change.
- [ ] Names and structure make intent clear; unnecessary complexity and duplication are avoided.
- [ ] Public APIs, configuration, and documentation are updated when behavior changes.
- [ ] No secrets, credentials, generated artifacts, or unrelated changes are included.
- [ ] Any deliberate deviation from these standards is explained in the pull request, with a reason and follow-up plan when appropriate.

## Principles

### 1. Correctness first

- Prefer the simplest implementation that correctly expresses the requirement.
- Validate untrusted input at system boundaries.
- Make invalid states difficult to represent; use explicit types/contracts where the language and project support them.
- Handle failures intentionally. Do not silently swallow errors or return misleading success values.
- Avoid hidden dependencies on time, randomness, process state, network services, or global mutable state.

### 2. Naming and readability

- Use intention-revealing names for variables, functions, classes, files, and tests.
- Prefer domain language over vague names such as `data`, `value`, `item`, `temp`, or unexplained abbreviations when a more precise name is available.
- Use consistent naming conventions already established in the relevant package.
- Name booleans as predicates (for example, `isEnabled`, `hasBalance`, `canRetry`).
- Functions should communicate their action or result. Tests should describe the behavior being verified.
- Avoid comments that merely restate code. Explain non-obvious intent, constraints, and trade-offs.

### 3. Functions and side effects

- Prefer small, cohesive functions with one clear responsibility.
- Prefer pure functions when practical: same inputs produce the same outputs, with no observable side effects.
- Keep I/O (network, filesystem, database, clock, randomness, process environment) at explicit boundaries; pass dependencies in when that improves testability.
- Separate decision-making from effects. Keep domain logic testable without external services.
- Avoid boolean flag parameters and long parameter lists when they obscure different behaviors; use a well-named options object or separate functions when clearer.
- Use early returns and guard clauses when they improve clarity, not as a rigid style rule.

### 4. Immutability and state

- Prefer `const` by default; use reassignment only when it materially improves clarity.
- Do not mutate function arguments or shared objects unexpectedly.
- Prefer non-mutating array/object operations and return new values when practical.
- Mutation is acceptable when it is local, explicit, safe, and measurably clearer or more efficient. Do not sacrifice correctness or readability to pursue theoretical purity.
- Make state transitions explicit. Avoid shared mutable state unless ownership and synchronization are clear.
- Remember that `const` prevents rebinding, not mutation of an object's contents.

### 5. DRY, abstraction, and complexity

- Avoid copy-pasting the same business rule in multiple places; extract shared logic when the duplication is meaningful.
- Do not create abstractions merely to eliminate a few similar lines. Prefer duplication over a premature abstraction that couples unrelated concepts.
- Keep modules cohesive and coupling low.
- Avoid overengineering, speculative generality, unnecessary dependencies, and abstraction layers without a concrete benefit.
- Refactor when it improves understanding, testability, or change safety—not solely to make files shorter.

### 6. SOLID and architecture

Apply SOLID as design guidance, not a checklist to force object-oriented patterns into every module:

- **Single Responsibility:** a module should have one cohesive reason to change.
- **Open/Closed:** extend behavior through clear seams when useful, without needless indirection.
- **Liskov Substitution:** implementations must honor the contracts of the abstractions they replace.
- **Interface Segregation:** keep contracts focused on what their consumers need.
- **Dependency Inversion:** high-level policy should not be tightly coupled to low-level details; use dependency injection or ports/adapters where complexity justifies it.

Prefer composition and simple functions when they fit the domain better than classes. Follow the architecture already used in the package unless there is a reason to improve it.

### 7. Error handling and security

- Fail clearly and early when an invariant or required input is invalid.
- Do not use exceptions for ordinary control flow when a clearer result type or return value is appropriate.
- Preserve useful error context when rethrowing errors.
- Never log secrets, credentials, access tokens, or sensitive payloads.
- Treat external API responses and user input as untrusted.
- Keep production and test credentials separate; tests that place orders must use TESTNET only.

### 8. Testing

- Test observable behavior, not private implementation details.
- Cover normal cases, boundaries, invalid input, failure paths, and regressions proportionate to risk.
- Prefer fast, isolated unit tests for pure/domain logic; use integration tests to verify important boundaries.
- Keep tests deterministic, independent, readable, and safe to run repeatedly.
- Do not rely on execution order, real time without control, live network calls, or production credentials in unit tests.
- Mock/stub external boundaries, not every internal function.
- A passing test suite is necessary but does not prove the absence of defects. Review test quality and missing scenarios.
- Add tests whenever a change alters behavior. Refactoring without behavior changes should preserve the existing suite and add tests if coverage is insufficient.

### 9. Dependencies and maintainability

- Prefer built-in platform capabilities and existing dependencies before adding a new package.
- Pin or constrain dependencies according to repository policy and update the lockfile with package-manager changes.
- Keep public interfaces small and document non-obvious contracts.
- Remove dead code when safe; do not leave commented-out implementations or unexplained TODOs.
- Keep changes focused. Avoid opportunistic rewrites unrelated to the task.

## Enforcement levels

### Required — CI blocker

- Dependency installation must be reproducible from the committed lockfile.
- The applicable unit-test suite must pass.
- Configured lint, type-check, build, security, and other required CI checks must pass.
- No secrets or credentials may be committed.
- Pull requests must satisfy repository rulesets/branch protection and required reviews where configured.

### Expected — review requirement

- Naming, cohesion, meaningful DRY, appropriate SOLID, pure-function preference, controlled side effects, and explicit state ownership.
- Tests appropriate to the change, including regression coverage for bug fixes.
- No unjustified complexity, speculative abstractions, or silent error handling.
- A reviewer should request changes for a material violation that affects correctness, security, maintainability, or testability.

### Advisory — discuss trade-offs

- Refactoring stable legacy code unrelated to the change.
- Applying a design pattern or abstraction where the benefit is uncertain.
- Enforcing purity or immutability where it conflicts with a clear, measured need.

## PR branch freshness — required before merging to main

A pull request targeting `main` must include the latest `main` commit before it is merged. The contributor/AI agent is responsible for synchronizing the PR branch; the user must not be asked to update it manually.

Immediately before merge, fetch the latest remote `main` and PR head and verify that the current `main` tip is an ancestor of the PR head. If it is not, rebase the PR branch onto the latest `main` or merge `main` into the PR branch according to repository history policy, resolve conflicts, review the diff, and push the update. Do not force-push shared history unless explicitly authorized and safe.

After any branch update, wait for required CI checks to pass on the exact final head SHA. Re-check branch freshness and CI immediately before merging; if `main` advances or the PR head changes, synchronize and validate again. Never merge a stale/unverified branch or bypass required checks. If tooling or permissions prevent synchronization or verification, stop and report the blocker rather than asking the user to perform a routine manual update.

This applies to every PR targeting `main`, including documentation-only changes. Repository branch protection/rulesets should enforce this where GitHub supports it; written agent instructions alone are not a technical merge lock.

## Exceptions

A rule may be waived when following it would make the code less correct, less secure, less clear, or materially less efficient. Explain the trade-off in the pull request and, where useful, create a follow-up issue. Do not disable checks globally to get one change through.

## Review checklist

Before approving a pull request, ask:

1. Is the behavior correct, and are important edge cases covered?
2. Are names and control flow easy to understand?
3. Are side effects and state changes explicit?
4. Is logic duplicated, or has an abstraction been introduced too early?
5. Are module responsibilities and dependencies cohesive?
6. Do tests cover behavior, boundaries, and failure paths?
7. Could the change expose secrets, weaken security, or break compatibility?
8. Does the PR branch contain the latest `main` commit, verified immediately before merge?
9. Do all required automated checks pass for the exact final PR head SHA?

## Rollout policy

This document describes the intended standard; it does not automatically enforce every principle. Enforce objectively checkable rules with lint/type-check/test/build/security tools in CI. Start with rules that match the existing codebase, fix or explicitly baseline existing violations, then tighten the gate incrementally. Do not claim a principle is CI-enforced until an automated check actually verifies it.

The repository's GitHub Actions workflows currently run package tests and test coverage. Configure repository rulesets or branch protection to require the desired status checks; a workflow running on a pull request does not by itself prevent merging.
