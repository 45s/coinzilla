# Coinzilla Engineering Roadmap

## Purpose

Make Coinzilla safer to change, test, and release without adding unnecessary product features. Prioritize demonstrated engineering risks over checklist progress.

This file tracks **repository-wide engineering goals and rules**. Package-specific architecture, implementation phases, protocol details, and operational instructions belong in the relevant package roadmap.

## 1. Make CI trustworthy

- [x] Provide repository workflows for package tests and workspace test coverage.
- [x] Identify tests that require credentials, network access, external APIs, or other services.
- [x] Separate deterministic unit tests from opt-in integration tests.
- [ ] Verify all relevant checks consistently pass on pull requests; distinguish checks that run from checks enforced by branch protection.
- [ ] Give unit tests explicit configuration and mocks. Keep live external-service tests opt-in and use GitHub Secrets only when genuinely required.

## 2. Protect main and improve change safety

- [x] Protect `main`: require pull requests and passing required status checks.
- [x] Pin third-party GitHub Actions to reviewed commit SHAs where practical.
- [ ] Review dependency updates and GitHub Actions permissions for least privilege.
- [ ] Keep shared branches current with `main`; review incoming changes before synchronizing and preserve other teams' work.

## 3. Test critical behavior

- [ ] Audit test coverage across every package and important cross-package flow.
- [ ] Cover invalid input, missing data, API errors, timeouts, retries, duplicate events, concurrency, and partial failures.
- [ ] Keep tests isolated, repeatable, and independent of execution order.
- [ ] Add a regression test for each bug fix when practical.

## 4. Improve code quality and dependency safety

- [ ] Add consistent linting and formatting checks where they provide value and are not already enforced.
- [x] Run dependency vulnerability checks in CI.
- [ ] Keep runtime dependencies minimal, justified, and reviewed.
- [ ] Prefer small, deterministic, testable functions and explicit contracts between packages.

## 5. Release safely

- [x] Document release and rollback steps.
- [ ] Verify critical workflows in a staging/test environment before production use.
- [ ] Require evidence from the exact commit being proposed for release; do not treat pending, canceled, or failed checks as green.

## 6. Package-level roadmaps

Package roadmaps are the operational source of truth for work scoped to an individual package. When asked to implement or improve a package, an agent should be able to open that package's roadmap and begin from its current status, next action, constraints, tests, and acceptance criteria without relying on chat history.

- **[Broker package roadmap](packages/brokers/ROADMAP.md)** — Binance broker architecture, compatibility contract, native WebSocket migration phases, test strategy, agent procedure, and main-branch synchronization rules.
- Add links here when other packages gain their own maintained roadmaps.

## Working rules

- Work one meaningful change at a time.
- Before editing, inspect the latest `main`, complete affected files, related tests, package scripts/manifests, and relevant open branches/PRs.
- When changes overlap, reconcile the complete file against current `main`; do not stack stale partial patches.
- Keep PRs focused and reviewable. Replace complete affected files when that materially reduces merge-conflict risk.
- Run narrow tests first, then relevant package/workspace checks. Fix failures rather than hiding them or using empty commits to restart CI.
- Verify mergeability and all relevant CI results on the exact PR head. Never claim checks are green while they are pending or failed.
- Do not merge PRs automatically; wait for explicit user approval.
- Update roadmaps only when work or decisions are supported by verified evidence.
