# Coinzilla

Coinzilla is a pnpm workspace containing the project's applications and shared packages.

## Development workflow

AI agents and contributors must follow [AI_AGENT_WORKFLOW.md](AI_AGENT_WORKFLOW.md). Work is integrated into `develop` through short-lived task branches and automated checks. `main` is reserved for milestone/release PRs that receive final human approval.

See [the contributing guide](docs/contributing.md), [domain ownership map](docs/workspace-package-map.md), and [engineering standards](ENGINEERING_STANDARDS.md).

## Requirements

- Node.js 22
- pnpm `12.11.2` (the version declared in the root `package.json`)

## Getting started

Install dependencies from the repository root:

```sh
pnpm install
```

Run the unit tests:

```sh
pnpm test
```

Unit tests should be deterministic and must not require local environment files, API credentials, or live exchange access. Broker tests that call Binance are kept in separate integration-test files and are excluded from the default test command.

To run the broker integration tests locally, copy `packages/brokers/.env.example` to `packages/brokers/.env.development`. The Binance SDK integration tests are skipped automatically unless actual Binance TESTNET credentials are configured; no credentials are needed for the default unit tests.

```sh
pnpm --filter @coinzilla/brokers test:integration
```

To run only the Binance SDK integration tests:

```sh
pnpm --filter @coinzilla/brokers test:sdk
```

Integration tests need network access. Tests that place orders use TESTNET only and are intentionally not part of the default CI unit-test run. Never use production credentials for these tests or commit real credentials.

To run the utility package tests directly:

```sh
pnpm --filter @coinzilla/utils test
```

To keep utility tests running while editing:

```sh
pnpm --filter @coinzilla/utils test:watch
```

## Workspace layout

- `apps/*` — application workspaces
- `packages/*` — shared packages
- `packages/utils` — shared utility functions and Node.js tests

## Utilities package

The `@coinzilla/utils` package uses Node.js built-in modules and the built-in `node:test` runner. Its source entry point is `packages/utils/src/index.js`.

```js
import {
  calculateTimeDiff,
  capitalize,
  generateUUID,
  formatTimeRelatively,
} from '@coinzilla/utils'

const hours = calculateTimeDiff({
  start: new Date('2026-01-01T00:00:00Z'),
  end: new Date('2026-01-01T02:30:00Z'),
}) // 2.5

capitalize('coinzilla') // 'COINZILLA'
generateUUID() // UUID v4 string
formatTimeRelatively({ value: -5, unit: 'minute' }) // '5 minutes ago'
```

## Continuous integration

GitHub Actions currently runs these checks:

- **Quality Gate** installs dependencies with `pnpm install --frozen-lockfile` and runs `pnpm run quality` (workspace unit tests plus JavaScript syntax checks).
- **Unit Tests** runs `pnpm test` independently.
- **Utils Unit Tests** runs `@coinzilla/utils` tests independently.
- **Test Coverage** runs workspace tests with Node.js coverage reporting.
- **Dependency Audit** runs `pnpm audit --prod --audit-level high` on pushes, pull requests, and a weekly schedule.

The Unit Tests and Utils Unit Tests workflows overlap with the Quality Gate. Keep that duplication until repository branch-protection requirements have been reviewed; removing a workflow can invalidate a required status check.

A workflow reporting success does not, by itself, prevent merging. Configure GitHub branch protection or a ruleset for `main` and require the **Quality Gate / Tests and JavaScript syntax** check. Consider requiring coverage and dependency audit as well if their runtime and failure policies are appropriate for every pull request.
