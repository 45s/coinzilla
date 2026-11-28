# Dashboard application roadmap

**Owner:** Dashboard application
**Last reviewed:** 2026-11-27
**Tracking:** [Issue #1623](https://github.com/45s/coinzilla/issues/1623)

## Active dashboard priorities

- **Live Harvester API connectivity:** [#1953](https://github.com/45s/coinzilla/issues/1953) / [PR #1961](https://github.com/45s/coinzilla/pull/1961) addresses dynamic local Dashboard origins and keeps runtime/operator/market/provider snapshots live when relational history persistence is unavailable. Persisted-history pages remain explicitly unavailable (HTTP 503) until the database is healthy; the database root cause remains in [#1854](https://github.com/45s/coinzilla/issues/1854).
- **Scenario Runner / GC Strategy Lab:** active production-flow work is tracked in [#1836](https://github.com/45s/coinzilla/issues/1836) and the [dedicated feature roadmap](./docs/features/gc-strategy-lab/RUNNER_ROADMAP.md). Foundation [PR #1837](https://github.com/45s/coinzilla/pull/1837) is merged into `develop`; the full production adapter/catalogue and trusted OS-level sandbox launcher remain incomplete. Keep execution fail-closed.
- Keep backend/API integration authoritative. Do not add UI-only pause state or call exchange APIs from the browser.

## Scenario flow visualization — 2026-11-28

The Scenario Runner uses the selected scenario's source-reviewed guide as its read-only expected-flow representation. Actual execution status and trace evidence remain a separate view and are never inferred from the expected path. No scenario editor, authoring schema, graph persistence or graph execution is in scope. Scenarios without a published guide are explicitly marked unavailable.

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

## Scenario Runner GitHub catalogue refresh — 2026-11-28

Issue [#1986](https://github.com/45s/coinzilla/issues/1986) adds an explicit checkbox to load a read-only Recovery Seller scenario metadata snapshot from the current `develop` commit without restarting Harvester. The snapshot is pinned to one immutable commit SHA and cannot authorize execution; unchecking restores the live Harvester catalogue. GitHub source text is parsed as metadata only and is never evaluated. See the Scenario Runner roadmap for the trust boundary.

## Scenario Runner run-detail presentation — 2026-11-28

The Dashboard Scenario Runner now has an evidence-linked visual run story in PR [#1983](https://github.com/45s/coinzilla/pull/1983), tracked by [issue #1982](https://github.com/45s/coinzilla/issues/1982). The implementation extends the existing framework-independent Scenario Runner application and Angular presentation rather than adding a second runner.

The view keeps execution, assertions, trading lifecycle, accounting/cycle, safety and provenance separate. It exposes individual assertion expected/actual values, source-linked order/decision/cycle evidence, multiple order lifecycles and repeated cycle states. It provides a selectable ordered trace, explicit source-declared branches, per-step source evidence, a recursive JSON tree, search, copy and export. The supplied RS partial-CANCELED fixture is a regression test; the view must not imply a completed cycle, blocked SELL admission, real exchange execution or verified provenance.

PR #1983 was merged into develop (merge commit `719260822dbde2a3be88fc7a264ad945c6b0fba7`). See the feature [Scenario Runner roadmap](./docs/features/gc-strategy-lab/RUNNER_ROADMAP.md) for implementation decisions and exact-head verification evidence.

## Scenario Runner pre-run intent diagrams — 2026-11-28

Issue [#1984](https://github.com/45s/coinzilla/issues/1984) / PR [#1988](https://github.com/45s/coinzilla/pull/1988) adds a source-reviewed explanation for every currently published RS runtime scenario and the preliminary RS-004-011 candidate. The selected scenario now shows its purpose, seeded starting state, deliberate condition/failure, expected flow, expected outcome and limitations before the user runs it. Unknown scenarios remain explicitly unmapped. These intent diagrams are separate from the post-run evidence-linked Run Story and do not change Harvester execution behavior.
