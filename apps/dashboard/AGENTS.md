# Dashboard application instructions

This file adds Dashboard-specific constraints. Repository-wide engineering, task, documentation, module-boundary, testing and branch requirements remain defined by the canonical documents linked from the root [AGENTS.md](../../AGENTS.md).

## Ownership

- This domain owns the Angular web application under `apps/dashboard/`, its UI state, view models, typed API client contracts, frontend tests and application documentation.
- The dashboard is a client of backend application APIs. It does not own trading decisions, exchange integration, database persistence, or Harvester runtime lifecycle.
- Keep Harvester strategy and operator behavior in `apps/harvester/`; keep broker protocol behavior in `packages/brokers/`; keep persistence mechanics in `packages/db/`.
- Do not import Harvester private source files, connect directly to SQLite/database files, or call broker/exchange APIs from the browser.
- Future order and operator commands must go through authenticated backend endpoints that invoke existing application use cases and enforce the existing safety invariants. A UI affordance is never authorization to submit an order.

## Current implementation boundary

- Overview remains a static Angular preview populated only by explicitly named demo data.
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

Before dashboard changes, read this roadmap and the applicable repository standards in the root [AGENTS.md](../../AGENTS.md). Read the relevant nested ownership instructions before entering Harvester, Brokers, DB, authentication, API contracts, CI, or another owned domain.

## Framework-independent architecture and DDD — mandatory for all Dashboard work

- **UI-framework independence is a mandatory architectural rule.** Business logic, domain rules, use cases, application orchestration, validation, calculations, state transitions, scenario execution, graph/scenario transformation and business-facing contracts MUST NOT depend on Angular or any UI framework. This applies to every Dashboard task.
- Apply DDD and clean architecture for every task: isolate domain concepts/rules; use application/use-case orchestration; define ports/contracts at boundaries; implement framework, transport, persistence and UI adapters outside the domain/application core. Follow canonical repository standards.
- Angular components/directives/templates MUST be presentation adapters: render state, capture interaction and delegate. No business rules, scenario parsing/normalization, graph semantics, validation, calculations, runner logic, business state transitions, or workflow orchestration in components, templates or framework-bound stores/services.
- Keep business logic in plain TypeScript modules/classes/functions with no Angular imports, DI decorators, signals, RxJS framework bindings, DOM APIs or component types in domain/application core. Angular may adapt UI state/events at the boundary; core contracts remain framework-neutral.
- Prefer domain/application modules and ports; Angular-specific wiring belongs in adapters/composition. Unit-test domain/application behavior without Angular TestBed, rendering, browser or UI-framework dependencies wherever feasible.
- **Framework swap invariant:** replacing Angular with React, Vue, another UI framework or non-framework UI must require replacing/reworking presentation and framework adapters only. It MUST NOT require changing business/domain/application logic, scenario contracts, core tests or business behavior. Record and resolve any blocker to this invariant before implementation.
- Explicitly review dependency direction and framework leakage, and test core independently. Enforce the boundary with architecture tests/static checks where practical.


## Trading logic/services refactoring for approved Scenario Runner work

For Scenario Runner tasks, trading logic and services may be refactored as required to reuse the exact production path faithfully. Preserve real-trading behavior and safety; add regression tests, document affected behavior and keep simulation side effects isolated. This permission applies only to the task scope and does not authorize real trading actions.

## Mandatory agent preflight — before any work

Every AI agent MUST read repository-root `AGENTS.md` and all applicable nested `AGENTS.md` files before exploring or editing code. Issue, PR and roadmap instructions must repeat this requirement. Follow the workflow and re-read affected instructions when scope expands.
