# Dashboard application instructions

This file adds Dashboard-specific constraints. Repository-wide engineering, task, documentation, module-boundary, testing and branch requirements remain defined by the canonical documents linked from the root [AGENTS.md](../../AGENTS.md).

## Ownership

- This domain owns the Angular web application under `apps/dashboard/`, its UI state, view models, typed API client contracts, frontend tests and application documentation.
- The dashboard is a client of backend application APIs. It does not own trading decisions, exchange integration, database persistence, or Harvester runtime lifecycle.
- Keep Harvester strategy and operator behavior in `apps/harvester/`; keep broker protocol behavior in `packages/brokers/`; keep persistence mechanics in `packages/db/`.
- Do not import Harvester private source files, connect directly to SQLite/database files, or call broker/exchange APIs from the browser.
- Future order and operator commands must go through authenticated backend endpoints that invoke existing application use cases and enforce the existing safety invariants. A UI affordance is never authorization to submit an order.

## Current implementation boundary

- The initial dashboard is a static Angular shell populated only by explicitly named demo data.
- Do not present mock values as live account, exchange, service-health, or trading-runtime observations.
- Do not add secrets, API credentials, production environment values, or user-specific configuration to source control.
- Keep TESTNET/LIVE selection and readiness semantics explicit when real backend integration is introduced. Do not infer trading readiness from HTTP connectivity.

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

Before dashboard changes, read this roadmap and the applicable repository standards in the root [AGENTS.md](../../AGENTS.md). Re-run the task compliance preflight whenever the scope expands into Harvester, Brokers, DB, authentication, API contracts, CI, or another owned domain.
