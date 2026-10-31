# Contributing

This guide describes the local checks and pull-request workflow for the Coinzilla pnpm workspace.

## Prerequisites

- Node.js 22
- pnpm 12.11.2 (the version pinned in the root `package.json`)

Install dependencies from the repository root:

```sh
pnpm install --frozen-lockfile
```

## Before opening a pull request

Run the checks relevant to your change from the repository root:

| Command | Purpose |
| --- | --- |
| `pnpm test` | Run all workspace tests that define a `test` script |
| `pnpm run check:syntax` | Parse JavaScript files under `apps/` and `packages/` with Node.js |
| `pnpm run quality` | Run workspace tests and the syntax check |
| `pnpm run test:coverage` | Run workspace tests with Node.js coverage reporting |
| `pnpm --filter @coinzilla/utils test` | Run the shared utilities package tests |

Keep the lockfile and package manifests in sync when changing dependencies. Prefer the frozen install command to catch an out-of-date lockfile.

## Broker integration tests

Broker integration tests are separate from the default unit-test run because they may require network access and exchange test credentials.

```sh
pnpm --filter @coinzilla/brokers test:integration
pnpm --filter @coinzilla/brokers test:sdk
```

For tests that need environment configuration, copy `packages/brokers/.env.example` to `packages/brokers/.env.development` and provide only appropriate test-environment credentials. Never commit real credentials or use production credentials for integration tests. Do not paste credentials into logs, pull requests, or issue reports.

## Pull-request checklist

- Keep each pull request focused on one change and explain the motivation and expected behavior.
- Add or update tests when changing behavior; avoid relying on live services for ordinary unit tests.
- Update documentation when commands, configuration, package interfaces, or operational procedures change.
- Review the complete diff for accidental generated files, local environment files, secrets, and unrelated edits.
- Confirm CI checks for the exact pull-request commit have completed successfully. A pending, cancelled, or skipped check is not evidence that the change passed.
- If a check fails, inspect the failing step and fix the cause rather than assuming the failure is transient.

## Continuous integration

GitHub Actions currently includes the Quality Gate, Unit Tests, Utils Unit Tests, Test Coverage, and Dependency Audit workflows. Their triggers and scopes are defined in `.github/workflows/`.

A successful workflow run is evidence for that run and commit only. Whether GitHub blocks merging on required checks depends on the repository's branch-protection or ruleset configuration.


## Branch and pull-request workflow

Follow [the mandatory AI-agent workflow](../AI_AGENT_WORKFLOW.md) for branch naming, domain ownership, cross-domain requests, synchronization, merging, and releases.

In brief:

- Start task branches from the latest `develop`; use short-lived branches such as `feature/entities/fr-008-asset-market` or `fix/brokers/order-reconciliation`.
- Target task PRs at `develop`, not `main`.
- Task PRs may be merged by the responsible agent after required checks pass. Routine human approval is intentionally not required.
- Synchronize against the latest PR target before merging; the agent owns this work.
- Only milestone/release PRs from `develop` to `main` require the user's final review and approval.
- Do not use permanent per-domain branches. Domain ownership is defined by repository paths and local instructions, not branch lifetime.
