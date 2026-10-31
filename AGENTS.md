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

## Pull request freshness and merge-readiness (mandatory)

Before describing any PR as ready to merge, recommending that a user merge it, or marking it ready for review:

1. Fetch the latest target branch (normally `origin/main`) from GitHub. Never rely on a local checkout, an earlier sync, or the PR's creation-time base SHA.
2. Compare the PR head with the current target-branch HEAD. If the target has advanced, update the PR branch yourself by merging the latest target branch (or rebasing only when repository policy explicitly requires it). Preserve existing PR commits and resolve conflicts carefully; never force-push over unknown work.
3. Push the updated PR branch and wait for CI to run against the new head SHA.
4. Verify that the PR head contains the latest target-branch HEAD, GitHub reports it mergeable, and every required CI/check suite has completed successfully for that exact PR head SHA.
5. If the target branch advances while checks are running, repeat the sync and verification. Passing checks on an older head is not enough.
6. If permissions or tooling prevent syncing, say so explicitly and give the user the exact remaining action. Never silently transfer this routine maintenance step to the user.

A PR is **merge-ready** only when all of the above are verified. Do not ask the user to update the branch manually when the agent has access and tools to do it.

## Repository-specific constraints

- This is a pnpm workspace. Follow the package manager and versions declared in the root manifest.
- Default unit tests must not require local environment files, credentials, network access, or live exchange access.
- Broker integration tests must remain separate from default unit tests. Tests that place orders must use TESTNET only.
- Do not claim a check passed unless it was actually run and passed.
- Do not bypass or weaken CI checks to make a change pass. Explain any justified exception to the engineering standards.
