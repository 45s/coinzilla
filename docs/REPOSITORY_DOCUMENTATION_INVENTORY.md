# Repository documentation inventory

**Purpose:** current navigation and cleanup register—not a historical checkpoint ledger.
**Last tree audit:** `develop` at `f46c198cc4d5f4adfaf0a8ca9364fea1cc72f2b5` (2026-11-26).
**Tracked Markdown files:** 213 at this tree snapshot.
**Policy:** [Documentation Governance](DOCUMENTATION_GOVERNANCE.md).

> The previous detailed inventory and dated recursive checkpoints are preserved in [REPOSITORY_DOCUMENTATION_INVENTORY_2026-11-26](archive/inventories/REPOSITORY_DOCUMENTATION_INVENTORY_2026-11-26.md). This page is the current entry point; counts must be refreshed from the recursive Git tree when the inventory is audited again.

## Canonical sources by information type

| Information | Single source of truth |
| --- | --- |
| Repository overview and setup | Root [README](../README.md) |
| Agent instructions | Root [AGENTS.md](../AGENTS.md), with scoped instructions only where needed |
| Engineering requirements | [ENGINEERING_STANDARDS.md](../ENGINEERING_STANDARDS.md) and linked canonical standards |
| Agent branch/PR/handoff workflow | [AI_AGENT_WORKFLOW.md](../AI_AGENT_WORKFLOW.md) |
| Cross-workspace active priorities | Root [ROADMAP.md](../ROADMAP.md) |
| App/package active priorities | Owning app/package `ROADMAP.md` |
| Runtime/domain behavior | Accepted domain specification and tests |
| Architecture decisions | Accepted ADR in the owning architecture directory |
| Work status and task details | GitHub Issue / PR |
| Audit/session facts | Dated audit report and its evidence artifacts; historical, not behavior authority |

## Current cleanup scope

The first cleanup pass targets these oversized active documents:

- [Root roadmap](../ROADMAP.md): active cross-workspace priorities and ownership links only.
- [Harvester roadmap](../apps/harvester/ROADMAP.md): current safety/correctness priorities only.
- [This inventory](REPOSITORY_DOCUMENTATION_INVENTORY.md): current canonical map and audit baseline only.

The original contents are preserved in the dated snapshots linked above. No source code, domain specification, ADR, or audit evidence was deleted or rewritten in this pass.

## Next audit tasks

1. Review the 17 roadmap files; determine whether each package needs a roadmap or can use GitHub Issues plus a concise README status link.
2. Audit root and scoped `AGENTS.md` files for duplicated mandatory rules; keep root instructions short and scoped instructions genuinely local.
3. Review large audit/session/history documents for duplicate summaries, retaining unique evidence and provenance.
4. Check inbound links before any later file deletion or rename; update the inventory only after the tree and link checks pass.
5. Refresh the Markdown count from a recursive tree at the commit being audited. Do not reuse prior checkpoint counts as current.

## Disposition rule

- **Keep** canonical current guidance, accepted decisions, specifications, and unique evidence.
- **Consolidate** duplicate summaries and repeated rules into one owned document.
- **Archive** completed plans and historical snapshots when provenance or evidence is useful.
- **Delete** only when the content is redundant, superseded, has no unique evidence, and all inbound references have been checked.


## Package roadmap consolidation — 2026-11-26

The second cleanup pass reduced four high-volume package roadmaps to active priority indexes and preserved their complete prior contents as dated snapshots:

- [Brokers roadmap history](archive/roadmaps/BROKERS_ROADMAP_HISTORY_2026-11-26.md) — prior 250 KB roadmap.
- [Journal roadmap history](archive/roadmaps/JOURNAL_ROADMAP_HISTORY_2026-11-26.md) — prior 48 KB roadmap.
- [Event Bus roadmap history](archive/roadmaps/EVENT_BUS_ROADMAP_HISTORY_2026-11-26.md) — prior 27 KB roadmap.
- [Utils roadmap history](archive/roadmaps/UTILS_ROADMAP_HISTORY_2026-11-26.md) — prior 21 KB roadmap.

No package source, public API, tests, README, domain specification, or ADR was changed. Active pages now point to canonical API/readme/source and issues; detailed delivery evidence remains in the snapshots. These snapshots are archival provenance, not current instructions or status authority.
