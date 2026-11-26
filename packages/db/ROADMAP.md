# Database roadmap

**Owner:** Database Infrastructure  
**Scope:** `packages/db/`

## Current position

- Application-owned relational schema infrastructure ([#1486](https://github.com/45s/coinzilla/issues/1486), [PR #1489](https://github.com/45s/coinzilla/pull/1489)) is merged.
- SQLite infrastructure audit and hardening ([#1395](https://github.com/45s/coinzilla/issues/1395), [PR #1396](https://github.com/45s/coinzilla/pull/1396)) is merged.
- Provider-neutral CRUD and SQLite backup/restore primitives are implemented; preserve their public contracts and existing failure semantics.

## Active maintenance

- Keep schema ownership with consuming applications; this package supplies infrastructure, not application-specific schema or trading policy.
- Maintain lifecycle, transaction, concurrency, backup/restore, and filesystem error regression coverage when behavior changes.
- Add provider capabilities only for a concrete consumer contract; do not expand abstractions speculatively.

## Canonical sources

- Package contract and usage: [README](./README.md)
- Public API and implementation: package source and tests
- Task status: GitHub Issues/PRs

The previous detailed delivery record and contract notes are preserved in [ROADMAP_HISTORY_2026-11-26.md](../../docs/archive/roadmap-history-2026-11-26.md#database-roadmap).
