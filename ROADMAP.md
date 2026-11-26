# Repository roadmap

**Scope:** cross-workspace priorities only. App/package implementation backlogs belong in their owning roadmap and GitHub issues.
**Last reviewed:** 2026-11-26
**Current branch:** `develop`

> This page is an index, not a second task tracker. The full pre-cleanup roadmap was preserved at [ROOT_ROADMAP_HISTORY_2026-11-26](ROADMAP_HISTORY_2026-11-26.md).

## Active cross-workspace priorities

1. **Engineering standards and governance** — S-0 through S-10 are complete. Follow-ups and evidence remain tracked in [#1568](https://github.com/45s/coinzilla/issues/1568) and the [engineering standards matrix](docs/engineering/ENGINEERING_STANDARDS_MATRIX.md).
2. **Domain Scenario Testing** — use the accepted methodology and track remaining delivery in [#1779](https://github.com/45s/coinzilla/issues/1779).
3. **Executable CLI source identity** — continue the source-identity contract and acceptance work in [#1631](https://github.com/45s/coinzilla/issues/1631).
4. **Multi-provider Harvester execution and market-data routing** — owned by Harvester; canonical backlog [#1339](https://github.com/45s/coinzilla/issues/1339) and [Harvester roadmap](apps/harvester/ROADMAP.md).
5. **Exchange-neutral Broker API consistency** — canonical backlog [#1446](https://github.com/45s/coinzilla/issues/1446) and [Brokers roadmap](packages/brokers/ROADMAP.md).
6. **Release readiness** — keep [PR #1662](https://github.com/45s/coinzilla/pull/1662) in Draft until exact-head security checks and main/develop divergence are reconciled; do not bypass the release gate.

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
