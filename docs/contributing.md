# Contributing

This guide describes the local checks and pull-request workflow for the Coinzilla pnpm workspace.

## Prerequisites

- Node.js 24 or newer
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
| `pnpm run quality` | Run workspace tests, syntax checks, and agent-policy checks |
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

Use the repository's [pull-request template](../.github/PULL_REQUEST_TEMPLATE.md) for the required summary, roadmap/invariant, verification, review, and ownership checklist. It is the single source for PR content requirements.

## Continuous integration

GitHub Actions includes the JavaScript Syntax, Unit Tests, Utils Unit Tests, Test Coverage, and Dependency Audit workflows. All workflows that execute Node.js use Node.js 24.x. Their triggers and scopes are defined in `.github/workflows/`.

A successful workflow run is evidence for that run and commit only. Whether GitHub blocks merging on required checks depends on the repository's branch-protection or ruleset configuration.


## Branch and pull-request workflow

Follow the single [mandatory AI-agent workflow](../AI_AGENT_WORKFLOW.md) for branch naming, domain ownership, cross-domain requests, synchronization, merge gates, task-branch cleanup, and releases. This guide intentionally does not duplicate those rules.
