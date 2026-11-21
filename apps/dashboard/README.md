# Coinzilla Dashboard

Angular + TypeScript client for the Coinzilla operational dashboard.

## Current state

The Overview screen remains an explicitly labeled fictional preview. Orders, Fills, and Commissions are separate read-only pages that request actual persisted Harvester records through the unauthenticated loopback-only `/api/v1` HTTP contract. The Market Screener displays Bitunix Futures public REST market data through Harvester; Bitunix Spot and Binance markets are visible future source options but are not enabled. The native rolling 24h percentage is displayed from Bitunix's public WebSocket ticker field; missing 5m, 1h, and 4h fields stay N/A. The Dashboard performs no movement calculations. Favourites are stored in source-specific one-year browser cookies.

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

The dashboard is a separate client application. Trading-history data access uses a typed local Harvester API client. Browser code must not open Harvester database files, import Harvester internals, or call exchange APIs. Financial decimal values remain strings and missing values remain null. Order entry remains out of scope. The local Operator workspace routes commands through Harvester's existing application facade and safety gates; its runtime/API integration is complete in [merged PR #1654](https://github.com/45s/coinzilla/pull/1654). The Market Screener also calls Harvester only; browser code never calls exchange endpoints.

## Documentation

- [Dashboard agent instructions](AGENTS.md)
- [Dashboard roadmap](ROADMAP.md)
- [Dashboard documentation index](docs/README.md)
- [Repository documentation index](../../docs/README.md)

## Local operator workspace

The Dashboard includes an **Operator** workspace backed by the same application-level operator facade used by Telegram Command Center. It reads runtime status, markets, portfolio positions, open orders, and balances from Harvester snapshots. Commands include:

- `pause BTCUSDT` and `unpause BTCUSDT` for one market's BUY side.
- `pauseallbuys` and `resumeallbuys` for the global BUY pause.

Every mutating command requires a second confirmation in the Dashboard. The API is local-only and unauthenticated by design; keep it bound to `127.0.0.1` and do not expose it to a LAN, reverse proxy, container port mapping, or remote host.
