# Repository documentation inventory

**Purpose:** current navigation and cleanup register—not a historical checkpoint ledger.
**Last tree audit:** `develop` at `fcfc11107ea077f96ee4af635ed66db8e01a4ea8` (2026-11-26); recursive tree verified before synchronizing PR #1864.
**Tracked Markdown files:** 215 on current `develop`; 216 on the synchronized cleanup PR tree, including its consolidated archive.
**Path-policy classification:** current `develop`: 178 maintained, 34 historical, 3 GitHub templates; synchronized cleanup PR: 178 maintained, 35 historical, 3 GitHub templates.
**Policy:** [Documentation Governance](DOCUMENTATION_GOVERNANCE.md).

> The previous detailed inventory and dated recursive checkpoints are preserved in [REPOSITORY_DOCUMENTATION_INVENTORY_2026-11-26](archive/roadmap-history-2026-11-26.md#inventory). This page is the current entry point; counts must be refreshed from the recursive Git tree when the inventory is audited again.

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

## Cleanup scope and disposition

The 2026-11-26 cleanup reduced active roadmap/status pages to concise owner, priority, and canonical-reference indexes. The consolidated archive preserves the prior contents of the pages shortened in this pass:

- [Root roadmap](../ROADMAP.md): cross-workspace priorities and ownership links.
- [Harvester roadmap](../apps/harvester/ROADMAP.md): current safety/correctness priorities.
- [Dashboard](../apps/dashboard/ROADMAP.md), [Database](../packages/db/ROADMAP.md), [Entities](../packages/entities/ROADMAP.md), and [Notifiers](../packages/notifiers/ROADMAP.md): active owner/status indexes.
- [Brokers](../packages/brokers/ROADMAP.md), [Event Bus](../packages/event-bus/ROADMAP.md), [Journal](../packages/journal/ROADMAP.md), and [Utils](../packages/utils/ROADMAP.md): active priorities and canonical contracts.
- [Harvester Journal integration](../apps/harvester/docs/JOURNAL_INTEGRATION_ROADMAP.md): active Step 8 closeout index. [Strategy-extensibility audit](../apps/harvester/docs/architecture/strategy-extensibility-audit-roadmap.md): historical pointer; its full discussion is archived. [Trading history](../apps/harvester/docs/persistence/trading-history-roadmap.md): retained canonical phased plan; only tracking/status references were corrected.
- [This inventory](REPOSITORY_DOCUMENTATION_INVENTORY.md): current canonical map and tree-specific count.
- The 2026-11-26 Harvester reliability baseline is retained as dated audit evidence and linked from the Harvester docs index; current priorities remain in the concise Harvester roadmap and issue #1639.

The complete prior roadmap contents and inventory checkpoint are preserved in the dated archive linked above. No application/package runtime source, domain specification, ADR, or audit evidence was deleted or rewritten. The Markdown path-policy tooling and its regression test were updated to classify this dated roadmap-history bundle as historical documentation.

The follow-up content review corrected stale Harvester architecture-index descriptions that still presented the completed strategy-extensibility work as an active S-3 roadmap, corrected the Harvester scenario-catalog index description, and made the superseded Domain First delivery plan's historical status consistent throughout. The strategy discussion remains discoverable through its short historical pointer and consolidated archive. The Harvester documentation inventory is now explicitly labeled as a frozen 2026-11-18 checkpoint, and the Recovery Seller roadmap indexes describe the completed RS-1–RS-5 implementation plus the remaining scenario, terminal-SELL/STOP and operator-resolution gates instead of an obsolete six-phase implementation plan. Current Markdown path-policy counts are centralized in this inventory; the governance and style standards now link here instead of embedding moving repository counts. The Database architecture index was also aligned with the concise active-priority roadmap rather than describing removed implementation phases.

## Next audit tasks

1. Review covered 17 roadmap/planning documents (excluding archived audit/history files): 11 were reduced to concise owner/status indexes, five specialized plans were retained while their work remains active, and the completed strategy-extensibility discussion was converted to a historical pointer. Retain the five specialized plans while their work remains active: [Scenario Runner](../apps/dashboard/docs/features/gc-strategy-lab/RUNNER_ROADMAP.md), [Bitunix Spot](../packages/brokers/docs/ROADMAP.md), [recovery seller implementation](../apps/harvester/docs/domain/recovery-seller-implementation-roadmap.md), [trading history](../apps/harvester/docs/persistence/trading-history-roadmap.md), and [indicators](../packages/indicators/ROADMAP.md). These are scoped implementation plans, not duplicate package-wide roadmaps. The completed strategy-extensibility discussion is now a short historical pointer; its full text is in the [consolidated archive](archive/roadmap-history-2026-11-26.md#strategy-extensibility-architecture-discussion).
2. Reviewed root and scoped `AGENTS.md` files. Retained domain ownership, architecture and safety constraints; removed redundant repository-wide Preflight, branch/PR lifecycle and remote-execution rules from Dashboard/Harvester instructions, which now defer to the root canonical workflow. Other scoped instructions remain where they express genuine domain-specific requirements. Do not remove domain safety text merely to reduce length.
3. Large audit/session/history documents remain evidence-bearing records. Retain source commit, limitations, and unique evidence; consolidate only demonstrably duplicated summaries after checking inbound references. The repository-engineering audit brief and audit report have different purposes and are not interchangeable.
4. Check inbound links before any later file deletion or rename; update the inventory only after the tree and link checks pass.
5. Refresh the Markdown count from a recursive tree at the commit being audited. Do not reuse prior checkpoint counts as current.

## Disposition rule

- **Keep** canonical current guidance, accepted decisions, specifications, and unique evidence.
- **Consolidate** duplicate summaries and repeated rules into one owned document.
- **Archive** completed plans and historical snapshots when provenance or evidence is useful.
- **Delete** only when the content is redundant, superseded, has no unique evidence, and all inbound references have been checked.

## Package roadmap consolidation — 2026-11-26

The second cleanup pass reduced four high-volume package roadmaps to active priority indexes and preserved their complete prior contents in the consolidated dated archive:

- [Brokers roadmap history](archive/roadmap-history-2026-11-26.md#brokers-roadmap) — prior 250 KB roadmap.
- [Journal roadmap history](archive/roadmap-history-2026-11-26.md#journal-roadmap) — prior 48 KB roadmap.
- [Event Bus roadmap history](archive/roadmap-history-2026-11-26.md#event-bus-roadmap) — prior 27 KB roadmap.
- [Utils roadmap history](archive/roadmap-history-2026-11-26.md#utils-roadmap) — prior 21 KB roadmap.

No package source, public API, tests, README, domain specification, or ADR was changed. Active pages now point to canonical API/readme/source and issues; detailed delivery evidence remains in the archive. It is provenance, not current instructions or status authority.

## Roadmap consolidation — 2026-11-26

Additional active roadmap pages were reduced to concise owner/status/next-action indexes; full prior contents were preserved in the consolidated archive:

- [Dashboard roadmap history](archive/roadmap-history-2026-11-26.md#dashboard-roadmap) — feature-specific Scenario Runner decisions remain in its dedicated roadmap.
- [Database roadmap history](archive/roadmap-history-2026-11-26.md#database-roadmap) — completed infrastructure delivery and provider-neutral contract notes.
- [Entities roadmap history](archive/roadmap-history-2026-11-26.md#entities-roadmap) — detailed FR contract execution notes.
- [Notifiers roadmap history](archive/roadmap-history-2026-11-26.md#notifiers-roadmap) — completed phases and validation records.
- [Harvester Journal integration history](archive/roadmap-history-2026-11-26.md#harvester-journal-integration) — staged PR-by-PR integration evidence; Step 8 closeout remains open.

The active pages now point to canonical READMEs, contracts, tests, issues, or feature roadmaps instead of repeating completed phase histories. The consolidated archive preserves provenance but is not current task-status authority. The original 214-file `develop` base had 178 maintained, 33 historical, and 3 GitHub templates. Current `develop` at `fcfc11107ea077f96ee4af635ed66db8e01a4ea8` has 215 files (178 maintained, 34 historical, 3 templates), including the new dated Harvester reliability report. The synchronized cleanup PR tree has 216 files (178 maintained, 35 historical, 3 templates); the consolidated roadmap archive is the one additional historical file.
