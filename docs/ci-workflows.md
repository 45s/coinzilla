# GitHub Actions Workflows

This page summarizes the workflows in `.github/workflows/` and what each one verifies. Workflow definitions remain the source of truth; update this page when their triggers or checks change.

## Workflow overview

| Workflow file | Purpose | Main check |
| --- | --- | --- |
| `quality-gate.yml` | Combined quality gate for pull requests and pushes to `main` | `pnpm run quality` (tests, then JavaScript syntax checks) |
| `unit-tests.yml` | Run workspace package tests on pushes and pull requests | `pnpm test` |
| `utils-unit-tests.yml` | Focused checks for the utility package | `pnpm --filter @coinzilla/utils test` |
| `test-coverage.yml` | Run workspace tests with Node.js coverage reporting | `pnpm run test:coverage` |
| `dependency-audit.yml` | Audit production dependencies | `pnpm audit --prod --audit-level high` |

## Triggers

- **Quality Gate** runs for pull requests, pushes to `main`, and manual dispatch.
- **Unit Tests**, **Utils Unit Tests**, and **Test Coverage** run for pushes, pull requests, and manual dispatch.
- **Dependency Audit** runs for pushes, pull requests, manual dispatch, and a weekly scheduled run (Monday at 07:23 UTC).

A workflow trigger starting a run does not, by itself, make that check a merge requirement. Configure the repository's branch protection or ruleset to require the appropriate checks.

## Local equivalents

Run these commands from the repository root with the Node.js and pnpm versions specified in the root `package.json`:

```sh
# Workspace tests
pnpm test

# Tests plus JavaScript syntax checks (the Quality Gate command)
pnpm run quality

# Utility package tests
pnpm --filter @coinzilla/utils test

# Workspace test coverage
pnpm run test:coverage

# Production dependency audit
pnpm audit --prod --audit-level high
```

The default unit-test suite should remain deterministic and must not require credentials, local environment files, network access, or live exchange access. Broker integration tests are separate; tests that place orders must use TESTNET only.

## Failure triage

1. Open the failed run in the repository's **Actions** tab and select the failed job.
2. Read the first failing command and its output before changing code or workflow configuration.
3. Reproduce the relevant command locally when possible.
4. Fix the underlying issue rather than skipping, weakening, or masking the check.
5. Re-run the relevant tests and checks, then confirm the pull request's checks have completed successfully.

The coverage workflow writes its command output to the GitHub Actions step summary to make the report easier to inspect. A failed coverage command still fails the job.
