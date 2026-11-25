# Dashboard application roadmap

**Owner:** Dashboard application
**Scope:** `apps/dashboard/`
**Tracking:** [Issue #1623](https://github.com/45s/coinzilla/issues/1623)

- **Next — full record inspection and operator-console hardening:** show every persisted key/value (including nested data) for Orders, Fills, and Commissions; harden the existing local Operator workspace and its backend integration. Do not implement UI-only pause state or call exchange APIs from the browser.

## Current milestone

- **Strategy-neutral Scenario Runner — executable RS MVP** ([Issue #1836](https://github.com/45s/coinzilla/issues/1836), [PR #1837](https://github.com/45s/coinzilla/pull/1837)): build one reusable runner for every strategy family with properly defined executable scenarios. RS is the first adapter because its scenario registry exists; it is not the runner's scope boundary. MVP must let users select strategy/market/scenario, edit schema-driven strategy configuration, execute the exact production functions/use cases in an isolated runtime, replace broker/market side effects with simulation adapters, inspect actual assertions/results/trace and compare expected vs actual. Future adapters may cover Generic/GC Conservative and Aggressive, futures and grid strategies. DDD/framework-independent core is mandatory; Angular is presentation only. **Approved execution ownership:** Harvester hosts the isolated simulation runtime and invokes production use cases; Dashboard submits typed requests and renders returned results/trace through a framework-independent contract. No browser imports of private Harvester modules, real broker/exchange access, credentials, live orders or production mutation. Specification: [feature folder](docs/features/gc-strategy-lab/SPEC.md).


- **In progress — GitHub PR Dashboard:** implement the read-only GitHub PRs page for every open `45s/coinzilla` pull request, current head-commit committer timestamps and browser-local work labels. The active behavior contract and scenarios live in [the GitHub PR Dashboard feature folder](docs/features/github-pr-dashboard/SPEC.md). The documentation-only specification task is complete in [Issue #1816](https://github.com/45s/coinzilla/issues/1816) and merged [PR #1817](https://github.com/45s/coinzilla/pull/1817); application implementation is tracked by [Issue #1821](https://github.com/45s/coinzilla/issues/1821) and review [PR #1822](https://github.com/45s/coinzilla/pull/1822). The page uses public read-only GitHub REST, with no GitHub mutations or credentials; custom labels remain in browser localStorage.

- **In progress in Dashboard PR [#1812](https://github.com/45s/coinzilla/pull/1812), tracked by [#1811](https://github.com/45s/coinzilla/issues/1811) and realtime follow-up [#1813](https://github.com/45s/coinzilla/issues/1813):** add a separate live Bots workspace for Harvester runtime/strategy-mode visibility, market enablement/readiness, Portfolio positions and confirmation-gated BUY pause controls. Runtime/market/Portfolio snapshots use the existing versioned local WebSocket stream with monotonic revisions, race-safe initial synchronization, explicit unavailable/stale states, and bounded reconnect backoff. Confirmed BUY commands still use the existing HTTP operator facade. Per-strategy registration state and per-Position strategy attribution remain unavailable in the current read models and are not inferred.

- **Complete in merged Dashboard PR [#1737](https://github.com/45s/coinzilla/pull/1737), tracked by [#1736](https://github.com/45s/coinzilla/issues/1736):** make Exchanges searchable/filterable with persistent favourites pinned first; add a separate live Open Orders page grouped by connected CEX/provider; stream initial and refreshed account/order snapshots from Harvester over WebSocket only. The two pages make no HTTP requests. Existing persisted trading-history and Operator workflows remain unchanged.

- **Selectable dashboard themes complete in merged [PR #1686](https://github.com/45s/coinzilla/pull/1686), tracked by [#1685](https://github.com/45s/coinzilla/issues/1685):** preserve the existing Emerald appearance as default; add Midnight Terminal, Clean Light, OLED / Neon, Green Terminal, Arctic, and Warm Graphite palettes plus System mode, with browser-local preference persistence. No operator or trading behavior changes.

- **Market Screener complete in merged [PR #1661](https://github.com/45s/coinzilla/pull/1661), tracked by [#1660](https://github.com/45s/coinzilla/issues/1660):** Bitunix Futures is the default working source; Bitunix Spot, Binance Futures, and Binance Spot remain unavailable placeholders. The backend reads public Bitunix contract/ticker REST resources and the Dashboard displays native fields only, passes through Bitunix's native rolling 24h ticker percentage, keeps absent 5m/1h/4h windows N/A, and stores per-source favourites in browser cookies. No local movement calculations, exchange credentials, or trading-provider admission.
- **Read-only trading-history pages complete in merged [PR #1636](https://github.com/45s/coinzilla/pull/1636), tracked by [#1634](https://github.com/45s/coinzilla/issues/1634):** Orders, Fills, and Commissions pages backed by Harvester's unauthenticated loopback-only versioned API, backend-selected environment, filters, bounded pagination, record details, readable exchange references, distinct limit/execution/fee-valuation labels, nullable fill-order links, explicit connection/error/empty states, and frontend regression tests.
- **Complete in merged [PR #1641](https://github.com/45s/coinzilla/pull/1641), tracked by [#1643](https://github.com/45s/coinzilla/issues/1643):** local WebSocket invalidation notifications for persisted order, fill, and commission changes; live/reconnecting/offline UI status; bounded reconnect backoff; and REST snapshot reconciliation after every successful socket connection. REST remains the source of truth. Notifications are best-effort and are not durable replay.
- **Operator workspace runtime integration complete in merged [PR #1654](https://github.com/45s/coinzilla/pull/1654):** the Dashboard Operator page and typed client already exist; this PR wires the running Harvester's composed operator facade into the loopback API. The API remains unauthenticated and loopback-only under the explicitly approved local-development exception.
- [x] Initialize the Angular + TypeScript workspace, responsive shell, Overview screen, demo-only view models, tests and repository ownership/CI registration.
- [x] Generate and commit the pnpm lockfile after local dependency installation.
- [x] Verify the Angular production build and tests through GitHub Actions on the exact task PR head.

## Mandatory Dashboard architecture

All Dashboard feature work must follow DDD/clean architecture and keep business/domain/application logic independent of Angular or any UI framework. Framework replacement must require changes to presentation/adapters only, never business logic. See [Dashboard AGENTS.md](AGENTS.md).

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


**Approved simulation isolation:** scenario execution runs in a dedicated worker process managed by Harvester, separate from the live trading process. Each run gets fresh isolated state and simulated infrastructure only; no credentials, production persistence/live state or real broker fallback. Timeouts, resource/concurrency limits, cleanup and fail-closed behavior are required.

## Approved transport decision — REST API + WebSocket (2026-11-25)

The Dashboard-to-Harvester Scenario Runner transport is **REST API + WebSocket**. REST is the command/query interface for submitting a scenario run, retrieving run status/results and diagnostics, requesting cancellation, and inspecting run details/history where supported. WebSocket carries server-pushed run lifecycle/progress and execution updates, including terminal completion/failure notifications. The asynchronous run-job contract remains transport-independent: Dashboard receives a run identifier and lifecycle state, then observes updates and retrieves authoritative results from Harvester.

The transport is an adapter, not a business layer. Domain/application contracts and use cases must not depend on HTTP, WebSocket APIs, Angular, RxJS or browser APIs. Keep request/event DTOs typed and versionable; define reconnect/resubscription and missed-update recovery so REST status/result retrieval remains authoritative if a WebSocket connection drops. Do not introduce GraphQL, gRPC or a message broker for the initial implementation without a demonstrated requirement.
