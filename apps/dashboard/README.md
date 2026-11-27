# Coinzilla Dashboard

Angular + TypeScript client for the Coinzilla operational dashboard.

## Current state

The dashboard uses the StarAdmin-inspired warm light palette by default: Athens-grey canvas, white surfaces, warm orange `#F29F67`, charcoal `#1E1E2C`, and blue/teal/yellow supporting accents. The persistent sidebar provides Overview, Bots, Brokers, GitHub and Scenario Runner. Selecting Brokers reveals primary Markets, Orders and History tabs. The Orders workspace exposes secondary Orders, Open Orders and Exchanges tabs; History exposes Fills and Commissions. Selecting Bots reveals Operators, Orders, a disabled future Positions tab and the existing Portfolio workspace. Existing records and live account pages remain accessible without moving them into the global sidebar. A persistent theme picker retains the original Emerald appearance and the Midnight Terminal, Clean Light, OLED / Neon, Green Terminal, Arctic, Warm Graphite, and System palettes. Theme choice is stored in browser local storage. The Overview is a live, read-only Harvester workspace. It reads API reachability from `/api/v1/trading/operator/status` and consumes validated runtime, configured-market and Portfolio snapshots from the existing `/api/v1/trading/events` WebSocket. Quantities and financial values remain exact source strings. The current read model does not expose total account valuation or historical equity performance, so Overview does not invent those figures. Connectivity and reported runtime readiness are shown separately; neither implies exchange readiness or permission to trade. The separate **Bots** workspace consumes versioned runtime, market and Portfolio snapshots from Harvester's existing loopback WebSocket stream and exposes confirmation-gated BUY pause controls over the existing HTTP command endpoint. Orders, Fills, and Commissions are separate read-only pages that request actual persisted Harvester records through the unauthenticated loopback-only `/api/v1` HTTP contract. Exchanges and Open Orders consume full account and order snapshots over the local Harvester WebSocket only; these two pages make no browser HTTP requests. The Market Screener displays Bitunix Futures public REST market data through Harvester; Bitunix Spot and Binance markets are visible future source options but are not enabled. The native rolling 24h percentage is displayed from Bitunix's public WebSocket ticker field; missing 5m, 1h, and 4h fields stay N/A. The Dashboard performs no movement calculations. Favourites are stored in source-specific one-year browser cookies. The screener fetches on page load and explicit refresh only; it does not poll in the background. The **GitHub PRs** page lists every open pull request in `45s/coinzilla`, including drafts, with the current head commit's committer timestamp and Dashboard-local work labels. Its compact label manager supports inline rename, color swatches and deletion; labels are toggled directly on each PR row, and a floating Refresh action remains available while scrolling.

### Markets theme contract

The Market Screener feature stylesheet uses the shared Dashboard theme tokens for page text, surfaces, borders, and controls (for example, `--text`, `--muted`, `--panel-bg`, `--surface-bg`, `--control-bg`, and `--line`). Do not add fixed palette colors for neutral feature UI: the selected theme must control the Markets page just like the shell and other Dashboard pages. Keep status colors only where they communicate market state or direction.

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

The development server binds to `127.0.0.1`. Open the URL printed by Angular CLI; it may choose a port other than `4200` if that port is occupied. Harvester accepts the local Dashboard origin on any valid `localhost` or `127.0.0.1` HTTP port while keeping its API listener loopback-only. Run `pnpm --filter @coinzilla/harvester dev` in a separate terminal. The local API starts with Harvester at `http://127.0.0.1:4201`; no token is required. Exchanges and Open Orders open the local WebSocket at `/api/v1/trading/events`, receive a full account snapshot on connect/reconnect, and make no HTTP requests. Bots consumes complete versioned operator snapshots from the same socket, distinguishes socket health from snapshot freshness, and never polls REST for runtime state. Persisted Orders/Fills/Commissions continue to use their existing HTTP resources and WebSocket invalidation hints; those HTTP snapshots remain authoritative for persisted history.

Build and test:

```sh
pnpm --filter @coinzilla/dashboard build
pnpm --filter @coinzilla/dashboard test
pnpm --filter @coinzilla/dashboard test:coverage
```

## Bots workspace

The **Bots** page is a structured live view over Harvester's existing operator snapshots. It receives a complete versioned snapshot on connect and reconnect, then receives newer complete snapshots after relevant process, broker, readiness, market, fill, recovery, account-audit, and successful operator BUY-control events. Revisions are monotonic; an older read racing a newer event is discarded server-side, and the client ignores duplicate or out-of-order messages. It shows process state and running duration, effective runtime strategy mode, TESTNET/LIVE environment, readiness and blockers, enabled/blocked/disabled markets, the latest sampled market prices/freshness, and Portfolio inventory/recovery accounting. The Bots stream is state-driven and intentionally does not broadcast every market-price tick. Decimal amounts remain strings and are rendered without browser-side financial calculations.

The current operator API reports one effective `strategyMode` and market-level state. It does not expose individual strategy registration/enablement or per-Position `strategyId`; the page does not invent those statuses or attribute market-level positions to a strategy. A richer strategy-by-strategy view requires a separately coordinated Harvester read-model/API extension.

The connection indicator reports WebSocket health separately from snapshot freshness. A failed resource read is explicit and never rendered as an empty list; the last complete snapshot is retained as stale and commands stay disabled until a complete snapshot returns. There is no manual refresh button or REST polling. Market and global controls use the existing Harvester `pause`, `unpause`, `pauseallbuys`, and `resumeallbuys` HTTP commands and require an explicit confirmation. These controls pause or resume the BUY gate only; they do not stop Recovery SELL evaluation, fill accounting, or safety reconciliation. The local API remains loopback-only and must not be exposed to a LAN, reverse proxy, container port mapping, or remote host.

## Exchanges workspace

The read-only **Exchanges** page lists provider accounts exposed by Harvester's already-running provider readers. Search, connection/environment filters, favourites and account snapshots are handled in the browser. Favourites persist in local storage and are always sorted above other accounts. Balances and open orders arrive together in full `exchange-accounts.snapshot` / `exchange-accounts.updated` WebSocket messages; this page makes no HTTP requests and never opens exchange connections or handles exchange credentials.

The separate **Open Orders** page aggregates the current account-wide open-order snapshots across every connected CEX/provider. It supports exchange, symbol, side and status filters, groups rows by provider account, and shows all available order fields in its details view. Both pages reconnect with bounded backoff and receive a fresh snapshot on each connection. A failed provider read stays visibly unavailable instead of being presented as an empty account/order list. Providers not configured and supported by Harvester are not displayed.

## GitHub PRs workspace

The **GitHub PRs** page reads the public `45s/coinzilla` repository through unauthenticated, read-only GitHub REST requests. It follows all open-PR pagination pages, includes drafts, and derives the displayed commit time from the current head SHA's `commit.committer.date`; it never substitutes PR `updated_at` or commit author time. Refresh occurs on page entry or explicit user action, not on a background polling loop. Reusable work labels are stored only in browser localStorage and are never written to GitHub. A per-PR commit lookup failure does not hide the PR, while an incomplete paginated list is never presented as a complete snapshot. See the [GitHub PR Dashboard specification](docs/features/github-pr-dashboard/SPEC.md).

## Architecture boundary

The dashboard is a separate client application. Persisted trading-history and the legacy Operator workspace use their established typed local Harvester HTTP clients; Bots uses the local Harvester WebSocket for read-only snapshots and the existing HTTP operator command endpoint for confirmed mutations; Exchanges and Open Orders use the WebSocket snapshot stream only. Browser code must not open Harvester database files, import Harvester internals, or call exchange APIs. The GitHub PRs feature is the sole external-service page and uses only unauthenticated public GitHub REST reads; it sends no credentials or write requests, and its labels remain browser-local. Financial decimal values remain strings and missing values remain null. Order entry remains out of scope. The local Operator workspace routes commands through Harvester's existing application facade and safety gates; its runtime/API integration is complete in [merged PR #1654](https://github.com/45s/coinzilla/pull/1654). The Market Screener also calls Harvester only; browser code never calls exchange endpoints.

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
