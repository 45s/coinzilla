# Dashboard application instructions

This file adds Dashboard-specific constraints. Repository-wide engineering, task, documentation, module-boundary, testing and branch requirements remain defined by the canonical documents linked from the root [AGENTS.md](../../AGENTS.md).

## Ownership

- This domain owns the Angular web application under `apps/dashboard/`, its UI state, view models, typed API client contracts, frontend tests and application documentation.
- The dashboard is a client of backend application APIs. It does not own trading decisions, exchange integration, database persistence, or Harvester runtime lifecycle.
- Keep Harvester strategy and operator behavior in `apps/harvester/`; keep broker protocol behavior in `packages/brokers/`; keep persistence mechanics in `packages/db/`.
- Do not import Harvester private source files, connect directly to SQLite/database files, or call broker/exchange APIs from the browser.
- Future order and operator commands must go through authenticated backend endpoints that invoke existing application use cases and enforce the existing safety invariants. A UI affordance is never authorization to submit an order.

## Current implementation boundary

- Overview is a live, read-only Harvester workspace. It obtains API reachability and runtime status from the existing `/api/v1/trading/operator/status` endpoint and consumes validated runtime, configured-market and Portfolio snapshots from the existing `/api/v1/trading/events` WebSocket. It must not fall back to demo data or render fabricated health, runtime, market, Portfolio, valuation or performance values. Keep API reachability, runtime status, WebSocket connectivity and valid-snapshot freshness distinct; none implies exchange readiness or trading authorization. See the [Dashboard README](README.md#current-state) for the current user-facing contract and operational setup.
- Orders, Fills, and Commissions are read-only client pages backed by Harvester's authenticated, versioned `/api/v1` contract. They display persisted API responses only and never fall back to demo fixtures.
- Do not present mock values as live account, exchange, service-health, or trading-runtime observations.
- Keep the bearer token in browser `sessionStorage` only. Do not commit secrets, API credentials, production environment values, or user-specific configuration.
- Display TESTNET/LIVE from Harvester API metadata. Do not infer trading readiness from HTTP connectivity.
- Browser code must not access SQLite/database files, import Harvester-private modules, or call brokers/exchanges.
- The GitHub PRs page is a public, unauthenticated, read-only GitHub REST client. It must never send credentials or mutate GitHub; Dashboard-local labels stay in browser storage and are not GitHub labels.

## Development

Run commands from the repository root with the pinned pnpm version:

```sh
pnpm install
pnpm --filter @coinzilla/dashboard start
pnpm --filter @coinzilla/dashboard build
pnpm --filter @coinzilla/dashboard test
pnpm --filter @coinzilla/dashboard test:coverage
```

Use standalone Angular components, strict TypeScript/template checking, feature-oriented folders and colocated tests. Prefer Angular signals for local reactive state when state is introduced; avoid adding global state infrastructure until a real cross-feature requirement exists.

## Required reading

Before dashboard changes, read this roadmap, root [AGENTS.md](../../AGENTS.md), every applicable nested `AGENTS.md`, and the canonical standards for each affected owner. If scope expands into Harvester, Brokers, DB, authentication, API contracts, CI, or another owned domain, inspect that domain's instructions, roadmap, implementation, consumers and tests before proceeding.

## Framework-independent architecture and DDD — mandatory for all Dashboard work

- **UI-framework independence is a mandatory architectural rule.** Business logic, domain rules, use cases, application orchestration, validation, calculations, state transitions, scenario execution, graph/scenario transformation and business-facing contracts MUST NOT depend on Angular or any UI framework. This applies to every Dashboard task.
- Apply DDD and clean architecture for every task: isolate domain concepts/rules; use application/use-case orchestration; define ports/contracts at boundaries; implement framework, transport, persistence and UI adapters outside the domain/application core. Follow canonical repository standards.
- Angular components/directives/templates MUST be presentation adapters: render state, capture interaction and delegate. No business rules, scenario parsing/normalization, graph semantics, validation, calculations, runner logic, business state transitions, or workflow orchestration in components, templates or framework-bound stores/services.
- Keep business logic in plain TypeScript modules/classes/functions with no Angular imports, DI decorators, signals, RxJS framework bindings, DOM APIs or component types in domain/application core. Angular may adapt UI state/events at the boundary; core contracts remain framework-neutral.
- Prefer domain/application modules and ports; Angular-specific wiring belongs in adapters/composition. Unit-test domain/application behavior without Angular TestBed, rendering, browser or UI-framework dependencies wherever feasible.
- **Framework swap invariant:** replacing Angular with React, Vue, another UI framework or non-framework UI must require replacing/reworking presentation and framework adapters only. It MUST NOT require changing business/domain/application logic, scenario contracts, core tests or business behavior. Record and resolve any blocker to this invariant before implementation.
- Explicitly review dependency direction and framework leakage, and test core independently. Enforce the boundary with architecture tests/static checks where practical.

## Scenario Runner approved trading-service refactoring

For Strategy Scenario Runner implementation, trading logic and trading services may be refactored on its task branch as required to faithfully reuse the production flow. Preserve trading behavior and safety invariants; add regression tests, document changed paths, and verify all affected consumers. This does not authorize real trading actions.

## Repository workflow

Follow the root [AGENTS.md](../../AGENTS.md) and [AI_AGENT_WORKFLOW.md](../../AI_AGENT_WORKFLOW.md) for instruction discovery, branch freshness, PR targets and review/merge ownership. This file adds Dashboard-specific ownership and framework-independent architecture constraints only.
