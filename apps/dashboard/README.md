# Coinzilla Dashboard

Angular + TypeScript application workspace for the future Coinzilla operational dashboard.

## Current state

The first milestone provides a responsive dashboard shell and an Overview screen populated with fictional demo data. It is not connected to Harvester, an exchange, a database, or a live event stream. The UI deliberately labels the sample data and reports the backend as disconnected.

## Requirements

- Node.js 24.15 or newer
- pnpm `12.11.2`, invoked from the repository root
- Dependencies installed from the root lockfile

## Development

From the repository root:

```sh
pnpm install
pnpm --filter @coinzilla/dashboard start
```

The development server binds to `127.0.0.1`. Open the URL printed by Angular CLI.

Build and test:

```sh
pnpm --filter @coinzilla/dashboard build
pnpm --filter @coinzilla/dashboard test
pnpm --filter @coinzilla/dashboard test:coverage
```

## Architecture boundary

The dashboard is a separate client application. Its future data access belongs behind typed, authenticated backend API contracts. Browser code must not open Harvester database files, import Harvester internals, or call exchange APIs. Order entry and operator controls are deferred until backend endpoints can route through existing application use cases and safety gates.

## Documentation

- [Dashboard agent instructions](AGENTS.md)
- [Dashboard roadmap](ROADMAP.md)
- [Dashboard documentation index](docs/README.md)
- [Repository documentation index](../../docs/README.md)
