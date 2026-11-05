# Database package instructions

This directory is owned by the **Database Infrastructure domain**. Read the repository-root `AGENTS.md`, `ENGINEERING_STANDARDS.md`, and `AI_AGENT_WORKFLOW.md` before working here.

## Ownership

Owned path: `packages/db/**`.

This package owns the built-in SQLite infrastructure, database lifecycle, SQL transaction boundary, and schema migration runner. The generic adapter lifecycle remains available for future database providers.

Roadmap: [`ROADMAP.md`](./ROADMAP.md).

This package's domain model owns only database-infrastructure concepts: database lifecycle and immutable migration identity/history. Business bounded contexts own their business domain models, aggregate invariants, and repository interfaces. Do not move business repository contracts into this package merely to centralize persistence. Do not let domain/application policy import SQLite drivers, SQL, database connections, statement objects, or provider sessions.

## Architecture rules

- Keep the public entry point thin and export only intentional contracts.
- Keep the dependency direction infrastructure → application → domain (dependencies point inward); do not add folders or wrappers that do not own meaningful policy.
- Model lifecycle invariants in the `Database` entity and immutable schema-change identity in the `Migration` entity; keep migration-history decisions in a pure domain service.
- Define provider capabilities at the application port; keep `node:sqlite` and SQL under `src/infrastructure/sqlite/`.
- Use Node.js built-in `node:sqlite`; do not add a third-party driver or ORM for SQLite.
- Keep SQL and SQLite-specific APIs in infrastructure adapters/repositories, not in domain policy.
- Use prepared statements and bound parameters for values.
- Enable foreign-key enforcement; keep file-backed journal mode and lock timeout behavior covered by tests.
- SQLite operations are synchronous. Transaction callbacks and migration functions must be synchronous; reject async callbacks rather than silently committing before awaited work.
- Keep each migration immutable after application. Add a new version instead of editing migration history.
- Fail explicitly on migration-history mismatch and transaction rollback failure.
- Do not build generic CRUD, ORM, schema-generation, or universal query abstractions without demonstrated consumers.
- Keep tests deterministic and offline. Use real in-memory SQLite and isolated temporary file databases; no network or credentials.
- Apply strict RED → GREEN → REFACTOR to every behavior change.

## Workflow and verification

Follow [the mandatory AI-agent workflow](../../AI_AGENT_WORKFLOW.md) for task branches, PRs, synchronization, merge gates, and cleanup.

Required checks:
- `pnpm --filter @coinzilla/db test`
- `pnpm --filter @coinzilla/db test:coverage`
- Applicable workspace tests and repository checks.
