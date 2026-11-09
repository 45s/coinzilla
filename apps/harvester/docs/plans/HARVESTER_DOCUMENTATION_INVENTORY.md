# Harvester documentation inventory

- Status: Initial recursive inventory complete; 3 of 4 initial Harvester REVIEW candidates now have verified KEEP/SUPERSEDE dispositions; 1 remains REVIEW
- Type: Documentation inventory
- Owner: Harvester
- Inventory baseline: `develop` at `cea27e580f9f9bf3d7fa109b9e6353f68aef9ff2`
- Inventory date: 2026-11-09
- Tracking: [#795](https://github.com/45s/coinzilla/issues/795)
- Policy: [Documentation Governance](../../../../docs/DOCUMENTATION_GOVERNANCE.md)

## Scope and method

The GitHub recursive Git tree endpoint returned a complete tree (`truncated: false`) for the baseline commit. This inventory includes every tracked Markdown file under `apps/harvester/` at that baseline: **42 files**. File sizes are bytes from the Git tree.

Each document was fetched for a first-pass title, heading, date, link and purpose review. The file list and byte sizes remain the original recursive-tree baseline; content dispositions are updated as review progresses. **KEEP does not mean every statement is currently verified**; it means preserve the file at its current path and maintain its stated authority. REVIEW means no move, merge, split or archive is authorized until the stated questions and inbound references are resolved.

## Disposition rules

- **KEEP** — preserve current location and content for now; maintain its index and authority boundaries.
- **SUPERSEDE** — retain the prior document and its provenance, but clearly identify the successor and stop treating the old plan/guidance as current.
- **REVIEW** — investigate content, status and references before deciding whether to keep, merge, split, supersede or archive.
- No file is deleted or moved by this inventory.
- Historical reports, exchange exports, logs, evidence and completed AI task briefs are preserved.

## File-by-file inventory

| Path | Size (bytes) | Category | Current disposition | Rationale / next review |
| --- | ---: | --- | --- | --- |
| `apps/harvester/AGENTS.md` | 6404 | Governance | **KEEP** | Mandatory domain instructions; link to root governance and local index. |
| `apps/harvester/AUDIT.md` | 121678 | Historical evidence | **KEEP** | Primary Conservative audit record; preserve its baseline, findings and provenance. |
| `apps/harvester/AUDIT_DOGE_TRADES_2026-11-06.md` | 10187 | Historical evidence | **KEEP** | Exchange trade export snapshot; preserve raw rows and source references. |
| `apps/harvester/AUDIT_EXECUTION_HISTORY.md` | 48396 | Historical evidence | **KEEP** | Detailed order/fill chronology; distinct from findings register and audit narrative. |
| `apps/harvester/AUDIT_FINDINGS.md` | 129985 | Historical evidence | **KEEP** | Findings register with individual evidence status; do not merge by filename similarity. |
| `apps/harvester/AUDIT_LOG_EVIDENCE_2026-11-06.md` | 9832 | Historical evidence | **KEEP** | Integrity and log evidence addendum. |
| `apps/harvester/AUDIT_SESSION_2026-11-08.md` | 65234 | Historical evidence | **KEEP** | Reconnect incident/session audit snapshot. |
| `apps/harvester/AUDIT_SESSION_2026-11-08_16-33-33.md` | 32983 | Historical evidence | **KEEP** | Separate afternoon session snapshot; not a duplicate of the earlier 2026-11-08 report. |
| `apps/harvester/AUDIT_SESSION_2026-11-09_11-33-00.md` | 25236 | Historical evidence | **KEEP** | Recovery forensic session; filename uses local clock while title records UTC; assess naming only after inbound-link review. |
| `apps/harvester/AUDIT_ZRO_TRADES_2026-11-06.md` | 9500 | Historical evidence | **KEEP** | Exchange trade export snapshot; preserve raw rows and source references. |
| `apps/harvester/README.md` | 56063 | Entry point | **SPLIT** | Reworked into a 14 KB navigation/setup entry point; detailed procedures link to canonical architecture, Journal, logging and TESTNET guides; historical 2026-11-04 README notes preserved in `docs/audits/README_HISTORY.md`. |
| `apps/harvester/ROADMAP.md` | 274026 | Roadmap | **SPLIT** | Historical sections moved to `apps/harvester/docs/audits/ROADMAP_HISTORY.md`; 157 original headings remain as compatibility anchors. Active roadmap reduced from 273,540 to 101,170 characters. Further concision review remains. |
| `apps/harvester/docs/AUDIT_WORKING_RULES.md` | 653 | Agent/audit guidance | **KEEP** | Short pointer to repository-wide workflow; do not duplicate global policy. |
| `apps/harvester/docs/CONSERVATIVE_SESSION_AUDIT.md` | 5197 | Audit procedure | **KEEP** | Date-independent session audit checklist; strategy authority remains the canonical domain specification. |
| `apps/harvester/docs/DDD_CLEAN_ARCHITECTURE_AUDIT.md` | 46513 | Historical architecture audit | **KEEP** | Historical architecture assessment, not current architecture authority. |
| `apps/harvester/docs/DOMAIN_FIRST_DELIVERY_PLAN.md` | 3760 | Historical delivery plan | **SUPERSEDE** | Retained at its original path with an explicit 2026-11-09 superseded notice; current priorities are in `apps/harvester/ROADMAP.md` and Conservative rules remain solely in the canonical domain specification. Known inbound navigation link updated; historical checklist retained, not a current gate. |
| `apps/harvester/docs/INCIDENT_AUDIT_PLAYBOOK.md` | 13976 | Audit procedure | **KEEP** | Reusable incident evidence workflow; retain as the audit process guide. |
| `apps/harvester/docs/JOURNAL_EVIDENCE_CONTRACT.md` | 6889 | Contract | **KEEP** | Harvester-owned Journal evidence contract; verify against current event DTOs when changed. |
| `apps/harvester/docs/JOURNAL_INTEGRATION_ROADMAP.md` | 29252 | Detailed implementation plan | **KEEP** | Retains unique staged integration acceptance criteria and the still-open Step 8 closeout. Step 1–4 milestone/status text was reconciled with merged PRs #453, #455, #456 and #458; current runtime authority links to Journal Operations and Trading First. |
| `apps/harvester/docs/JOURNAL_OPERATIONS.md` | 30560 | Operations | **KEEP** | Current Journal operating and failure-handling guide; verify against runtime when changed. |
| `apps/harvester/docs/LOGGING.md` | 7923 | Operations | **KEEP** | Current logging guide. |
| `apps/harvester/docs/README.md` | 2332 | Index | **KEEP** | Harvester documentation entry point; expand with all local categories. |
| `apps/harvester/docs/TESTNET_VALIDATION_RUNBOOK.md` | 30942 | Safety runbook | **KEEP** | Controlled TESTNET procedure; preserve strict authorization and safety boundary; verify before use. |
| `apps/harvester/docs/TRADING_FIRST.md` | 33635 | Agent/product priority | **KEEP** | Canonical Harvester trading priority and exchange-safety entry point. |
| `apps/harvester/docs/architecture.md` | 54830 | Architecture | **KEEP** | Current application architecture; inspect embedded historical sections before any split. |
| `apps/harvester/docs/architecture/BROKER_HARVESTER_TRADING_FLOW.md` | 9306 | Architecture diagram | **KEEP** | Visual broker/Harvester flow; complementary to the text version. |
| `apps/harvester/docs/architecture/BROKER_HARVESTER_TRADING_FLOW_TEXT.md` | 7241 | Architecture diagram text | **KEEP** | Text alternative to the visual flow; do not assume duplicate without user/readability rationale. |
| `apps/harvester/docs/audits/INVESTIGATION_TEMPLATE.md` | 1102 | Template | **KEEP** | Reusable investigation template. |
| `apps/harvester/docs/audits/README.md` | 1005 | Index | **KEEP** | Historical audit/evidence index; include every application-level snapshot. |
| `apps/harvester/docs/domain/ACCOUNTING_INVARIANTS.md` | 9482 | Domain verification | **KEEP** | Accounting verification matrix; current verification status must remain explicit. |
| `apps/harvester/docs/domain/CONSERVATIVE_BEHAVIOR_BASELINE.md` | 1010 | Superseded pointer | **KEEP** | Already explicitly superseded and points to canonical spec; retain for inbound-link compatibility. |
| `apps/harvester/docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md` | 23090 | Canonical domain specification | **KEEP** | Sole authoritative Conservative behavior contract. |
| `apps/harvester/docs/domain/DOMAIN_GLOSSARY.md` | 6964 | Domain reference | **KEEP** | Domain vocabulary and responsibility boundaries. |
| `apps/harvester/docs/domain/portfolio.md` | 14533 | Domain reference | **KEEP** | Portfolio concepts and invariants; ensure it does not redefine strategy behavior. |
| `apps/harvester/docs/incidents/2026-11-05-user-data-stream-recovery.md` | 8105 | Incident record | **KEEP** | Dated incident record with source issue and evidence. |
| `apps/harvester/docs/infrastructure/broker-port-and-adapter.md` | 11802 | Infrastructure contract | **KEEP** | Harvester-owned broker port/adapter boundary. |
| `apps/harvester/docs/plans/DOCUMENTATION_MIGRATION.md` | 8818 | Migration plan | **KEEP** | Active phased documentation migration plan tracked by #795. |
| `apps/harvester/docs/tasks/AI_TASK_JOURNAL_INTEGRATION.md` | 4738 | Historical AI task brief | **KEEP** | Completed task handoff/history; not current agent policy or active task status. |
| `apps/harvester/docs/tasks/AI_TASK_TESTNET_INCIDENT_FOLLOWUP.md` | 16548 | Historical AI task brief | **KEEP** | Explicitly historical; old assertions defer to canonical domain specification. |
| `apps/harvester/docs/tasks/AI_TASK_USER_DATA_STREAM_RECOVERY.md` | 9681 | Historical AI task brief | **KEEP** | Implementation task history linked to #626/PR #627; not current agent policy. |
| `apps/harvester/docs/testnet-order-tools.md` | 16286 | Operational tool guide | **REVIEW** | Read-only/destructive command behavior was checked against package scripts; PR #808 corrected an invalid order-history argument example. Historical ownership-diagnostic notes partly overlap `ROADMAP_HISTORY.md` but include unique correlation fields; preserve them until exact provenance/timezone and inbound references are mapped before any split. |
| `apps/harvester/docs/trading-strategies.md` | 20794 | Strategy overview | **KEEP** | Conservative section delegates all behavior to the canonical domain specification; Aggressive is explicitly exploratory/disabled. Current implementation status now reflects merged PR #653, closed audit #645 and paused/unverified TESTNET acceptance. |

## Content-based findings

1. The root-level Conservative audit, findings register, execution history and trade/log/session records are distinct evidence artifacts with different roles. Similar topic or filename does not establish duplication.
2. `AUDIT_SESSION_2026-11-08.md` and `AUDIT_SESSION_2026-11-08_16-33-33.md` describe distinct sessions/time windows and must not be merged by date alone.
3. `CONSERVATIVE_BEHAVIOR_BASELINE.md` already declares itself superseded and points to the canonical domain specification. Preserve it for inbound-link compatibility.
4. `CONSERVATIVE_SESSION_AUDIT.md` is a reusable checklist, while `INCIDENT_AUDIT_PLAYBOOK.md` is a broader incident workflow; they serve different purposes.
5. The two broker/Harvester flow documents are visual and text alternatives, not automatically redundant.
6. Three `AI_TASK_*.md` files are task briefs/handoff history, not current agent policy. Their historical task context should remain discoverable but must not be treated as active instructions.
7. `ROADMAP.md` (274 KB), `README.md` (56 KB), `architecture.md` (54 KB), `AUDIT.md` (122 KB), and `AUDIT_FINDINGS.md` (130 KB) are large. Size alone is not grounds for splitting; identify mixed responsibilities and preserve every fact/reference before proposing a split.
8. `DOMAIN_FIRST_DELIVERY_PLAN.md` is superseded as a task tracker but retained at its original path; `trading-strategies.md` is a non-authoritative strategy overview whose Conservative content points to the canonical specification and whose Aggressive material remains exploratory.
9. `JOURNAL_INTEGRATION_ROADMAP.md` remains a useful active implementation plan because Step 8 is still open; its original Step 1–4 status notes were stale and have been reconciled with merged PRs and current operational documentation.
10. `testnet-order-tools.md` mixes current operator procedures with historical ownership diagnostics. `ROADMAP_HISTORY.md` preserves related 2026-11-03 evidence, but not the entire runbook block verbatim; some correlation fields are unique. Do not split until source commit, timezone and inbound references are established.
11. The TESTNET order-history example was corrected in [PR #808](https://github.com/45s/coinzilla/pull/808); the runbook's account-wide cancellation and ZRO-sale authorization boundaries were checked against current scripts.

## Remaining review work

- [ ] Trace inbound links for the remaining Harvester REVIEW candidate (`testnet-order-tools.md`) and both repository-wide Brokers REVIEW candidates, including issue/PR references and links in other documentation.
- [ ] Verify current status and source references for each large living document against `develop`.
- [ ] Determine whether any active guidance is duplicated or conflicts with canonical specifications.
- [ ] Create dated successor/addendum records where historical findings need correction; do not rewrite originals.
- [ ] Record final disposition and rationale for each REVIEW row.
- [ ] Update this inventory and all indexes after each approved migration.
