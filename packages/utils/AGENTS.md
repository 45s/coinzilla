# Utilities agent instructions

This directory is owned by the **Utilities domain**. Read the repository-root `AGENTS.md`, `ENGINEERING_STANDARDS.md`, and `AI_AGENT_WORKFLOW.md` before working here. This file adds local rules; it cannot weaken repository-wide requirements.

## Ownership

Owned path: `packages/utils/**`

This domain owns: domain-neutral reusable helpers, logging, generic validation and common platform utilities.

Roadmap: [`ROADMAP.md`](./ROADMAP.md).

Do not silently change another domain's implementation, tests, roadmap, or public contract. For cross-domain needs, follow [the cross-domain request process](../../docs/engineering/CROSS_DOMAIN_REQUESTS.md).

## Local engineering rules

- Inspect current public exports, package manifest, consumers, tests, and existing conventions before changing the API.
- Keep the public entry point thin and export only intentional public contracts.
- Prefer cohesive modules, pure functions, explicit side-effect boundaries, and immutable inputs/outputs where practical.
- Add deterministic native Node.js tests for new behavior and regression tests for defects.
- Do not add dependencies without a concrete need; prefer existing dependencies and Node.js built-ins.
- Document public contract changes and consumer migration impact.
- Update this domain's roadmap when work is accepted, blocked, deferred, or merged. Mark work complete only after it is merged into `develop` and required checks pass.

## Workflow

- Create a short-lived task branch from the latest `develop`, using `feature/utils/<task>` or `fix/utils/<task>`.
- Open task PRs against `develop`; do not use permanent domain branches.
- Run the relevant package test: `pnpm --filter @coinzilla/utils test` (verify the package script exists before relying on it), followed by applicable workspace checks.
- The responsible agent may merge into `develop` only after required CI and target-freshness checks pass. No routine human approval is expected for `develop`.
- Never merge task work into `main`. Only the user approves the final release PR from `develop` to `main`.

## Domain-specific constraints

Only add utilities that are genuinely generic and reused or clearly reusable across domains. Do not move strategy, broker, entity, event-bus, or journal business rules into utils. Prefer pure functions and deterministic node:test coverage.


## Repository-wide modularity rule (mandatory)

The pure-function extraction and file-size requirements in the root `ENGINEERING_STANDARDS.md` and `AGENTS.md` apply to every change in this package. They are mandatory, not optional style suggestions.

- **Extract meaningful, non-trivial pure functions into focused separate modules, even when there is only one caller.** A function is a pure extraction candidate when its result depends only on explicit inputs and it does not read or mutate instance state, shared mutable state, globals, or external systems.
- Keep validation, parsing, serialization, formatting, normalization, mapping, calculations, predicates, and business-rule decisions outside large classes/services whenever they can be expressed as pure functions. Classes/services should own state and coordinate side effects, not become containers for unrelated implementation details.
- Group related pure functions by domain and responsibility. Use package/feature-local helpers for internal logic; use shared `utils` only for genuinely generic behavior. Do not create a miscellaneous catch-all module.
- Keep pure logic independently testable. Add focused unit tests where they add confidence, and test orchestration through observable behavior. Keep I/O, network, filesystem, database, clock, randomness, logging, and process-environment access at explicit boundaries.
- Avoid god files. Review files approaching 300 lines for cohesive extraction opportunities. Files exceeding 500 lines require a refactoring plan or a concrete technical justification in the PR. These are review triggers, not arbitrary limits.
- Do not fragment trivial expressions, tiny context-dependent callbacks, or tightly coupled logic merely to reduce line count. The goal is cohesion, low coupling, readability, and independent testability—not the maximum number of files.

When modifying an existing large file, improve its structure as part of the task when the extraction is relevant and safe. Do not expand an already fragmented architecture or undertake unrelated mass refactoring.
