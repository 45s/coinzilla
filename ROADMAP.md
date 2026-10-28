# Bug-Resistance Roadmap

Goal: make Coinzilla safer to change and release, without adding product features.

## 1. Make CI trustworthy
- [ ] Audit why each existing test needs environment variables or external services.
- [ ] Separate deterministic unit tests from integration tests that contact exchanges or other services.
- [ ] Make unit tests blocking in CI; remove `continue-on-error` only after the suite is reliable.
- [ ] Provide `.env.example` with variable names and safe placeholders; never commit real credentials.
- [ ] Give unit tests explicit test configuration/mocks. Keep live API tests opt-in and use GitHub Secrets only when genuinely required.

## 2. Test critical behavior
- [ ] Add tests for every package and important cross-package flow.
- [ ] Cover invalid input, missing data, API errors, timeouts, retries, duplicate events, and partial failures.
- [ ] Make tests isolated, repeatable, and independent of execution order.

## 3. Prevent regressions
- [ ] Add consistent linting and formatting checks.
- [ ] Require CI checks and pull-request review before merging to `main`.
- [ ] Add dependency/security checks and secret scanning.
- [ ] Pin third-party GitHub Actions to reviewed commit SHAs where practical.

## 4. Release safely
- [ ] Document release and rollback steps.
- [ ] Verify critical workflows in a staging/test environment before production use.

## Working rules
- One focused change per pull request.
- Every bug fix includes a regression test when practical.
- Do not hide failing checks or add empty commits to restart CI.
- Update this roadmap as work is completed; prioritize demonstrated risks over checking boxes.
