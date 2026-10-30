# Bug-Resistance Roadmap

Goal: make Coinzilla safer to change and release, without adding product features.

Prioritize demonstrated engineering risks over checklist progress. Keep changes focused, inspect complete affected files against current `main`, and verify mergeability and checks before calling work complete.

## 1. Make CI trustworthy

- [x] Provide repository workflows for package tests and workspace test coverage.
- [x] Audit which tests need environment variables, network access, exchange APIs, or other external services.
- [x] Separate deterministic unit tests from integration tests that contact exchanges or other services.

  Audit result: the broker package has two `.integration.js` tests that require network access. The default `pnpm test` runs package `node --test` scripts and discovers `.test.js` files, so those integration tests are not part of the deterministic unit-test run. Run them explicitly with `pnpm --filter @coinzilla/brokers test:integration`; the Binance SDK integration suite skips unless non-placeholder credentials are configured. Integration tests are not currently run in CI.
- [ ] Verify all relevant checks consistently pass on pull requests; distinguish checks that run from checks enforced by branch protection.
- [ ] Give unit tests explicit test configuration and mocks. Keep live API tests opt-in and use GitHub Secrets only when genuinely required.

## 2. Protect main and improve change safety

- [x] Protect `main`: require pull requests and passing required status checks; enable review requirements where appropriate.

  Current configuration: the active repository ruleset `core` targets `refs/heads/main`, requires a pull request, requires the branch to be up to date, requires conversation resolution, and enforces these status checks: `Run package tests`, `Check JavaScript syntax`, `packages/utils tests`, and `Audit production dependencies`. It requires zero approvals, has no bypass actors, and blocks force pushes and deletions.
- [x] Pin third-party GitHub Actions to reviewed commit SHAs where practical.
- [ ] Review dependency updates and GitHub Actions permissions for least privilege.

## 3. Test critical behavior

- [ ] Audit test coverage across every package and important cross-package flow.
- [ ] Cover invalid input, missing data, API errors, timeouts, retries, duplicate events, concurrency, and partial failures.
- [ ] Keep tests isolated, repeatable, and independent of execution order.
- [ ] Add a regression test for each bug fix when practical.

## 4. Improve code quality and dependency safety

- [ ] Add consistent linting and formatting checks if the repository does not already enforce them. GitHub Actions workflow linting is enforced by the existing JavaScript Syntax workflow; JavaScript linting and formatting are still follow-up work.
- [x] Add dependency vulnerability checks to CI.

  Current check: `pnpm audit --prod --audit-level high` runs on pull requests, pushes to `main`, and the weekly schedule.
- [x] Keep the existing mock Binance key/secret examples in `.env.example` to demonstrate expected format, with an explicit comment that the values are fake.

## 5. Release safely

- [x] Document release and rollback steps.
- [ ] Verify critical workflows in a staging/test environment before production use.

## Working rules

- Work one meaningful change at a time.
- Before editing, inspect the latest `main`, the complete affected file(s), related tests, and branches/PRs touching the same paths.
- When changes overlap, reconcile the full file against current `main`; do not stack stale, partial patches.
- Run the narrow tests first, then relevant package/workspace checks. Fix failures rather than hiding them or using empty commits to restart CI.
- Check mergeability and all relevant CI results after pushing. Never claim checks are green while they are pending or failed.
- Update this roadmap when a task is actually verified complete; distinguish repository configuration from checks that are merely present.
