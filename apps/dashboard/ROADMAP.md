# Dashboard application roadmap

**Owner:** Dashboard application
**Scope:** `apps/dashboard/`
**Tracking:** [Issue #1623](https://github.com/45s/coinzilla/issues/1623)

- **Next — full record inspection and operator-console hardening:** show every persisted key/value (including nested data) for Orders, Fills, and Commissions; harden the existing local Operator workspace and its backend integration. Do not implement UI-only pause state or call exchange APIs from the browser.

## Current milestone

- **In progress — GitHub PR Dashboard:** implement the read-only GitHub PRs page for every open `45s/coinzilla` pull request, current head-commit committer timestamps and browser-local work labels. The active behavior contract and scenarios live in [the GitHub PR Dashboard feature folder](docs/features/github-pr-dashboard/SPEC.md). The documentation-only specification task is complete in [Issue #1816](https://github.com/45s/coinzilla/issues/1816) and merged [PR #1817](https://github.com/45s/coinzilla/pull/1817); application implementation is tracked by [Issue #1821](https://github.com/45s/coinzilla/issues/1821) and review [PR #1822](https://github.com/45s/coinzilla/pull/1822). The page uses public read-only GitHub REST, with no GitHub mutations or credentials; custom labels remain in browser localStorage.

- **Complete in merged Dashboard PR [#1812](https://github.com/45s/coinzilla/pull/1812), tracked by [#1811](https://github.com/45s/coinzilla/issues/1811); realtime follow-up #1813 remains separate.** The live Bots workspace provides Harvester runtime/strategy-mode visibility, market enablement/readiness, Portfolio positions and confirmation-gated BUY pause controls. Runtime/market/Portfolio snapshots use the versioned local WebSocket stream with monotonic revisions, race-safe initial synchronization, explicit unavailable/stale states and bounded reconnect backoff. Confirmed BUY commands use the existing HTTP operator facade. Per-strategy registration state and per-Position strategy attribution remain unavailable and are not inferred.

- **Complete in merged Dashboard PR [#1737](https://github.com/45s/coinzilla/pull/1737), tracked by [#1736](https://github.com/45s/coinzilla/issues/1736):** make Exchanges searchable/filterable with persistent favourites pinned first; add a separate live Open Orders page grouped by connected CEX/provider; stream initial and refreshed account/order snapshots from Harvester over WebSocket only. The two pages make no HTTP requests. Existing persisted trading-history and Operator workflows remain unchanged.

- **Selectable dashboard themes complete in merged [PR #1686](https://github.com/45s/coinzilla/pull/1686), tracked by [#1685](https://github.com/45s/coinzilla/issues/1685):** preserve the existing Emerald appearance as default; add Midnight Terminal, Clean Light, OLED / Neon, Green Terminal, Arctic, and Warm Graphite palettes plus System mode, with browser-local preference persistence. No operator or trading behavior changes.

- **Market Screener complete in merged [PR #1661](https://github.com/45s/coinzilla/pull/1661), tracked by [#1660](https://github.com/45s/coinzilla/issues/1660):** Bitunix Futures is the default working source; Bitunix Spot, Binance Futures, and Binance Spot remain unavailable placeholders. The backend reads public Bitunix contract/ticker REST resources and the Dashboard displays native fields only, passes through Bitunix's native rolling 24h ticker percentage, keeps absent 5m/1h/4h windows N/A, and stores per-source favourites in browser cookies. No local movement calculations, exchange credentials, or trading-provider admission.
- **Read-only trading-history pages complete in merged [PR #1636](https://github.com/45s/coinzilla/pull/1636), tracked by [#1634](https://github.com/45s/coinzilla/issues/1634):** Orders, Fills, and Commissions pages backed by Harvester's unauthenticated loopback-only versioned API, backend-selected environment, filters, bounded pagination, record details, readable exchange references, distinct limit/execution/fee-valuation labels, nullable fill-order links, explicit connection/error/empty states, and frontend regression tests.
- **Complete in merged [PR #1641](https://github.com/45s/coinzilla/pull/1641), tracked by [#1643](https://github.com/45s/coinzilla/issues/1643):** local WebSocket invalidation notifications for persisted order, fill, and commission changes; live/reconnecting/offline UI status; bounded reconnect backoff; and REST snapshot reconciliation after every successful socket connection. REST remains the source of truth. Notifications are best-effort and are not durable replay.
- **Operator workspace runtime integration complete in merged [PR #1654](https://github.com/45s/coinzilla/pull/1654):** the Dashboard Operator page and typed client already exist; this PR wires the running Harvester's composed operator facade into the loopback API. The API remains unauthenticated and loopback-only under the explicitly approved local-development exception.
- [x] Initialize the Angular + TypeScript workspace, responsive shell, Overview screen, demo-only view models, tests and repository ownership/CI registration.
- [x] Generate and commit the pnpm lockfile after local dependency installation.
- [x] Verify the Angular production build and tests through GitHub Actions on the exact task PR head.

## Future capability areas

These are planning areas, not commitments to bypass backend ownership or existing trading safety requirements:

- Authenticated, typed, read-only integration for positions and service diagnostics.
- Environment-aware TESTNET/LIVE presentation with explicit backend-reported state and readiness.
- Searchable diagnostics views backed by server APIs.
- Order-entry and operator-control workflows only after the backend exposes authorized endpoints that use existing Harvester application use cases.
- Optional desktop packaging with Tauri after the web application and its API contracts are stable.

## Constraints

- Keep the browser a presentation/client layer; no direct database, broker or exchange integration.
- Keep feature modules independently testable and avoid introducing a global state framework before multiple features need shared state.
- Keep mock/demo fixtures clearly separated from production API models.
- Update this roadmap when the issue scope or delivered milestone changes. Do not use it as a chronological task log.

## Strategy-neutral Scenario Runner — issue #1836

Open Draft [PR #1837](https://github.com/45s/coinzilla/pull/1837) delivers the Dashboard presentation slice for the strategy-neutral production-flow Scenario Runner. Keep all scenario validation, orchestration, run contracts, traces and debug-package construction in framework-independent core/application modules; Angular components remain adapters only. All six required workflows passed on exact head `cdeef1ab862f08bf0ed1e724acd8f765cf21e9dd`, but the branch is 111 commits ahead / 42 behind current `develop` and must be synchronized. The MVP is not complete: replay/trace/export evidence, configuration/market metadata, reconnect/history behavior and verified OS-level process isolation remain acceptance gates. Do not register the RS adapter as executable or enable exchange/production access before those gates pass.
