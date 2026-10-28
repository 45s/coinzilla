# Coinzilla

Coinzilla is a pnpm workspace containing the project's applications and shared packages.

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

To run the broker integration tests locally, copy `packages/brokers/.env.example` to `packages/brokers/.env.development`, add Binance **TESTNET** credentials, then run:

```sh
pnpm --filter @coinzilla/brokers test:integration
```

To run only the Binance SDK integration tests:

```sh
pnpm --filter @coinzilla/brokers test:sdk
```

Integration tests need network access and valid testnet credentials. They are intentionally not part of the default CI unit-test run. Never use production credentials for these tests or commit real credentials.

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

The main GitHub Actions workflow runs `pnpm test` and fails when a package unit test fails. The separate `packages/utils tests` workflow also checks the utility package. Repository branch protection must require the relevant checks if they should block merges.
