# Dashboard application roadmap

**Owner:** Dashboard application
**Tracking:** [Issue #1623](https://github.com/45s/coinzilla/issues/1623)

## Active dashboard priorities

- **Scenario Runner / GC Strategy Lab:** active production-flow work is tracked in [#1836](https://github.com/45s/coinzilla/issues/1836) and the [dedicated feature roadmap](./docs/features/gc-strategy-lab/RUNNER_ROADMAP.md). Foundation [PR #1837](https://github.com/45s/coinzilla/pull/1837) is merged, but the full production adapter/catalogue and trusted OS-level sandbox launcher remain incomplete; keep execution fail-closed.
- **Operator-console/full-record inspection:** Dashboard foundation issue [#1623](https://github.com/45s/coinzilla/issues/1623) is closed by [PR #1627](https://github.com/45s/coinzilla/pull/1627) and does not track a persisted Orders/Fills/Commissions inspection feature. No matching open Dashboard issue was found. Do not present this as active work until it has a dedicated issue; when scoped, render persisted fields from the authoritative backend/API rather than demo-only view models.
- Keep backend/API integration authoritative. Do not add UI-only pause state or call exchange APIs from the browser.

## Canonical sources

- Dashboard behavior and setup: [README](./README.md)
- Feature-specific Scenario Runner implementation and decisions: [Scenario Runner roadmap](./docs/features/gc-strategy-lab/RUNNER_ROADMAP.md)
- Current task state: linked GitHub issues and PRs

Detailed prior roadmap, including completed design decisions and historical runner notes, is preserved in [ROADMAP_HISTORY_2026-11-26.md](../../docs/archive/roadmap-history-2026-11-26.md#dashboard-roadmap).
