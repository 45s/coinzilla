# Harvester documentation inventory

- Status: Frozen 42-file baseline dispositions complete; all 4 initial Harvester REVIEW candidates have verified KEEP/SUPERSEDE dispositions; 15 post-baseline additions are recorded below; no current Harvester REVIEW candidates remain
- Type: Documentation inventory
- Owner: Harvester
- Inventory baseline: `develop` at `cea27e580f9f9bf3d7fa109b9e6353f68aef9ff2`
- Latest recursive checkpoint: `develop` at `86f9c1d4d7a012e628dcd1b7b68b2354e4073045` (`truncated: false`; 57 Harvester Markdown/MDX files; PR #950 added no paths after the PR #951 archive relocation)
- Inventory date: 2026-11-09 (baseline); latest verification: 2026-11-10
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
| `apps/harvester/AUDIT.md` | 121678 | Historical evidence | **MOVE** | Primary Conservative audit record; moved to `apps/harvester/docs/audits/reports/AUDIT.md` in PR #951; preserve baseline, findings and provenance. |
| `apps/harvester/AUDIT_DOGE_TRADES_2026-11-06.md` | 10187 | Historical evidence | **MOVE** | Exchange trade export snapshot; moved to `apps/harvester/docs/audits/evidence/AUDIT_DOGE_TRADES_2026-11-06.md` in PR #951; preserve raw rows and source references. |
| `apps/harvester/AUDIT_EXECUTION_HISTORY.md` | 48396 | Historical evidence | **MOVE** | Detailed order/fill chronology; moved to `apps/harvester/docs/audits/reports/AUDIT_EXECUTION_HISTORY.md` in PR #951; remains distinct from findings register and audit narrative. |
| `apps/harvester/AUDIT_FINDINGS.md` | 129985 | Historical evidence | **MOVE** | Findings register with individual evidence status; moved to `apps/harvester/docs/audits/reports/AUDIT_FINDINGS.md` in PR #951; do not merge by filename similarity. |
| `apps/harvester/AUDIT_LOG_EVIDENCE_2026-11-06.md` | 9832 | Historical evidence | **MOVE** | moved to `apps/harvester/docs/audits/evidence/AUDIT_LOG_EVIDENCE_2026-11-06.md` in PR #951; integrity and log evidence addendum. |
| `apps/harvester/AUDIT_SESSION_2026-11-08.md` | 65234 | Historical evidence | **MOVE** | moved to `apps/harvester/docs/audits/sessions/AUDIT_SESSION_2026-11-08.md` in PR #951; reconnect incident/session audit snapshot. |
| `apps/harvester/AUDIT_SESSION_2026-11-08_16-33-33.md` | 32983 | Historical evidence | **MOVE** | moved to `apps/harvester/docs/audits/sessions/AUDIT_SESSION_2026-11-08_16-33-33.md` in PR #951; distinct afternoon session snapshot, not a duplicate of the earlier 2026-11-08 report. |
| `apps/harvester/AUDIT_SESSION_2026-11-09_11-33-00.md` | 25236 | Historical evidence | **MOVE** | moved to `apps/harvester/docs/audits/sessions/AUDIT_SESSION_2026-11-09_11-33-00.md` in PR #951; recovery forensic session; original filename/timezone note retained. |
| `apps/harvester/AUDIT_ZRO_TRADES_2026-11-06.md` | 9500 | Historical evidence | **MOVE** | Exchange trade export snapshot; moved to `apps/harvester/docs/audits/evidence/AUDIT_ZRO_TRADES_2026-11-06.md` in PR #951; preserve raw rows and source references. |
| `apps/harvester/README.md` | 56063 | Entry point | **SPLIT** | Reworked into a 14 KB navigation/setup entry point; detailed procedures link to canonical architecture, Journal, logging and TESTNET guides; historical 2026-11-04 README notes preserved in `docs/audits/README_HISTORY.md`. Current default pair is ZROFDUSD only (PR #836); the illustrative ZROUSDT example is explicitly distinguished from live config and the runbook hold; the interactive menu and its read-only audit/destructive action boundaries are linked to their canonical guides. |
| `apps/harvester/ROADMAP.md` | 274026 | Roadmap | **SPLIT** | Historical sections moved to `apps/harvester/docs/audits/ROADMAP_HISTORY.md`; 157 original headings remain as compatibility anchors. Active roadmap reduced from 273,540 to 101,170 characters. Current TESTNET blockers now include the PR #836 pair-scope mismatch; the earlier pair statement is explicitly historical. Further concision review remains. |
| `apps/harvester/docs/AUDIT_WORKING_RULES.md` | 653 | Agent/audit guidance | **KEEP** | Short pointer to repository-wide workflow; do not duplicate global policy. |
| `apps/harvester/docs/CONSERVATIVE_SESSION_AUDIT.md` | 5197 | Audit procedure | **KEEP** | Date-independent session audit checklist; strategy authority remains the canonical domain specification. |
| `apps/harvester/docs/DDD_CLEAN_ARCHITECTURE_AUDIT.md` | 46513 | Historical architecture audit | **KEEP** | Historical architecture assessment, not current architecture authority. |
| `apps/harvester/docs/DOMAIN_FIRST_DELIVERY_PLAN.md` | 3760 | Historical delivery plan | **SUPERSEDE** | Retained at its original path with an explicit 2026-11-09 superseded notice; current priorities are in `apps/harvester/ROADMAP.md` and Conservative rules remain solely in the canonical domain specification. Known inbound navigation link updated; historical checklist retained, not a current gate. |
| `apps/harvester/docs/INCIDENT_AUDIT_PLAYBOOK.md` | 13976 | Audit procedure | **KEEP** | Reusable incident evidence workflow; retain as the audit process guide. |
| `apps/harvester/docs/JOURNAL_EVIDENCE_CONTRACT.md` | 6889 | Contract | **KEEP** | Harvester-owned Journal evidence contract; verify against current event DTOs when changed. |
| `apps/harvester/docs/JOURNAL_INTEGRATION_ROADMAP.md` | 29252 | Detailed implementation plan | **KEEP** | Retains unique staged integration acceptance criteria and the still-open Step 8 closeout. Step 1–4 milestone/status text was reconciled with merged PRs #453, #455, #456 and #458; current runtime authority links to Journal Operations and Trading First. |
| `apps/harvester/docs/JOURNAL_OPERATIONS.md` | 36399 | Operations | **KEEP** | Source-verified Journal operations, per-process session-directory layout, cumulative diagnostic locations, legacy history reading, and separate process/writer locks. |
| `apps/harvester/docs/LOGGING.md` | 10688 | Operations | **KEEP** | Source-verified cumulative and per-process log destinations, session identity, append/exclusive-create behavior, and terminal capture. |
| `apps/harvester/docs/README.md` | 2332 | Index | **KEEP** | Harvester documentation entry point; runbook link now surfaces the CLOSED / PAUSED pair-scope mismatch and directs readers to reconcile before any future session. |
| `apps/harvester/docs/TESTNET_VALIDATION_RUNBOOK.md` | 30942 | Safety runbook | **KEEP** | Controlled TESTNET procedure; preserves the prior DOGEUSDT/ZROUSDT plan as historical evidence, records PR #836's ZROFDUSD-only config, and blocks execution until scope is reconciled; strict authorization and regional pause remain. |
| `apps/harvester/docs/TRADING_FIRST.md` | 33635 | Agent/product priority | **KEEP** | Canonical Harvester trading priority and exchange-safety entry point. |
| `apps/harvester/docs/architecture.md` | 54830 | Architecture | **KEEP** | Current application architecture; inspect embedded historical sections before any split. |
| `apps/harvester/docs/architecture/BROKER_HARVESTER_TRADING_FLOW.md` | 9306 | Architecture diagram | **KEEP** | Visual broker/Harvester flow; complementary to the text version. |
| `apps/harvester/docs/architecture/BROKER_HARVESTER_TRADING_FLOW_TEXT.md` | 7241 | Architecture diagram text | **KEEP** | Text alternative to the visual flow; do not assume duplicate without user/readability rationale. |
| `apps/harvester/docs/audits/INVESTIGATION_TEMPLATE.md` | 1102 | Template | **KEEP** | Reusable investigation template. |
| `apps/harvester/docs/audits/README.md` | 1005 | Index | **KEEP** | Historical audit/evidence index; include every application-level snapshot. |
| `apps/harvester/docs/domain/ACCOUNTING_INVARIANTS.md` | 9482 | Domain verification | **KEEP** | Accounting verification matrix; current verification status must remain explicit. |
| `apps/harvester/docs/domain/CONSERVATIVE_BEHAVIOR_BASELINE.md` | 1010 | Superseded pointer | **KEEP** | Already explicitly superseded and points to canonical spec; retain for inbound-link compatibility. |
| `apps/harvester/docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md` | 23090 | Canonical domain specification | **KEEP** | Sole authoritative Conservative behavior contract; minimum-profit denomination is quote-asset units, including the current ZROFDUSD/FDUSD configuration. |
| `apps/harvester/docs/domain/DOMAIN_GLOSSARY.md` | 6964 | Domain reference | **KEEP** | Domain vocabulary and responsibility boundaries. |
| `apps/harvester/docs/domain/portfolio.md` | 14533 | Domain reference | **KEEP** | Portfolio concepts and invariants; ensure it does not redefine strategy behavior. |
| `apps/harvester/docs/incidents/2026-11-05-user-data-stream-recovery.md` | 8105 | Incident record | **KEEP** | Dated incident record with source issue and evidence. |
| `apps/harvester/docs/infrastructure/broker-port-and-adapter.md` | 11802 | Infrastructure contract | **KEEP** | Harvester-owned broker port/adapter boundary. |
| `apps/harvester/docs/plans/DOCUMENTATION_MIGRATION.md` | 8818 | Migration plan | **KEEP** | Active phased documentation migration plan tracked by #795. |
| `apps/harvester/docs/tasks/AI_TASK_JOURNAL_INTEGRATION.md` | 4738 | Historical AI task brief | **KEEP** | Completed task handoff/history; not current agent policy or active task status. |
| `apps/harvester/docs/tasks/AI_TASK_TESTNET_INCIDENT_FOLLOWUP.md` | 16548 | Historical AI task brief | **KEEP** | Explicitly historical; old assertions defer to canonical domain specification. |
| `apps/harvester/docs/tasks/AI_TASK_USER_DATA_STREAM_RECOVERY.md` | 9681 | Historical AI task brief | **KEEP** | Implementation task history linked to #626/PR #627; not current agent policy. |
| `apps/harvester/docs/testnet-order-tools.md` | 16286 | Operational tool guide | **KEEP** | Current standalone TESTNET command procedures and destructive authorization boundaries are checked against package scripts; PR #808 corrected the history argument example. Current ownership diagnostics are aligned with `create-user-data-event-handler.js` and `OrderRegistry`; dated `666845`/client-ID investigation snapshots now point to `ROADMAP_HISTORY.md` rather than posing as current instructions. The ZROUSDT market-sell helper and ZROUSDT/DOGEUSDT history defaults are explicitly labeled legacy and not authorized by the paused runbook; the interactive menu is documented as a wrapper for order tools plus the exchange-read-only account audit and local Journal audit; the account-wide cancel is explicitly marked as proceeding without interactive confirmation. Inbound links from `apps/harvester/README.md` and `docs/README.md` are preserved. |
| `apps/harvester/docs/trading-strategies.md` | 20794 | Strategy overview | **KEEP** | Conservative section delegates all behavior to the canonical domain specification; Aggressive is explicitly exploratory/disabled. Current implementation status now reflects merged PR #653, closed audit #645 and paused/unverified TESTNET acceptance. |

## Post-baseline additions — current 57-file checkpoint

The 42-file table above remains a frozen baseline. A complete recursive Git tree comparison at `dcb0b64ece84ea2f3a41f5a110e559a01797ac6d` (`truncated: false`) finds **57 tracked Harvester Markdown/MDX files**: 15 additions relative to the 42-file baseline. PR #951 added three audit-category indexes and relocated nine historical records without changing the total file count for those records; PRs #964 and #968 subsequently updated living roadmap, operations and domain-accounting guidance without adding or removing Markdown/MDX paths. Additions are recorded separately so the original baseline byte sizes and paths remain intact.

| Added path | Purpose | Disposition |
| --- | --- | --- |
| `apps/harvester/docs/architecture/README.md` | Local index for Harvester architecture documentation. | **KEEP** |
| `apps/harvester/docs/audits/README_HISTORY.md` | Preserved historical README material and navigation. | **KEEP** |
| `apps/harvester/docs/audits/ROADMAP_HISTORY.md` | Preserved historical roadmap material, provenance and compatibility anchors. | **KEEP** |
| `apps/harvester/docs/domain/README.md` | Local index for Harvester domain documentation. | **KEEP** |
| `apps/harvester/docs/domain/DOMAIN_TEST_INVENTORY.md` | Source-driven behavior-to-test map, regression evidence and prioritized domain test-quality improvements (added in PR #917). | **KEEP** |
| `apps/harvester/docs/error-vocabulary.md` | Maintained source-verified error vocabulary and recovery classifications. | **KEEP** |
| `apps/harvester/docs/incidents/README.md` | Local index for Harvester incident records. | **KEEP** |
| `apps/harvester/docs/infrastructure/README.md` | Local index for Harvester infrastructure documentation. | **KEEP** |
| `apps/harvester/docs/operations/README.md` | Local index for Harvester operating procedures and runbooks. | **KEEP** |
| `apps/harvester/docs/plans/HARVESTER_DOCUMENTATION_INVENTORY.md` | This file; detailed Harvester documentation inventory and disposition record. | **KEEP** |
| `apps/harvester/docs/plans/README.md` | Local index for Harvester plans and migration tracking. | **KEEP** |
| `apps/harvester/docs/tasks/README.md` | Local index for Harvester task records and historical handoffs. | **KEEP** |
| `apps/harvester/docs/audits/reports/README.md` | Index for historical audit narratives, findings and execution chronology (PR #951). | **KEEP** |
| `apps/harvester/docs/audits/sessions/README.md` | Index for distinct historical session audits (PR #951). | **KEEP** |
| `apps/harvester/docs/audits/evidence/README.md` | Index for read-only exchange exports and log-integrity evidence (PR #951). | **KEEP** |

## Content-based findings

1. The Conservative audit, findings register, execution history and trade/log/session records are distinct evidence artifacts with different roles. PR #951 moved them into reports, sessions and evidence archives; similar topic or filename does not establish duplication.
2. `AUDIT_SESSION_2026-11-08.md` and `AUDIT_SESSION_2026-11-08_16-33-33.md` describe distinct sessions/time windows and must not be merged by date alone.
3. `CONSERVATIVE_BEHAVIOR_BASELINE.md` already declares itself superseded and points to the canonical domain specification. Preserve it for inbound-link compatibility.
4. `CONSERVATIVE_SESSION_AUDIT.md` is a reusable checklist, while `INCIDENT_AUDIT_PLAYBOOK.md` is a broader incident workflow; they serve different purposes.
5. The two broker/Harvester flow documents are visual and text alternatives, not automatically redundant.
6. Three `AI_TASK_*.md` files are task briefs/handoff history, not current agent policy. Their historical task context should remain discoverable but must not be treated as active instructions.
7. The baseline sizes of `ROADMAP.md`, `README.md`, and `architecture.md` identify the largest living documents for separate content review. The large historical audit records are now grouped under `docs/audits/`; size alone is not grounds for splitting or rewriting evidence.
8. `DOMAIN_FIRST_DELIVERY_PLAN.md` is superseded as a task tracker but retained at its original path; `trading-strategies.md` is a non-authoritative strategy overview whose Conservative content points to the canonical specification and whose Aggressive material remains exploratory.
9. `JOURNAL_INTEGRATION_ROADMAP.md` remains a useful active implementation plan because Step 8 is still open; its original Step 1–4 status notes were stale and have been reconciled with merged PRs and current operational documentation.
10. `testnet-order-tools.md` remains the canonical TESTNET operator guide. Historical ownership findings are preserved in `ROADMAP_HISTORY.md`; current diagnostics now document the source-confirmed `OWNERSHIP_INTEGRITY` fields and broker-order-ID-first registry behavior. No further split is justified because command procedures and current troubleshooting form one operational subject.
11. The TESTNET order-history example was corrected in [PR #808](https://github.com/45s/coinzilla/pull/808); the runbook's account-wide cancellation and ZRO-sale authorization boundaries were checked against current scripts.
12. PR #964 updated the living roadmap, Journal Operations and Trading First guidance for authoritative recovery of ambiguous order identity and shutdown ownership. The `UNKNOWN → OPEN` transition requires a matching owned client order ID and assigned broker order ID; duplicates are idempotent, conflicts remain rejected, and uncertain placement is never retried. Startup status uses validated `TRADING_MODE`, not `NODE_ENV`.
13. PR #968 updated the living roadmap, Accounting Invariants, Domain Test Inventory and Portfolio domain guidance for snapshot-relative account allocation. Each account snapshot captures quote cash flow, total Portfolio base (active plus retained free), and active BUY/SELL commitments by asset ID; allocation applies only post-snapshot deltas while pair-specific investment and active SELL inventory remain separate. The eight required scenario families and recovery event-sequence recapture are covered; exact PR #968 head passed 914/914 offline Harvester tests and all seven workflows. No TESTNET/account operation was performed.

## Remaining review work

- [x] Trace inbound links for `testnet-order-tools.md`: Harvester README sections for standalone order/balance/history/trade tools and the Harvester documentation index both point to the canonical runbook; both links remain valid.
- [x] Resolve all initial Harvester REVIEW candidates with evidence-based KEEP/SUPERSEDE dispositions.
- [ ] Verify current status and source references for each large living document against `develop`.
- [ ] Determine whether any active guidance is duplicated or conflicts with canonical specifications.
- [ ] Create dated successor/addendum records where historical findings need correction; do not rewrite originals.
- [ ] Record final disposition and rationale for each REVIEW row.
- [ ] Update this inventory and all indexes after each approved migration.
