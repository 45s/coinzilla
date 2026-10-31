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
8. Before merging any pull request into `main`, follow the mandatory **Keep PR branches up to date** procedure below. The PR must contain the latest `main` commit.
9. In the completion summary, report what changed, tests actually run and their results, the exact commit checked, and any checks that could not be run.

## Mandatory: keep PR branches up to date before merge

**Never merge a pull request into `main` while its head branch is behind or has not been verified against the latest `main`. The agent—not the user—owns this update.**

For every PR targeting `main`, immediately before merging:

1. Fetch the latest remote `main` and the PR head; do not rely on a previously cached local or API snapshot.
2. Compare the PR branch with the current `main`. Confirm that the PR branch contains the current `main` tip (equivalently, that the current `main` tip is an ancestor of the PR head).
3. If it does not, update the PR branch by rebasing it onto the latest `main` or merging the latest `main` into it. Prefer the repository's established history policy. Never rewrite or force-push shared history unless explicitly authorized and safe.
4. Resolve conflicts on the PR branch, review the resulting diff, and push the updated branch. Do not ask the user to update the branch manually.
5. Wait for all required CI checks to finish successfully on the exact final PR head commit. If the branch changes, or `main` advances while checks are running, repeat the freshness check and wait for checks on the new final commit.
6. Re-fetch both refs immediately before merge. Merge only if the PR still contains the latest `main` tip, required reviews are satisfied, and all required checks pass for the exact head SHA.
7. If the agent cannot fetch, update, push, or verify the branch with its available permissions/tools, do not merge. Explain the precise blocker and the action that is unavailable; never silently leave branch synchronization to the user.

Do not merge directly to `main` as a shortcut. This rule applies to every PR, including documentation-only and agent-authored PRs.

## Repository-specific constraints

- This is a pnpm workspace. Follow the package manager and versions declared in the root manifest.
- Default unit tests must not require local environment files, credentials, network access, or live exchange access.
- Broker integration tests must remain separate from default unit tests. Tests that place orders must use TESTNET only.
- Do not claim a check passed unless it was actually run and passed.
- Do not bypass or weaken CI checks to make a change pass. Explain any justified exception to the engineering standards.
