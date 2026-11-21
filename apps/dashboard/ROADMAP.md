# Dashboard application roadmap

**Owner:** Dashboard application
**Scope:** `apps/dashboard/`
**Tracking:** [Issue #1623](https://github.com/45s/coinzilla/issues/1623)

- **Next — full record inspection and operator-console hardening:** show every persisted key/value (including nested data) for Orders, Fills, and Commissions; harden the existing local Operator workspace and its backend integration. Do not implement UI-only pause state or call exchange APIs from the browser.

## Current milestone

- **Market Screener in progress in [PR #1661](https://github.com/45s/coinzilla/pull/1661), tracked by [#1660](https://github.com/45s/coinzilla/issues/1660):** Bitunix Futures is the default working source; Bitunix Spot, Binance Futures, and Binance Spot remain unavailable placeholders. The backend reads public Bitunix contract/ticker REST resources and the Dashboard displays native fields only, passes through Bitunix's native rolling 24h ticker percentage, keeps absent 5m/1h/4h windows N/A, and stores per-source favourites in browser cookies. No local movement calculations, exchange credentials, or trading-provider admission.
- **Read-only trading-history pages complete in merged [PR #1636](https://github.com/45s/coinzilla/pull/1636), tracked by [#1634](https://github.com/45s/coinzilla/issues/1634):** Orders, Fills, and Commissions pages backed by Harvester's unauthenticated loopback-only versioned API, backend-selected environment, filters, bounded pagination, record details, readable exchange references, distinct limit/execution/fee-valuation labels, nullable fill-order links, explicit connection/error/empty states, and frontend regression tests.
- **Complete in merged [PR #1641](https://github.com/45s/coinzilla/pull/1641), tracked by [#1643](https://github.com/45s/coinzilla/issues/1643):** local WebSocket invalidation notifications for persisted order, fill, and commission changes; live/reconnecting/offline UI status; bounded reconnect backoff; and REST snapshot reconciliation after every successful socket connection. REST remains the source of truth. Notifications are best-effort and are not durable replay.
- **Operator workspace runtime integration complete in merged [PR #1654](https://github.com/45s/coinzilla/pull/1654):** the Dashboard Operator page and typed client already exist; this PR wires the running Harvester's composed operator facade into the loopback API. The API remains unauthenticated and loopback-only under the explicitly approved local-development exception.
- [x] Initialize the Angular + TypeScript workspace, responsive shell, Overview screen, demo-only view models, tests and repository ownership/CI registration.
- [x] Generate and commit the pnpm lockfile after local dependency installation.
- [x] Verify the Angular production build and tests through GitHub Actions on the exact task PR head.

## Future capability areas

These are planning areas, not commitments to bypass backend ownership or existing trading safety requirements:

- Authenticated, typed, read-only API integration for account snapshots, positions and service diagnostics.
- Environment-aware TESTNET/LIVE presentation with explicit backend-reported state and readiness.
- Searchable diagnostics views backed by server APIs.
- Order-entry and operator-control workflows only after the backend exposes authorized endpoints that use existing Harvester application use cases.
- Optional desktop packaging with Tauri after the web application and its API contracts are stable.

## Constraints

- Keep the browser a presentation/client layer; no direct database, broker or exchange integration.
- Keep feature modules independently testable and avoid introducing a global state framework before multiple features need shared state.
- Keep mock/demo fixtures clearly separated from production API models.
- Update this roadmap when the issue scope or delivered milestone changes. Do not use it as a chronological task log.
