# Dashboard application roadmap

**Owner:** Dashboard application
**Scope:** `apps/dashboard/`
**Tracking:** [Issue #1623](https://github.com/45s/coinzilla/issues/1623)

- **Next — full record inspection and operator-console hardening:** show every persisted key/value (including nested data) for Orders, Fills, and Commissions; harden the existing local Operator workspace and its backend integration. Do not implement UI-only pause state or call exchange APIs from the browser.

## Current milestone

- **Strategy-neutral Scenario Runner — RS-first implementation in progress** ([Issue #1836](https://github.com/45s/coinzilla/issues/1836), [PR #1837](https://github.com/45s/coinzilla/pull/1837)): generic lifecycle/process-worker scaffolding, REST lifecycle routes, WebSocket notifications, a Dashboard page, framework-independent trace graph and debug-package core have been added. The RS-004-011 profitability helper is preliminary scaffolding only; it is not a complete production scenario. **No scenario is currently exposed as executable by the host.** The host fails closed until a strategy adapter invokes the full production RS use-case flow with verified simulation-only infrastructure. Dashboard now delegates catalog/history/run validation/submission/cancellation/refresh/trace and debug-package orchestration to a framework-independent application module; Angular remains a thin presentation and transport adapter. Full RS registry and production-flow adapter coverage, schema-driven configuration/Playground, complete trace/assertions, bounded history, exact replay, debug-package completeness, broader isolation and end-to-end acceptance remain outstanding. Runner architecture is strategy-neutral; Angular remains replaceable presentation. [Specification](docs/features/gc-strategy-lab/SPEC.md) and [phased roadmap](docs/features/gc-strategy-lab/RUNNER_ROADMAP.md).

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

## Approved Scenario Runner lifecycle decision — 2026-11-25

Scenario execution uses explicit server-owned states: Accepted/Queued → Starting → Running, with Cancelling as a non-terminal shutdown state and terminal outcomes Completed, Failed, Cancelled, Timed out or Blocked. Cancellation is cooperative first, followed by forced worker termination after a configurable grace period. Repeated cancellation is idempotent; a cancelled run is never reported as passed/completed. Timeouts remain distinct from user cancellation. Preserve partial trace/diagnostics when safely available, fail closed if worker initialization/isolation cannot be verified, and release resources on every terminal path. WebSocket publishes state changes; REST remains authoritative after reconnect. Numeric timeouts/grace periods and OS-level termination/cleanup details require implementation audit.

## Approved Scenario Runner result retention and AI-debug report — 2026-11-25

Harvester persists bounded server-side run history with configurable retention/size limits. The persisted simulation-only evidence includes run identity/status/lifecycle, strategy/scenario and code versions, effective configuration and inputs, ordered events, outputs, steps/decisions/trace, assertions and diagnostics. Scenario-definition storage is separate. Secrets, credentials, live account data and production state are excluded.

Dashboard provides **Copy AI Debug Package** for an inspectable run: one self-contained, versioned JSON document with complete available inputs, outputs, statuses, events, steps, decisions, assertions, diagnostics and provenance, suitable for AI agents. It identifies the executed production revision (not merely the target branch), strategy/adapter, scenario/scenarioId and runId. Never silently truncate; offer a complete export or segmented-copy fallback if clipboard constraints prevent full copy. Report generation remains framework-independent; Angular is presentation only.

## Approved Scenario Runner AI-debug and access decisions — 2026-11-25

The AI Debug Report is self-contained as complete execution evidence, not as a copy of the source repository/docs. It must stand alone without the original server run. Repository access is explicitly permitted for faster, deeper debugging: use the report's executed revision and scenario provenance to audit matching production source, architecture/specification docs, scenario definitions and mapped tests; establish why/how the scenario should behave; compare that intended behavior with captured trace/results; and cite exact source files/lines/tests. Do not confuse expected behavior with observed execution.

The initial runner is unauthenticated and **strictly loopback-only for local development**. Do not expose it on LAN, public or remote interfaces. Remote/shared access is blocked until authentication and server-side authorization are designed and implemented. Actual bind enforcement and existing local API integration require implementation audit.

## Scenario Runner — RS configuration unit and replay clarification (2026-11-25)

Documentation must use actual RS config fields/values and explicit units. For every RS market, `minProfit: 0.01` means **0.01 units of that market's quote asset as absolute net profit, never 1%**. For the LINEAUSDT TESTNET example this is 0.01 USDT (one USDT cent); `priceStepPercent: 0.5` is a 0.5% price-step setting. Distinguish base quantities (LINEA), quote amounts (USDT), percentages and derived values. Do not invent standalone average-entry inputs; derive legacy average cost from configured legacy basis and label it as derived. Market prices and simulated broker outcomes are ordered scenario events, sourced from existing scenario/test evidence or explicitly authored and validated—not fabricated as configuration.

Approved replay scope is original-version replay only: execute the original scenario against its exact recorded production revision and original inputs/configuration. Newer-revision regression comparison is not currently in scope.

**Universal RS rule:** `minProfit` is an absolute net-profit amount in the selected market's quote asset for every RS market. `0.01` always means 0.01 quote-asset units, never 1%; the LINEAUSDT/USDT-cent example above is illustrative only.

## Approved Scenario Runner Playground decisions (2026-11-25)

Original scenario replay uses the exact recorded production revision and original scenario/configuration/inputs. The Playground creates a temporary run-local copy where users can change market and strategy configuration; edits never modify or save over the original scenario.

Configuration loaded from a file and configuration entered in the client Playground must pass through the same production parsing, validation, normalization and market-metadata resolution. Strategy code receives validated effective configuration and cannot distinguish its source. Invalid configuration blocks execution before strategy evaluation.

The UI action is **Copy AI Debug Package** and copies complete versioned JSON only, including original scenario, temporary overrides, validated effective configuration, executed revision, ordered events, results, trace and diagnostics. Repository access at the recorded revision is expected for deeper AI-agent debugging.

## Scenario Runner roadmap
See [the phased implementation roadmap](docs/features/gc-strategy-lab/RUNNER_ROADMAP.md). Within the approved Scenario Runner task, trading logic and services may be refactored as required for faithful production-flow reuse on the task branch. Preserve real trading behavior and safety invariants, add regression tests, document changed paths and inspect affected consumers. This does not authorize unrelated trading changes or real exchange operations.

### Strategy Scenario Runner agent rules

Before exploration or edits, agents MUST read root `AGENTS.md` and all applicable nested `AGENTS.md`. This requirement is stated in Issue #1836, PR #1837 and the Runner roadmap. Trading logic/services may be refactored as needed to faithfully reuse production flows; preserve trading safety and behavior, add regression tests, and stay exclusively on the task branch/PR. Never commit directly to `develop`/`main` or merge/auto-merge.
