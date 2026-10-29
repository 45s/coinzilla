# GitHub Copilot instructions

Before proposing or making code changes, read the repository-root [AGENTS.md](../blob/main/AGENTS.md) and [ENGINEERING_STANDARDS.md](../blob/main/ENGINEERING_STANDARDS.md).

Treat ENGINEERING_STANDARDS.md as the project's engineering contract. Prefer clear names, cohesive functions, pure logic where practical, explicit side-effect boundaries, controlled mutation, meaningful tests, and simple designs. Do not force patterns or abstractions where they make the code worse.

For every behavior change, add or update tests. Keep default tests deterministic and offline. Do not weaken tests or CI checks to get a green result. In the final summary, state which checks were actually run and whether they passed.
