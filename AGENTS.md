# Instructions for coding agents

Before making changes, read ENGINEERING_STANDARDS.md, inspect the affected package's instructions and conventions, and understand the relevant implementation and tests.

## Non-negotiable engineering principles

1. **Test-First, Comprehensive Verification**
   - Every new or changed behavior must have meaningful automated tests. Tests are a required part of implementation, not optional follow-up work.
   - For bug fixes, add a regression test that reproduces the defect and fails before the fix whenever practical.
   - Cover success paths, invalid inputs, boundaries, edge cases, failure paths, and relevant interactions between features.
   - Test observable contracts and externally visible behavior. Test private implementation details only when a focused unit test adds meaningful confidence.
   - Prefer deterministic tests. Control time, randomness, scheduling, and concurrency; use promises/barriers instead of arbitrary sleeps.
   - Run the affected package's tests and coverage command, then applicable workspace and repository checks. Never claim a test or check passed unless it was actually executed and passed.
   - Do not weaken, skip, delete, or rewrite meaningful assertions merely to make a change pass. Explain any unavoidable gap.

2. **Reliability and Observability by Default**
   - Design for invalid input, partial failure, rejected promises, concurrency, cleanup, and resource exhaustion—not only the happy path.
   - Validate inputs at boundaries and preserve invariants throughout the implementation.
   - Handle every failure deliberately. Never silently swallow errors, hide rejected promises, or return success when an operation failed.
   - Provide useful, structured diagnostic context at meaningful system boundaries and on actionable failures. Include relevant operation/entity identifiers and the original error when available.
   - Logging must help diagnose behavior without flooding normal operation. Do not log the same failure redundantly, and never log secrets, credentials, tokens, or sensitive payloads.
   - Make retries, timeouts, cancellation, resource limits, and fallback behavior explicit and bounded where applicable.
   - Add tests for failure handling and for the behavior of logging/error-reporting hooks.

3. **Single-Responsibility Module Design**
   - Keep entry points and public index files thin: exports and composition only, not the home for an entire feature implementation.
   - Split implementation into cohesive modules based on responsibility, not arbitrary file size. Each module should have one clear reason to change.
   - Use package-local folders such as helpers/ for focused internal operations, utils/ for genuinely reusable generic utilities, constants/ for stable shared constants, errors/ for domain-specific errors, and adapters/ or services/ for integration and side-effect boundaries when those concepts exist.
   - Keep feature orchestration in a clearly named feature module. Avoid both giant files and excessive fragmentation into one-function files without a cohesion or testing benefit.
   - Use descriptive, consistent file and symbol names. Prefer domain-specific names over vague names such as common, misc, or stuff.
   - Keep dependencies flowing toward stable, lower-level contracts; avoid circular dependencies and hidden side effects.

4. **Evidence-Based Completion**
   - Inspect the final diff for correctness, missing tests, accidental changes, dead code, secrets, and weakened checks.
   - Update relevant documentation, agent instructions, and package roadmaps when contracts or conventions change.
   - In the completion summary, list the behavior changed, tests/checks actually run and their outcomes, and anything not run or still uncertain.

## Required workflow

1. Identify the behavior requested and the smallest safe change.
2. Read repository and package-level agent instructions and engineering standards.
3. Inspect the affected code, neighboring tests, package scripts, and relevant consumers before editing.
4. Add or update tests alongside the implementation; for defects, reproduce the defect in a regression test first whenever practical.
5. Implement the smallest cohesive change, separating pure logic from side effects where practical.
6. Run the focused test and coverage commands, followed by relevant workspace and repository checks when feasible.
7. Review the final diff and report evidence accurately.
8. Before merging any pull request into main, follow the mandatory **Keep PR branches up to date** procedure below. The PR must contain the latest main commit.
9. In the completion summary, report what changed, tests actually run and their results, the exact commit checked, and any checks that could not be run.

## Mandatory: keep PR branches up to date before merge

**Never merge a pull request into main while its head branch is behind or has not been verified against the latest main. The agent—not the user—owns this update.**

For every PR targeting main, immediately before merging:

1. Fetch the latest remote main and the PR head; do not rely on a previously cached local or API snapshot.
2. Compare the PR branch with the current main. Confirm that the PR branch contains the current main tip (equivalently, that the current main tip is an ancestor of the PR head).
3. If it does not, update the PR branch by rebasing it onto the latest main or merging the latest main into it. Prefer the repository's established history policy. Never rewrite or force-push shared history unless explicitly authorized and safe.
4. Resolve conflicts on the PR branch, review the resulting diff, and push the updated branch. Do not ask the user to update the branch manually.
5. Wait for all required CI checks to finish successfully on the exact final PR head commit. If the branch changes, or main advances while checks are running, repeat the freshness check and wait for checks on the new final commit.
6. Re-fetch both refs immediately before merge. Merge only if the PR still contains the latest main tip, required reviews are satisfied, and all required checks pass for the exact head SHA.
7. If the agent cannot fetch, update, push, or verify the branch with its available permissions/tools, do not merge. Explain the precise blocker and the action that is unavailable; never silently leave branch synchronization to the user.

Do not merge directly to main as a shortcut. This rule applies to every PR, including documentation-only and agent-authored PRs.

## Repository-specific constraints

- This is a pnpm workspace. Follow the package manager and versions declared in the root manifest.
- Default unit tests must not require local environment files, credentials, network access, or live exchange access.
- Broker integration tests must remain separate from default unit tests. Tests that place orders must use TESTNET only.
- Do not claim a check passed unless it was actually run and passed.
- Do not bypass or weaken CI checks to make a change pass. Explain any justified exception to the engineering standards.
