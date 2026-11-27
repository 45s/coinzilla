# Repository roadmap

**Scope:** cross-workspace priorities only. App/package implementation backlogs belong in their owning roadmap and GitHub issues.
**Last reviewed:** 2026-11-27
**Target branch:** `develop`

> This page is an index, not a second task tracker. The full pre-cleanup roadmap was preserved at [ROOT_ROADMAP_HISTORY_2026-11-26](docs/archive/roadmap-history-2026-11-26.md#root-roadmap).

## Active cross-workspace priorities

1. **Repository-wide scenario catalog** — continue source-grounded behavior mapping and named-test traceability in [#1783](https://github.com/45s/coinzilla/issues/1783) and the [Scenario Catalog](docs/testing/SCENARIO_CATALOG.md).
2. **Recovery Seller scenario coverage** — Harvester-owned matrix and evidence remain active in [#1780](https://github.com/45s/coinzilla/issues/1780); use the completed, canonical [Domain Scenario Testing methodology](docs/testing/DOMAIN_SCENARIO_TESTING.md) rather than redefining it.
3. **Executable CLI source identity** — continue the source-identity contract and acceptance work in [#1631](https://github.com/45s/coinzilla/issues/1631).
4. **Multi-provider Harvester execution and market-data routing** — owned by Harvester; canonical backlog [#1339](https://github.com/45s/coinzilla/issues/1339) and [Harvester roadmap](apps/harvester/ROADMAP.md).
5. **Release readiness** — [PR #1662](https://github.com/45s/coinzilla/pull/1662) was closed without merge on 2026-11-27. No active release PR exists; reconcile the `main`/`develop` divergence (7,371 commits ahead / 1 behind at this review) before the next promotion. CodeQL was disabled by the repository owner and is no longer an automated release check; this does not clear historical alerts.

**Completed governance:** initiative [#1568](https://github.com/45s/coinzilla/issues/1568) (S-0 through S-10) and recurring review [#1633](https://github.com/45s/coinzilla/issues/1633) are closed/merged. The [engineering standards matrix](docs/engineering/ENGINEERING_STANDARDS_MATRIX.md) remains the canonical standards index; the owner-confirmed CodeQL disablement, ruleset verification limits, and deferred JSDoc pilot are recorded in the [governance review](docs/engineering/REPOSITORY_GOVERNANCE_REVIEW.md), not as active roadmap tasks. The exchange-neutral Broker API initiative [#1446](https://github.com/45s/coinzilla/issues/1446) is complete; its contract remains in [BROKER_API.md](packages/brokers/BROKER_API.md), while Bitunix safety blockers remain tracked separately.

## Ownership map

| Area | Canonical roadmap / contract |
| --- | --- |
| Harvester | [apps/harvester/ROADMAP.md](apps/harvester/ROADMAP.md) |
| Dashboard | [apps/dashboard/ROADMAP.md](apps/dashboard/ROADMAP.md) |
| Brokers | [packages/brokers/ROADMAP.md](packages/brokers/ROADMAP.md) |
| Other shared packages | Each package's `ROADMAP.md`, `README.md`, and `AGENTS.md` |
| Cross-workspace engineering | [Engineering standards](ENGINEERING_STANDARDS.md), [standards matrix](docs/engineering/ENGINEERING_STANDARDS_MATRIX.md) |
| Agent collaboration | [AI agent workflow](AI_AGENT_WORKFLOW.md) |
| Documentation policy | [Documentation governance](docs/DOCUMENTATION_GOVERNANCE.md) |

## Roadmap maintenance

- Keep only current priorities, blockers, owner, and links here.
- Do not copy detailed task plans, implementation history, test logs, or completed issue narratives into this file.
- GitHub Issues are the task/status source of truth; accepted specifications and ADRs are the behavior/decision source of truth.
- When work completes, update the owning issue/roadmap and remove it from active priorities. Preserve significant historical evidence in its existing audit or history record.
- Review this index monthly and verify every linked priority is still open and relevant.
