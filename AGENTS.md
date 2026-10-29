# Instructions for coding agents

Before making changes, read [ENGINEERING_STANDARDS.md](./ENGINEERING_STANDARDS.md), inspect the affected package's existing conventions, and understand the relevant tests.

## Required workflow

1. Identify the behavior requested and the smallest safe change.
2. Inspect the affected code and neighboring tests before editing.
3. Prefer clear names, cohesive functions, pure domain logic, explicit side-effect boundaries, and non-mutating operations where practical.
4. Avoid speculative abstractions and unrelated refactors. Apply SOLID as guidance, not as a requirement to introduce classes.
5. Add or update deterministic tests for changed behavior and edge cases. Bug fixes should include a regression test when practical.
6. Run the relevant package tests, then run `pnpm test` when feasible. Run other configured checks that apply.
7. Review the final diff for accidental changes, secrets, weakened tests, silent error handling, and violations of ENGINEERING_STANDARDS.md.
8. In the completion summary, report what changed, tests actually run and their results, and any checks that could not be run.

## Repository-specific constraints

- This is a pnpm workspace. Follow the package manager and versions declared in the root manifest.
- Default unit tests must not require local environment files, credentials, network access, or live exchange access.
- Broker integration tests must remain separate from default unit tests. Tests that place orders must use TESTNET only.
- Do not claim a check passed unless it was actually run and passed.
- Do not bypass or weaken CI checks to make a change pass. Explain any justified exception to the engineering standards.
