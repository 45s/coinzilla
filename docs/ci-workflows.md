# GitHub Actions Workflows

This page summarizes the workflows in `.github/workflows/` and what each one verifies. Workflow definitions remain the source of truth; update this page when their triggers or checks change.

## Workflow overview

| Workflow file | Purpose | Main check |
| --- | --- | --- |
| `quality-gate.yml` | **JavaScript Syntax** workflow: lint GitHub Actions, check JavaScript syntax, and enforce agent-policy/domain-ownership checks on pull requests and pushes to `main`/`develop` | `actionlint`; `node scripts/check-syntax.js`; `node --test scripts/check-agent-policy.test.js && node scripts/check-agent-policy.js` |
| `unit-tests.yml` | Run workspace package tests on pushes and pull requests | `pnpm test` |
| `utils-unit-tests.yml` | Focused checks for the utility package | `pnpm --filter @coinzilla/utils test` |
| `test-coverage.yml` | Run workspace tests with Node.js coverage reporting | `pnpm run test:coverage` |
| `dependency-audit.yml` | Audit production dependencies | `pnpm audit --prod --audit-level high` |

## Triggers

- **JavaScript Syntax** runs for pull requests, pushes to `main` and `develop`, and manual dispatch.
- **Unit Tests**, **Utils Unit Tests**, and **Test Coverage** run for pushes, pull requests, and manual dispatch.
- **Dependency Audit** runs for pushes, pull requests, manual dispatch, and a weekly scheduled run (Monday at 07:23 UTC).

A workflow trigger starting a run does not, by itself, make that check a merge requirement. The active `develop-core` ruleset requires the `Check JavaScript syntax` context; its workflow includes actionlint, JavaScript syntax, and agent-policy/domain-ownership validation. Re-read the live ruleset before changing workflow names or required contexts; see [Documentation Governance](./DOCUMENTATION_GOVERNANCE.md).

## Manual broker TESTNET validation

The `unit-tests.yml` workflow exposes an opt-in `run_broker_testnet_read_only` dispatch input on `develop`. The TESTNET job uses repository secrets only in its final integration step; checkout, tool setup, and dependency installation do not receive exchange credentials. The step rejects missing or case-insensitive placeholder credentials before running the read-only broker integration suite. It fixes order mutations and externally triggered user-data event waiting to `0`; it does not upload integration artifacts. Ordinary package tests remain offline and credential-free.

## Local equivalents

Run these commands from the repository root with the Node.js and pnpm versions specified in the root `package.json`:

```sh
# Workspace tests
pnpm test

# Local aggregate: workspace tests, syntax checks, and agent-policy checks
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
