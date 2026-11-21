# Coinzilla Dashboard

Angular + TypeScript client for the Coinzilla operational dashboard.

## Current state

The Overview screen remains an explicitly labeled fictional preview. Orders, Fills, and Commissions are separate read-only pages that request actual persisted Harvester records through the unauthenticated loopback-only `/api/v1` HTTP contract. They never use demo fixtures as a fallback. The selected TESTNET/LIVE environment is taken from API metadata.

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

The development server binds to `127.0.0.1`. Open the URL printed by Angular CLI. Run `pnpm --filter @coinzilla/harvester dev` in a separate terminal. The API starts with Harvester at `http://127.0.0.1:4201`; the Dashboard connects automatically without a token. The API binds to loopback by default and is intended for local development only. The Dashboard opens a local WebSocket at `/api/v1/trading/events`; persisted-change notifications refresh the active resource and record counts. The client reconnects with bounded backoff and reloads REST snapshots after every successful reconnect; REST remains authoritative because WebSocket notifications are best-effort invalidation hints, not durable replay.

Build and test:

```sh
pnpm --filter @coinzilla/dashboard build
pnpm --filter @coinzilla/dashboard test
pnpm --filter @coinzilla/dashboard test:coverage
```

## Architecture boundary

The dashboard is a separate client application. Trading-history data access uses a typed local Harvester API client. Browser code must not open Harvester database files, import Harvester internals, or call exchange APIs. Financial decimal values remain strings and missing values remain null. Order entry and operator controls remain deferred until backend endpoints can route through existing application use cases and safety gates.

## Documentation

- [Dashboard agent instructions](AGENTS.md)
- [Dashboard roadmap](ROADMAP.md)
- [Dashboard documentation index](docs/README.md)
- [Repository documentation index](../../docs/README.md)
