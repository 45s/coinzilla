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
- [ ] Meaningful pure logic is separated into cohesive, independently testable modules where doing so improves clarity, cohesion, or testability; trivial/context-bound logic remains local.
- [ ] Large files have been split by responsibility, or a concrete reason for keeping them together is documented in the PR.
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

### 7.1 Cohesive pure logic and file-size discipline

This section is a required design and code-review standard for all new code and materially changed code.

- **Extract meaningful pure logic when separation improves cohesion, testability, or comprehension.** A function's purity makes it a good candidate for independent testing, but does not by itself require a new file. A single caller is not a reason to keep meaningful domain logic embedded in a large service.
- Keep pure logic separate from effectful orchestration when that creates a clear boundary. Validation, parsing, serialization, formatting, normalization, mapping, calculations, predicates, and business-rule decisions are common candidates. Leave network, filesystem, database, clock, randomness, and process-environment access at explicit adapter/service boundaries.
- Group closely related pure functions by domain and reason to change. Use a focused feature-local `helpers/` or domain-named module for internal logic; reserve shared `utils/` for genuinely generic functions used across domains.
- The owning class/service should retain the state and orchestration it needs. It should import and compose extracted functions rather than accumulate unrelated transformation and decision-making responsibilities.
- Keep modules independently testable. Add focused unit tests for extracted pure behavior when they materially improve confidence, and test orchestration at its observable boundary.
- **Do not create artificial fragmentation.** Trivial one-line expressions, tiny local callbacks whose meaning depends on immediate context, and tightly coupled implementation details may remain local when extraction would obscure the flow. Do not create one-function files mechanically or introduce circular dependencies.
- **Do not allow god files to grow.** Treat approximately 300 lines as a prompt for a modularity review, not an automatic failure. Files exceeding 500 lines require cohesive extraction where practical; if they genuinely cannot be split without harming correctness or cohesion, document the reason in the PR. Generated files, declarative registries, schemas, and similarly constrained files may need explicit exceptions.
- Line count is a warning signal, not the design goal. The required outcome is clear ownership, low coupling, independent testability, and maintainable change boundaries.

**Example — Telegram notifier:** Keep `TelegramNotifier` responsible for sending the request and validating the external API response. Move independent option validation, message validation, or safe error-message sanitization into focused modules when that separation improves reuse, independent testing, or readability. Closely related operations may share a module; do not create one-function files mechanically or put unrelated operations into a generic catch-all `utils.js`.

### 7.2 Shared utilities: search and reuse before implementation

This rule is mandatory for every contributor and AI agent. Before implementing a helper or cross-cutting capability, search packages/utils/src/, its tests, and public exports first; then search the entire monorepo for equivalent behavior and consumers. Read [docs/engineering/SHARED_UTILITIES_POLICY.md](docs/engineering/SHARED_UTILITIES_POLICY.md) and follow its classification and migration rules.

- Reuse an existing public @coinzilla/utils API when its contract fits. Do not import private files from another package.
- If a genuinely generic capability is missing, extend packages/utils through the Utilities domain, with documented contracts, deterministic boundary/failure tests, and meaningful line/branch coverage.
- Do not move business policy, domain invariants, or protocol-specific behavior into shared utilities. Pure does not automatically mean generic.
- Do not create a duplicate generic helper because the existing API has a different name or because the agent did not search. Document intentional duplication and its domain boundary.
- Use Logger or defaultLogger from @coinzilla/utils for application/package diagnostics. Direct console calls are limited to the logger implementation and intentional CLI stdout/stderr output; other exceptions require an explicit reason.
- For exact financial arithmetic, do not use the legacy Number-based NH helpers. Use an exact decimal-string API; until a shared exact decimal API is approved and exported, keep the current domain implementation and track consolidation through the Utilities roadmap.

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

## PR branch freshness — required for every target branch

A PR must contain the latest commit from its actual target branch before merge. The contributor/AI agent owns synchronization; the user must never be asked to perform routine branch updates manually.

- For task PRs targeting `develop`, synchronize against the latest `develop`.
- For the final release PR targeting `main`, synchronize against the latest `main`.
- Fetch both target and PR refs immediately before merge. Verify the target tip is an ancestor of the PR head.
- If stale, merge the latest target into the task branch (or use the repository's explicitly approved history policy), resolve conflicts on the task branch, inspect the complete diff, and push. Never force-push shared history.
- Wait for required checks on the exact final PR head SHA. If either ref changes, repeat synchronization and validation.
- Do not merge if checks are pending, failed, skipped unexpectedly, or missing from the required-check policy.
- Task PRs may be merged by the responsible AI agent into `develop` after all required automated gates pass. No routine human approval is required for `develop`.
- No AI agent may merge a task PR directly into `main`. The user approves the final milestone/release PR from `develop` to `main`.
- If the agent cannot verify freshness, checks, or required permissions, stop and report the blocker. Never bypass branch protection or ask the user to update a branch.

Repository rulesets must enforce PR-only merges, target freshness, required status checks, no force pushes, and no deletion for both `develop` and `main`. Written instructions are not a technical substitute for branch protection.

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
