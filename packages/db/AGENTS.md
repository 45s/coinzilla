# Database package instructions

This directory is owned by the **Database Infrastructure domain**. Read the repository-root `AGENTS.md`, `ENGINEERING_STANDARDS.md`, and `AI_AGENT_WORKFLOW.md` before working here.

## Ownership

Owned path: `packages/db/**`.

This package owns provider-neutral database lifecycle, record CRUD/query contracts, transaction boundaries, concrete provider adapters, and the SQLite schema migration runner.

Roadmap: [`ROADMAP.md`](./ROADMAP.md).  
Architecture decisions: [`docs/README.md`](./docs/README.md).

The package domain may model only generic database infrastructure concepts: record identity/shape, query semantics, provider capabilities, error classification, lifecycle, transactions, and immutable migration identity/history. Business bounded contexts own their business domain models, aggregate invariants, schemas, and repository interfaces. Never place application-specific business entities, repositories, or schemas in this package.

## Architecture rules

- Keep the public entry point thin and export only intentional contracts.
- Keep dependency direction infrastructure → application → domain (dependencies point inward); do not add folders or wrappers that do not own meaningful policy.
- Domain owns provider-independent record/query contracts, database error classification, lifecycle invariants, migration identity, and pure query/record validation.
- Application owns provider-neutral CRUD orchestration and provider composition.
- Infrastructure owns concrete provider adapters. Keep `node:sqlite`, SQL, prepared statements, driver objects, and provider-native errors under `src/infrastructure/sqlite/`.
- Use Node.js built-in `node:sqlite`; do not add a third-party SQLite driver or ORM.
- Generic CRUD is an approved package responsibility. Define behavior once in provider-neutral contracts and require every provider to satisfy the same applicable conformance tests.
- Keep the public record API simple. Do not create an ORM, chainable query builder, schema generator, or application-specific repository abstraction.
- The initial record model is a JSON object with a non-empty string `id`, stored in a named collection. Query filters are exact equality on top-level scalar fields; sorting and pagination use the documented portable contract.
- Provider-specific configuration belongs at the outer composition boundary. Consumers of the composed database must not branch on provider identity.
- Declare provider capabilities explicitly. Do not silently emulate unsupported query, transaction, concurrency, or durability guarantees.
- Keep SQL and SQLite-specific APIs out of domain and application policy.
- Use prepared statements and bound parameters for all SQL values.
- Enable foreign-key enforcement; keep file-backed journal mode and lock timeout behavior covered by tests.
- SQLite operations are synchronous. Transaction callbacks and migration functions must be synchronous; reject async callbacks rather than silently committing before awaited work.
- Keep each migration immutable after application. Add a new version instead of editing migration history.
- Fail explicitly on migration-history mismatch and transaction rollback failure.
- Keep tests deterministic and offline. Use real in-memory SQLite and isolated temporary file databases; no network or credentials.
- Apply strict RED → GREEN → REFACTOR to every behavior change.

## Workflow and verification

Follow [the mandatory AI-agent workflow](../../AI_AGENT_WORKFLOW.md) for task branches, PRs, synchronization, merge gates, and cleanup.

Required checks:

- `pnpm --filter @coinzilla/db test`
- `pnpm --filter @coinzilla/db test:coverage`
- `pnpm lint`
- `pnpm run check:agent-policy`
- Applicable workspace tests and repository checks.
