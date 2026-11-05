# Database package instructions

This directory is owned by the **Database Infrastructure domain**. Read the repository-root `AGENTS.md`, `ENGINEERING_STANDARDS.md`, and `AI_AGENT_WORKFLOW.md` before working here.

## Ownership

Owned path: `packages/db/**`.

This package owns provider-neutral database lifecycle/transaction boundaries and concrete database infrastructure adapters when a provider is deliberately selected.

Roadmap: [`ROADMAP.md`](./ROADMAP.md).

Bounded contexts own their domain models, aggregate invariants, and repository interfaces. Do not move domain repository contracts into this package merely to centralize persistence. Do not let domain/application policy import database drivers, SQL, collection APIs, ORM models, or provider sessions.

## Architecture rules

- Keep the public entry point thin and export only intentional contracts.
- Keep provider-specific implementation behind adapters; do not select a database engine before a real consumer requirement and explicit architecture decision exist.
- Do not build generic CRUD, table/collection, ORM, schema, migration, or query abstractions without demonstrated consumers.
- Keep the transaction context opaque in this package; provider adapters own begin/commit/rollback semantics.
- Fail explicitly when a provider cannot satisfy an advertised transaction guarantee.
- Prefer Node.js built-ins and existing workspace capabilities; do not add a driver or ORM dependency speculatively.
- Keep tests deterministic and offline. Use fake adapters for lifecycle/contract tests; provider integration tests are separate and opt-in.
- Apply strict RED → GREEN → REFACTOR to every behavior change.

## Workflow and verification

Follow [the mandatory AI-agent workflow](../../AI_AGENT_WORKFLOW.md) for task branches, PRs, synchronization, merge gates, and cleanup.

Required checks:
- `pnpm --filter @coinzilla/db test`
- `pnpm --filter @coinzilla/db test:coverage`
- Applicable workspace tests and repository checks.
