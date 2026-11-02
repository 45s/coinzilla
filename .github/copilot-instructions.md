# GitHub Copilot instructions

Before proposing or making code changes, read the repository-root [AGENTS.md](../blob/main/AGENTS.md) and [ENGINEERING_STANDARDS.md](../blob/main/ENGINEERING_STANDARDS.md).

Treat ENGINEERING_STANDARDS.md as the project's engineering contract. Prefer clear names, cohesive functions, pure logic where practical, explicit side-effect boundaries, controlled mutation, meaningful tests, and simple designs. Do not force patterns or abstractions where they make the code worse.
Treat ENGINEERING_STANDARDS.md as the project's engineering contract. Prefer clear names, cohesive functions, pure logic where practical, explicit side-effect boundaries, controlled mutation, meaningful tests, and simple designs. Do not force patterns or abstractions where they make the code worse.

**Mandatory modularity rule:** Extract every meaningful, non-trivial pure function into a dedicated cohesive module, even if it currently has one caller. Do not bury validation, parsing, formatting, mapping, calculations, or business rules inside large classes/services. Keep classes/services focused on state and side-effect orchestration. Avoid god files; review files approaching 300 lines and require a concrete justification or refactoring plan for files over 500 lines. Do not fragment trivial expressions or tightly coupled logic just to reduce line counts. See the pure-function extraction and file-size guidance in `ENGINEERING_STANDARDS.md`.

For every behavior change, add or update tests. Keep default tests deterministic and offline. Do not weaken tests or CI checks to get a green result. In the final summary, state which checks were actually run and whether they passed.


## Mandatory repository workflow

Before making changes, read the repository-root `AGENTS.md`, `ENGINEERING_STANDARDS.md`, and `AI_AGENT_WORKFLOW.md`, then read the closest package/application `AGENTS.md`. Follow domain ownership, short-lived task branches from `develop`, target-aware synchronization, and the rule that only the user approves the final `develop` to `main` release PR. Do not ask the user to update branches manually.
