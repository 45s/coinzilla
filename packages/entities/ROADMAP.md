# Entities roadmap

**Owner:** Entities domain
**Scope:** `packages/entities/`

## Active direction

- Preserve canonical financial, broker, order, execution, and event contracts. Treat compatibility and serialization as correctness requirements.
- Keep entities exchange-neutral; exchange-specific behavior belongs in broker adapters.
- Keep validation and shared helpers aligned with the canonical [shared utility policy](../../docs/engineering/SHARED_UTILITIES_POLICY.md); avoid restoring removed utility APIs or duplicating validation logic.
- Extend contracts only when a real consumer requires a documented field or behavior. Add consumer-facing regression tests for contract changes.
- Continue package maintenance and lint/test compliance; defer speculative entities and broad refactors.

## Active task\n\n- [ ] Migrate Coin and Order normalization to the accurately named `trimAndUppercase` utility; preserve existing uppercase normalization and whitespace handling. Tracked by [issue #1598](https://github.com/45s/coinzilla/issues/1598).\n\n## Canonical sources

- Contract and package usage: [README](./README.md)
- Current interfaces, schemas, and tests: package source
- Task status and consumer requirements: GitHub Issues/PRs

Detailed prior execution plan, FR-009–FR-016 contract notes, and completed maintenance history are preserved in [ROADMAP_HISTORY_2026-11-26.md](../../docs/archive/roadmap-history-2026-11-26.md#entities-roadmap).
