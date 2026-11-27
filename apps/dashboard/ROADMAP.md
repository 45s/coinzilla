# Dashboard application roadmap

**Owner:** Dashboard application
**Last reviewed:** 2026-11-27
**Tracking:** [Issue #1623](https://github.com/45s/coinzilla/issues/1623)

## Active dashboard priorities

- **Live Harvester API connectivity:** [#1953](https://github.com/45s/coinzilla/issues/1953) / [PR #1954](https://github.com/45s/coinzilla/pull/1954) addresses dynamic local Dashboard origins and keeps runtime/operator/market/provider snapshots live when relational history persistence is unavailable. Persisted-history pages remain explicitly unavailable (HTTP 503) until the database is healthy; the database root cause remains in [#1854](https://github.com/45s/coinzilla/issues/1854).
- **Scenario Runner / GC Strategy Lab:** active production-flow work is tracked in [#1836](https://github.com/45s/coinzilla/issues/1836) and the [dedicated feature roadmap](./docs/features/gc-strategy-lab/RUNNER_ROADMAP.md). Foundation [PR #1837](https://github.com/45s/coinzilla/pull/1837) is merged into `develop`; the full production adapter/catalogue and trusted OS-level sandbox launcher remain incomplete. Keep execution fail-closed.
- Keep backend/API integration authoritative. Do not add UI-only pause state or call exchange APIs from the browser.

## Recently completed

- **Live Overview workspace:** [#1945](https://github.com/45s/coinzilla/issues/1945) completed in [PR #1947](https://github.com/45s/coinzilla/pull/1947). Overview now shows read-only Harvester API health plus authoritative runtime, configured-market and Portfolio snapshots. Total account valuation and historical equity performance remain unavailable because the current read model does not expose them.

## Deferred / not currently tracked

- **Operator-console/full-record inspection:** Dashboard foundation issue [#1623](https://github.com/45s/coinzilla/issues/1623) is closed by [PR #1627](https://github.com/45s/coinzilla/pull/1627) and does not track a persisted Orders/Fills/Commissions inspection feature. No matching open Dashboard issue was found. Do not present this as active work until it has a dedicated issue; when scoped, render persisted fields from the authoritative backend/API rather than demo-only view models.

## Canonical sources

- Dashboard behavior and setup: [README](./README.md)
- **Scenario Runner implementation progress:** PR #1887 adds under-target FILLED SELL reconciliation, STOP-persistence failure handling, and BUY-only STOP admission coverage. The full production RS adapter and trusted OS-level sandbox launcher remain incomplete; execution stays fail-closed.
- Feature-specific Scenario Runner implementation and decisions: [Scenario Runner roadmap](./docs/features/gc-strategy-lab/RUNNER_ROADMAP.md)
- Current task state: linked GitHub issues and PRs

Detailed prior roadmap, including completed design decisions and historical runner notes, is preserved in [ROADMAP_HISTORY_2026-11-26.md](../../docs/archive/roadmap-history-2026-11-26.md#dashboard-roadmap).
