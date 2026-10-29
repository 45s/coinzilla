# Bug-Resistance Roadmap

Goal: make Coinzilla safer to change and release, without adding product features.

Prioritize demonstrated risks over checklist progress. Keep one focused change per pull request, inspect the full affected files against current `main`, and verify mergeability and checks before calling work complete.

## 1. Security hygiene and merge safety

- [x] Keep `apps/bot-free-roll/.env.example` limited to safe, clearly fake placeholders; never commit credentials.
- [ ] If any previously committed credential was real, rotate/revoke it and review its usage. Replacing a value in the current file does not remove it from Git history.
- [ ] Enable secret scanning (and push protection if available); audit existing tracked files and history for credentials.
- [ ] Protect `main`: require pull requests and passing required status checks; enable review requirements where appropriate. Current repository settings show branch protection is not enabled.
- [ ] Pin third-party GitHub Actions to reviewed commit SHAs where practical.

## 2. Make CI trustworthy

- [x] Provide repository workflows for package tests and workspace test coverage.
- [ ] Audit which tests need environment variables, network access, exchange APIs, or other external services.
- [ ] Separate deterministic unit tests from integration tests that contact exchanges or other services.
- [ ] Verify all required checks are consistently green on pull requests; do not treat an existing workflow as proof that its checks are required by branch protection.
- [ ] Give unit tests explicit test configuration and mocks. Keep live API tests opt-in and use GitHub Secrets only when genuinely required.

## 3. Test critical behavior

- [ ] Audit test coverage across every package and important cross-package flow.
- [ ] Cover invalid input, missing data, API errors, timeouts, retries, duplicate events, concurrency, and partial failures.
- [ ] Keep tests isolated, repeatable, and independent of execution order.
- [ ] Add a regression test for each bug fix when practical.

## 4. Improve code quality and dependency safety

- [ ] Add consistent linting and formatting checks if the repository does not already enforce them.
- [ ] Add dependency vulnerability checks and secret scanning to CI.
- [ ] Review dependency updates and GitHub Actions permissions for least privilege.

## 5. Release safely

- [ ] Document release and rollback steps.
- [ ] Verify critical workflows in a staging/test environment before production use.

## Working rules

- Work one meaningful change at a time.
- Before editing, inspect the latest `main`, the complete affected file(s), related tests, and branches/PRs touching the same paths.
- When changes overlap, reconcile the full file against current `main`; do not stack stale, partial patches.
- Run the narrow tests first, then relevant package/workspace checks. Fix failures rather than hiding them or using empty commits to restart CI.
- Check mergeability and all required CI results after pushing. Never claim checks are green while they are pending or failed.
- Update this roadmap when a task is actually verified complete; distinguish repository configuration from checks that are merely present.
