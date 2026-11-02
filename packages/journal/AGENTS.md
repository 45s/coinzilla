# Journal agent instructions

This directory is owned by the **Journal domain**. Read the repository-root `AGENTS.md`, `ENGINEERING_STANDARDS.md`, and `AI_AGENT_WORKFLOW.md` before working here. These local instructions add constraints but cannot weaken repository-wide rules.

## Ownership
Owned path: `packages/journal/**`.

This domain owns journal record contracts, persistence boundaries, append/read behavior, serialization, replay, and journal-specific lifecycle.

Roadmap: [ROADMAP.md](./ROADMAP.md).

Do not silently change another domain's implementation, tests, roadmap, or public contract. For cross-domain needs, follow [the cross-domain request process](../../docs/engineering/CROSS_DOMAIN_REQUESTS.md).

## Local engineering rules
- Inspect the package manifest, public exports, consumers, tests, and current storage behavior before changing contracts.
- Keep journal storage and record semantics independent of application strategy decisions.
- Preserve historical records; make serialization, schema evolution, replay, and recovery behavior explicit.
- Prefer cohesive modules, pure functions, and explicit I/O boundaries.
- Add deterministic tests for partial failures, duplicate/replay behavior, serialization compatibility, and cleanup where relevant.
- Avoid new dependencies unless there is a concrete need.

## Workflow
- Create a short-lived task branch from latest `develop`, such as `feature/journal/<task>` or `fix/journal/<task>`.
- Open task PRs against `develop`; do not create a permanent domain branch.
- Run `pnpm --filter @coinzilla/journal test` after verifying the script exists, then applicable workspace checks.
- The responsible agent may merge to `develop` only after required CI and target-freshness checks pass. No routine human approval is expected.
- Never merge task work into `main`; the user approves only the final `develop` to `main` release PR.
- Update this roadmap when work changes scope or status. Mark an item complete only after merge into `develop` and passing required checks.


## Repository-wide modularity rule (mandatory)

The pure-function extraction and file-size requirements in the root `ENGINEERING_STANDARDS.md` and `AGENTS.md` apply to every change in this package. They are mandatory, not optional style suggestions.

- **Extract meaningful, non-trivial pure functions into focused separate modules, even when there is only one caller.** A function is a pure extraction candidate when its result depends only on explicit inputs and it does not read or mutate instance state, shared mutable state, globals, or external systems.
- Keep validation, parsing, serialization, formatting, normalization, mapping, calculations, predicates, and business-rule decisions outside large classes/services whenever they can be expressed as pure functions. Classes/services should own state and coordinate side effects, not become containers for unrelated implementation details.
- Group related pure functions by domain and responsibility. Use package/feature-local helpers for internal logic; use shared `utils` only for genuinely generic behavior. Do not create a miscellaneous catch-all module.
- Keep pure logic independently testable. Add focused unit tests where they add confidence, and test orchestration through observable behavior. Keep I/O, network, filesystem, database, clock, randomness, logging, and process-environment access at explicit boundaries.
- Avoid god files. Review files approaching 300 lines for cohesive extraction opportunities. Files exceeding 500 lines require a refactoring plan or a concrete technical justification in the PR. These are review triggers, not arbitrary limits.
- Do not fragment trivial expressions, tiny context-dependent callbacks, or tightly coupled logic merely to reduce line count. The goal is cohesion, low coupling, readability, and independent testability—not the maximum number of files.

When modifying an existing large file, improve its structure as part of the task when the extraction is relevant and safe. Do not expand an already fragmented architecture or undertake unrelated mass refactoring.
