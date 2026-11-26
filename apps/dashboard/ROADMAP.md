# Dashboard application roadmap

**Owner:** Dashboard application
**Tracking:** [Issue #1623](https://github.com/45s/coinzilla/issues/1623)

## Active dashboard priorities

- **Scenario Runner / GC Strategy Lab:** active production-flow work is tracked in [#1836](https://github.com/45s/coinzilla/issues/1836) and the [dedicated feature roadmap](./docs/features/gc-strategy-lab/RUNNER_ROADMAP.md). Foundation [PR #1837](https://github.com/45s/coinzilla/pull/1837) is merged; [PR #1887](https://github.com/45s/coinzilla/pull/1887) adds the under-target FILLED SELL runtime/STOP scenario. STOP-persistence failure and BUY-only STOP admission coverage are implemented in PR #1887; other infrastructure-failure cases and trusted OS-level sandbox attestation remain incomplete; keep execution fail-closed.
- **Operator-console/full-record inspection:** Dashboard foundation issue [#1623](https://github.com/45s/coinzilla/issues/1623) is closed by [PR #1627](https://github.com/45s/coinzilla/pull/1627) and does not track a persisted Orders/Fills/Commissions inspection feature. No matching open Dashboard issue was found. Do not present this as active work until it has a dedicated issue; when scoped, render persisted fields from the authoritative backend/API rather than demo-only view models.
- Keep backend/API integration authoritative. Do not add UI-only pause state or call exchange APIs from the browser.

- **StarAdmin dashboard redesign — PR #1873 / Issue #1872:** warm light default theme, preserved selectable themes, contextual Brokers/Bots navigation, compact GitHub PR labels with direct assignment controls, persistent refresh action and light native dropdown options. Presentation-only; no API or trading behavior changes.
- **Contextual navigation refinement — PR #1877 / Issue #1877:** keep the five-item persistent sidebar; reduce Brokers to Markets / Orders / History, with Open Orders / Exchanges nested under Orders and Fills / Commissions under History. Keep the Bots tabs Operators / Orders / Positions / Portfolio. Preserve all existing pages.

- **Theme surface contrast regression — Issue #1876:** ensure shared feature surfaces, controls and tables resolve the selected palette's semantic tokens, including System mode in both OS color schemes.
- **Markets theme consistency — Issue #1878 / PR #1879:** replace feature-level fixed dark neutral colors with active Dashboard theme tokens so the Markets page honors StarAdmin Warm Light and all selectable palettes. Presentation-only; no market-data or trading behavior changes.

## Canonical sources

- Dashboard behavior and setup: [README](./README.md)
- Feature-specific Scenario Runner implementation and decisions: [Scenario Runner roadmap](./docs/features/gc-strategy-lab/RUNNER_ROADMAP.md)
- Current task state: linked GitHub issues and PRs

Detailed prior roadmap, including completed design decisions and historical runner notes, is preserved in [ROADMAP_HISTORY_2026-11-26.md](../../docs/archive/roadmap-history-2026-11-26.md#dashboard-roadmap).
