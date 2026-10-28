# Coinzilla

Coinzilla is a pnpm workspace containing the project's applications and shared packages.

## Requirements

- Node.js with support for ES modules
- pnpm `12.11.2` (the version declared in the root `package.json`)

## Getting started

Install dependencies from the repository root:

```sh
pnpm install
```

Run the test scripts available in workspace packages:

```sh
pnpm test
```

The root test command runs each package's available `test` script recursively. To run the utility package tests directly:

```sh
pnpm --filter @coinzilla/utils test
```

To keep the utility tests running while editing:

```sh
pnpm --filter @coinzilla/utils test:watch
```

## Workspace layout

- `apps/*` — application workspaces
- `packages/*` — shared package workspaces
- `packages/utils` — shared utility functions and their Node.js test-runner tests

## Utilities package

The `@coinzilla/utils` package uses Node.js built-in modules and the built-in `node:test` runner. Its source entry point is `packages/utils/src/index.js`.

A few examples:

```js
import {
  calculateTimeDiff,
  capitalize,
  generateUUID,
  formatTimeRelatively,
} from '@coinzilla/utils'

// Difference is returned in hours by default.
const hours = calculateTimeDiff({
  start: new Date('2026-01-01T00:00:00Z'),
  end: new Date('2026-01-01T02:30:00Z'),
}) // 2.5

capitalize('coinzilla') // 'COINZILLA'
generateUUID() // UUID v4 string
formatTimeRelatively({ value: -5, unit: 'minute' }) // '5 minutes ago'
```

These examples illustrate the exported API; use the package's configured workspace resolution when importing it from another workspace. The utility package also exports validation helpers, logging, event-emitter constants, file-appending, error handling, feature-flag checks, wait helpers, number helpers, and result wrappers.

## Continuous integration

The `packages/utils tests` GitHub Actions check runs the utility package's test script on pushes and pull requests. A failed test causes that check to fail. Repository branch protection must require this check if it should block merges.
